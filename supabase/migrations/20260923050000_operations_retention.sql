-- Platform metadata audit/request receipts last 180 days. Manual retries only for jobs created within 90 days.
create or replace function private.platform_retry_existing_job(p_family text,p_job_id uuid,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_parameters jsonb; prior private.platform_operations_audit; v_result jsonb; v_retry uuid;
  k public.knowledge_jobs; s public.knowledge_sources; r public.reddit_jobs; d public.draft_jobs; draft public.drafts; n public.notification_deliveries;
begin
  v_actor:=private.require_platform_admin(); perform private.validate_platform_operation(p_reason,p_request_id);
  if p_family is null or p_family not in ('knowledge','reddit','draft','notification') or p_job_id is null then raise exception 'INVALID_PLATFORM_OPERATION'; end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,81));
  v_parameters:=jsonb_build_object('family',p_family,'job_id',p_job_id,'reason',p_reason);
  select * into prior from private.platform_operations_audit where actor_user_id=v_actor and request_id=p_request_id;
  if found then
    if prior.action<>'job.retry' or prior.parameters<>v_parameters then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  select organization_id into v_org from private.platform_job_metadata where id=p_job_id and family=p_family;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if not exists(select 1 from private.platform_job_metadata where id=p_job_id and family=p_family and created_at>now()-interval '90 days') then raise exception 'JOB_NOT_RETRYABLE'; end if;
  if v_org is not null then
    perform 1 from public.organizations where id=v_org and status='active' and deleted_at is null for update;
    if not found then raise exception 'ORGANIZATION_UNAVAILABLE'; end if;
  end if;
  -- All retries for one source row serialize, including independent request IDs.
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(p_family||p_job_id::text,82));
  select retry_job_id into v_retry from private.platform_job_retries where family=p_family and job_id=p_job_id;
  if found then raise exception 'JOB_ALREADY_RETRIED'; end if;
  if p_family='knowledge' then
    select * into k from public.knowledge_jobs where id=p_job_id;
    perform 1 from public.brands where id=k.brand_id for update;
    select * into s from public.knowledge_sources where id=k.source_id for update;
    select * into k from public.knowledge_jobs where id=p_job_id for update;
    if k.status<>'failed' then raise exception 'JOB_NOT_RETRYABLE'; end if;
    if s.id is null or s.generation<>k.generation or exists(select 1 from public.knowledge_jobs where source_id=s.id and status in ('queued','processing')) then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    if k.kind='ingest' then
      perform private.require_available_plan(v_org);
      if s.deleted_at is not null or s.status<>'failed' or not exists(select 1 from public.brands where id=k.brand_id and status='active') then raise exception 'JOB_CONTEXT_CHANGED'; end if;
      perform private.require_knowledge_page_capacity(s.brand_id,cardinality(s.selected_pages),s.id);
    elsif s.deleted_at is null then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    update public.knowledge_sources set generation=generation+1,status=case when k.kind='delete' then 'deleting' else 'pending' end,error_code=null where id=s.id returning * into s;
    insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(k.organization_id,k.brand_id,k.source_id,s.generation,k.kind) returning id into v_retry;
  elsif p_family='reddit' then
    select * into r from public.reddit_jobs where id=p_job_id for update;
    if r.status<>'failed' then raise exception 'JOB_NOT_RETRYABLE'; end if;
    if exists(select 1 from public.reddit_jobs where dedupe_key=r.dedupe_key and status in ('queued','processing')) then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    if r.organization_id is not null then
      perform private.require_available_plan(r.organization_id);
      if not exists(select 1 from public.brands b join public.brand_subreddits bs on bs.brand_id=b.id join public.reddit_posts p on p.subreddit_id=bs.subreddit_id
        where b.id=r.brand_id and b.status='active' and bs.status='active' and p.id=r.reddit_post_id and not p.is_deleted and p.purged_at is null and not p.is_locked and not p.is_archived)
        or (r.kind='rescore' and not exists(select 1 from public.opportunities where id=r.opportunity_id and status not in ('dismissed','archived'))) then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    elsif r.kind in ('sync','rules') and not exists(select 1 from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id
      where bs.subreddit_id=r.subreddit_id and bs.status='active' and b.status='active' and private.billing_plan_active(bs.organization_id)) then raise exception 'JOB_CONTEXT_CHANGED';
    elsif r.kind='refresh' and not exists(select 1 from public.reddit_posts where id=r.reddit_post_id and not is_deleted and purged_at is null) then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    insert into public.reddit_jobs(kind,organization_id,brand_id,subreddit_id,reddit_post_id,opportunity_id,sort,dedupe_key)
      values(r.kind,r.organization_id,r.brand_id,r.subreddit_id,r.reddit_post_id,r.opportunity_id,r.sort,r.dedupe_key) returning id into v_retry;
  elsif p_family='draft' then
    select * into d from public.draft_jobs where id=p_job_id;
    select * into draft from public.drafts where id=d.draft_id for update;
    select * into d from public.draft_jobs where id=p_job_id for update;
    if d.status<>'failed' then raise exception 'JOB_NOT_RETRYABLE'; end if;
    perform private.require_draft_available(d.draft_id);
    if draft.current_version<>d.version or draft.status<>'error' or exists(select 1 from public.draft_jobs where draft_id=d.draft_id and status in ('queued','processing')) then raise exception 'JOB_CONTEXT_CHANGED'; end if;
    -- Reuse the paid generation reservation and request identity; approval is never granted.
    update public.draft_jobs set status='queued',attempts=0,available_at=now(),lease_token=null,lease_expires_at=null,error_code=null where id=d.id;
    update public.drafts set status=case when d.kind='generate' then 'generating' else 'editing' end,error_code=null,approved_by=null,approved_at=null where id=d.draft_id;
    v_retry:=d.id;
  else
    select * into n from public.notification_deliveries where id=p_job_id for update;
    if n.status<>'failed' then raise exception 'JOB_NOT_RETRYABLE'; end if;
    if n.first_attempt_at is not null and n.first_attempt_at<=now()-interval '23 hours' then raise exception 'NOTIFICATION_RETRY_WINDOW_EXPIRED'; end if;
    -- Existing claim function rechecks current membership, preferences, quiet hours,
    -- lifecycle, recipient/context fingerprint and provider idempotency deadline.
    update public.notification_deliveries set status='queued',attempts=0,available_at=now(),lease_token=null,lease_expires_at=null,error_code=null where id=n.id;
    v_retry:=n.id;
  end if;
  insert into private.platform_job_retries(family,job_id,retry_job_id,actor_user_id) values(p_family,p_job_id,v_retry,v_actor);
  v_result:=jsonb_build_object('job_id',v_retry,'replayed',false);
  insert into private.platform_operations_audit(actor_user_id,action,organization_id,target_id,request_id,parameters,result)
    values(v_actor,'job.retry',v_org,p_job_id,p_request_id,v_parameters,v_result);
  return v_result;
end $$;

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
  if j.created_at<=now()-interval '90 days' then raise exception 'JOB_NOT_RETRYABLE'; end if;
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

create or replace function public.platform_admin_jobs(p_limit integer default 25,p_before timestamptz default null,p_before_id uuid default null,p_family text default null,p_status text default null,p_organization_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_items jsonb; v_more boolean; v_last_time timestamptz; v_last_id uuid;
begin
  perform private.require_platform_admin();
  if p_limit is null or p_limit not between 1 and 50 or (p_before is null)<>(p_before_id is null)
    or (p_family is not null and p_family not in ('knowledge','reddit','draft','notification','privacy'))
    or (p_status is not null and p_status not in ('queued','processing','completed','failed','sent','suppressed')) then raise exception 'INVALID_PAGINATION'; end if;
  perform private.platform_audit('jobs.list',p_organization_id);
  select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc,id desc),'[]'::jsonb) into v_items from (
    select j.*,j.created_at>now()-interval '90 days' and j.status='failed' and not exists(select 1 from private.platform_job_retries r where r.family=j.family and r.job_id=j.id)
      and (j.organization_id is null or exists(select 1 from public.organizations o where o.id=j.organization_id and ((o.status='active' and o.deleted_at is null) or (j.family='privacy' and j.kind='delete' and o.status='deleted'))))
      and (j.family<>'privacy' or exists(select 1 from public.organization_data_requests p where p.id=j.id and p.confirmed_at is not null and p.status='failed'))
      and (j.family<>'notification' or exists(select 1 from public.notification_deliveries n where n.id=j.id and (n.first_attempt_at is null or n.first_attempt_at>now()-interval '23 hours'))) as retry_available
    from private.platform_job_metadata j where (p_family is null or j.family=p_family) and (p_status is null or j.status=p_status)
      and (p_organization_id is null or j.organization_id=p_organization_id) and (p_before is null or (j.created_at,j.id)<(p_before,p_before_id))
    order by created_at desc,id desc limit p_limit
  )c;
  v_last_time:=(v_items->-1->>'created_at')::timestamptz; v_last_id:=(v_items->-1->>'id')::uuid;
  select exists(select 1 from private.platform_job_metadata j where (p_family is null or j.family=p_family) and (p_status is null or j.status=p_status)
    and (p_organization_id is null or j.organization_id=p_organization_id) and (j.created_at,j.id)<(v_last_time,v_last_id)) into v_more;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then jsonb_build_object('created_at',v_last_time,'id',v_last_id) end);
end $$;



-- Keep bounded administrative evidence without resetting a live job's retry allowance.
create function private.maintain_platform_operations(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_audits integer; v_retries integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'INVALID_MAINTENANCE_LIMIT'; end if;
  delete from private.platform_operations_audit where id in (
    select id from private.platform_operations_audit where created_at<now()-interval '180 days' order by created_at,id limit p_limit
  ); get diagnostics v_audits=row_count;
  delete from private.platform_job_retries where (family,job_id) in (
    select r.family,r.job_id from private.platform_job_retries r where r.created_at<now()-interval '180 days'
      and not exists(select 1 from private.platform_job_metadata j where j.family=r.family and j.id=r.job_id and j.created_at>now()-interval '90 days')
    order by r.created_at,r.family,r.job_id limit p_limit
  ); get diagnostics v_retries=row_count;
  return jsonb_build_object('audits_deleted',v_audits,'retry_receipts_deleted',v_retries);
end $$;
revoke all on function private.maintain_platform_operations(integer) from public,anon,authenticated;
create index platform_job_retries_created_idx on private.platform_job_retries(created_at,family,job_id);
