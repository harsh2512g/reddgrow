-- Phase 8: narrow, audited platform operations. No platform role is granted here.
create table private.platform_operations_audit (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null, organization_id uuid references public.organizations(id) on delete set null,
  target_id uuid, request_id uuid, parameters jsonb not null default '{}', result jsonb,
  created_at timestamptz not null default now(), unique(actor_user_id,request_id)
);
alter table private.platform_operations_audit enable row level security;
revoke all on private.platform_operations_audit from public,anon,authenticated;
create table private.platform_job_retries (
  family text not null check(family in ('knowledge','reddit','draft','notification')), job_id uuid not null,
  retry_job_id uuid not null, actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), primary key(family,job_id)
);
alter table private.platform_job_retries enable row level security;
revoke all on private.platform_job_retries from public,anon,authenticated;

create function private.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_platform_admin) then
    raise exception using errcode='42501',message='PLATFORM_ADMIN_REQUIRED';
  end if;
  return auth.uid();
end $$;
create function public.platform_admin_session() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select is_platform_admin from public.profiles where id=auth.uid()),false)
$$;
create function private.platform_audit(p_action text,p_organization_id uuid default null,p_target_id uuid default null) returns void
language sql security definer set search_path='' as $$
  insert into private.platform_operations_audit(actor_user_id,action,organization_id,target_id)
  values(private.require_platform_admin(),p_action,p_organization_id,p_target_id)
$$;

-- Explicit operational fields only: never include options, recipient, payload, content,
-- raw provider responses, source paths, customer identifiers, or lease credentials.
create view private.platform_job_metadata as
  select id,'knowledge'::text as family,kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.knowledge_jobs
  union all select id,'reddit',kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.reddit_jobs
  union all select id,'draft',kind,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.draft_jobs
  union all select id,'notification',type,organization_id,status,attempts,error_code,created_at,updated_at,available_at from public.notification_deliveries;
revoke all on private.platform_job_metadata from public,anon,authenticated;

create function private.platform_metrics(p_organization_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'jobs',coalesce((select jsonb_agg(to_jsonb(c) order by family,status) from (
      select family,status,count(*) as count from private.platform_job_metadata where p_organization_id is null or organization_id=p_organization_id group by family,status
    ) c),'[]'::jsonb),
    'knowledge_ready',(select count(*) from public.knowledge_sources where status in ('ready','partial') and deleted_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'knowledge_failed',(select count(*) from public.knowledge_sources where status='failed' and deleted_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_pass',(select count(*) from public.drafts where compliance_status='pass' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_warning',(select count(*) from public.drafts where compliance_status='warning' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_blocked',(select count(*) from public.drafts where compliance_status='blocked' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'ai_input_tokens',(select coalesce(sum(input_tokens),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'ai_output_tokens',(select coalesce(sum(output_tokens),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'ai_estimated_cost_usd',(select coalesce(sum(estimated_cost_usd),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'billing_applied',(select count(*) from public.billing_events where outcome='applied' and (p_organization_id is null or organization_id=p_organization_id)),
    'billing_stale',(select count(*) from public.billing_events where outcome='stale' and (p_organization_id is null or organization_id=p_organization_id)),
    'billing_last_received_at',(select max(created_at) from public.billing_events where p_organization_id is null or organization_id=p_organization_id)
  )
$$;
create function private.platform_organization_summary(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'status',o.status,'created_at',o.created_at,
    'plan',s.plan_key,'subscription_status',s.status,
    'member_count',(select count(*) from public.organization_members where organization_id=o.id),
    'brand_count',(select count(*) from public.brands where organization_id=o.id and status='active'))
  from public.organizations o left join public.subscriptions s on s.organization_id=o.id where o.id=p_id
$$;
create function public.platform_admin_overview() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.platform_audit('overview.read');
  return jsonb_build_object('organizations',(select jsonb_build_object('total',count(*),'active',count(*) filter(where status='active'),'suspended',count(*) filter(where status='suspended')) from public.organizations),
    'metrics',private.platform_metrics(),'generated_at',now());
end $$;
create function public.platform_admin_organizations(p_limit integer default 25,p_after uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_items jsonb; v_last uuid; v_more boolean;
begin
  perform private.require_platform_admin();
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGINATION'; end if;
  perform private.platform_audit('organizations.list');
  select coalesce(jsonb_agg(private.platform_organization_summary(id) order by id),'[]'::jsonb) into v_items
    from (select id from public.organizations where p_after is null or id>p_after order by id limit p_limit) selected;
  v_last:=(v_items->-1->>'id')::uuid;
  select exists(select 1 from public.organizations where id>v_last) into v_more;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then v_last end);
end $$;
create function public.platform_admin_organization(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.organizations;
begin
  perform private.require_platform_admin();
  select * into o from public.organizations where id=p_organization_id;
  if not found then raise exception 'ORGANIZATION_NOT_FOUND'; end if;
  perform private.platform_audit('organization.read',o.id,o.id);
  return jsonb_build_object('organization',private.platform_organization_summary(o.id),'timezone',o.timezone,'currency',o.default_currency,
    'usage',coalesce((select jsonb_agg(to_jsonb(c) order by period_start desc,metric) from (select metric,quantity,period_start,period_end from public.usage_counters where organization_id=o.id order by period_start desc,metric limit 100)c),'[]'::jsonb),
    'metrics',private.platform_metrics(o.id));
end $$;
create function public.platform_admin_jobs(p_limit integer default 25,p_before timestamptz default null,p_before_id uuid default null,p_family text default null,p_status text default null,p_organization_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_items jsonb; v_more boolean; v_last_time timestamptz; v_last_id uuid;
begin
  perform private.require_platform_admin();
  if p_limit is null or p_limit not between 1 and 50 or (p_before is null)<>(p_before_id is null)
    or (p_family is not null and p_family not in ('knowledge','reddit','draft','notification'))
    or (p_status is not null and p_status not in ('queued','processing','completed','failed','sent','suppressed')) then raise exception 'INVALID_PAGINATION'; end if;
  perform private.platform_audit('jobs.list',p_organization_id);
  select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc,id desc),'[]'::jsonb) into v_items from (
    select j.*,j.status='failed' and not exists(select 1 from private.platform_job_retries r where r.family=j.family and r.job_id=j.id)
      and (j.organization_id is null or exists(select 1 from public.organizations o where o.id=j.organization_id and o.status='active' and o.deleted_at is null))
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

-- A bounded reason code avoids copying sensitive customer content into operator notes.
create function private.validate_platform_operation(p_reason text,p_request_id uuid) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or p_reason not in ('security_review','provider_failure','customer_request','maintenance','recovered') or p_request_id is null then raise exception 'INVALID_PLATFORM_OPERATION'; end if;
end $$;
create function public.platform_admin_set_organization_status(p_organization_id uuid,p_paused boolean,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; o public.organizations; v_parameters jsonb; prior private.platform_operations_audit; v_result jsonb;
begin
  v_actor:=private.require_platform_admin(); perform private.validate_platform_operation(p_reason,p_request_id);
  if p_paused is null then raise exception 'INVALID_PLATFORM_OPERATION'; end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,81));
  v_parameters:=jsonb_build_object('organization_id',p_organization_id,'paused',p_paused,'reason',p_reason);
  select * into prior from private.platform_operations_audit where actor_user_id=v_actor and request_id=p_request_id;
  if found then
    if prior.action<>'organization.status' or prior.parameters<>v_parameters then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  select * into o from public.organizations where id=p_organization_id for update;
  if not found or o.deleted_at is not null or o.status='deleted' then raise exception 'ORGANIZATION_NOT_FOUND'; end if;
  update public.organizations set status=case when p_paused then 'suspended' else 'active' end where id=o.id;
  v_result:=jsonb_build_object('organization_id',o.id,'status',case when p_paused then 'suspended' else 'active' end,'replayed',false);
  insert into private.platform_operations_audit(actor_user_id,action,organization_id,target_id,request_id,parameters,result)
    values(v_actor,'organization.status',o.id,o.id,p_request_id,v_parameters,v_result);
  -- Customer-visible activity gets safe facts only; operator identity remains a UUID.
  perform private.audit(o.id,case when p_paused then 'organization.paused' else 'organization.resumed' end,'organization',o.id,jsonb_build_object('reason',p_reason));
  return v_result;
end $$;

create function public.platform_admin_retry_job(p_family text,p_job_id uuid,p_reason text,p_request_id uuid) returns jsonb
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

create function public.get_organization_activity(p_organization_id uuid,p_limit integer default 25,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_last_time timestamptz; v_last_id uuid; v_more boolean;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  if p_limit is null or p_limit not between 1 and 50 or (p_before is null)<>(p_before_id is null) then raise exception 'INVALID_PAGINATION'; end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc,id desc),'[]'::jsonb) into v_items from (
    select id,action,target_type,target_id,actor_user_id,actor_type,created_at from public.audit_logs
    where organization_id=p_organization_id and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit p_limit
  )c;
  v_last_time:=(v_items->-1->>'created_at')::timestamptz; v_last_id:=(v_items->-1->>'id')::uuid;
  select exists(select 1 from public.audit_logs where organization_id=p_organization_id and (created_at,id)<(v_last_time,v_last_id)) into v_more;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then jsonb_build_object('created_at',v_last_time,'id',v_last_id) end);
end $$;

revoke all on function private.require_platform_admin(),private.platform_audit(text,uuid,uuid),private.platform_metrics(uuid),private.platform_organization_summary(uuid),private.validate_platform_operation(text,uuid) from public,anon,authenticated;
revoke all on function public.platform_admin_session(),public.platform_admin_overview(),public.platform_admin_organizations(integer,uuid),public.platform_admin_organization(uuid),public.platform_admin_jobs(integer,timestamptz,uuid,text,text,uuid),public.platform_admin_set_organization_status(uuid,boolean,text,uuid),public.platform_admin_retry_job(text,uuid,text,uuid),public.get_organization_activity(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.platform_admin_session(),public.platform_admin_overview(),public.platform_admin_organizations(integer,uuid),public.platform_admin_organization(uuid),public.platform_admin_jobs(integer,timestamptz,uuid,text,text,uuid),public.platform_admin_set_organization_status(uuid,boolean,text,uuid),public.platform_admin_retry_job(text,uuid,text,uuid),public.get_organization_activity(uuid,integer,timestamptz,uuid) to authenticated;

create index platform_operations_audit_created_idx on private.platform_operations_audit(created_at desc,id);
create index audit_logs_activity_cursor_idx on public.audit_logs(organization_id,created_at desc,id desc);
