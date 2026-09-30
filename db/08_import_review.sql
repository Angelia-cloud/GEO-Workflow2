-- Per-upload temporary rows for the explicit validate → map → review → save flow.
-- `import_batches` remains the durable workflow/audit record; this table isolates
-- normalized rows between requests without writing measurements before confirmation.
create table if not exists public.import_review_rows (
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  row_data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, row_number)
);

-- IDs captured during human mapping. These staging-only columns let the
-- existing normalized loader honor reviewed IDs without label-based joins.
alter table public.stg_rankscale_export add column if not exists mapped_property_id uuid;
alter table public.stg_rankscale_export add column if not exists mapped_prompt_id uuid;
alter table public.stg_rankscale_export add column if not exists mapped_engine_id uuid;
alter table public.stg_rankscale_export add column if not exists mapped_competitor_ids jsonb not null default '{}'::jsonb;

alter table public.import_review_rows enable row level security;
drop policy if exists import_review_rows_authenticated_all on public.import_review_rows;
create policy import_review_rows_authenticated_all on public.import_review_rows
  for all to authenticated using (true) with check (true);
