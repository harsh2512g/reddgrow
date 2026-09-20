-- Late verified Checkout completion retains its durable request binding.
-- Expiration limits user interaction, not acknowledgment of an actual provider payment.
create or replace function private.apply_billing_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sub jsonb; v_org uuid; s public.subscriptions; e public.billing_events; v_hash text; v_created timestamptz; v_start timestamptz; v_end timestamptz; v_stale boolean; v_checkout_request uuid;
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
  else
    -- Provider payment can finish after the local UI request expires. A signed
    -- Checkout event must still match its exact registered session and customer.
    select id into v_checkout_request from public.billing_checkout_requests
      where organization_id=v_org and provider='stripe' and status in ('pending','expired')
        and provider_session_id=p_event->>'checkoutSessionId'
        and (provider_customer_id is null or provider_customer_id=v_sub->>'customerId');
    if v_checkout_request is null then raise exception 'BILLING_CHECKOUT_REQUIRED'; end if;
  end if;
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
  update public.billing_checkout_requests set status='completed',completed_at=now(),provider_customer_id=v_sub->>'customerId'
    where id=v_checkout_request;
  insert into public.audit_logs(organization_id,actor_type,action,target_type,target_id,metadata) values(v_org,'system','subscription.synchronized','subscription',s.id,jsonb_build_object('provider','stripe','plan_key',v_sub->>'planKey','status',v_sub->>'status'));
  return jsonb_build_object('applied',true,'duplicate',false,'stale',false);
exception when invalid_text_representation or datetime_field_overflow then raise exception 'INVALID_BILLING_EVENT';
end $$;
