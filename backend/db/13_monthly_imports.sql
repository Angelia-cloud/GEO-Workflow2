-- =====================================================================
-- 13 · Monthly RankScale imports. Safe to re-run.
--  * import_batches gets provenance for each upload: property, file hash, date coverage, per-month
--    breakdown, duplicates skipped and the error text of a failed import.
--  * measurement_import_conflicts keeps the version of an observation from a later export that differs
--    from the one already stored. The stored measurement is never overwritten.
-- Months are always derived from measurements.measured_at in Australia/Sydney; nothing is stored per month.
-- =====================================================================
alter table public.import_batches
  add column if not exists property_id        uuid references public.properties(id),
  add column if not exists source_sha256      text,
  add column if not exists date_from          timestamptz,
  add column if not exists date_to            timestamptz,
  add column if not exists months             jsonb,
  add column if not exists duplicates_skipped integer,
  add column if not exists conflicts_found    integer,
  add column if not exists error              text,
  add column if not exists completed_at       timestamptz;

create index if not exists import_batches_property_idx on public.import_batches (property_id, created_at desc);

create table if not exists public.measurement_import_conflicts (
  id                uuid primary key default gen_random_uuid(),
  import_batch      text not null,
  property_id       uuid not null references public.properties(id),
  measurement_id    uuid not null references public.measurements(id) on delete cascade,
  prompt_id         uuid not null,
  engine_id         uuid not null,
  measured_at       timestamptz not null,
  stored            jsonb not null,   -- what Supabase kept (brand_found, rank)
  incoming          jsonb not null,   -- what the later export said
  created_at        timestamptz not null default now(),
  unique (import_batch, measurement_id)
);
create index if not exists measurement_import_conflicts_property_idx on public.measurement_import_conflicts (property_id, measured_at);
alter table public.measurement_import_conflicts enable row level security;
drop policy if exists measurement_import_conflicts_authenticated_all on public.measurement_import_conflicts;
create policy measurement_import_conflicts_authenticated_all on public.measurement_import_conflicts
  for all to authenticated using (true) with check (true);
