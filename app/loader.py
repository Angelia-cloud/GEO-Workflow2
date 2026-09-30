"""Load validated rows into the V1 tables.

Flow (one transaction — all or nothing):
  1. take an advisory lock so two uploads can't interleave
  2. empty stg_rankscale_export and COPY the clean rows into it
  3. run db/03_load_rankscale.sql (the same script used manually in Supabase)
  4. count what was added, empty the staging table, record the batch
"""
from __future__ import annotations

import json
import uuid

from psycopg import sql as pgsql
from psycopg.types.json import Jsonb

from .db import connect, sql_file
from .ingest import KEEP, IngestReport

LOCK_KEY = 874203  # arbitrary constant for pg_advisory_xact_lock

COUNT_SQL = """
select (select count(*) from measurements)          as measurements,
       (select count(*) from measurement_mentions)  as mentions,
       (select count(*) from evidence)              as evidence,
       (select count(*) from prompts)               as prompts,
       (select count(*) from competitors)           as competitors
"""


def own_brand_match(name: str, aliases: list[str], prop_name: str) -> bool:
    """Python twin of public.is_own_brand() — used before anything is written."""
    n = (name or "").strip().lower()
    for a in list(aliases or []) + [prop_name]:
        a = a.strip().lower()
        if a.endswith("*") and n.startswith(a[:-1]):
            return True
        if n == a:
            return True
    return False


def check_brand_references(conn, rows: list[dict], rep: IngestReport) -> None:
    props = conn.execute("select name, aliases from properties").fetchall()
    refs = {r["brand_reference"] for r in rows}
    unmatched = [ref for ref in refs
                 if not any(own_brand_match(ref, p["aliases"], p["name"]) for p in props)]
    if unmatched and props:
        n = sum(1 for r in rows if r["brand_reference"] in unmatched)
        rep.warnings.append({"message": f"{n} rows are for a brand that isn't set up as a property yet "
                                        "and will be skipped. Add the property (with aliases) first.",
                             "brand_references": sorted(unmatched)})


def load_rows(rows: list[dict], rep: IngestReport, uploaded_by: str | None = None) -> dict:
    with connect() as conn:
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
            return load_rows_in_transaction(conn, rows, rep, uploaded_by)


def load_rows_in_transaction(conn, rows: list[dict], rep: IngestReport,
                              uploaded_by: str | None = None,
                              mapped_rows: list[dict] | None = None,
                              batch_id: str | uuid.UUID | None = None) -> dict:
    """Run the existing SQL loader inside a caller-owned transaction."""
    batch_id = uuid.UUID(str(batch_id)) if batch_id else uuid.uuid4()
    if mapped_rows is not None and len(mapped_rows) != len(rows):
        raise ValueError("Mapped row metadata must align one-to-one with validated rows")
    mapping_columns = ["mapped_property_id", "mapped_prompt_id", "mapped_engine_id", "mapped_competitor_ids"]
    copy_columns = KEEP + (mapping_columns if mapped_rows is not None else [])
    conn.execute("truncate public.stg_rankscale_export")
    cols = pgsql.SQL(", ").join(pgsql.Identifier(column) for column in copy_columns)
    copy_stmt = pgsql.SQL("copy public.stg_rankscale_export ({}) from stdin").format(cols)
    with conn.cursor().copy(copy_stmt) as cp:
        for index, row in enumerate(rows):
            values = [row.get(column) for column in KEEP]
            if mapped_rows is not None:
                mapping = mapped_rows[index]
                values.extend([mapping.get("property_id"), mapping.get("prompt_id"),
                               mapping.get("engine_id"), Jsonb(mapping.get("competitor_ids", {}))])
            cp.write_row(values)
    if mapped_rows is not None:
        complete = conn.execute("""
                        with incoming as (
                            select distinct mapped_prompt_id as prompt_id, mapped_engine_id as engine_id,
                                         "timestamp"::timestamptz as measured_at
                            from public.stg_rankscale_export
                            where mapped_prompt_id is not null and mapped_engine_id is not null
                        ),
                        measured as (
                            select s.*, m.id as measurement_id
                            from public.stg_rankscale_export s
                            join public.measurements m on m.prompt_id = s.mapped_prompt_id
                                and m.engine_id = s.mapped_engine_id and m.measured_at = s."timestamp"::timestamptz
                        ),
                        ranked as (
                            select distinct s.measurement_id, v.rank, trim(v.name) as brand_name,
                                         public.is_own_brand(s.mapped_property_id, v.name) as is_own_brand
                            from measured s
                            cross join lateral (values
                                (1,s.rank1_brandname),(2,s.rank2_brandname),(3,s.rank3_brandname),
                                (4,s.rank4_brandname),(5,s.rank5_brandname),(6,s.rank6_brandname),
                                (7,s.rank7_brandname),(8,s.rank8_brandname),(9,s.rank9_brandname),
                                (10,s.rank10_brandname),(11,s.rank11_brandname),(12,s.rank12_brandname),
                                (13,s.rank13_brandname),(14,s.rank14_brandname),(15,s.rank15_brandname)
                            ) v(rank,name)
                            where nullif(trim(v.name),'') is not null
                                and not public.is_ignored_name(s.mapped_property_id,v.name)
                        ),
                        citations as (
                            select s.measurement_id, null::uuid as competitor_id, 'own_brand'::text as attributed_to,
                                         s.brand_citations as urls, 0.80::numeric as score,
                                         'Cited by the AI engine and attributed to our property by Rankscale; not manually checked'::text as basis,
                                         s."timestamp"::timestamptz as captured_at
                            from measured s
                            union all
                            select s.measurement_id,
                                         coalesce(nullif(s.mapped_competitor_ids ->> trim(v.name),'')::uuid,c.id),
                                         'competitor',v.urls,0.80,
                                         'Cited by the AI engine and attributed to this competitor by Rankscale; not manually checked',
                                         s."timestamp"::timestamptz
                            from measured s
                            cross join lateral (values
                                (s.rank1_brandname,s.rank1_citations),(s.rank2_brandname,s.rank2_citations),
                                (s.rank3_brandname,s.rank3_citations),(s.rank4_brandname,s.rank4_citations),
                                (s.rank5_brandname,s.rank5_citations),(s.rank6_brandname,s.rank6_citations),
                                (s.rank7_brandname,s.rank7_citations),(s.rank8_brandname,s.rank8_citations),
                                (s.rank9_brandname,s.rank9_citations),(s.rank10_brandname,s.rank10_citations),
                                (s.rank11_brandname,s.rank11_citations),(s.rank12_brandname,s.rank12_citations),
                                (s.rank13_brandname,s.rank13_citations),(s.rank14_brandname,s.rank14_citations),
                                (s.rank15_brandname,s.rank15_citations)
                            ) v(name,urls)
                            join public.competitors c on c.id=coalesce(
                                nullif(s.mapped_competitor_ids ->> trim(v.name),'')::uuid,
                                (select c2.id from public.competitors c2 where c2.name=trim(v.name)))
                            union all
                            select measurement_id,null::uuid,'unattributed',other_citations,0.50,
                                         'Cited in the AI answer but not linked to a specific brand by Rankscale',
                                         "timestamp"::timestamptz
                            from measured
                        ),
                        expected_evidence as (
                            select distinct c.measurement_id,c.competitor_id,c.attributed_to,trim(u.url) as url
                            from citations c cross join lateral regexp_split_to_table(c.urls, ',(?=https?://)') u(url)
                            where nullif(trim(c.urls),'') is not null and trim(u.url) ~ '^https?://'
                        )
                        select
                            (select count(*) from incoming) =
                                (select count(*) from incoming i join public.measurements m
                                     on m.prompt_id=i.prompt_id and m.engine_id=i.engine_id and m.measured_at=i.measured_at)
                            and not exists (
                                select 1 from ranked r left join public.measurement_mentions mm
                                    on mm.measurement_id=r.measurement_id and mm.rank=r.rank
                                where mm.id is null or mm.brand_name_raw is distinct from r.brand_name
                                     or mm.is_own_brand is distinct from r.is_own_brand
                            )
                            and not exists (
                                select 1 from expected_evidence x left join public.evidence e
                                    on e.measurement_id=x.measurement_id and e.url=x.url
                                 and e.attributed_to=x.attributed_to and e.competitor_id is not distinct from x.competitor_id
                                where e.id is null
                            ) as complete
            """).fetchone()["complete"]
        if complete:
            conn.execute("truncate public.stg_rankscale_export")
            return {"batch_id": str(batch_id),
                    "added": {"measurements": 0, "mentions": 0, "evidence": 0,
                              "prompts": 0, "competitors": 0}}
    before = conn.execute(COUNT_SQL).fetchone()
    conn.execute("select set_config('geo.import_batch', %s, true)", (str(batch_id),))
    conn.execute(sql_file("03_load_rankscale.sql"))
    if conn.execute("select to_regproc('public.seed_coogee_report') is not null as ok").fetchone()["ok"]:
        conn.execute("select public.seed_coogee_report()")
    if conn.execute("select to_regproc('public.classify_neutral_prompts') is not null as ok").fetchone()["ok"]:
        conn.execute("select public.classify_neutral_prompts()")
    after = conn.execute(COUNT_SQL).fetchone()
    conn.execute("truncate public.stg_rankscale_export")
    added = {key: after[key] - before[key] for key in after}
    if mapped_rows is None:
        conn.execute(
            """insert into import_batches (id, filename, uploaded_by, status, rows_in_file, rows_valid,
                                           rows_rejected, measurements_added, mentions_added,
                                           evidence_added, report)
               values (%s, %s, %s, 'loaded', %s, %s, %s, %s, %s, %s, %s)""",
            (batch_id, rep.filename, uploaded_by, rep.rows_in_file, rep.rows_valid, rep.rows_rejected,
             added["measurements"], added["mentions"], added["evidence"],
             json.dumps(rep.as_dict(), default=str)))
    return {"batch_id": str(batch_id), "added": added}


def record_rejected(rep: IngestReport, uploaded_by: str | None = None) -> str:
    batch_id = uuid.uuid4()
    with connect() as conn:
        conn.execute(
            """insert into import_batches (id, filename, uploaded_by, status, rows_in_file, rows_valid,
                                           rows_rejected, report)
               values (%s, %s, %s, 'rejected', %s, %s, %s, %s)""",
            (batch_id, rep.filename, uploaded_by, rep.rows_in_file, rep.rows_valid, rep.rows_rejected,
             json.dumps(rep.as_dict(), default=str)))
        conn.commit()
    return str(batch_id)
