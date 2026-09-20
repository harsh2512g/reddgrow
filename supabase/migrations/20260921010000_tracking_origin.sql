-- CORS preflight exposes only a boolean, never credentials, organizations or customer data.
create function private.tracking_browser_origin_allowed(p_brand_id uuid,p_origin text,p_allow_fixture boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1 from public.brands b join public.organizations o on o.id=b.organization_id
    join public.subscriptions s on s.organization_id=o.id join public.plan_catalog p on p.key=s.plan_key
    where (p_brand_id is null or b.id=p_brand_id) and b.status='active' and o.status='active' and o.deleted_at is null
      and s.status in ('active','trialing') and s.current_period_end>now() and p.features->'conversionTracking'='true'::jsonb
      and (
        (p_origin='https://'||private.knowledge_host(b.website_url))
        or exists(select 1 from jsonb_array_elements_text(b.profile->'allowed_links') u where p_origin='https://'||private.knowledge_host(u))
        or (p_allow_fixture is true and p_origin='http://127.0.0.1:3000' and private.knowledge_host(b.website_url)='clarityscale.example')
      )
  ),false)
$$;
revoke all on function private.tracking_browser_origin_allowed(uuid,text,boolean) from public,anon,authenticated,threadsignal_tracking_api;
grant execute on function private.tracking_browser_origin_allowed(uuid,text,boolean) to threadsignal_tracking_api;

-- Advanced segmentation follows the catalog; core historical metrics remain readable.
create or replace function private.compute_attribution_analytics(p_organization_id uuid,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from date;v_to date;v_rows jsonb;v_metrics jsonb;v_series jsonb;v_groups jsonb;v_breakdowns jsonb:='{}';v_dimension text;v_days integer;v_key text;v_advanced boolean;
begin
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>2000 or exists(select 1 from jsonb_each(p_filters) e where e.key not in ('from','to','brand_id','subreddit_id','opportunity_id','event','intent','competitor_id','style') or jsonb_typeof(e.value)<>'string') then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  foreach v_key in array array['brand_id','subreddit_id','opportunity_id','competitor_id'] loop
    if p_filters->>v_key is not null and p_filters->>v_key !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  end loop;
  if (p_filters->>'event' is not null and p_filters->>'event' not in ('signup','lead','trial_started','purchase','custom')) or (p_filters->>'intent' is not null and p_filters->>'intent' not in ('recommendation','alternative','comparison','problem','research','support','other')) or char_length(p_filters->>'style')>100 then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  select coalesce((select c.features->'advancedAnalytics'='true'::jsonb from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key where s.organization_id=p_organization_id),false) into v_advanced;
  if not v_advanced and (p_filters ? 'competitor_id' or p_filters ? 'style') then raise exception 'ADVANCED_ANALYTICS_PLAN_REQUIRED'; end if;
  v_from:=coalesce((p_filters->>'from')::date,(now() at time zone 'UTC')::date-29);
  v_to:=coalesce((p_filters->>'to')::date,(now() at time zone 'UTC')::date);
  if not isfinite(v_from) or not isfinite(v_to) or v_to<v_from or v_to-v_from>89 then raise exception 'INVALID_ANALYTICS_RANGE'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from private.attribution_rows(p_organization_id,v_from::timestamp at time zone 'UTC',(v_to+1)::timestamp at time zone 'UTC',p_filters) r;
  v_metrics:=private.attribution_metrics(v_rows);
  select jsonb_agg(jsonb_build_object('date',d.day::date)||private.attribution_metrics(coalesce((select jsonb_agg(r) from jsonb_array_elements(v_rows) r where ((r->>'occurred_at')::timestamptz at time zone 'UTC')::date=d.day::date),'[]'::jsonb)) order by d.day) into v_series from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') d(day);
  foreach v_dimension in array array['brands','subreddits','intents','competitors','opportunities','styles'] loop
    if not v_advanced and v_dimension in ('competitors','styles') then v_breakdowns:=v_breakdowns||jsonb_build_object(v_dimension,'[]'::jsonb); continue; end if;
    with expanded as (
      select r as item,
        case v_dimension when 'brands' then r->>'brand_id' when 'subreddits' then r->>'subreddit_id' when 'intents' then r->>'intent' when 'opportunities' then r->>'opportunity_id' when 'styles' then r->>'style' when 'competitors' then competitor.id end as id,
        case v_dimension when 'brands' then r->>'brand_label' when 'subreddits' then r->>'subreddit_label' when 'intents' then r->>'intent' when 'opportunities' then r->>'opportunity_id' when 'styles' then r->>'style' when 'competitors' then coalesce((select c.name from public.brand_competitors c where c.organization_id=p_organization_id and c.id::text=competitor.id),'Removed competitor') end as label
      from jsonb_array_elements(v_rows) r left join lateral (select jsonb_array_elements_text(r->'competitors') as id where v_dimension='competitors') competitor on true
    ), grouped as (select id,max(label) as label,private.attribution_metrics(jsonb_agg(item)) as metrics from expanded where id is not null group by id)
    select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'label',g.label)||g.metrics order by (g.metrics->>'clicks')::integer desc,g.id),'[]'::jsonb) into v_groups from (select * from grouped order by (metrics->>'clicks')::integer desc,id limit 100) g;
    v_breakdowns:=v_breakdowns||jsonb_build_object(v_dimension,v_groups);
  end loop;
  select coalesce((select attribution_days from public.tracking_settings where organization_id=p_organization_id),30) into v_days;
  return jsonb_build_object('range',jsonb_build_object('from',v_from,'to',v_to),'attribution_days',v_days,'metrics',v_metrics,'timeseries',v_series,'breakdowns',v_breakdowns,'funnel',jsonb_build_array(
    jsonb_build_object('stage','opportunities','count',v_metrics->'opportunities'),jsonb_build_object('stage','drafts','count',v_metrics->'drafts'),jsonb_build_object('stage','published','count',v_metrics->'published'),jsonb_build_object('stage','clicks','count',v_metrics->'clicks'),jsonb_build_object('stage','signups','count',v_metrics->'signups'),jsonb_build_object('stage','purchases','count',v_metrics->'purchases')));
exception when invalid_text_representation or datetime_field_overflow then raise exception 'INVALID_ANALYTICS_FILTER';
end $$;

create trigger subscriptions_invalidate_analytics after insert or update or delete on public.subscriptions for each row execute function private.invalidate_attribution_cache();
