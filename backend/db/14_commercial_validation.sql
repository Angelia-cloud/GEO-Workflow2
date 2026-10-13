-- =====================================================================
-- 14 · Commercial validation. Safe to re-run.
--  * intent_business_priorities: what the HOTEL has told us about each search intent. Every column is
--    nullable and nothing is pre-filled: an intent with no row, or a row that is not confirmed and complete,
--    is reported as "Commercial validation required". Nothing here is inferred or estimated by the platform.
--  * intent_business_priority_history: append-only audit trail of every change and who made it.
--  * opportunity_assessments: the saved result of combining a verified visibility gap (RankScale) with the
--    hotel's confirmed priority, with the evidence used. Visibility figures and commercial status are stored
--    in separate columns and never blended into one score.
-- =====================================================================
create table if not exists public.intent_business_priorities (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references public.properties(id) on delete cascade,
  intent_id             uuid not null references public.intents(id) on delete cascade,
  commercial_importance text check (commercial_importance in ('high','medium','low')),
  revenue_potential     numeric check (revenue_potential >= 0),
  revenue_currency      text,
  revenue_basis         text,
  strategic_relevance   text check (strategic_relevance in ('high','medium','low')),
  feasibility           text check (feasibility in ('high','medium','low')),
  confirmation_status   text not null default 'not_provided'
                        check (confirmation_status in ('not_provided','proposed','confirmed')),
  evidence_source       text,
  confirmed_by          text references public.team_members(id),
  confirmed_at          timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (intent_id),
  check (confirmation_status <> 'confirmed'
         or (evidence_source is not null and length(trim(evidence_source)) > 0
             and confirmed_by is not null and confirmed_at is not null)),
  check (revenue_potential is null or (revenue_currency is not null and revenue_basis is not null))
);
create index if not exists intent_business_priorities_property_idx on public.intent_business_priorities (property_id);

create table if not exists public.intent_business_priority_history (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  intent_id   uuid not null references public.intents(id) on delete cascade,
  snapshot    jsonb not null,
  changed_by  text not null references public.team_members(id),
  changed_at  timestamptz not null default now()
);
create index if not exists intent_business_priority_history_idx on public.intent_business_priority_history (intent_id, changed_at desc);

create table if not exists public.opportunity_assessments (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references public.properties(id) on delete cascade,
  intent_id          uuid not null references public.intents(id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  visibility_gap     numeric,
  gap_status         text not null check (gap_status in ('gap','no_gap','insufficient_data')),
  commercial_status  text not null check (commercial_status in ('Commercial validation required','Commercially validated')),
  validation_missing text[] not null default '{}',
  priority_rank      integer,
  proposed_action    text,
  action_kind        text not null default 'potential_geo_improvement',
  rationale          text,
  evidence           jsonb not null default '{}'::jsonb,
  priority_snapshot  jsonb,
  generated_at       timestamptz not null default now(),
  unique (intent_id, period_start, period_end)
);
create index if not exists opportunity_assessments_property_idx on public.opportunity_assessments (property_id, period_start);

alter table public.intent_business_priorities enable row level security;
alter table public.intent_business_priority_history enable row level security;
alter table public.opportunity_assessments enable row level security;
