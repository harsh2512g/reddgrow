-- Phase 7: durable billing and notification workflows. No customer content is deleted.
alter table public.subscriptions add column grace_ends_at timestamptz;
alter table public.subscriptions add column latest_provider_event_at timestamptz;
alter table public.subscriptions add column latest_provider_event_id text;
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (status in ('trialing','active','past_due','canceled','incomplete','unpaid','incomplete_expired','paused'));

create table public.billing_checkout_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade, idempotency_key uuid not null,
  plan_key public.plan_key not null check (plan_key in ('solo','growth')), provider text not null check(provider in ('mock','stripe')),
  status text not null default 'pending' check(status in ('pending','completed','expired')),
  provider_session_id text unique, provider_customer_id text,
  expires_at timestamptz not null default now()+interval '30 minutes', completed_at timestamptz,
  created_at timestamptz not null default now(), unique(organization_id,idempotency_key)
);
create table public.billing_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(provider in ('mock','stripe')), provider_event_id text not null check(char_length(provider_event_id) between 1 and 200),
  provider_created_at timestamptz not null, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null check(outcome in ('applied','stale')), created_at timestamptz not null default now(), unique(provider,provider_event_id)
);
create index billing_events_organization_idx on public.billing_events(organization_id,created_at desc);
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, user_id uuid not null,
  categories jsonb not null default '{"welcome":true,"invitation":true,"ingestion_complete":true,"ingestion_failed":true,"daily_digest":true,"high_score_alert":true,"trial_ending":true,"usage_limit":true,"payment_failed":true,"subscription_changed":true}',
  digest_time time not null default '09:00', minimum_score integer not null default 90 check(minimum_score between 0 and 100),
  quiet_start time, quiet_end time, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade,
  unique(organization_id,user_id), check((quiet_start is null)=(quiet_end is null)), check(quiet_start is null or quiet_start<>quiet_end),
  check(jsonb_typeof(categories)='object' and octet_length(categories::text)<=1000)
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, user_id uuid not null,
  type text not null check(type in ('welcome','invitation','ingestion_complete','ingestion_failed','daily_digest','high_score_alert','trial_ending','usage_limit','payment_failed','subscription_changed')),
  dedupe_key text not null check(char_length(dedupe_key) between 1 and 200), payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2000),
  status text not null default 'queued' check(status in ('queued','processing','sent','suppressed','failed')),
  provider text check(provider in ('console','resend')), provider_message_id text check(char_length(provider_message_id)<=200),
  attempts integer not null default 0 check(attempts between 0 and 3), available_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz, error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
  foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade,
  unique(organization_id,user_id,type,dedupe_key)
);
create index notification_dispatch_idx on public.notification_deliveries(status,available_at,lease_expires_at);
create index notification_history_idx on public.notification_deliveries(organization_id,user_id,created_at desc);
create trigger notification_preferences_updated_at before update on public.notification_preferences for each row execute function private.set_updated_at();
create trigger notification_deliveries_updated_at before update on public.notification_deliveries for each row execute function private.set_updated_at();
do $$ declare t text; begin
  foreach t in array array['billing_checkout_requests','billing_events','notification_preferences','notification_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;
create policy billing_checkout_owner on public.billing_checkout_requests for select to authenticated using(private.organization_role(organization_id)='owner');
create policy billing_events_owner on public.billing_events for select to authenticated using(private.organization_role(organization_id)='owner');
create policy notification_preferences_self on public.notification_preferences for select to authenticated using(user_id=auth.uid() and private.organization_role(organization_id) is not null);
create policy notification_deliveries_self on public.notification_deliveries for select to authenticated using(user_id=auth.uid() and private.organization_role(organization_id) is not null);
-- Deliberately expose summaries only through RPCs. No payload/hash/recipient grants.

create function private.billing_plan_active(p_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select (s.status in ('trialing','active') and s.current_period_end>now())
    or (s.status='past_due' and s.grace_ends_at>now())
    from public.subscriptions s join public.organizations o on o.id=s.organization_id
    where s.organization_id=p_organization_id and o.status='active' and o.deleted_at is null),false)
$$;
create or replace function private.require_available_plan(p_organization_id uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; v_limit integer;
begin
  select * into s from public.subscriptions where organization_id=p_organization_id;
  if not found then raise exception 'PLAN_UNAVAILABLE'; end if;
  if s.status='trialing' and s.current_period_end<=now() then raise exception 'TRIAL_EXPIRED'; end if;
  if not private.billing_plan_active(p_organization_id) then raise exception 'PLAN_INACTIVE'; end if;
  select member_limit into v_limit from public.plan_catalog where key=s.plan_key;
  return v_limit;
end $$;
create function public.get_billing_subscription(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; o public.organizations; v_owner boolean;
begin
  v_owner:=private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[])='owner';
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select * into strict o from public.organizations where id=p_organization_id;
  return jsonb_build_object('organization_id',s.organization_id,'provider',s.provider,'plan_key',s.plan_key,
    'status',case when s.status='trialing' and s.current_period_end<=now() then 'expired' else s.status end,
    'period_start',s.current_period_start,'period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end,
    'grace_ends_at',s.grace_ends_at,'trial_ends_at',o.trial_ends_at,'can_manage',v_owner,'active',private.billing_plan_active(p_organization_id),
    'billing_email',case when v_owner then o.billing_email end,'customer_id',case when v_owner then s.provider_customer_id end,'subscription_id',case when v_owner then s.provider_subscription_id end);
end $$;
create function public.get_billing_usage(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; p public.plan_catalog; v_brands bigint; v_communities bigint; v_members bigint;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select * into strict p from public.plan_catalog where key=s.plan_key;
  select count(*) into v_brands from public.brands where organization_id=p_organization_id and status='active';
  select count(*) into v_communities from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id where bs.organization_id=p_organization_id and bs.status='active' and b.status='active';
  select (select count(*) from public.organization_members where organization_id=p_organization_id)+(select count(*) from public.organization_invitations where organization_id=p_organization_id and accepted_at is null and revoked_at is null and expires_at>now()) into v_members;
  return jsonb_build_object('period_start',s.current_period_start,'period_end',s.current_period_end,'features',p.features,'meters',jsonb_build_array(
    jsonb_build_object('metric','brands','used',v_brands,'limit',p.brand_limit),jsonb_build_object('metric','communities','used',v_communities,'limit',p.subreddit_limit),jsonb_build_object('metric','members','used',v_members,'limit',p.member_limit),
    jsonb_build_object('metric','opportunities','used',coalesce((select quantity from public.usage_counters where organization_id=p_organization_id and metric='opportunities' and period_start=s.current_period_start and period_end=s.current_period_end),0),'limit',p.opportunity_limit),
    jsonb_build_object('metric','ai_drafts','used',coalesce((select quantity from public.usage_counters where organization_id=p_organization_id and metric='ai_drafts' and period_start=s.current_period_start and period_end=s.current_period_end),0),'limit',p.ai_draft_limit)));
end $$;
create function public.begin_billing_checkout(p_organization_id uuid,p_plan_key text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_checkout_requests; s public.subscriptions;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  if p_plan_key is null or p_plan_key not in ('solo','growth') or p_idempotency_key is null then raise exception 'INVALID_CHECKOUT'; end if;
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select * into r from public.billing_checkout_requests where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if r.plan_key::text<>p_plan_key then raise exception 'BILLING_IDEMPOTENCY_CONFLICT'; end if;
  else
    if (select count(*) from public.billing_checkout_requests where organization_id=p_organization_id and created_at>now()-interval '10 minutes')>=10 then raise exception 'BILLING_RATE_LIMIT'; end if;
    insert into public.billing_checkout_requests(organization_id,requested_by,idempotency_key,plan_key,provider)
      values(p_organization_id,auth.uid(),p_idempotency_key,p_plan_key::public.plan_key,s.provider) returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'organization_id',r.organization_id,'plan_key',r.plan_key,'provider',r.provider,'status',r.status,'expires_at',r.expires_at);
end $$;
-- Keep consumed units when checkout moves a trial to a paid billing period.
create function private.carry_billing_usage(p_organization_id uuid,p_old_start timestamptz,p_old_end timestamptz,p_new_start timestamptz,p_new_end timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_old_start=p_new_start and p_old_end=p_new_end then return; end if;
  insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity)
    select organization_id,metric,p_new_start,p_new_end,quantity from public.usage_counters
    where organization_id=p_organization_id and period_start=p_old_start and period_end=p_old_end
    on conflict(organization_id,metric,period_start,period_end) do update set quantity=greatest(public.usage_counters.quantity,excluded.quantity);
end $$;
create function public.complete_mock_checkout(p_organization_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_checkout_requests; s public.subscriptions; v_start timestamptz; v_end timestamptz;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  select * into r from public.billing_checkout_requests where id=p_request_id and organization_id=p_organization_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  select * into strict s from public.subscriptions where organization_id=p_organization_id for update;
  if s.provider<>'mock' or r.provider<>'mock' then raise exception 'MOCK_BILLING_ONLY'; end if;
  if r.status='completed' then return public.get_billing_subscription(p_organization_id); end if;
  if r.expires_at<=now() then raise exception 'CHECKOUT_EXPIRED'; end if;
  -- Plan changes cannot reset an active paid usage period. Expired periods start anew.
  v_start:=case when s.plan_key='trial' or s.current_period_end<=now() then now() else s.current_period_start end;
  v_end:=case when s.plan_key='trial' or s.current_period_end<=now() then v_start+interval '1 month' else s.current_period_end end;
  if s.current_period_end>now() then perform private.carry_billing_usage(p_organization_id,s.current_period_start,s.current_period_end,v_start,v_end); end if;
  update public.subscriptions set plan_key=r.plan_key,status='active',current_period_start=v_start,current_period_end=v_end,
    provider_customer_id='mock_customer_'||p_organization_id::text,provider_subscription_id='mock_subscription_'||p_organization_id::text,cancel_at_period_end=false,grace_ends_at=null where organization_id=p_organization_id;
  update public.billing_checkout_requests set status='completed',completed_at=now() where id=r.id;
  perform private.audit(p_organization_id,'subscription.changed','subscription',s.id,jsonb_build_object('provider','mock','plan_key',r.plan_key));
  return public.get_billing_subscription(p_organization_id);
end $$;
create function public.manage_mock_subscription(p_organization_id uuid,p_action text,p_plan_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  select * into strict s from public.subscriptions where organization_id=p_organization_id for update;
  if s.provider<>'mock' then raise exception 'MOCK_BILLING_ONLY'; end if;
  if p_plan_key is not null or p_action is null or p_action not in ('cancel','resume','payment_failed','payment_recovered','renew') or s.plan_key='trial' then raise exception 'INVALID_BILLING_ACTION'; end if;
  if p_action in ('cancel','resume') then
    if s.status not in ('active','past_due') or s.current_period_end<=now() then raise exception 'PLAN_INACTIVE'; end if;
    update public.subscriptions set cancel_at_period_end=p_action='cancel' where organization_id=p_organization_id;
  elsif p_action='payment_failed' then
    if s.status not in ('active','past_due') then raise exception 'PLAN_INACTIVE'; end if;
    update public.subscriptions set status='past_due',grace_ends_at=coalesce(grace_ends_at,now()+interval '3 days') where organization_id=p_organization_id;
  elsif p_action='payment_recovered' then
    if s.status<>'past_due' then raise exception 'INVALID_BILLING_ACTION'; end if;
    update public.subscriptions set status='active',grace_ends_at=null where organization_id=p_organization_id;
  else
    if s.status<>'active' or s.current_period_end>now() or s.cancel_at_period_end then raise exception 'BILLING_PERIOD_NOT_DUE'; end if;
    perform private.maintain_billing_periods(100);
  end if;
  perform private.audit(p_organization_id,'subscription.'||p_action,'subscription',s.id,jsonb_build_object('provider','mock'));
  return public.get_billing_subscription(p_organization_id);
end $$;

create function private.register_billing_session(p_request_id uuid,p_provider text,p_session_id text,p_customer_id text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.billing_checkout_requests;
begin
  select * into r from public.billing_checkout_requests where id=p_request_id;
  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=r.organization_id for update;
  select * into strict r from public.billing_checkout_requests where id=p_request_id for update;
  if p_provider<>'stripe' or p_session_id !~ '^cs_[A-Za-z0-9_]{1,190}$' or (p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9_]{1,190}$') or p_provider is null or p_session_id is null then raise exception 'INVALID_BILLING_SESSION'; end if;
  if r.provider_session_id is not null then
    if r.provider_session_id<>p_session_id or r.provider_customer_id is distinct from p_customer_id then raise exception 'BILLING_IDEMPOTENCY_CONFLICT'; end if;
    return;
  end if;
  if r.status<>'pending' or r.expires_at<=now() then raise exception 'CHECKOUT_EXPIRED'; end if;
  if exists(select 1 from public.subscriptions where organization_id<>r.organization_id and provider='stripe' and provider_customer_id=p_customer_id) then raise exception 'BILLING_CUSTOMER_CONFLICT'; end if;
  update public.billing_checkout_requests set provider=p_provider,provider_session_id=p_session_id,provider_customer_id=p_customer_id where id=p_request_id;
end $$;
create function private.apply_billing_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sub jsonb; v_org uuid; s public.subscriptions; e public.billing_events; v_hash text; v_created timestamptz; v_start timestamptz; v_end timestamptz; v_stale boolean;
begin
  if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>10000 or p_event->>'provider'<>'stripe' or (p_event->>'eventId') !~ '^evt_[A-Za-z0-9_]{1,190}$' then raise exception 'INVALID_BILLING_EVENT'; end if;
  v_sub:=p_event->'subscription'; v_org:=(v_sub->>'organizationId')::uuid; v_created:=(p_event->>'eventCreatedAt')::timestamptz;
  v_start:=(v_sub->>'currentPeriodStart')::timestamptz; v_end:=(v_sub->>'currentPeriodEnd')::timestamptz;
  if v_org is null or v_created is null or not isfinite(v_created) or v_created>now()+interval '5 minutes' or v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_end<=v_start
    or coalesce(v_sub->>'planKey','') not in ('solo','growth') or coalesce(v_sub->>'status','') not in ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')
    or coalesce(v_sub->>'id','') !~ '^sub_[A-Za-z0-9_]{1,190}$' or coalesce(v_sub->>'customerId','') !~ '^cus_[A-Za-z0-9_]{1,190}$' or jsonb_typeof(v_sub->'cancelAtPeriodEnd') is distinct from 'boolean' then raise exception 'INVALID_BILLING_EVENT'; end if;
  perform 1 from public.organizations where id=v_org and status='active' and deleted_at is null for update;
  if not found then raise exception 'BILLING_ORGANIZATION_UNAVAILABLE'; end if;
  select * into strict s from public.subscriptions where organization_id=v_org for update;
  v_hash:=encode(extensions.digest(jsonb_build_object('provider','stripe','eventId',p_event->>'eventId','created',v_created,'organization',v_org,'subscription',v_sub->>'id','customer',v_sub->>'customerId')::text,'sha256'),'hex');
  select * into e from public.billing_events where provider='stripe' and provider_event_id=p_event->>'eventId';
  if found then
    if e.organization_id<>v_org or e.payload_hash<>v_hash then raise exception 'BILLING_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('applied',false,'duplicate',true,'stale',e.outcome='stale');
  end if;
  if s.provider='stripe' then
    if s.provider_customer_id is distinct from v_sub->>'customerId' or s.provider_subscription_id is distinct from v_sub->>'id' then raise exception 'BILLING_CUSTOMER_CONFLICT'; end if;
  elsif not exists(select 1 from public.billing_checkout_requests where organization_id=v_org and provider='stripe' and status='pending'
    and (provider_customer_id=v_sub->>'customerId' or (provider_customer_id is null and provider_session_id=p_event->>'checkoutSessionId'))) then raise exception 'BILLING_CHECKOUT_REQUIRED'; end if;
  -- Terminal snapshots cannot be resurrected. Equal-second events use authoritative
  -- snapshots fetched under the application's organization advisory lock.
  v_stale:=coalesce(v_created<s.latest_provider_event_at,false) or (s.status in ('canceled','incomplete_expired') and s.provider='stripe' and v_sub->>'status' not in ('canceled','incomplete_expired'));
  insert into public.billing_events(organization_id,provider,provider_event_id,provider_created_at,payload_hash,outcome)
    values(v_org,'stripe',p_event->>'eventId',v_created,v_hash,case when v_stale then 'stale' else 'applied' end);
  if v_stale then return jsonb_build_object('applied',false,'duplicate',false,'stale',true); end if;
  if s.current_period_end>now() and v_start<s.current_period_end then perform private.carry_billing_usage(v_org,s.current_period_start,s.current_period_end,v_start,v_end); end if;
  update public.subscriptions set provider='stripe',provider_customer_id=v_sub->>'customerId',provider_subscription_id=v_sub->>'id',plan_key=(v_sub->>'planKey')::public.plan_key,status=v_sub->>'status',
    current_period_start=v_start,current_period_end=v_end,cancel_at_period_end=(v_sub->>'cancelAtPeriodEnd')::boolean,
    grace_ends_at=case when v_sub->>'status'='past_due' then coalesce(s.grace_ends_at,v_created+interval '3 days') else null end,
    latest_provider_event_at=v_created,latest_provider_event_id=p_event->>'eventId' where organization_id=v_org;
  update public.billing_checkout_requests set status='completed',completed_at=now(),provider_customer_id=v_sub->>'customerId' where organization_id=v_org and provider='stripe' and status='pending'
    and (provider_customer_id=v_sub->>'customerId' or (provider_customer_id is null and provider_session_id=p_event->>'checkoutSessionId'));
  insert into public.audit_logs(organization_id,actor_type,action,target_type,target_id,metadata) values(v_org,'system','subscription.synchronized','subscription',s.id,jsonb_build_object('provider','stripe','plan_key',v_sub->>'planKey','status',v_sub->>'status'));
  return jsonb_build_object('applied',true,'duplicate',false,'stale',false);
exception when invalid_text_representation or datetime_field_overflow then raise exception 'INVALID_BILLING_EVENT';
end $$;

create function private.maintain_billing_periods(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; v_start timestamptz; v_end timestamptz; v_count integer:=0;
begin
  for s in select sub.* from public.subscriptions sub join public.organizations o on o.id=sub.organization_id
    where sub.provider='mock' and sub.plan_key<>'trial' and sub.status='active' and sub.current_period_end<=now() and o.status='active' and o.deleted_at is null
    order by sub.current_period_end limit greatest(1,least(coalesce(p_limit,100),100)) for update of o skip locked loop
    if s.cancel_at_period_end then update public.subscriptions set status='canceled' where id=s.id;
    else
      v_start:=s.current_period_end; v_end:=v_start+interval '1 month';
      while v_end<=now() loop v_start:=v_end; v_end:=v_start+interval '1 month'; end loop;
      update public.subscriptions set current_period_start=v_start,current_period_end=v_end where id=s.id;
    end if;
    v_count:=v_count+1;
  end loop;
  update public.billing_checkout_requests set status='expired' where id in(select id from public.billing_checkout_requests where status='pending' and expires_at<=now() limit 100);
  return v_count;
end $$;

create function public.get_notification_preferences(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences; v_timezone text;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  insert into public.notification_preferences(organization_id,user_id) values(p_organization_id,auth.uid()) on conflict do nothing;
  select * into strict p from public.notification_preferences where organization_id=p_organization_id and user_id=auth.uid();
  select timezone into v_timezone from public.organizations where id=p_organization_id;
  return jsonb_build_object('categories',p.categories,'digest_time',to_char(p.digest_time,'HH24:MI'),'minimum_score',p.minimum_score,
    'quiet_start',to_char(p.quiet_start,'HH24:MI'),'quiet_end',to_char(p.quiet_end,'HH24:MI'),'timezone',v_timezone);
end $$;
create function public.set_notification_preferences(p_organization_id uuid,p_preferences jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_categories jsonb; v_default jsonb; v_start text; v_end text;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  v_categories:=p_preferences->'categories';
  v_default:=(public.get_notification_preferences(p_organization_id))->'categories';
  v_start:=p_preferences->>'quiet_start'; v_end:=p_preferences->>'quiet_end';
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' or octet_length(p_preferences::text)>2000
    or jsonb_typeof(v_categories) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_categories))<>10
    or exists(select 1 from jsonb_each(v_categories) e where not v_default ? e.key or jsonb_typeof(e.value)<>'boolean')
    or coalesce(p_preferences->>'digest_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(p_preferences->'minimum_score') is distinct from 'number' or (p_preferences->>'minimum_score') !~ '^([0-9]|[1-9][0-9]|100)$'
    or (v_start is null)<>(v_end is null) or (v_start is not null and (v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_start=v_end)) then raise exception 'INVALID_NOTIFICATION_PREFERENCES'; end if;
  update public.notification_preferences set categories=v_categories,digest_time=(p_preferences->>'digest_time')::time,minimum_score=(p_preferences->>'minimum_score')::integer,
    quiet_start=v_start::time,quiet_end=v_end::time where organization_id=p_organization_id and user_id=auth.uid();
  return public.get_notification_preferences(p_organization_id);
end $$;
create function public.list_notification_deliveries(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from(
    select id,type,status,provider,attempts,error_code,created_at,sent_at from public.notification_deliveries
    where organization_id=p_organization_id and user_id=auth.uid() order by created_at desc,id desc limit 50) d),'[]'::jsonb);
end $$;
create function private.enqueue_notification(p_organization_id uuid,p_user_id uuid,p_type text,p_dedupe_key text,p_payload jsonb default '{}',p_available_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id) then return null; end if;
  insert into public.notification_preferences(organization_id,user_id) values(p_organization_id,p_user_id) on conflict do nothing;
  insert into public.notification_deliveries(organization_id,user_id,type,dedupe_key,payload,available_at)
    values(p_organization_id,p_user_id,p_type,p_dedupe_key,p_payload,p_available_at) on conflict do nothing returning id into v_id;
  return v_id;
end $$;
create function private.notification_source_events() returns trigger
language plpgsql security definer set search_path='' as $$
declare m record; v_type text; v_key text; v_payload jsonb; v_org uuid;
begin
  if tg_table_name='organization_members' then
    perform private.enqueue_notification(new.organization_id,new.user_id,'welcome','membership-'||new.user_id::text);
    return new;
  elsif tg_table_name='organization_invitations' then
    if new.created_by is not null then
      perform private.enqueue_notification(new.organization_id,new.created_by,'invitation',new.id::text,jsonb_build_object('count',1));
    end if;
    return new;
  elsif tg_table_name='knowledge_sources' then
    if new.status not in ('ready','partial','failed') or new.status=old.status or new.deleted_at is not null then return new; end if;
    v_org:=new.organization_id; v_type:=case when new.status='failed' then 'ingestion_failed' else 'ingestion_complete' end;
    v_key:=new.id::text||'-'||new.generation::text; v_payload:=jsonb_build_object('source_id',new.id,'count',new.page_count);
  elsif tg_table_name='opportunities' then
    if new.is_blocked or new.status in ('blocked','dismissed','archived') or new.final_score<1 then return new; end if;
    v_org:=new.organization_id; v_type:='high_score_alert'; v_key:=new.id::text; v_payload:=jsonb_build_object('opportunity_id',new.id,'score',new.final_score);
  elsif tg_table_name='subscriptions' then
    if new.status=old.status and new.plan_key=old.plan_key and new.cancel_at_period_end=old.cancel_at_period_end then return new; end if;
    v_org:=new.organization_id; v_type:=case when new.status='past_due' and old.status<>'past_due' then 'payment_failed' else 'subscription_changed' end;
    v_key:=coalesce(new.latest_provider_event_id,new.id::text||'-'||extract(epoch from clock_timestamp())::text);
    v_payload:=jsonb_build_object('plan_key',new.plan_key,'status',new.status,'cancel_at_period_end',new.cancel_at_period_end);
  elsif tg_table_name='usage_counters' then
    if new.quantity < (select case new.metric when 'ai_drafts' then p.ai_draft_limit else p.opportunity_limit end from public.subscriptions s join public.plan_catalog p on p.key=s.plan_key where s.organization_id=new.organization_id) then return new; end if;
    v_org:=new.organization_id; v_type:='usage_limit'; v_key:=new.metric||'-'||extract(epoch from new.period_start)::text; v_payload:=jsonb_build_object('metric',new.metric,'count',new.quantity);
  else return new;
  end if;
  for m in select user_id,role from public.organization_members where organization_id=v_org loop
    if v_type in ('payment_failed','subscription_changed') and m.role<>'owner' then continue; end if;
    perform private.enqueue_notification(v_org,m.user_id,v_type,v_key,v_payload);
  end loop;
  return new;
end $$;
create trigger notification_member_added after insert on public.organization_members for each row execute function private.notification_source_events();
create trigger notification_invitation_created after insert on public.organization_invitations for each row execute function private.notification_source_events();
create trigger notification_knowledge_finished after update of status on public.knowledge_sources for each row execute function private.notification_source_events();
create trigger notification_opportunity_scored after insert or update of final_score on public.opportunities for each row execute function private.notification_source_events();
create trigger notification_subscription_changed after update on public.subscriptions for each row execute function private.notification_source_events();
create trigger notification_usage_limit after insert or update of quantity on public.usage_counters for each row execute function private.notification_source_events();

create function private.schedule_notifications(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; v_id uuid; v_count integer:=0; v_local timestamp; v_due timestamptz; v_total bigint;
begin
  -- Populate existing memberships without emitting retroactive welcome messages.
  insert into public.notification_preferences(organization_id,user_id)
    select m.organization_id,m.user_id from public.organization_members m left join public.notification_preferences p using(organization_id,user_id) where p.id is null limit 100 on conflict do nothing;
  for r in select p.*,o.timezone,s.plan_key,s.status,s.current_period_end,c.features from public.notification_preferences p
    join public.organizations o on o.id=p.organization_id join public.subscriptions s on s.organization_id=o.id join public.plan_catalog c on c.key=s.plan_key
    where o.status='active' and o.deleted_at is null and (
      (p.categories->'trial_ending'='true'::jsonb and s.status='trialing' and s.current_period_end>now() and s.current_period_end<=now()+interval '2 days'
        and not exists(select 1 from public.notification_deliveries d where d.organization_id=p.organization_id and d.user_id=p.user_id and d.type='trial_ending' and d.dedupe_key=s.current_period_end::text))
      or (p.categories->'daily_digest'='true'::jsonb and c.features->'dailyDigest'='true'::jsonb and private.billing_plan_active(o.id)
        and (now() at time zone o.timezone)::time>=p.digest_time and not exists(select 1 from public.notification_deliveries d where d.organization_id=p.organization_id and d.user_id=p.user_id and d.type='daily_digest' and d.dedupe_key=(now() at time zone o.timezone)::date::text)))
    order by p.created_at,p.id limit greatest(1,least(coalesce(p_limit,100),100)) loop
    if r.status='trialing' and r.current_period_end>now() and r.current_period_end<=now()+interval '2 days' then
      v_id:=private.enqueue_notification(r.organization_id,r.user_id,'trial_ending',r.current_period_end::text);
      if v_id is not null then v_count:=v_count+1; end if;
    end if;
    if r.features->'dailyDigest'='true'::jsonb and private.billing_plan_active(r.organization_id) then
      v_local:=now() at time zone r.timezone; v_due:=(v_local::date+r.digest_time) at time zone r.timezone;
      if v_due<=now() then
        select count(*) into v_total from public.opportunities op join public.reddit_posts rp on rp.id=op.reddit_post_id
          where op.organization_id=r.organization_id and op.created_at>now()-interval '1 day' and op.status in ('new','saved','monitoring') and not op.is_blocked and not rp.is_deleted and rp.purged_at is null;
        v_id:=private.enqueue_notification(r.organization_id,r.user_id,'daily_digest',v_local::date::text,jsonb_build_object('count',v_total),v_due);
        if v_id is not null then v_count:=v_count+1; end if;
      end if;
    end if;
  end loop;
  -- Recovery is bounded; exhausted leases are visible as failed delivery records.
  update public.notification_deliveries set status=case when attempts>=3 then 'failed' else 'queued' end,
    error_code=case when attempts>=3 then 'NOTIFICATION_ATTEMPTS_EXHAUSTED' else 'NOTIFICATION_LEASE_EXPIRED' end,lease_token=null,lease_expires_at=null
    where id in(select id from public.notification_deliveries where status='processing' and lease_expires_at<=now() order by lease_expires_at limit 100 for update skip locked);
  return v_count;
end $$;
create function private.claim_notification(p_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries; p public.notification_preferences; o public.organizations; v_time time; v_due timestamptz; v_local timestamp; v_email text; v_suppress boolean:=false; v_score numeric; v_count bigint;
begin
  if p_lease_token is null then raise exception 'INVALID_NOTIFICATION_LEASE'; end if;
  select * into d from public.notification_deliveries where id=p_id for update;
  if not found or d.status<>'queued' or d.available_at>now() or d.attempts>=3 then return null; end if;
  select * into p from public.notification_preferences where organization_id=d.organization_id and user_id=d.user_id;
  select * into o from public.organizations where id=d.organization_id;
  select email into v_email from auth.users where id=d.user_id and email_confirmed_at is not null;
  v_suppress:=p.id is null or o.status<>'active' or o.deleted_at is not null or v_email is null or not coalesce((p.categories->>d.type)::boolean,false);
  if d.type in ('payment_failed','subscription_changed') and not exists(select 1 from public.organization_members where organization_id=d.organization_id and user_id=d.user_id and role='owner') then v_suppress:=true; end if;
  if d.type in ('daily_digest','high_score_alert') and not private.billing_plan_active(d.organization_id) then v_suppress:=true; end if;
  if d.type='daily_digest' then
    if not exists(select 1 from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key where s.organization_id=d.organization_id and c.features->'dailyDigest'='true'::jsonb) then v_suppress:=true; end if;
    select count(*) into v_count from public.opportunities op join public.reddit_posts rp on rp.id=op.reddit_post_id where op.organization_id=d.organization_id and op.created_at>now()-interval '1 day' and op.status in ('new','saved','monitoring') and not op.is_blocked and not rp.is_deleted and rp.purged_at is null;
    d.payload:=jsonb_build_object('count',v_count);
  elsif d.type='high_score_alert' then
    select op.final_score into v_score from public.opportunities op join public.reddit_posts rp on rp.id=op.reddit_post_id where op.organization_id=d.organization_id and op.id=(d.payload->>'opportunity_id')::uuid and op.status in ('new','saved','monitoring') and not op.is_blocked and not rp.is_deleted and rp.purged_at is null;
    if v_score is null or v_score<p.minimum_score then v_suppress:=true; end if;
    d.payload:=jsonb_build_object('opportunity_id',d.payload->>'opportunity_id','score',coalesce(v_score,0));
  elsif d.type in ('ingestion_complete','ingestion_failed') and not exists(select 1 from public.knowledge_sources where id=(d.payload->>'source_id')::uuid and organization_id=d.organization_id and deleted_at is null) then v_suppress:=true;
  end if;
  if v_suppress then update public.notification_deliveries set status='suppressed',error_code='NOTIFICATION_PREFERENCES_SUPPRESSED' where id=d.id; return null; end if;
  v_local:=now() at time zone o.timezone; v_time:=v_local::time;
  if p.quiet_start is not null and ((p.quiet_start<p.quiet_end and v_time>=p.quiet_start and v_time<p.quiet_end) or (p.quiet_start>p.quiet_end and (v_time>=p.quiet_start or v_time<p.quiet_end))) then
    v_due:=((v_local::date+case when p.quiet_start>p.quiet_end and v_time>=p.quiet_start then 1 else 0 end)+p.quiet_end) at time zone o.timezone;
    update public.notification_deliveries set available_at=greatest(v_due,now()+interval '1 minute') where id=d.id; return null;
  end if;
  update public.notification_deliveries set status='processing',attempts=attempts+1,lease_token=p_lease_token,lease_expires_at=now()+interval '120 seconds',payload=d.payload,error_code=null where id=d.id;
  return jsonb_build_object('id',d.id,'organization_id',d.organization_id,'user_id',d.user_id,'type',d.type,'recipient',v_email,'organization_name',o.name,'payload',d.payload,'attempt',d.attempts+1);
end $$;
create function private.finish_notification(p_id uuid,p_lease_token uuid,p_status text,p_provider text,p_message_id text default null,p_error_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries;
begin
  if p_status is null or p_status not in ('suppressed','sent','retry','failed') or p_provider is null or p_provider not in ('console','resend') or char_length(p_message_id)>200 or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{1,79}$') then raise exception 'INVALID_NOTIFICATION_RESULT'; end if;
  select * into d from public.notification_deliveries where id=p_id for update;
  if not found or d.status<>'processing' or d.lease_token is distinct from p_lease_token or d.lease_expires_at<=now() then return false; end if;
  update public.notification_deliveries set status=case when p_status='retry' then case when d.attempts>=3 then 'failed' else 'queued' end else p_status end,
    available_at=case when p_status='retry' then now()+make_interval(secs=>30*power(2,d.attempts-1)::integer) else available_at end,
    provider=p_provider,provider_message_id=p_message_id,error_code=p_error_code,lease_token=null,lease_expires_at=null,sent_at=case when p_status='sent' then now() else null end where id=d.id;
  return true;
end $$;

-- Exact function grants: anonymous users cannot inspect preferences or mutate billing.
revoke all on function public.get_billing_subscription(uuid),public.get_billing_usage(uuid),public.begin_billing_checkout(uuid,text,uuid),public.complete_mock_checkout(uuid,uuid),public.manage_mock_subscription(uuid,text,text),public.get_notification_preferences(uuid),public.set_notification_preferences(uuid,jsonb),public.list_notification_deliveries(uuid) from public,anon,authenticated;
grant execute on function public.get_billing_subscription(uuid),public.get_billing_usage(uuid),public.begin_billing_checkout(uuid,text,uuid),public.complete_mock_checkout(uuid,uuid),public.manage_mock_subscription(uuid,text,text),public.get_notification_preferences(uuid),public.set_notification_preferences(uuid,jsonb),public.list_notification_deliveries(uuid) to authenticated;
revoke all on function private.billing_plan_active(uuid),private.carry_billing_usage(uuid,timestamptz,timestamptz,timestamptz,timestamptz),private.register_billing_session(uuid,text,text,text),private.apply_billing_event(jsonb),private.maintain_billing_periods(integer),private.enqueue_notification(uuid,uuid,text,text,jsonb,timestamptz),private.notification_source_events(),private.schedule_notifications(integer),private.claim_notification(uuid,uuid),private.finish_notification(uuid,uuid,text,text,text,text) from public,anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_billing_api') then create role threadsignal_billing_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls; end if;
end $$;
grant threadsignal_billing_api to postgres with inherit false,set true;
grant usage on schema private to threadsignal_billing_api;
grant execute on function private.register_billing_session(uuid,text,text,text),private.apply_billing_event(jsonb) to threadsignal_billing_api;
