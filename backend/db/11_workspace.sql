-- =====================================================================
-- 11 · Workspace tables for the React app (Prompt + Rankscale phases)
-- Run after 10_import_performance.sql. Safe to re-run.
--
--   properties        + client_name / target_audience / goals  (a "client" in the UI)
--   team_members      accounts shown on the sign-in screen
--   library_entries   saved files, prompt workbooks, generated reports and reviews
--   library_files     the original uploaded file behind a library entry
--   rankscale_imports one row per Rankscale file a client uploads
--   rankscale_records every Rankscale answer row, de-duplicated per client
-- Prompt-setup runs (Phase 1) reuse prompt_generation_runs with
-- inputs->>'workflow' = 'prompt_setup'.
-- =====================================================================

alter table public.properties add column if not exists client_name text;   -- shown in the client picker
alter table public.properties add column if not exists team_name text;     -- 'Client / team' in Phase 1
alter table public.properties add column if not exists target_audience text not null default '';
alter table public.properties add column if not exists goals text not null default '';

create table if not exists public.team_members (
  id          text primary key,
  name        text not null,
  role        text not null default 'Team member',
  initials    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.library_entries (
  id          text primary key,
  type        text not null check (type in ('sheet', 'data', 'review', 'upload', 'report')),
  client_id   uuid references public.properties(id) on delete set null,
  data        jsonb not null default '{}',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists library_entries_client_idx on public.library_entries (client_id, created_at desc);

create table if not exists public.library_files (
  entry_id      text primary key references public.library_entries(id) on delete cascade,
  file_name     text not null,
  content_type  text,
  size_bytes    bigint not null,
  content       bytea not null,
  uploaded_at   timestamptz not null default now()
);

create table if not exists public.rankscale_imports (
  id             text primary key,
  client_id      uuid not null references public.properties(id) on delete cascade,
  imported_at    timestamptz not null default now(),
  file_name      text,
  imported_by    text,
  status         text not null default 'loaded',
  rows_processed int,
  rows_total     int,
  rows_added     int,
  duplicates     int,
  answers_added  int,
  file_size      bigint,
  follow_up      jsonb not null default '{}'   -- measurement load + auto alerts, when the file allows it
);
create index if not exists rankscale_imports_client_idx on public.rankscale_imports (client_id, imported_at desc);

create table if not exists public.rankscale_records (
  client_id              uuid not null references public.properties(id) on delete cascade,
  id                     text not null,          -- hash of every source field: identical rows collapse
  answer_id              text not null,          -- one AI answer (several rows can share it)
  ts                     timestamptz not null,
  day                    date not null,
  engine                 text not null,
  prompt                 text not null,
  answer                 text not null default '',
  brand_reference        text not null default '',
  topic                  text not null default '',
  brand_found            boolean,
  brand_name_mentioned   text not null default '',
  brand_rank             int,
  sentiment              numeric,
  source                 jsonb not null default '{}',
  source_fields          jsonb not null default '{}',
  import_id              text references public.rankscale_imports(id) on delete set null,
  primary key (client_id, id)
);
create index if not exists rankscale_records_day_idx on public.rankscale_records (client_id, day);
create index if not exists rankscale_records_answer_idx on public.rankscale_records (client_id, answer_id);

-- row level security, matching the other tables
do $$
declare t text;
begin
  foreach t in array array['team_members','library_entries','library_files','rankscale_imports','rankscale_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)',
                   t || '_authenticated_all', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seed data: the sign-in account and the starting client list
-- ---------------------------------------------------------------------
insert into public.team_members (id, name, role, initials)
values ('vy-huynh', 'Vy Huynh', 'Team member', 'VH')
on conflict (id) do nothing;

insert into public.properties (name, brand_group, location, website_url, aliases, client_name, team_name, target_audience, goals)
values
  ('InterContinental Sydney Coogee Beach', 'IHG', 'Coogee, Sydney NSW', 'https://coogeebeach.intercontinental.com',
   array['InterContinental Sydney Coogee Beach'], 'InterContinental Sydney Coogee Beach', 'InterContinental Sydney Coogee Beach marketing team',
   'Sydney leisure, business and occasion-led travellers',
   'Build consideration for coastal, family and wellness stays; strengthen business, dining and occasion-led discovery.'),
  ('Crowne Plaza Canberra', 'IHG', 'Canberra ACT', null, array['Crowne Plaza Canberra'], 'Crowne Plaza Canberra', null, '', ''),
  ('Holiday Inn Potts Point', 'IHG', 'Potts Point, Sydney NSW', null, array['Holiday Inn Potts Point'], 'Holiday Inn Potts Point', null, '', ''),
  ('Voco Gold Coast', 'IHG', 'Gold Coast QLD', null, array['Voco Gold Coast'], 'Voco Gold Coast', null, '', '')
on conflict (name) do update
  set client_name = coalesce(public.properties.client_name, excluded.client_name),
      team_name = coalesce(public.properties.team_name, excluded.team_name),
      target_audience = case when public.properties.target_audience = '' then excluded.target_audience
                             else public.properties.target_audience end,
      goals = case when public.properties.goals = '' then excluded.goals else public.properties.goals end;

-- the Coogee prompt workbook that already exists in Google Sheets
insert into public.library_entries (id, type, client_id, data, created_by)
select 'reference-property-workbook', 'sheet', p.id,
       jsonb_build_object(
         'title', 'Komosion GEO — Engine Intent & Prompt Review',
         'client', p.name, 'property', p.name,
         'sheetUrl', 'https://docs.google.com/spreadsheets/d/1EhRUo3rB9yT4x0Vu9sdQWGyUSa2-7VuTQuZqC4u7-AM/edit',
         'status', 'reference', 'isReference', true, 'createdBy', 'Existing project link'),
       'Existing project link'
from public.properties p where p.name = 'InterContinental Sydney Coogee Beach'
on conflict (id) do nothing;
