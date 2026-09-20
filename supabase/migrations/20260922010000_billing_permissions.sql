-- Phase 7 follow-up: provider activation and mock entitlements require the trusted server bridge.

revoke execute on function public.complete_mock_checkout(uuid,uuid),public.manage_mock_subscription(uuid,text,text) from authenticated;
grant execute on function public.complete_mock_checkout(uuid,uuid),public.manage_mock_subscription(uuid,text,text) to threadsignal_billing_api;
grant usage on schema public to threadsignal_billing_api;

drop function public.begin_billing_checkout(uuid,text,uuid);

create function public.begin_billing_checkout(p_organization_id uuid,p_plan_key text,p_idempotency_key uuid,p_provider text default 'mock') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.billing_checkout_requests; s public.subscriptions;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  if p_plan_key is null or p_plan_key not in ('solo','growth') or p_idempotency_key is null or p_provider is null or p_provider not in ('mock','stripe') then raise exception 'INVALID_CHECKOUT'; end if;
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select * into r from public.billing_checkout_requests where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if r.plan_key::text<>p_plan_key or r.provider<>p_provider then raise exception 'BILLING_IDEMPOTENCY_CONFLICT'; end if;
  else
    if s.provider='stripe' and s.status not in ('canceled','incomplete_expired') then raise exception 'BILLING_PORTAL_REQUIRED'; end if;
    if (select count(*) from public.billing_checkout_requests where organization_id=p_organization_id and created_at>now()-interval '10 minutes')>=10 then raise exception 'BILLING_RATE_LIMIT'; end if;
    insert into public.billing_checkout_requests(organization_id,requested_by,idempotency_key,plan_key,provider)
      values(p_organization_id,auth.uid(),p_idempotency_key,p_plan_key::public.plan_key,p_provider) returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'organization_id',r.organization_id,'plan_key',r.plan_key,'provider',r.provider,'status',r.status,'expires_at',r.expires_at);
end $$;

revoke all on function public.begin_billing_checkout(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_billing_checkout(uuid,text,uuid,text) to authenticated;

create or replace function private.apply_billing_event(p_event jsonb) returns jsonb
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
  if s.provider='stripe' and not (s.status in ('canceled','incomplete_expired') and s.provider_subscription_id is distinct from v_sub->>'id') then
    if s.provider_customer_id is distinct from v_sub->>'customerId' or s.provider_subscription_id is distinct from v_sub->>'id' then raise exception 'BILLING_CUSTOMER_CONFLICT'; end if;
  elsif not exists(select 1 from public.billing_checkout_requests where organization_id=v_org and provider='stripe' and status='pending'
    and (provider_customer_id=v_sub->>'customerId' or (provider_customer_id is null and provider_session_id=p_event->>'checkoutSessionId'))) then raise exception 'BILLING_CHECKOUT_REQUIRED'; end if;
  -- Terminal snapshots cannot be resurrected. Equal-second events use authoritative
  -- snapshots fetched under the application's organization advisory lock.
  v_stale:=coalesce(v_created<s.latest_provider_event_at,false) or (s.status in ('canceled','incomplete_expired') and s.provider='stripe' and s.provider_subscription_id=v_sub->>'id' and v_sub->>'status' not in ('canceled','incomplete_expired'));
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

create or replace function public.manage_mock_subscription(p_organization_id uuid,p_action text,p_plan_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; v_start timestamptz; v_end timestamptz;
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
    v_start:=s.current_period_end; v_end:=v_start+interval '1 month';
    while v_end<=now() loop v_start:=v_end; v_end:=v_start+interval '1 month'; end loop;
    update public.subscriptions set current_period_start=v_start,current_period_end=v_end where organization_id=p_organization_id;
  end if;
  perform private.audit(p_organization_id,'subscription.'||p_action,'subscription',s.id,jsonb_build_object('provider','mock'));
  return public.get_billing_subscription(p_organization_id);
end $$;

create or replace function private.claim_notification(p_id uuid,p_lease_token uuid) returns jsonb
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
  elsif d.type in ('ingestion_complete','ingestion_failed') and not exists(select 1 from public.knowledge_sources where id=(d.payload->>'source_id')::uuid and organization_id=d.organization_id and deleted_at is null and generation=(d.payload->>'generation')::integer and ((d.type='ingestion_failed' and status='failed') or (d.type='ingestion_complete' and status in ('ready','partial')))) then v_suppress:=true;
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

create or replace function private.notification_source_events() returns trigger
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
    v_key:=new.id::text||'-'||new.generation::text; v_payload:=jsonb_build_object('source_id',new.id,'count',new.page_count,'generation',new.generation);
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

create or replace function private.enqueue_notification(p_organization_id uuid,p_user_id uuid,p_type text,p_dedupe_key text,p_payload jsonb default '{}',p_available_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id) then return null; end if;
  insert into public.notification_preferences(organization_id,user_id) values(p_organization_id,p_user_id) on conflict do nothing;
  if p_type='high_score_alert' and (p_payload->>'score')::numeric < (select minimum_score from public.notification_preferences where organization_id=p_organization_id and user_id=p_user_id) then return null; end if;
  insert into public.notification_deliveries(organization_id,user_id,type,dedupe_key,payload,available_at)
    values(p_organization_id,p_user_id,p_type,p_dedupe_key,p_payload,p_available_at) on conflict do nothing returning id into v_id;
  return v_id;
end $$;

create or replace function private.tracking_browser_origin_allowed(p_brand_id uuid,p_origin text,p_allow_fixture boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1 from public.brands b join public.organizations o on o.id=b.organization_id
    join public.subscriptions s on s.organization_id=o.id join public.plan_catalog p on p.key=s.plan_key
    where (p_brand_id is null or b.id=p_brand_id) and b.status='active' and o.status='active' and o.deleted_at is null
      and private.billing_plan_active(o.id) and p.features->'conversionTracking'='true'::jsonb
      and (
        (p_origin='https://'||private.knowledge_host(b.website_url))
        or exists(select 1 from jsonb_array_elements_text(b.profile->'allowed_links') u where p_origin='https://'||private.knowledge_host(u))
        or (p_allow_fixture is true and p_origin='http://127.0.0.1:3000' and private.knowledge_host(b.website_url)='clarityscale.example')
      )
  ),false)
$$;
