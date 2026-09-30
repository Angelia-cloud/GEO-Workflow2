-- =====================================================================
-- 09_workflow2.sql — Workflow 2 (monthly run) additions from the architecture diagram.
-- Run after 01, 02, 06, 07 and 08. Safe to re-run.
--
--   Auto alerts           → intelligence.insight_type 'alert' (sharp score drops)
--   Insight review        → intelligence.status + human_feedback.intelligence_id
--   Learning memory       → learning_memory: what a reviewer changed, at which step, and why
--   Agent versions        → agent_versions: the prompt/rule text each agent ran with
--   Outcome logging       → recommendation_outcomes: before/after score for actioned recommendations
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Insights: alerts + human review
-- ---------------------------------------------------------------------
alter table public.intelligence drop constraint if exists intelligence_insight_type_check;
alter table public.intelligence add constraint intelligence_insight_type_check
  check (insight_type in ('visibility_summary','visibility_gap','competitor_threat','trend','alert','other',
                          'INTENT_WEAKNESS','ENGINE_WEAKNESS','COMPETITOR_VISIBILITY_GAP','VISIBILITY_DECLINE'));

alter table public.intelligence add column if not exists status text not null default 'draft';
alter table public.intelligence drop constraint if exists intelligence_status_check;
alter table public.intelligence add constraint intelligence_status_check
  check (status in ('draft','approved','rejected'));
alter table public.intelligence add column if not exists reviewed_by text;
alter table public.intelligence add column if not exists reviewed_at timestamptz;

alter table public.human_feedback add column if not exists intelligence_id uuid
  references public.intelligence(id) on delete cascade;
alter table public.human_feedback drop constraint if exists human_feedback_check;
alter table public.human_feedback drop constraint if exists human_feedback_one_target;
alter table public.human_feedback add constraint human_feedback_one_target
  check (num_nonnulls(recommendation_id, diagnosis_id, evidence_id, measurement_id, intelligence_id) = 1);

-- ---------------------------------------------------------------------
-- 2. Agent versions (layer 3: agent_versions)
-- ---------------------------------------------------------------------
do $$
declare idx record;
begin
  if to_regclass('public.agent_versions') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'agent_versions'
         and column_name = 'prompt_hash'
     ) then
    if to_regclass('public.agent_versions_legacy') is not null then
      raise exception 'Legacy agent_versions table exists; review it before migrating again';
    end if;
    alter table public.agent_versions rename to agent_versions_legacy;
    for idx in select indexname from pg_indexes
               where schemaname = 'public' and tablename = 'agent_versions_legacy'
    loop
      execute format('alter index public.%I rename to %I', idx.indexname, left(idx.indexname || '_legacy', 63));
    end loop;
  end if;
end $$;

create table if not exists public.agent_versions (
  id           uuid primary key default gen_random_uuid(),
  step         text not null check (step in ('insight','diagnosis','recommendation','prompt_generation','alert')),
  prompt_hash  text not null,              -- sha256 of prompt_text; a new hash = a new version
  prompt_text  text not null,              -- system prompt or rule definition the agent ran with
  model        text,
  created_at   timestamptz not null default now(),
  unique (step, prompt_hash)
);
alter table public.diagnoses add column if not exists agent_version_id uuid
  references public.agent_versions(id) on delete set null;
update public.diagnoses d set agent_version_id = null
where agent_version_id is not null
  and not exists (select 1 from public.agent_versions v where v.id = d.agent_version_id);
alter table public.diagnoses drop constraint if exists diagnoses_agent_version_id_fkey;
alter table public.diagnoses add constraint diagnoses_agent_version_id_fkey
  foreign key (agent_version_id) references public.agent_versions(id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. Learning memory (layer 3: stores what changed, at which step and why)
-- ---------------------------------------------------------------------
do $$
declare idx record;
begin
  if to_regclass('public.learning_memory') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'learning_memory'
         and column_name = 'entity_table'
     ) then
    if to_regclass('public.learning_memory_legacy') is not null then
      raise exception 'Legacy learning_memory table exists; review it before migrating again';
    end if;
    alter table public.learning_memory rename to learning_memory_legacy;
    for idx in select indexname from pg_indexes
               where schemaname = 'public' and tablename = 'learning_memory_legacy'
    loop
      execute format('alter index public.%I rename to %I', idx.indexname, left(idx.indexname || '_legacy', 63));
    end loop;
  end if;
end $$;

create table if not exists public.learning_memory (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references public.properties(id) on delete cascade,
  step          text not null check (step in ('measurement','insight','diagnosis','recommendation','report')),
  entity_table  text not null,
  entity_id     uuid not null,
  action        text not null check (action in ('edit','reject','approve','comment')),
  before        jsonb not null default '{}',
  after         jsonb not null default '{}',
  reason        text,
  reviewer      text,
  feeds_agent   boolean not null default true,   -- false = don't show this correction to agents
  created_at    timestamptz not null default now()
);
create index if not exists learning_memory_step_idx on public.learning_memory (property_id, step, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Outcome logging (layer 3: feedback — before/after score)
-- ---------------------------------------------------------------------
-- Preserve the pre-Workflow 2 table shape; CREATE IF NOT EXISTS cannot upgrade it.
do $$
begin
  if to_regclass('public.recommendation_outcomes') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'recommendation_outcomes'
         and column_name = 'window_days'
     ) then
    if to_regclass('public.recommendation_outcomes_legacy') is not null then
      raise exception 'Legacy recommendation_outcomes table exists; review it before migrating again';
    end if;
    alter table public.recommendation_outcomes rename to recommendation_outcomes_legacy;
  end if;
end $$;

create table if not exists public.recommendation_outcomes (
  recommendation_id  uuid primary key references public.recommendations(id) on delete cascade,
  property_id        uuid not null references public.properties(id) on delete cascade,
  prompt_id          uuid not null references public.prompts(id) on delete cascade,
  intent_id          uuid references public.intents(id) on delete set null,
  done_on            date not null,
  window_days        int  not null default 28,
  before_answers     int,
  before_visibility  numeric(6,2),
  before_detection   numeric(6,2),
  after_answers      int,
  after_visibility   numeric(6,2),
  after_detection    numeric(6,2),
  intent_before_visibility numeric(6,2),
  intent_after_visibility  numeric(6,2),
  logged_by          text,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Review queue view: add owner / due date / impact / outcome
-- ---------------------------------------------------------------------
drop view if exists public.v_recommendation_queue;
create view public.v_recommendation_queue with (security_invoker = on) as
select r.id as recommendation_id, r.title, r.detail, r.action_type, r.priority, r.status,
       r.created_at, d.id as diagnosis_id, d.diagnosis_type, d.severity, d.root_cause,
       d.confidence_score as diagnosis_confidence, d.status as diagnosis_status, d.generated_by,
       f.property_id, f.intent, f.prompt_text, f.engine, f.measured_at, f.measurement_id,
       (select count(*) from public.human_feedback hf where hf.recommendation_id = r.id) as feedback_count,
       r.owner, r.due_date, r.expected_impact, r.updated_at,
       case d.diagnosis_type
         when 'content_gap' then 'Relevance'
         when 'entity_confusion' then 'Clarity'
         when 'negative_sentiment' then 'Clarity'
         when 'citation_gap' then 'Credibility'
         when 'competitor_dominance' then 'Credibility'
         else 'Unclear' end as lens,
       o.done_on, o.before_visibility, o.after_visibility, o.after_answers
from public.recommendations r
left join public.diagnoses d on d.id = r.diagnosis_id
join public.v_measurements_flat f on f.measurement_id = r.measurement_id
left join public.recommendation_outcomes o on o.recommendation_id = r.id;

-- activity log for the new tables
do $$
declare t text;
begin
  foreach t in array array['learning_memory','recommendation_outcomes'] loop
    execute format('drop trigger if exists %I_activity on public.%I', t, t);
  end loop;
  execute 'create trigger learning_memory_activity after insert or update or delete on public.learning_memory
           for each row execute function public.log_activity()';
end $$;

-- RLS, same policy as the rest of the schema
do $$
declare t text;
begin
  foreach t in array array['agent_versions','learning_memory','recommendation_outcomes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_authenticated_all on public.%I', t, t);
    execute format('create policy %I_authenticated_all on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;
