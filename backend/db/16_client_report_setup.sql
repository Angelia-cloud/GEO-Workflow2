-- =====================================================================
-- 16 · Per-client report setup. Safe to re-run.
-- Everything that used to be written into the SQL for InterContinental Sydney Coogee Beach — its own
-- names, own web domains, the words that mark a question as naming the hotel, the comparison hotels and
-- the baseline — is now client data, edited in Settings → Report setup. Coogee keeps its values: they
-- are written once here (only where Coogee has none yet) and never overwritten again by an upload.
-- =====================================================================

-- short name used in report sentences ("Coogee Beach"); empty → derived from the property name
alter table public.properties add column if not exists short_name text;

-- A question names the hotel when it contains one of the client's own names (aliases, property name)
-- or one of its extra terms (outlets, suburb, venue) in neutral_exclusion_terms. Such questions are
-- tracked but left out of the competitor comparison. Before this, a client without terms had every
-- question counted as neutral.
create or replace function public.classify_neutral_prompts() returns void
language sql as $$
  with terms as (
    select t.property_id, t.term from public.neutral_exclusion_terms t
    union
    select p.id, rtrim(a, '*') from public.properties p, unnest(p.aliases || p.name) a
    where length(rtrim(a, '*')) >= 3
  ),
  wanted as (
    select p.id, not exists (
             select 1 from terms t
             where t.property_id = i.property_id and p.prompt_text ilike '%' || t.term || '%') as neutral
    from public.prompts p join public.intents i on i.id = p.intent_id
  )
  update public.prompts p set is_neutral = w.neutral
  from wanted w
  where w.id = p.id and p.is_neutral is distinct from w.neutral;
$$;

-- Re-apply a client's own / ignored names to the answers already loaded (after the names change).
create or replace function public.refresh_property_names(p_property_id uuid) returns void
language plpgsql as $$
begin
  -- names that are now ignored: neither us nor a competitor
  delete from public.measurement_mentions mm
  using public.measurements m, public.prompts pr, public.intents i
  where m.id = mm.measurement_id and pr.id = m.prompt_id and i.id = pr.intent_id
    and i.property_id = p_property_id and public.is_ignored_name(p_property_id, mm.brand_name_raw);

  -- names that are now ours
  update public.measurement_mentions mm set is_own_brand = true, competitor_id = null
  from public.measurements m, public.prompts pr, public.intents i
  where m.id = mm.measurement_id and pr.id = m.prompt_id and i.id = pr.intent_id
    and i.property_id = p_property_id and not mm.is_own_brand
    and public.is_own_brand(p_property_id, mm.brand_name_raw);

  -- names that are no longer ours: they are competitors again
  insert into public.competitors (name)
  select distinct trim(mm.brand_name_raw)
  from public.measurement_mentions mm
  join public.measurements m on m.id = mm.measurement_id
  join public.prompts pr on pr.id = m.prompt_id
  join public.intents i on i.id = pr.intent_id
  where i.property_id = p_property_id and mm.is_own_brand
    and not public.is_own_brand(p_property_id, mm.brand_name_raw)
  on conflict (name) do nothing;

  update public.measurement_mentions mm
  set is_own_brand = false,
      competitor_id = (select c.id from public.competitors c where c.name = trim(mm.brand_name_raw))
  from public.measurements m, public.prompts pr, public.intents i
  where m.id = mm.measurement_id and pr.id = m.prompt_id and i.id = pr.intent_id
    and i.property_id = p_property_id and mm.is_own_brand
    and not public.is_own_brand(p_property_id, mm.brand_name_raw);

  -- answers that mention us under any of our names
  update public.measurements m
  set brand_found_any_alias = m.brand_found or exists (
        select 1 from public.measurement_mentions mm where mm.measurement_id = m.id and mm.is_own_brand)
  from public.prompts pr, public.intents i
  where pr.id = m.prompt_id and i.id = pr.intent_id and i.property_id = p_property_id
    and m.brand_found_any_alias is distinct from (m.brand_found or exists (
        select 1 from public.measurement_mentions mm where mm.measurement_id = m.id and mm.is_own_brand));
end $$;

-- ---------------------------------------------------------------------
-- Coogee's setup, written once. Each part only applies while Coogee has none of its own yet, so the
-- values edited in Report setup are kept.
-- ---------------------------------------------------------------------
create or replace function public.seed_coogee_report() returns void
language plpgsql as $$
declare pid uuid;
begin
  select id into pid from public.properties where name = 'InterContinental Sydney Coogee Beach';
  if pid is null then
    return;
  end if;

  update public.properties set
    short_name = coalesce(nullif(short_name, ''), 'Coogee Beach'),
    aliases = case when coalesce(array_length(aliases, 1), 0) <= 1 then array[
      'InterContinental Sydney Coogee Beach','InterContinental Coogee Beach',
      'InterContinental Sydney Coogee Beach by IHG','InterContinental Coogee',
      'Intercontinental Sydney Coogee Beach',
      'InterContinental Sydney Coogee Beach - Shutters Restaurant & Bar',
      'Shutters Restaurant & Bar','Shutters Restaurant and Bar','Shutters Restaurant',
      'Shutters','Shutters Coogee','Shutters Coogee Beach',
      'Rick Stein at Coogee Beach','Rick Stein at Coogee','Rick Stein','Rick Stein''s',
      'Rick Stein''s Coogee Beach',
      'Èliva Spa','Èliva Spa & Wellness','Èliva','Eliva Spa','Èliva Wellness',
      'Eliva Spa & Wellness','Èliva Coogee Beach','Èliva Spa - InterContinental Coogee Beach',
      'Èliva Spa Coogee Beach',
      'Crowne Plaza Sydney Coogee Beach','Crowne Plaza Coogee Beach','Crowne Plaza Coogee',
      'InterContinental Sydney Coogee Beach*',
      'InterContinental Sydney Coogee',
      'Shutters at InterContinental Sydney Coogee Beach',
      'Rick Stein at InterContinental Sydney Coogee Beach',
      'Rick Stein''s at InterContinental Sydney Coogee Beach'] else aliases end,
    ignored_names = case when coalesce(array_length(ignored_names, 1), 0) = 0
                         then array['Club InterContinental'] else ignored_names end,
    own_domains = case when coalesce(array_length(own_domains, 1), 0) = 0 then array[
      'coogeebeach.intercontinental.com','ihg.com','ihgplc.com',
      'coogeebeach-intercontinental.vouchercart.com','intercontinental-sydney-coogee-beach.h-rez.com']
      else own_domains end
  where id = pid;

  if not exists (select 1 from public.neutral_exclusion_terms where property_id = pid) then
    insert into public.neutral_exclusion_terms (property_id, term)
    select pid, t from unnest(array['Coogee','InterContinental','Rick Stein','Shutters','Èliva','Eliva',
                                    'Randwick','Allianz Stadium']) t
    on conflict do nothing;
  end if;

  if not exists (select 1 from public.competitor_groups where property_id = pid) then
    insert into public.competitor_groups (property_id, name, display_name, aliases, sort_order) values
      (pid, 'Elysium Manly', 'Elysium Manly (formerly Manly Pacific)',
       array['Elysium Manly','Manly Pacific','Manly Pacific Hotel','Manly Pacific Sydney','Manly Pacific Sydney MGallery*',
             'Novotel Sydney Manly Pacific','Beachside Manly Pacific'], 10),
      (pid, 'Pier One', 'Pier One Sydney Harbour',
       array['Pier One','Pier One Sydney Harbour*','Bridge Marquee at Pier One','Pier One Bridge Marquee'], 20),
      (pid, 'Langham', 'The Langham, Sydney',
       array['The Langham','The Langham Sydney','The Langham, Sydney','Langham Sydney','The Day Spa by Chuan at The Langham Sydney'], 30),
      (pid, 'InterCon Double Bay', 'InterContinental Sydney Double Bay',
       array['InterContinental Double Bay','InterContinental Sydney Double Bay*'], 40)
    on conflict (property_id, name) do nothing;
  end if;

  -- Baseline and snapshots from the Aug 2026 report (31 Jul – 31 Aug). Baselines are back-calculated
  -- from the reported relative movement, so they're flagged is_derived. Never overwritten.
  insert into public.benchmarks (property_id, label, kind, as_of, prompt_set, dimension, dim_key, metric, value, is_derived, note)
  select pid, v.label, v.kind, v.as_of::date, v.pset, v.dim, v.dkey, v.metric, v.val, v.derived, v.note
  from (values
    ('Pre-schema baseline','baseline','2026-07-30','full','overall','','visibility',34.74,true,'40.47 reported as +16.5%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','overall','','detection',37.04,true,'42.34 reported as +14.3%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','overall','','position',2.13,true,'#2.03 reported as improved 4.5%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','overall','','sentiment',85.88,true,'88.8 reported as +3.4%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','ChatGPT','visibility',64.15,true,'66.91, +4.3%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','Gemini','visibility',47.17,true,'44.95, −4.7%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','Claude','visibility',40.59,true,'38.68, −4.7%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','Google AI Overview','visibility',38.14,true,'35.66, −6.5%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','Perplexity','visibility',29.78,true,'33.50, +12.5%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','engine','Bing Copilot','visibility',30.26,true,'30.84, +1.9%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Dining-Led Discovery','visibility',54.95,true,'65.99, +20.1%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Luxury Coastal Stay','visibility',56.91,true,'63.74, +12.0%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Family Stays','visibility',31.18,true,'58.03, +86.1%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Wellness & Spa','visibility',40.16,true,'46.63, +16.1%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Business / Bleisure','visibility',30.31,true,'38.65, +27.5%'),
    ('Pre-schema baseline','baseline','2026-07-30','full','intent','Romance & Events','visibility',14.58,true,'15.62, +7.1%'),
    ('13 Aug benchmark','benchmark','2026-08-13','neutral','overall','','visibility',40.6,false,null),
    ('13 Aug benchmark','benchmark','2026-08-13','neutral','overall','','detection',42.8,false,null),
    ('13 Aug benchmark','benchmark','2026-08-13','neutral','overall','','position',1.8,false,null),
    ('13 Aug benchmark','benchmark','2026-08-13','neutral','overall','','top3',38.4,false,null),
    ('13 Aug benchmark','benchmark','2026-08-13','neutral','overall','','sentiment',90.6,false,null),
    ('Aug 2026 report','report','2026-08-31','full','overall','','visibility',40.47,false,null),
    ('Aug 2026 report','report','2026-08-31','full','overall','','detection',42.34,false,null),
    ('Aug 2026 report','report','2026-08-31','full','overall','','position',2.03,false,null),
    ('Aug 2026 report','report','2026-08-31','full','overall','','sentiment',88.8,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','overall','','visibility',27.93,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','overall','','detection',30.99,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','overall','','position',2.45,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','overall','','top3',25.73,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','overall','','sentiment',88.0,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','competitor','Elysium Manly','visibility',10.28,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','competitor','Pier One','visibility',17.8,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','competitor','Langham','visibility',9.58,false,null),
    ('Aug 2026 report','report','2026-08-31','neutral','competitor','InterCon Double Bay','visibility',4.96,false,null)
  ) as v(label, kind, as_of, pset, dim, dkey, metric, val, derived, note)
  where not exists (select 1 from public.benchmarks b where b.property_id = pid)
  on conflict (property_id, label, prompt_set, dimension, dim_key, metric) do nothing;

  perform public.classify_neutral_prompts();
end $$;

-- Coogee as a client (if a database was set up without 11_workspace.sql's seed), then its setup, once.
insert into public.properties (name, brand_group, location, website_url, client_name, team_name)
values ('InterContinental Sydney Coogee Beach', 'IHG', 'Coogee, Sydney NSW', 'https://coogeebeach.intercontinental.com',
        'InterContinental Sydney Coogee Beach', 'InterContinental Sydney Coogee Beach marketing team')
on conflict (name) do nothing;
select public.seed_coogee_report();
