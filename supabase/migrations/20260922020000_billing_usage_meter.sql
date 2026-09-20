-- Match the community meter to the existing atomic allocation rule, including active
-- monitors retained on archived brands. Archiving data never hides consumed capacity.
create or replace function public.get_billing_usage(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; p public.plan_catalog; v_brands bigint; v_communities bigint; v_members bigint;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select * into strict p from public.plan_catalog where key=s.plan_key;
  select count(*) into v_brands from public.brands where organization_id=p_organization_id and status='active';
  select count(*) into v_communities from public.brand_subreddits bs where bs.organization_id=p_organization_id and bs.status='active';
  select (select count(*) from public.organization_members where organization_id=p_organization_id)+(select count(*) from public.organization_invitations where organization_id=p_organization_id and accepted_at is null and revoked_at is null and expires_at>now()) into v_members;
  return jsonb_build_object('period_start',s.current_period_start,'period_end',s.current_period_end,'features',p.features,'meters',jsonb_build_array(
    jsonb_build_object('metric','brands','used',v_brands,'limit',p.brand_limit),jsonb_build_object('metric','communities','used',v_communities,'limit',p.subreddit_limit),jsonb_build_object('metric','members','used',v_members,'limit',p.member_limit),
    jsonb_build_object('metric','opportunities','used',coalesce((select quantity from public.usage_counters where organization_id=p_organization_id and metric='opportunities' and period_start=s.current_period_start and period_end=s.current_period_end),0),'limit',p.opportunity_limit),
    jsonb_build_object('metric','ai_drafts','used',coalesce((select quantity from public.usage_counters where organization_id=p_organization_id and metric='ai_drafts' and period_start=s.current_period_start and period_end=s.current_period_end),0),'limit',p.ai_draft_limit)));
end $$;

-- Resend retains idempotency keys for 24 hours. A 23-hour local fence leaves
-- clock/transport headroom and refuses changed recipients or message context.
alter table public.notification_deliveries add column first_attempt_at timestamptz;
alter table public.notification_deliveries add column delivery_fingerprint text check(delivery_fingerprint ~ '^[a-f0-9]{64}$');

create or replace function private.claim_notification(p_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries; p public.notification_preferences; o public.organizations; v_time time; v_due timestamptz; v_local timestamp; v_email text; v_suppress boolean:=false; v_score numeric; v_count bigint; v_fingerprint text;
begin
  if p_lease_token is null then raise exception 'INVALID_NOTIFICATION_LEASE'; end if;
  select * into d from public.notification_deliveries where id=p_id for update;
  if not found or d.status<>'queued' or d.available_at>now() or d.attempts>=3 then return null; end if;
  if d.first_attempt_at is not null and d.first_attempt_at<=now()-interval '23 hours' then
    update public.notification_deliveries set status='failed',error_code='NOTIFICATION_RETRY_WINDOW_EXPIRED' where id=d.id; return null;
  end if;
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
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('organization_name',o.name,'recipient',v_email,'payload',d.payload)::text,'sha256'),'hex');
  if d.delivery_fingerprint is not null and d.delivery_fingerprint<>v_fingerprint then
    update public.notification_deliveries set status='suppressed',error_code='NOTIFICATION_CONTEXT_CHANGED' where id=d.id; return null;
  end if;
  v_local:=now() at time zone o.timezone; v_time:=v_local::time;
  if p.quiet_start is not null and ((p.quiet_start<p.quiet_end and v_time>=p.quiet_start and v_time<p.quiet_end) or (p.quiet_start>p.quiet_end and (v_time>=p.quiet_start or v_time<p.quiet_end))) then
    v_due:=((v_local::date+case when p.quiet_start>p.quiet_end and v_time>=p.quiet_start then 1 else 0 end)+p.quiet_end) at time zone o.timezone;
    update public.notification_deliveries set available_at=greatest(v_due,now()+interval '1 minute') where id=d.id; return null;
  end if;
  update public.notification_deliveries set status='processing',first_attempt_at=coalesce(first_attempt_at,now()),delivery_fingerprint=v_fingerprint,attempts=attempts+1,lease_token=p_lease_token,lease_expires_at=now()+interval '120 seconds',payload=d.payload,error_code=null where id=d.id;
  return jsonb_build_object('id',d.id,'organization_id',d.organization_id,'user_id',d.user_id,'type',d.type,'recipient',v_email,'organization_name',o.name,'payload',d.payload,'attempt',d.attempts+1);
end $$;
