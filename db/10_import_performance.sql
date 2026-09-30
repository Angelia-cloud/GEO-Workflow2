-- Support batch-scoped maintenance during confirmed imports.
create index if not exists measurements_import_batch_idx on public.measurements (import_batch);