-- Phase 3: read-only Reddit discovery, tenant monitoring and scored opportunities.
-- No posting, drafting, OAuth secrets or hosted worker privileges are introduced.
create table public.subreddits (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mock' check (provider in ('mock','oauth')),
  provider_id text check (char_length(provider_id) <= 100),
  name text not null unique check (name ~ '^([a-z0-9_]{2,21}|artificialintelligence)$'),
  display_name text not null check (char_length(display_name) <= 200),
  description text not null default '' check (char_length(description) <= 10000),
  subscriber_count bigint check (subscriber_count >= 0),
  is_nsfw boolean not null default false,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=20000),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.brand_subreddits (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  brand_id uuid not null, subreddit_id uuid not null references public.subreddits(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused')),
  priority integer not null default 3 check (priority between 1 and 5),
  minimum_score integer not null default 40 check (minimum_score between 0 and 100),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','blocked')),
  product_relevance integer not null default 0 check (product_relevance between 0 and 100),
  allowed_reply_style text not null default 'helpful' check (allowed_reply_style in ('helpful','technical','no_links','answer_only')),
  internal_notes text not null default '' check (char_length(internal_notes)<=2000),
  internal_interpretation text not null default '' check (char_length(internal_interpretation)<=4000),
  monitor_new boolean not null default true, monitor_hot boolean not null default false,
  monitor_rising boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (brand_id,organization_id) references public.brands(id,organization_id) on delete cascade,
  unique (brand_id,subreddit_id), unique(id,brand_id,organization_id),
  check (monitor_new or monitor_hot or monitor_rising)
);
create index brand_subreddits_organization_idx on public.brand_subreddits(organization_id,status);
create index brand_subreddits_schedule_idx on public.brand_subreddits(subreddit_id,status);
create table public.subreddit_rules (
  id uuid primary key default gen_random_uuid(), subreddit_id uuid not null references public.subreddits(id) on delete cascade,
  provider_rule_id text not null check (char_length(provider_rule_id) between 1 and 100),
  title text not null check (char_length(title)<=500), description text not null check (char_length(description)<=10000),
  kind text not null default 'all' check (char_length(kind)<=100),
  applies_to text not null default 'all' check (char_length(applies_to)<=100),
  raw_data jsonb not null default '{}' check (jsonb_typeof(raw_data)='object' and octet_length(raw_data::text)<=20000),
  last_synced_at timestamptz not null default now(), unique(subreddit_id,provider_rule_id)
);
create table public.reddit_sync_checkpoints (
  id uuid primary key default gen_random_uuid(), subreddit_id uuid not null references public.subreddits(id) on delete cascade,
  sort text not null check (sort in ('new','hot','rising')),
  cursor text check (char_length(cursor)<=200), last_success_at timestamptz, last_error_at timestamptz,
  consecutive_errors integer not null default 0 check (consecutive_errors>=0),
  next_sync_at timestamptz not null default now(), last_rules_sync_at timestamptz, last_post_refresh_at timestamptz,
  provider_paused boolean not null default false,
  provider_retry_at timestamptz,
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  unique(subreddit_id,sort)
);
create table public.reddit_posts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mock','oauth')),
  provider_post_id text not null check (provider_post_id ~ '^[A-Za-z0-9_]{1,100}$'),
  subreddit_id uuid not null references public.subreddits(id) on delete cascade,
  permalink text check (char_length(permalink)<=2048 and permalink ~ '^https://(www\.)?reddit\.com/r/[A-Za-z0-9_]+/comments/[A-Za-z0-9_]+(/[^?#[:space:]]*)?$'),
  title text check (char_length(title)<=1000), body text check (char_length(body)<=50000),
  author_name text check (char_length(author_name)<=100),
  created_at_provider timestamptz not null, score integer not null default 0,
  num_comments integer not null default 0 check (num_comments>=0),
  upvote_ratio numeric check (upvote_ratio between 0 and 1), flair text check (char_length(flair)<=500),
  is_nsfw boolean not null default false, is_locked boolean not null default false,
  is_archived boolean not null default false, is_edited boolean not null default false,
  is_deleted boolean not null default false,
  raw_metadata jsonb not null default '{}' check (jsonb_typeof(raw_metadata)='object' and octet_length(raw_metadata::text)<=10000),
  last_synced_at timestamptz not null default now(), purged_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,provider_post_id), unique(id,subreddit_id),
  check (not is_deleted or (title is null and body is null and author_name is null and permalink is null and flair is null and raw_metadata='{}'::jsonb and purged_at is not null))
);
create index reddit_posts_community_created_idx on public.reddit_posts(subreddit_id,created_at_provider desc);
create index reddit_posts_refresh_idx on public.reddit_posts(last_synced_at) where not is_deleted;
create table public.opportunities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
  reddit_post_id uuid not null, subreddit_id uuid not null references public.subreddits(id) on delete cascade,
  status text not null default 'new' check (status in ('new','saved','monitoring','dismissed','archived','blocked')),
  summary text not null check (char_length(summary)<=1000), user_need text not null check (char_length(user_need)<=2000),
  intent_category text not null check (intent_category in ('recommendation','alternative','comparison','problem','research','support','other')),
  semantic_relevance numeric not null check (semantic_relevance between 0 and 100),
  buying_intent numeric not null check (buying_intent between 0 and 100),
  freshness numeric not null check (freshness between 0 and 100),
  engagement_velocity numeric not null check (engagement_velocity between 0 and 100),
  rule_fit numeric not null check (rule_fit between 0 and 100),
  competitor_context numeric not null check (competitor_context between 0 and 100),
  penalty_score numeric not null check (penalty_score between 0 and 100),
  final_score numeric not null check (final_score between 0 and 100),
  risk_level text not null check (risk_level in ('low','medium','high','blocked')),
  suggested_action text not null check (suggested_action in ('reply','monitor','ignore','blocked')),
  is_blocked boolean not null default false,
  risk_reasons jsonb not null default '[]' check (jsonb_typeof(risk_reasons)='array' and octet_length(risk_reasons::text)<=20000),
  matched_capabilities jsonb not null default '[]' check (jsonb_typeof(matched_capabilities)='array' and octet_length(matched_capabilities::text)<=20000),
  missing_capabilities jsonb not null default '[]' check (jsonb_typeof(missing_capabilities)='array' and octet_length(missing_capabilities::text)<=20000),
  matched_competitor_ids jsonb not null default '[]' check (jsonb_typeof(matched_competitor_ids)='array'),
  knowledge_citations jsonb not null default '[]' check (jsonb_typeof(knowledge_citations)='array' and octet_length(knowledge_citations::text)<=20000),
  reasoning_summary text not null check (char_length(reasoning_summary)<=4000),
  model_metadata jsonb not null default '{}' check (jsonb_typeof(model_metadata)='object' and octet_length(model_metadata::text)<=10000),
  input_checksum text not null check (input_checksum ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz not null default now(), dismissed_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (brand_id,organization_id) references public.brands(id,organization_id) on delete cascade,
  foreign key (reddit_post_id,subreddit_id) references public.reddit_posts(id,subreddit_id) on delete cascade,
  unique(brand_id,reddit_post_id), unique(id,brand_id,organization_id,reddit_post_id),
  check (not is_blocked or (risk_level='blocked' and suggested_action='blocked' and status in ('blocked','dismissed','archived')))
);
create index opportunities_feed_idx on public.opportunities(organization_id,brand_id,final_score desc,id);
create index opportunities_created_idx on public.opportunities(organization_id,created_at desc,id);
create index opportunities_community_idx on public.opportunities(subreddit_id);
create table public.usage_counters (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  metric text not null check (metric='opportunities'), period_start timestamptz not null, period_end timestamptz not null,
  quantity bigint not null default 0 check (quantity>=0), updated_at timestamptz not null default now(),
  unique(organization_id,metric,period_start,period_end), check (period_end>period_start)
);
create table public.reddit_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sync','rules','refresh','evaluate','rescore')),
  organization_id uuid, brand_id uuid,
  subreddit_id uuid references public.subreddits(id) on delete cascade,
  reddit_post_id uuid references public.reddit_posts(id) on delete cascade, opportunity_id uuid,
  sort text not null default 'new' check (sort in ('new','hot','rising')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3), available_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz,
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (brand_id,organization_id) references public.brands(id,organization_id) on delete cascade,
  foreign key (opportunity_id,brand_id,organization_id,reddit_post_id) references public.opportunities(id,brand_id,organization_id,reddit_post_id) on delete cascade,
  check ((organization_id is null)=(brand_id is null)),
  check ((kind in ('sync','rules') and subreddit_id is not null and brand_id is null and reddit_post_id is null and opportunity_id is null)
    or (kind='refresh' and reddit_post_id is not null and brand_id is null and opportunity_id is null)
    or (kind='evaluate' and brand_id is not null and reddit_post_id is not null and opportunity_id is null)
    or (kind='rescore' and brand_id is not null and reddit_post_id is not null and opportunity_id is not null))
);
create unique index reddit_jobs_pending_key_idx on public.reddit_jobs(dedupe_key) where status in ('queued','processing');
create index reddit_jobs_dispatch_idx on public.reddit_jobs(status,available_at,lease_expires_at);

do $$ declare t text; begin
  foreach t in array array['subreddits','brand_subreddits','subreddit_rules','reddit_sync_checkpoints','reddit_posts','opportunities','usage_counters','reddit_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    if t not in ('reddit_jobs','reddit_sync_checkpoints') then execute format('grant select on public.%I to authenticated',t); end if;
  end loop;
  foreach t in array array['subreddits','brand_subreddits','reddit_posts','opportunities','usage_counters','reddit_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',t||'_updated_at',t);
  end loop;
end $$;
create policy subreddits_read on public.subreddits for select to authenticated using (true);
create policy subreddit_rules_read on public.subreddit_rules for select to authenticated using (true);
create policy brand_subreddits_read_member on public.brand_subreddits for select to authenticated using (private.organization_role(organization_id) is not null);
create policy opportunities_read_member on public.opportunities for select to authenticated using (private.organization_role(organization_id) is not null);
create policy usage_counters_read_member on public.usage_counters for select to authenticated using (private.organization_role(organization_id) is not null);
create policy reddit_posts_read_associated on public.reddit_posts for select to authenticated using (
  exists(select 1 from public.brand_subreddits bs where bs.subreddit_id=reddit_posts.subreddit_id and private.organization_role(bs.organization_id) is not null)
  or exists(select 1 from public.opportunities o where o.reddit_post_id=reddit_posts.id and private.organization_role(o.organization_id) is not null)
);
create policy reddit_checkpoints_read_associated on public.reddit_sync_checkpoints for select to authenticated using (
  exists(select 1 from public.brand_subreddits bs where bs.subreddit_id=reddit_sync_checkpoints.subreddit_id and private.organization_role(bs.organization_id) is not null)
);
grant select(id,subreddit_id,sort,last_success_at,last_error_at,consecutive_errors,next_sync_at,last_rules_sync_at,last_post_refresh_at,provider_paused,error_code)
  on public.reddit_sync_checkpoints to authenticated;
create policy reddit_jobs_read_associated on public.reddit_jobs for select to authenticated using (
  private.organization_role(organization_id) is not null or (organization_id is null and exists(
    select 1 from public.brand_subreddits bs where bs.subreddit_id=reddit_jobs.subreddit_id and private.organization_role(bs.organization_id) is not null))
);
grant select(id,kind,organization_id,brand_id,subreddit_id,reddit_post_id,opportunity_id,sort,status,attempts,available_at,error_code,created_at,updated_at) on public.reddit_jobs to authenticated;

-- This phase changes no privileges of the dedicated hosted knowledge worker.
alter table public.brand_competitors add column notes text not null default '' check (char_length(notes)<=2000);
alter table public.brand_keywords add constraint brand_keywords_value_valid check (char_length(btrim(value)) between 1 and 200);
alter table public.brand_keywords add constraint brand_keywords_kind_valid check (kind in ('category','problem','recommendation','alternative','competitor','technical','exclusion'));
alter table public.brand_keywords add constraint brand_keywords_source_valid check (source in ('manual','suggested'));

create function private.validate_monitor_settings(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare k text;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>12000 then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  if exists(select 1 from jsonb_object_keys(p) keys(value) where keys.value not in ('status','priority','minimum_score','allowed_reply_style','internal_notes','internal_interpretation','monitor_new','monitor_hot','monitor_rising')) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  if p ? 'status' and (jsonb_typeof(p->'status')<>'string' or p->>'status' not in ('active','paused')) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  foreach k in array array['priority','minimum_score'] loop
    if p ? k and (jsonb_typeof(p->k)<>'number' or (p->>k)::numeric<>trunc((p->>k)::numeric)) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  end loop;
  if p ? 'priority' and (p->>'priority')::numeric not between 1 and 5 then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  if p ? 'minimum_score' and (p->>'minimum_score')::numeric not between 0 and 100 then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  if p ? 'allowed_reply_style' and (jsonb_typeof(p->'allowed_reply_style')<>'string' or p->>'allowed_reply_style' not in ('helpful','technical','no_links','answer_only')) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  foreach k in array array['monitor_new','monitor_hot','monitor_rising'] loop
    if p ? k and jsonb_typeof(p->k)<>'boolean' then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  end loop;
  if p ? 'internal_notes' and (jsonb_typeof(p->'internal_notes')<>'string' or char_length(p->>'internal_notes')>2000) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
  if p ? 'internal_interpretation' and (jsonb_typeof(p->'internal_interpretation')<>'string' or char_length(p->>'internal_interpretation')>4000) then raise exception 'INVALID_MONITOR_SETTINGS'; end if;
end $$;

create function private.queue_reddit_job(p_kind text,p_subreddit_id uuid,p_sort text default 'new',p_brand_id uuid default null,p_post_id uuid default null,p_opportunity_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_key text; v_id uuid; v_org uuid;
begin
  if p_kind not in ('sync','rules','refresh','evaluate','rescore') or p_sort not in ('new','hot','rising') then raise exception 'INVALID_REDDIT_JOB'; end if;
  if p_brand_id is not null then select organization_id into strict v_org from public.brands where id=p_brand_id; end if;
  v_key:=p_kind||':'||coalesce(p_subreddit_id::text,'')||':'||p_sort||':'||coalesce(p_brand_id::text,'')||':'||coalesce(p_post_id::text,'')||':'||coalesce(p_opportunity_id::text,'');
  insert into public.reddit_jobs(kind,organization_id,brand_id,subreddit_id,reddit_post_id,opportunity_id,sort,dedupe_key)
    values(p_kind,v_org,p_brand_id,p_subreddit_id,p_post_id,p_opportunity_id,p_sort,v_key)
    on conflict(dedupe_key) where status in ('queued','processing') do update set dedupe_key=excluded.dedupe_key returning id into v_id;
  return v_id;
end $$;

create function private.require_subreddit_capacity(p_organization_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_limit integer;
begin
  perform private.require_available_plan(p_organization_id);
  select p.subreddit_limit into strict v_limit from public.subscriptions s join public.plan_catalog p on p.key=s.plan_key where s.organization_id=p_organization_id;
  if (select count(*) from public.brand_subreddits where organization_id=p_organization_id and status='active')>=v_limit then raise exception 'SUBREDDIT_LIMIT'; end if;
end $$;

create function public.add_brand_subreddit(p_brand_id uuid,p_name text,p_settings jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.brands; v_sub uuid; v_id uuid; v_name text; v_status text;
begin
  select * into b from public.brands where id=p_brand_id;
  if not found then raise exception 'BRAND_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=b.organization_id for update;
  perform private.require_role(b.organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_available_plan(b.organization_id);
  select * into b from public.brands where id=p_brand_id for update;
  if b.status<>'active' then raise exception 'BRAND_ARCHIVED'; end if;
  perform private.validate_monitor_settings(p_settings);
  v_name:=lower(btrim(p_name));
  if v_name is null or v_name !~ '^([a-z0-9_]{2,21}|artificialintelligence)$' then raise exception 'INVALID_SUBREDDIT'; end if;
  v_status:=coalesce(p_settings->>'status','active');
  insert into public.subreddits(name,display_name) values(v_name,v_name) on conflict(name) do nothing;
  select id into strict v_sub from public.subreddits where name=v_name;
  select id into v_id from public.brand_subreddits where brand_id=p_brand_id and subreddit_id=v_sub;
  if v_id is not null then return v_id; end if;
  if v_status='active' then perform private.require_subreddit_capacity(b.organization_id); end if;
  if (select count(*) from public.brand_subreddits where brand_id=p_brand_id)>=100 then raise exception 'SUBREDDIT_RECORD_LIMIT'; end if;
  insert into public.brand_subreddits(organization_id,brand_id,subreddit_id,status,priority,minimum_score,allowed_reply_style,internal_notes,internal_interpretation,monitor_new,monitor_hot,monitor_rising)
    values(b.organization_id,p_brand_id,v_sub,v_status,coalesce((p_settings->>'priority')::integer,3),coalesce((p_settings->>'minimum_score')::integer,40),coalesce(p_settings->>'allowed_reply_style','helpful'),coalesce(p_settings->>'internal_notes',''),coalesce(p_settings->>'internal_interpretation',''),coalesce((p_settings->>'monitor_new')::boolean,true),coalesce((p_settings->>'monitor_hot')::boolean,false),coalesce((p_settings->>'monitor_rising')::boolean,false)) returning id into v_id;
  perform private.queue_reddit_job('rules',v_sub);
  if v_status='active' then
    if coalesce((p_settings->>'monitor_new')::boolean,true) then perform private.queue_reddit_job('sync',v_sub,'new'); end if;
    if coalesce((p_settings->>'monitor_hot')::boolean,false) then perform private.queue_reddit_job('sync',v_sub,'hot'); end if;
    if coalesce((p_settings->>'monitor_rising')::boolean,false) then perform private.queue_reddit_job('sync',v_sub,'rising'); end if;
  end if;
  perform private.audit(b.organization_id,'subreddit.added','brand_subreddit',v_id);
  return v_id;
end $$;

create function public.update_brand_subreddit(p_id uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item public.brand_subreddits; b public.brands; v_status text;
begin
  select * into item from public.brand_subreddits where id=p_id;
  if not found then raise exception 'SUBREDDIT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin']::public.organization_role[]);
  select * into b from public.brands where id=item.brand_id for update;
  select * into item from public.brand_subreddits where id=p_id for update;
  perform private.validate_monitor_settings(p_settings);
  v_status:=coalesce(p_settings->>'status',item.status);
  if v_status='active' then
    if b.status<>'active' then raise exception 'BRAND_ARCHIVED'; end if;
    perform private.require_available_plan(item.organization_id);
    if item.status<>'active' then perform private.require_subreddit_capacity(item.organization_id); end if;
  end if;
  update public.brand_subreddits set status=v_status,priority=coalesce((p_settings->>'priority')::integer,priority),minimum_score=coalesce((p_settings->>'minimum_score')::integer,minimum_score),allowed_reply_style=coalesce(p_settings->>'allowed_reply_style',allowed_reply_style),internal_notes=coalesce(p_settings->>'internal_notes',internal_notes),internal_interpretation=coalesce(p_settings->>'internal_interpretation',internal_interpretation),monitor_new=coalesce((p_settings->>'monitor_new')::boolean,monitor_new),monitor_hot=coalesce((p_settings->>'monitor_hot')::boolean,monitor_hot),monitor_rising=coalesce((p_settings->>'monitor_rising')::boolean,monitor_rising) where id=p_id returning * into item;
  if item.status='active' then
    if item.monitor_new then perform private.queue_reddit_job('sync',item.subreddit_id,'new'); end if;
    if item.monitor_hot then perform private.queue_reddit_job('sync',item.subreddit_id,'hot'); end if;
    if item.monitor_rising then perform private.queue_reddit_job('sync',item.subreddit_id,'rising'); end if;
  end if;
  perform private.audit(item.organization_id,'subreddit.updated','brand_subreddit',p_id);
end $$;

create function public.remove_brand_subreddit(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.brand_subreddits;
begin
  select * into item from public.brand_subreddits where id=p_id;
  if not found then raise exception 'SUBREDDIT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin']::public.organization_role[]);
  delete from public.brand_subreddits where id=p_id;
  perform private.audit(item.organization_id,'subreddit.removed','brand_subreddit',p_id);
end $$;

create function public.refresh_brand_subreddit(p_id uuid,p_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.brand_subreddits; v_job uuid;
begin
  select * into item from public.brand_subreddits where id=p_id;
  if not found then raise exception 'SUBREDDIT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_available_plan(item.organization_id);
  if not exists(select 1 from public.brands where id=item.brand_id and status='active') then raise exception 'BRAND_ARCHIVED'; end if;
  if p_kind is null or p_kind not in ('sync','rules') then raise exception 'INVALID_REDDIT_JOB'; end if;
  if p_kind='sync' and item.status<>'active' then raise exception 'SUBREDDIT_PAUSED'; end if;
  if p_kind='rules' then v_job:=private.queue_reddit_job('rules',item.subreddit_id);
  else
    if item.monitor_new then v_job:=private.queue_reddit_job('sync',item.subreddit_id,'new'); end if;
    if item.monitor_hot then v_job:=private.queue_reddit_job('sync',item.subreddit_id,'hot'); end if;
    if item.monitor_rising then v_job:=private.queue_reddit_job('sync',item.subreddit_id,'rising'); end if;
  end if;
  perform private.audit(item.organization_id,'subreddit.refresh_requested','brand_subreddit',p_id,jsonb_build_object('kind',p_kind));
  return v_job;
end $$;

create function private.sync_keyword_profile(p_brand_id uuid) returns void
language sql security definer set search_path='' as $$
  update public.brands set profile=jsonb_set(jsonb_set(profile,'{keywords}',coalesce((select jsonb_agg(value order by created_at,id) from public.brand_keywords where brand_id=p_brand_id and not is_exclusion),'[]'::jsonb)),'{exclusions}',coalesce((select jsonb_agg(value order by created_at,id) from public.brand_keywords where brand_id=p_brand_id and is_exclusion),'[]'::jsonb)) where id=p_brand_id
$$;

create function public.save_brand_keyword(p_brand_id uuid,p_id uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.brands; v_id uuid; v_exclusion boolean; v_value text; v_kind text; v_status text; v_source text;
begin
  select * into b from public.brands where id=p_brand_id;
  if not found then raise exception 'BRAND_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=b.organization_id for update;
  perform private.require_role(b.organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_available_plan(b.organization_id);
  select * into b from public.brands where id=p_brand_id for update;
  if b.status<>'active' then raise exception 'BRAND_ARCHIVED'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>3000 then raise exception 'INVALID_KEYWORD'; end if;
  if jsonb_typeof(p_input->'value') is distinct from 'string' or char_length(btrim(p_input->>'value')) not between 1 and 200
    or jsonb_typeof(p_input->'is_exclusion') is distinct from 'boolean' then raise exception 'INVALID_KEYWORD'; end if;
  v_value:=btrim(p_input->>'value'); v_exclusion:=(p_input->>'is_exclusion')::boolean;
  v_kind:=p_input->>'kind'; v_status:=coalesce(p_input->>'status','active'); v_source:=coalesce(p_input->>'source','manual');
  if v_kind is null or v_kind not in ('category','problem','recommendation','alternative','competitor','technical','exclusion') or v_status not in ('active','paused') or v_source not in ('manual','suggested') or (v_kind='exclusion')<>v_exclusion then raise exception 'INVALID_KEYWORD'; end if;
  if p_id is not null and not exists(select 1 from public.brand_keywords where id=p_id and brand_id=p_brand_id) then raise exception 'KEYWORD_NOT_FOUND'; end if;
  if exists(select 1 from public.brand_keywords where brand_id=p_brand_id and lower(value)=lower(v_value) and is_exclusion=v_exclusion and (p_id is null or id<>p_id)) then raise exception 'KEYWORD_EXISTS'; end if;
  if (select count(*) from public.brand_keywords where brand_id=p_brand_id and is_exclusion=v_exclusion and (p_id is null or id<>p_id))>=30 then raise exception 'KEYWORD_LIMIT'; end if;
  if p_id is null then
    insert into public.brand_keywords(organization_id,brand_id,value,kind,is_exclusion,status,source) values(b.organization_id,p_brand_id,v_value,v_kind,v_exclusion,v_status,v_source) returning id into v_id;
  else
    update public.brand_keywords set value=v_value,kind=v_kind,is_exclusion=v_exclusion,status=v_status,source=v_source where id=p_id returning id into v_id;
  end if;
  perform private.sync_keyword_profile(p_brand_id);
  perform private.audit(b.organization_id,case when p_id is null then 'keyword.created' else 'keyword.updated' end,'brand_keyword',v_id);
  return v_id;
end $$;

create function public.delete_brand_keyword(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.brand_keywords;
begin
  select * into item from public.brand_keywords where id=p_id;
  if not found then raise exception 'KEYWORD_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin']::public.organization_role[]);
  perform 1 from public.brands where id=item.brand_id for update;
  delete from public.brand_keywords where id=p_id;
  perform private.sync_keyword_profile(item.brand_id);
  perform private.audit(item.organization_id,'keyword.deleted','brand_keyword',p_id);
end $$;

-- Preserve the Phase 2 RPC signature while reconciling persistent identifiers.
create or replace function public.save_brand(p_organization_id uuid,p_id uuid,p_profile jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_item jsonb; v_competitor uuid; v_keep uuid[]:='{}';
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  perform private.validate_brand_profile(p_profile);
  if p_id is null then
    perform private.require_brand_capacity(p_organization_id);
    insert into public.brands(organization_id,name,website_url,profile) values(p_organization_id,btrim(p_profile->>'name'),p_profile->>'website_url',p_profile) returning id into v_id;
  else
    select id into v_id from public.brands where id=p_id and organization_id=p_organization_id for update;
    if v_id is null then raise exception 'BRAND_NOT_FOUND'; end if;
    update public.brands set name=btrim(p_profile->>'name'),website_url=p_profile->>'website_url',profile=p_profile where id=v_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_profile->'competitors') loop
    if v_item ? 'notes' and (jsonb_typeof(v_item->'notes')<>'string' or char_length(v_item->>'notes')>2000) then raise exception 'INVALID_COMPETITOR_NOTES'; end if;
    select id into v_competitor from public.brand_competitors where brand_id=v_id and lower(domain)=lower(v_item->>'domain') and lower(name)=lower(btrim(v_item->>'name')) order by created_at,id limit 1;
    if v_competitor is null then
      insert into public.brand_competitors(organization_id,brand_id,name,domain,aliases,notes) values(p_organization_id,v_id,btrim(v_item->>'name'),v_item->>'domain',v_item->'aliases',coalesce(v_item->>'notes','')) returning id into v_competitor;
    else
      update public.brand_competitors set name=btrim(v_item->>'name'),domain=v_item->>'domain',aliases=v_item->'aliases',notes=coalesce(v_item->>'notes',notes) where id=v_competitor;
    end if;
    v_keep:=array_append(v_keep,v_competitor);
  end loop;
  delete from public.brand_competitors where brand_id=v_id and not(id=any(v_keep));
  update public.brands set profile=jsonb_set(profile,'{competitors}',coalesce((
    select jsonb_agg(jsonb_build_object('name',name,'domain',domain,'aliases',aliases,'notes',notes)
      order by array_position(v_keep,id)) from public.brand_competitors where brand_id=v_id
  ),'[]'::jsonb)) where id=v_id;
  insert into public.brand_personas(organization_id,brand_id,name,real_role,tone,custom_tone,reply_length,default_disclosure,prohibited_statements)
    values(p_organization_id,v_id,'Default representative',p_profile->>'real_role',p_profile->>'tone',p_profile->>'custom_tone',p_profile->>'reply_length',p_profile->>'disclosure_text',p_profile->'avoid_claims')
    on conflict(brand_id) do update set real_role=excluded.real_role,tone=excluded.tone,custom_tone=excluded.custom_tone,reply_length=excluded.reply_length,default_disclosure=excluded.default_disclosure,prohibited_statements=excluded.prohibited_statements;
  delete from public.brand_keywords k where brand_id=v_id and not exists(
    select 1 from jsonb_array_elements_text(case when k.is_exclusion then p_profile->'exclusions' else p_profile->'keywords' end) term where btrim(term)=k.value);
  insert into public.brand_keywords(organization_id,brand_id,value,is_exclusion)
    select p_organization_id,v_id,btrim(value),false from jsonb_array_elements_text(p_profile->'keywords') on conflict(brand_id,value,is_exclusion) do nothing;
  insert into public.brand_keywords(organization_id,brand_id,value,kind,is_exclusion)
    select p_organization_id,v_id,btrim(value),'exclusion',true from jsonb_array_elements_text(p_profile->'exclusions') on conflict(brand_id,value,is_exclusion) do nothing;
  perform private.sync_keyword_profile(v_id);
  perform private.audit(p_organization_id,case when p_id is null then 'brand.created' else 'brand.updated' end,'brand',v_id);
  return v_id;
end $$;

create function public.get_opportunity_usage(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; v_limit integer; v_quantity bigint;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select opportunity_limit into strict v_limit from public.plan_catalog where key=s.plan_key;
  select quantity into v_quantity from public.usage_counters where organization_id=p_organization_id and metric='opportunities' and period_start=s.current_period_start and period_end=s.current_period_end;
  return jsonb_build_object('quantity',coalesce(v_quantity,0),'limit',v_limit,'period_start',s.current_period_start,'period_end',s.current_period_end,'plan_key',s.plan_key);
end $$;

create function public.set_opportunity_status(p_id uuid,p_status text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.opportunities;
begin
  select * into item from public.opportunities where id=p_id;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin','member']::public.organization_role[]);
  select * into item from public.opportunities where id=p_id for update;
  if p_status is null or p_status not in ('new','saved','monitoring','dismissed','archived') then raise exception 'INVALID_OPPORTUNITY_STATUS'; end if;
  if (item.is_blocked or exists(select 1 from public.reddit_posts where id=item.reddit_post_id and is_deleted)) and p_status not in ('dismissed','archived') then raise exception 'OPPORTUNITY_BLOCKED'; end if;
  if p_status='dismissed' and (p_reason is null or p_reason not in ('not_relevant','low_intent','already_answered','community_risk','product_cannot_help','duplicate','other')) then raise exception 'INVALID_DISMISSAL_REASON'; end if;
  update public.opportunities set status=p_status,dismissed_reason=case when p_status='dismissed' then p_reason else null end where id=p_id;
  perform private.audit(item.organization_id,'opportunity.status_changed','opportunity',p_id,jsonb_build_object('status',p_status,'reason',case when p_status='dismissed' then p_reason else null end));
end $$;

create function public.bulk_dismiss_opportunities(p_ids uuid[],p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_count integer; v_id uuid;
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null then raise exception 'INVALID_OPPORTUNITY_SELECTION'; end if;
  select min(organization_id::text)::uuid,count(distinct organization_id) into v_org,v_count from public.opportunities where id=any(p_ids);
  if v_count<>1 or (select count(*) from public.opportunities where id=any(p_ids))<>(select count(distinct v) from unnest(p_ids) v) then raise exception 'INVALID_OPPORTUNITY_SELECTION'; end if;
  perform 1 from public.organizations where id=v_org for update;
  perform private.require_role(v_org,array['owner','admin','member']::public.organization_role[]);
  for v_id in select distinct v from unnest(p_ids) v order by v loop
    perform public.set_opportunity_status(v_id,'dismissed',p_reason);
  end loop;
  return (select count(distinct v)::integer from unnest(p_ids) v);
end $$;

create function public.rescore_opportunity(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.opportunities; v_job uuid;
begin
  select * into item from public.opportunities where id=p_id;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=item.organization_id for update;
  perform private.require_role(item.organization_id,array['owner','admin','member']::public.organization_role[]);
  perform private.require_available_plan(item.organization_id);
  if not exists(select 1 from public.brands where id=item.brand_id and status='active') then raise exception 'BRAND_ARCHIVED'; end if;
  if exists(select 1 from public.reddit_posts where id=item.reddit_post_id and is_deleted) then raise exception 'POST_DELETED'; end if;
  if not exists(select 1 from public.brand_subreddits where brand_id=item.brand_id and subreddit_id=item.subreddit_id and status='active') then raise exception 'SUBREDDIT_PAUSED'; end if;
  v_job:=private.queue_reddit_job('rescore',item.subreddit_id,'new',item.brand_id,item.reddit_post_id,item.id);
  perform private.audit(item.organization_id,'opportunity.rescore_requested','opportunity',p_id);
  return v_job;
end $$;

create function private.validate_opportunity_evaluation(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare k text; citation jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>80000 then raise exception 'INVALID_EVALUATION'; end if;
  foreach k in array array['semantic_relevance','buying_intent','freshness','engagement_velocity','rule_fit','competitor_context','penalty_score','final_score'] loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric not between 0 and 100 then raise exception 'INVALID_EVALUATION'; end if;
  end loop;
  if jsonb_typeof(p->'summary') is distinct from 'string' or char_length(p->>'summary')>1000
    or jsonb_typeof(p->'user_need') is distinct from 'string' or char_length(p->>'user_need')>2000
    or jsonb_typeof(p->'reasoning_summary') is distinct from 'string' or char_length(p->>'reasoning_summary')>4000
    or (p->>'intent_category') is null or p->>'intent_category' not in ('recommendation','alternative','comparison','problem','research','support','other')
    or (p->>'risk_level') is null or p->>'risk_level' not in ('low','medium','high','blocked')
    or (p->>'suggested_action') is null or p->>'suggested_action' not in ('reply','monitor','ignore','blocked')
    or jsonb_typeof(p->'is_blocked') is distinct from 'boolean'
    or (p->>'input_checksum') is null or (p->>'input_checksum') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p->'model_metadata') is distinct from 'object' then raise exception 'INVALID_EVALUATION'; end if;
  if ((p->>'is_blocked')::boolean) and (p->>'risk_level'<>'blocked' or p->>'suggested_action'<>'blocked') then raise exception 'INVALID_EVALUATION'; end if;
  foreach k in array array['risk_reasons','matched_capabilities','missing_capabilities'] loop
    if not private.valid_knowledge_list(p->k,30,500) then raise exception 'INVALID_EVALUATION'; end if;
  end loop;
  if not private.valid_knowledge_list(p->'matched_competitor_ids',20,36)
    or exists(select 1 from jsonb_array_elements_text(p->'matched_competitor_ids') x where x !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
    or jsonb_typeof(p->'knowledge_citations') is distinct from 'array' or jsonb_array_length(p->'knowledge_citations')>8 then raise exception 'INVALID_EVALUATION'; end if;
  for citation in select value from jsonb_array_elements(p->'knowledge_citations') loop
    if jsonb_typeof(citation)<>'object' or citation->>'chunk_id' is null or citation->>'source_id' is null
      or citation->>'chunk_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or citation->>'source_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'INVALID_EVALUATION'; end if;
  end loop;
end $$;

create function private.publish_opportunity(p_brand_id uuid,p_reddit_post_id uuid,p_evaluation jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.brands; post public.reddit_posts; v_subscription public.subscriptions; monitor public.brand_subreddits;
  v_id uuid; v_status text; v_limit integer; v_quantity bigint; v_blocked boolean; v_citations jsonb;
begin
  perform private.validate_opportunity_evaluation(p_evaluation);
  select * into b from public.brands where id=p_brand_id;
  if not found then return null; end if;
  perform 1 from public.organizations where id=b.organization_id and status='active' and deleted_at is null for update;
  if not found then return null; end if;
  select * into b from public.brands where id=p_brand_id for update;
  if b.status<>'active' then return null; end if;
  select * into post from public.reddit_posts where id=p_reddit_post_id for share;
  if not found or post.is_deleted then return null; end if;
  select * into monitor from public.brand_subreddits where brand_id=p_brand_id and subreddit_id=post.subreddit_id and status='active' for share;
  if not found then return null; end if;
  perform private.require_available_plan(b.organization_id);
  if exists(select 1 from jsonb_array_elements_text(p_evaluation->'matched_competitor_ids') matched(value) where not exists(select 1 from public.brand_competitors c where c.id=matched.value::uuid and c.brand_id=p_brand_id)) then raise exception 'INVALID_COMPETITOR_REFERENCE'; end if;
  if exists(select 1 from jsonb_array_elements(p_evaluation->'knowledge_citations') citation where not exists(
    select 1 from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id
    join public.knowledge_sources s on s.id=c.source_id
    where c.id=(citation->>'chunk_id')::uuid and c.source_id=(citation->>'source_id')::uuid
      and c.brand_id=p_brand_id and c.organization_id=b.organization_id and d.is_included
      and s.deleted_at is null and s.status in ('ready','partial')
  )) then raise exception 'INVALID_KNOWLEDGE_REFERENCE'; end if;
  -- Citation text/URLs come from verified tenant knowledge, not evaluation input.
  select coalesce(jsonb_agg(jsonb_build_object('chunk_id',c.id,'source_id',s.id,'title',d.title,
    'source_url',d.canonical_url,'excerpt',left(c.content,300)) order by citation.ordinality),'[]'::jsonb) into v_citations
    from jsonb_array_elements(p_evaluation->'knowledge_citations') with ordinality citation(value,ordinality)
    join public.knowledge_chunks c on c.id=(citation.value->>'chunk_id')::uuid
    join public.knowledge_documents d on d.id=c.document_id join public.knowledge_sources s on s.id=c.source_id;
  v_blocked:=(p_evaluation->>'is_blocked')::boolean;
  select id,status into v_id,v_status from public.opportunities where brand_id=p_brand_id and reddit_post_id=p_reddit_post_id for update;
  if v_id is null then
    if not v_blocked and (p_evaluation->>'final_score')::numeric<monitor.minimum_score then return null; end if;
    select * into strict v_subscription from public.subscriptions where organization_id=b.organization_id;
    select opportunity_limit into strict v_limit from public.plan_catalog where key=v_subscription.plan_key;
    insert into public.usage_counters(organization_id,metric,period_start,period_end) values(b.organization_id,'opportunities',v_subscription.current_period_start,v_subscription.current_period_end) on conflict do nothing;
    update public.usage_counters set quantity=quantity+1 where organization_id=b.organization_id and metric='opportunities' and period_start=v_subscription.current_period_start and period_end=v_subscription.current_period_end and quantity<v_limit returning quantity into v_quantity;
    if v_quantity is null then raise exception 'OPPORTUNITY_LIMIT'; end if;
    v_id:=gen_random_uuid(); v_status:='new';
  end if;
  if v_blocked and v_status not in ('dismissed','archived') then v_status:='blocked'; elsif not v_blocked and v_status='blocked' then v_status:='new'; end if;
  insert into public.opportunities(id,organization_id,brand_id,reddit_post_id,subreddit_id,status,summary,user_need,intent_category,semantic_relevance,buying_intent,freshness,engagement_velocity,rule_fit,competitor_context,penalty_score,final_score,risk_level,suggested_action,is_blocked,risk_reasons,matched_capabilities,missing_capabilities,matched_competitor_ids,knowledge_citations,reasoning_summary,model_metadata,input_checksum,evaluated_at)
    values(v_id,b.organization_id,b.id,post.id,post.subreddit_id,v_status,p_evaluation->>'summary',p_evaluation->>'user_need',p_evaluation->>'intent_category',(p_evaluation->>'semantic_relevance')::numeric,(p_evaluation->>'buying_intent')::numeric,(p_evaluation->>'freshness')::numeric,(p_evaluation->>'engagement_velocity')::numeric,(p_evaluation->>'rule_fit')::numeric,(p_evaluation->>'competitor_context')::numeric,(p_evaluation->>'penalty_score')::numeric,(p_evaluation->>'final_score')::numeric,p_evaluation->>'risk_level',p_evaluation->>'suggested_action',v_blocked,p_evaluation->'risk_reasons',p_evaluation->'matched_capabilities',p_evaluation->'missing_capabilities',p_evaluation->'matched_competitor_ids',v_citations,p_evaluation->>'reasoning_summary',p_evaluation->'model_metadata',p_evaluation->>'input_checksum',now())
    on conflict(brand_id,reddit_post_id) do update set status=excluded.status,summary=excluded.summary,user_need=excluded.user_need,intent_category=excluded.intent_category,semantic_relevance=excluded.semantic_relevance,buying_intent=excluded.buying_intent,freshness=excluded.freshness,engagement_velocity=excluded.engagement_velocity,rule_fit=excluded.rule_fit,competitor_context=excluded.competitor_context,penalty_score=excluded.penalty_score,final_score=excluded.final_score,risk_level=excluded.risk_level,suggested_action=excluded.suggested_action,is_blocked=excluded.is_blocked,risk_reasons=excluded.risk_reasons,matched_capabilities=excluded.matched_capabilities,missing_capabilities=excluded.missing_capabilities,matched_competitor_ids=excluded.matched_competitor_ids,knowledge_citations=excluded.knowledge_citations,reasoning_summary=excluded.reasoning_summary,model_metadata=excluded.model_metadata,input_checksum=excluded.input_checksum,evaluated_at=excluded.evaluated_at;
  return v_id;
end $$;

create function private.purge_reddit_post(p_reddit_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.reddit_posts set title=null,body=null,author_name=null,permalink=null,flair=null,raw_metadata='{}',is_deleted=true,purged_at=coalesce(purged_at,now()),last_synced_at=now() where id=p_reddit_post_id;
  update public.opportunities set status='archived',summary='',user_need='',reasoning_summary='',risk_reasons='[]',matched_capabilities='[]',missing_capabilities='[]',matched_competitor_ids='[]',knowledge_citations='[]',model_metadata='{}',input_checksum=repeat('0',64),suggested_action='blocked',risk_level='blocked',is_blocked=true,dismissed_reason=null where reddit_post_id=p_reddit_post_id;
end $$;

revoke all on function private.validate_monitor_settings(jsonb),private.queue_reddit_job(text,uuid,text,uuid,uuid,uuid),private.require_subreddit_capacity(uuid),private.sync_keyword_profile(uuid),private.validate_opportunity_evaluation(jsonb),private.publish_opportunity(uuid,uuid,jsonb),private.purge_reddit_post(uuid) from public,anon,authenticated;
revoke all on function public.add_brand_subreddit(uuid,text,jsonb),public.update_brand_subreddit(uuid,jsonb),public.remove_brand_subreddit(uuid),public.refresh_brand_subreddit(uuid,text),public.save_brand_keyword(uuid,uuid,jsonb),public.delete_brand_keyword(uuid),public.get_opportunity_usage(uuid),public.set_opportunity_status(uuid,text,text),public.bulk_dismiss_opportunities(uuid[],text),public.rescore_opportunity(uuid) from public,anon;
grant execute on function public.add_brand_subreddit(uuid,text,jsonb),public.update_brand_subreddit(uuid,jsonb),public.remove_brand_subreddit(uuid),public.refresh_brand_subreddit(uuid,text),public.save_brand_keyword(uuid,uuid,jsonb),public.delete_brand_keyword(uuid),public.get_opportunity_usage(uuid),public.set_opportunity_status(uuid,text,text),public.bulk_dismiss_opportunities(uuid[],text),public.rescore_opportunity(uuid) to authenticated;
