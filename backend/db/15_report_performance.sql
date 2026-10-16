-- =====================================================================
-- 15 · Report performance. Safe to re-run.
-- v_answer_scores looked up each answer's own-brand mention by aggregating measurement_mentions for
-- EVERY property before filtering, so each report query scanned the whole mentions table. The own-brand
-- lookup is now done per answer (unique index on measurement_mentions(measurement_id, rank)).
-- Same columns, same values; only the plan changes.
-- =====================================================================
create or replace view public.v_answer_scores with (security_invoker = on) as
select f.measurement_id, f.property_id, f.intent_id, f.intent, f.prompt_id, f.engine, f.measured_at,
       (f.measured_at at time zone 'Australia/Sydney')::date as day,
       coalesce(pr.is_neutral, true) as is_neutral,
       f.brand_found                                                   as found_rs,
       case when f.brand_found then f.own_brand_rank end               as rank_rs,
       case when f.brand_found then f.own_brand_sentiment end          as sentiment_rs,
       f.brand_found_any_alias                                         as found_any,
       case when f.brand_found_any_alias then least(f.own_brand_rank, own.rank) end as rank_any,
       case when f.brand_found_any_alias then coalesce(f.own_brand_sentiment, own.sentiment) end as sentiment_any
from public.v_measurements_flat f
join public.prompts pr on pr.id = f.prompt_id
left join lateral (
  select min(mm.rank) as rank, (array_agg(mm.sentiment order by mm.rank))[1] as sentiment
  from public.measurement_mentions mm
  where mm.measurement_id = f.measurement_id and mm.is_own_brand
) own on true;

-- Reports filter answers by Sydney calendar day.
create index if not exists measurements_sydney_day_idx
  on public.measurements (((measured_at at time zone 'Australia/Sydney')::date));
-- Own-brand lookups per answer.
create index if not exists measurement_mentions_own_idx
  on public.measurement_mentions (measurement_id, rank) where is_own_brand;
