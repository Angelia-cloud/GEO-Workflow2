-- =====================================================================
-- 12 · Data provenance. Safe to re-run.
-- Measurements carry a text `import_batch`. This table says whether a batch is real RankScale data.
-- Batches flagged 'synthetic' stay in `measurements` (nothing is deleted or edited) but are excluded from
-- v_measurements_flat, so every dashboard, report, diagnosis queue and the chatbot sees verified data only.
-- Batches with no row here are treated as verified.
-- =====================================================================
create table if not exists public.import_batch_provenance (
  import_batch text primary key,
  data_origin  text not null check (data_origin in ('verified', 'synthetic', 'unverified')),
  note         text,
  flagged_by   text,
  flagged_at   timestamptz not null default now()
);
alter table public.import_batch_provenance enable row level security;

insert into public.import_batch_provenance (import_batch, data_origin, note, flagged_by) values
  ('889c8d26-e332-40de-9ae5-0ca2fd2bc27b', 'synthetic',
   'Rankscale_major_impact_synthetic_600_rows.csv: 600 rows, responses begin "SYNTHETIC TEST RESULT:", every row brand-found. Test upload, not RankScale measurements.',
   'stage1-reconciliation'),
  ('65ddf4af-6fb8-4187-8b71-ce34e9e896d5', 'synthetic',
   '54 "Lantern Bay" test rows (3 extra prompts, dated 1 Jul and 2 Oct) that extended the live report window. Not RankScale measurements.',
   'stage1-reconciliation')
on conflict (import_batch) do update set data_origin = excluded.data_origin, note = excluded.note;

-- same columns as before; only the WHERE clause is new
create or replace view public.v_measurements_flat with (security_invoker = on) as
select m.id                         as measurement_id,
       p.id                         as property_id,
       p.name                       as property_name,
       i.id                         as intent_id,
       i.name                       as intent,
       pr.id                        as prompt_id,
       pr.prompt_text,
       e.name                       as engine,
       m.measured_at,
       date_trunc('week', m.measured_at)::date as week_start,
       m.brand_found,
       coalesce(m.brand_found_any_alias, m.brand_found) as brand_found_any_alias,
       m.own_brand_rank,
       m.own_brand_sentiment,
       m.brands_total,
       m.visibility_score_30d,
       m.used_web_search,
       m.import_batch
from public.measurements m
join public.prompts pr    on pr.id = m.prompt_id
join public.intents i     on i.id = pr.intent_id
join public.properties p  on p.id = i.property_id
join public.engines e     on e.id = m.engine_id
where not exists (select 1 from public.import_batch_provenance b
                  where b.import_batch = m.import_batch and b.data_origin <> 'verified');
