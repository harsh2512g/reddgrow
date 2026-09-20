-- Include confirmed privacy work without giving operators authority to confirm deletion.
alter table private.platform_job_retries drop constraint platform_job_retries_family_check;
alter table private.platform_job_retries add constraint platform_job_retries_family_check
  check(family in ('knowledge','reddit','draft','notification','privacy'));
create or replace view private.platform_job_metadata as
  select id,'knowledge'::text as family,kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.knowledge_jobs
  union all select id,'reddit',kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.reddit_jobs
  union all select id,'draft',kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.draft_jobs
  union all select id,'notification',type,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.notification_deliveries
  union all select id,'privacy',kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.privacy_jobs;
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
    select j.*,j.status='failed' and not exists(select 1 from private.platform_job_retries r where r.family=j.family and r.job_id=j.id)
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


-- Preserve all original family lifecycle checks in a private, uncallable helper.
alter function public.platform_admin_retry_job(text,uuid,text,uuid) set schema private;
alter function private.platform_admin_retry_job(text,uuid,text,uuid) rename to platform_retry_existing_job;
revoke all on function private.platform_retry_existing_job(text,uuid,text,uuid) from public,anon,authenticated;
create function public.platform_admin_retry_job(p_family text,p_job_id uuid,p_reason text,p_request_id uuid) returns jsonb
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
    or (j.kind='export' and (o.status<>'active' or o.deleted_at is not null))
    or (j.kind='delete' and o.status<>'deleted') then raise exception 'JOB_CONTEXT_CHANGED'; end if;
  update public.privacy_jobs set status='queued',attempts=0,available_at=now(),lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  update public.organization_data_requests set status='requested',error_code=null where id=r.id;
  insert into private.platform_job_retries(family,job_id,retry_job_id,actor_user_id) values('privacy',j.id,j.id,v_actor);
  v_result:=jsonb_build_object('job_id',j.id,'replayed',false);
  insert into private.platform_operations_audit(actor_user_id,action,organization_id,target_id,request_id,parameters,result)
    values(v_actor,'job.retry',j.organization_id,j.id,p_request_id,v_parameters,v_result);
  return v_result;
end $$;
revoke all on function public.platform_admin_retry_job(text,uuid,text,uuid) from public,anon;
grant execute on function public.platform_admin_retry_job(text,uuid,text,uuid) to authenticated;

-- Keyset job pages remain bounded as durable histories grow.
create index knowledge_jobs_history_idx on public.knowledge_jobs(created_at desc,id desc);
create index reddit_jobs_history_idx on public.reddit_jobs(created_at desc,id desc);
create index draft_jobs_history_idx on public.draft_jobs(created_at desc,id desc);
create index notification_deliveries_history_idx on public.notification_deliveries(created_at desc,id desc);
create index privacy_jobs_history_idx on public.privacy_jobs(created_at desc,id desc);
