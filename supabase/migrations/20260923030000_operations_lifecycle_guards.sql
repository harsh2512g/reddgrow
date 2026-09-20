-- Export retries keep current owner/deadline authority; notification claims use organization-first locking.
create or replace function public.platform_admin_retry_job(p_family text,p_job_id uuid,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_parameters jsonb; prior private.platform_operations_audit; v_result jsonb;
  j public.privacy_jobs; r public.organization_data_requests; o public.organizations;
begin
  if p_family is distinct from 'privacy' then return private.platform_retry_existing_job(p_family,p_job_id,p_reason,p_request_id); end if;
  v_actor:=private.require_platform_admin(); perform private.validate_platform_operation(p_reason,p_request_id);
  if p_job_id is null then raise exception 'INVALID_PLATFORM_OPERATION'; end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,81));
  v_parameters:=jsonb_build_object('family',p_family,'job_id',p_job_id,'reason',p_reason);
  select * into prior from private.platform_operations_audit where actor_user_id=v_actor and request_id=p_request_id;
  if found then
    if prior.action<>'job.retry' or prior.parameters<>v_parameters then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  select * into j from public.privacy_jobs where id=p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  select * into o from public.organizations where id=j.organization_id for update;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(p_family||p_job_id::text,82));
  if exists(select 1 from private.platform_job_retries where family=p_family and job_id=p_job_id) then raise exception 'JOB_ALREADY_RETRIED'; end if;
  select * into r from public.organization_data_requests where id=p_job_id for update;
  select * into j from public.privacy_jobs where id=p_job_id for update;
  if j.status<>'failed' then raise exception 'JOB_NOT_RETRYABLE'; end if;
  if r.id is null or r.confirmed_at is null or r.status<>'failed' or r.organization_id<>j.organization_id or r.kind<>j.kind
    or (j.kind='export' and (o.status<>'active' or o.deleted_at is not null or (r.expires_at is not null and r.expires_at<=now())
      or not exists(select 1 from public.organization_members where organization_id=j.organization_id and user_id=r.requested_by and role='owner')))
    or (j.kind='delete' and o.status<>'deleted') then raise exception 'JOB_CONTEXT_CHANGED'; end if;
  update public.privacy_jobs set status='queued',attempts=0,available_at=now(),lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  update public.organization_data_requests set status='requested',error_code=null where id=r.id;
  insert into private.platform_job_retries(family,job_id,retry_job_id,actor_user_id) values('privacy',j.id,j.id,v_actor);
  v_result:=jsonb_build_object('job_id',j.id,'replayed',false);
  insert into private.platform_operations_audit(actor_user_id,action,organization_id,target_id,request_id,parameters,result)
    values(v_actor,'job.retry',j.organization_id,j.id,p_request_id,v_parameters,v_result);
  return v_result;
end $$;

create or replace function private.claim_notification(p_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries; p public.notification_preferences; o public.organizations; v_time time; v_due timestamptz; v_local timestamp; v_email text; v_suppress boolean:=false; v_score numeric; v_count bigint; v_fingerprint text;
begin
  if p_lease_token is null then raise exception 'INVALID_NOTIFICATION_LEASE'; end if;
  select * into d from public.notification_deliveries where id=p_id;
  if not found then return null; end if;
  -- Serialize dispatch eligibility with organization pause/deletion and operator retries.
  perform 1 from public.organizations where id=d.organization_id for update;
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
  if d.type='trial_ending' and not exists(select 1 from public.subscriptions where organization_id=d.organization_id and status='trialing' and current_period_end>now() and current_period_end<=now()+interval '2 days' and current_period_end::text=d.dedupe_key) then v_suppress:=true; end if;
  if d.type='payment_failed' and not exists(select 1 from public.subscriptions where organization_id=d.organization_id and status='past_due') then v_suppress:=true; end if;
  if d.type='usage_limit' and not exists(
    select 1 from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key join public.usage_counters u on u.organization_id=s.organization_id and u.period_start=s.current_period_start and u.period_end=s.current_period_end
    where s.organization_id=d.organization_id and u.metric=d.payload->>'metric' and d.dedupe_key=u.metric||'-'||extract(epoch from u.period_start)::text
      and u.quantity>=case u.metric when 'ai_drafts' then c.ai_draft_limit else c.opportunity_limit end
  ) then v_suppress:=true; end if;
  if d.type='daily_digest' then
    if not exists(select 1 from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key where s.organization_id=d.organization_id and c.features->'dailyDigest'='true'::jsonb) then v_suppress:=true; end if;
    v_local:=now() at time zone o.timezone;
    if d.dedupe_key<>v_local::date::text then
      update public.notification_deliveries set status='suppressed',error_code='NOTIFICATION_DIGEST_STALE' where id=d.id; return null;
    end if;
    if not v_suppress and v_local::time<p.digest_time then
      v_due:=(v_local::date+p.digest_time) at time zone o.timezone;
      update public.notification_deliveries set available_at=greatest(v_due,now()+interval '1 minute') where id=d.id; return null;
    end if;
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
