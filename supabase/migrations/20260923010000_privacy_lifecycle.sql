-- Phase 8: confirmed privacy operations, private exports and durable cleanup.
-- Historical requests are deliberately NOT confirmed by this migration.
alter table public.organization_data_requests drop constraint organization_data_requests_status_check;
alter table public.organization_data_requests add constraint organization_data_requests_status_check
  check(status in ('requested','processing','completed','canceled','failed','expired','revoked'));
alter table public.organization_data_requests add column confirmed_at timestamptz,
  add column completed_at timestamptz, add column expires_at timestamptz,
  add column artifact_path text, add column artifact_sha256 text,
  add column artifact_bytes integer, add column error_code text;
alter table public.organization_data_requests add constraint organization_data_request_artifact_check check (
  (artifact_path is null or artifact_path ~ ('^' || id::text || '/[a-f0-9-]{36}\.json\.gz$'))
  and (artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$')
  and (artifact_bytes is null or artifact_bytes between 1 and 67108864)
  and (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'));
-- Internal artifact/lease details are never exposed by generic table reads.
revoke select on public.organization_data_requests from authenticated;
grant select(id,organization_id,requested_by,kind,status,created_at,updated_at,confirmed_at,completed_at,expires_at,error_code)
  on public.organization_data_requests to authenticated;

create table public.privacy_jobs (
  id uuid primary key references public.organization_data_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check(kind in ('export','delete')),
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
  error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index privacy_jobs_dispatch_idx on public.privacy_jobs(status,available_at,lease_expires_at);
alter table public.privacy_jobs enable row level security;
revoke all on public.privacy_jobs from public,anon,authenticated;
create policy privacy_jobs_owner_read on public.privacy_jobs for select to authenticated
  using(private.organization_role(organization_id)='owner');
grant select(id,organization_id,kind,status,attempts,available_at,error_code,created_at,updated_at)
  on public.privacy_jobs to authenticated;
create trigger privacy_jobs_updated_at before update on public.privacy_jobs
  for each row execute function private.set_updated_at();

-- No organization FK: the small, content-free receipt survives tenant deletion for 30 days.
create table private.privacy_deletion_receipts (
  request_id uuid primary key, organization_id uuid not null, completed_at timestamptz not null default now()
);
revoke all on private.privacy_deletion_receipts from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('privacy-exports','privacy-exports',false,67108864,array['application/gzip'])
on conflict(id) do nothing;

create function private.privacy_export_access(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_data_requests r
    where r.organization_id::text || '/' || r.artifact_path=p_name and r.kind='export'
      and r.status='completed' and r.expires_at>now() and r.confirmed_at is not null
      and private.organization_role(r.organization_id)='owner')
$$;
revoke all on function private.privacy_export_access(text) from public,anon;
grant execute on function private.privacy_export_access(text) to authenticated;
create policy privacy_exports_owner_read on storage.objects for select to authenticated
  using(bucket_id='privacy-exports' and private.privacy_export_access(name));

create function public.list_organization_data_requests(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,
    'status',case when r.status='completed' and r.kind='export' and r.expires_at<=now() then 'expired' else r.status end,
    'created_at',r.created_at,'confirmed_at',r.confirmed_at,'completed_at',r.completed_at,
    'expires_at',r.expires_at,'error_code',r.error_code,
    'download_available',r.kind='export' and r.status='completed' and r.expires_at>now() and r.artifact_path is not null)
    order by r.created_at desc,r.id) from (select * from public.organization_data_requests
    where organization_id=p_organization_id order by created_at desc,id limit 50) r),'[]'::jsonb);
end $$;

create function public.begin_organization_export(p_organization_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  select id into v_id from public.organization_data_requests where organization_id=p_organization_id
    and kind='export' and status in ('requested','processing');
  if v_id is null then
    -- Bound disk amplification even when callers bypass the HTTP rate limiter.
    if (select count(*) from public.organization_data_requests where organization_id=p_organization_id
      and kind='export' and confirmed_at>now()-interval '24 hours')>=3 then raise exception 'EXPORT_RATE_LIMIT'; end if;
    insert into public.organization_data_requests(organization_id,requested_by,kind,confirmed_at)
      values(p_organization_id,auth.uid(),'export',now()) returning id into v_id;
  else
    update public.organization_data_requests set confirmed_at=coalesce(confirmed_at,now()),requested_by=auth.uid()
      where id=v_id;
  end if;
  insert into public.privacy_jobs(id,organization_id,kind) values(v_id,p_organization_id,'export') on conflict(id) do nothing;
  perform private.audit(p_organization_id,'organization.export_confirmed','data_request',v_id);
  return v_id;
end $$;

create function public.get_organization_export(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.organization_data_requests;
begin
  select * into r from public.organization_data_requests where id=p_request_id;
  perform private.require_role(r.organization_id,array['owner']::public.organization_role[]);
  if r.kind<>'export' or r.status<>'completed' or r.artifact_path is null or r.expires_at<=now()
    then raise exception 'EXPORT_UNAVAILABLE'; end if;
  perform private.audit(r.organization_id,'organization.export_downloaded','data_request',r.id);
  return jsonb_build_object('id',r.id,'bucket','privacy-exports','path',r.organization_id::text || '/' || r.artifact_path,
    'expires_at',r.expires_at,'bytes',r.artifact_bytes,'sha256',r.artifact_sha256);
end $$;

create function public.revoke_organization_export(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.organization_data_requests where id=p_request_id;
  perform 1 from public.organizations where id=v_org for update;
  perform private.require_role(v_org,array['owner']::public.organization_role[]);
  update public.organization_data_requests set status='revoked',expires_at=now() where id=p_request_id and kind='export';
  if not found then raise exception 'EXPORT_UNAVAILABLE'; end if;
  update public.privacy_jobs set status='completed',lease_token=null,lease_expires_at=null where id=p_request_id;
  perform private.audit(v_org,'organization.export_revoked','data_request',p_request_id);
end $$;

create function public.confirm_organization_deletion(p_organization_id uuid,p_confirmation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.organizations; v_id uuid;
begin
  select * into o from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  if p_confirmation is null or p_confirmation<>o.slug then raise exception 'CONFIRMATION_REQUIRED'; end if;
  -- Do not orphan a real paid subscription or imply that database deletion cancels payment.
  if exists(select 1 from public.subscriptions where organization_id=p_organization_id and provider='stripe'
    and status not in ('canceled','incomplete')) then raise exception 'BILLING_CANCELLATION_REQUIRED'; end if;
  select id into v_id from public.organization_data_requests where organization_id=p_organization_id
    and kind='delete' and status in ('requested','processing');
  if v_id is null then
    insert into public.organization_data_requests(organization_id,requested_by,kind,confirmed_at)
      values(p_organization_id,auth.uid(),'delete',now()) returning id into v_id;
  else
    update public.organization_data_requests set confirmed_at=now(),requested_by=auth.uid() where id=v_id;
  end if;
  insert into public.privacy_jobs(id,organization_id,kind) values(v_id,p_organization_id,'delete') on conflict(id) do nothing;
  perform private.audit(p_organization_id,'organization.deletion_confirmed','data_request',v_id);
  update public.organizations set status='deleted',deleted_at=now() where id=p_organization_id;
  update public.extension_sessions set revoked_at=coalesce(revoked_at,now()) where organization_id=p_organization_id;
  delete from public.extension_connection_codes where organization_id=p_organization_id;
  update public.conversion_api_keys set revoked_at=coalesce(revoked_at,now()) where organization_id=p_organization_id;
  update public.tracking_links set status='revoked',revoked_at=coalesce(revoked_at,now()) where organization_id=p_organization_id;
  update public.organization_invitations set revoked_at=coalesce(revoked_at,now()) where organization_id=p_organization_id;
  update public.knowledge_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='ORGANIZATION_DELETED' where organization_id=p_organization_id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,options='{}',error_code='ORGANIZATION_DELETED' where organization_id=p_organization_id;
  update public.reddit_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='ORGANIZATION_DELETED' where organization_id=p_organization_id;
  update public.notification_deliveries set status='suppressed',lease_token=null,lease_expires_at=null,error_code='ORGANIZATION_DELETED' where organization_id=p_organization_id and status in ('queued','processing');
  update public.organization_data_requests set status='revoked',expires_at=now() where organization_id=p_organization_id and kind='export';
  update public.privacy_jobs set status='completed',lease_token=null,lease_expires_at=null where organization_id=p_organization_id and kind='export';
  return v_id;
end $$;

create function private.claim_privacy_job(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.privacy_jobs; o public.organizations;
begin
  select * into j from public.privacy_jobs where id=p_id;
  if not found then return null; end if;
  select * into o from public.organizations where id=j.organization_id for update;
  if not found or (j.kind='export' and (o.status<>'active' or o.deleted_at is not null))
    or (j.kind='delete' and (o.status<>'deleted' or o.deleted_at is null)) then return null; end if;
  if not exists(select 1 from public.organization_data_requests where id=p_id and confirmed_at is not null
    and status in ('requested','processing')) then return null; end if;
  update public.privacy_jobs set status='failed',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null
    where id=p_id and attempts>=3 and status='processing' and lease_expires_at<=now();
  if found then
    update public.organization_data_requests set status='failed',error_code='LEASE_EXPIRED' where id=p_id;
    return null;
  end if;
  update public.privacy_jobs set status='processing',attempts=attempts+1,lease_token=p_lease,
    lease_expires_at=now()+interval '120 seconds',error_code=null
    where id=p_id and attempts<3 and ((status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now())) returning * into j;
  if not found then return null; end if;
  update public.organization_data_requests set status='processing',error_code=null where id=p_id;
  return jsonb_build_object('id',j.id,'organization_id',j.organization_id,'kind',j.kind,'attempts',j.attempts,'lease_token',j.lease_token);
end $$;

create function private.finish_privacy_export(p_id uuid,p_lease uuid,p_bytes integer,p_sha256 text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.privacy_jobs;
begin
  select * into j from public.privacy_jobs where id=p_id;
  perform 1 from public.organizations where id=j.organization_id and status='active' and deleted_at is null for update;
  if not found then return false; end if;
  update public.privacy_jobs set status='completed',lease_token=null,lease_expires_at=null
    where id=p_id and kind='export' and status='processing' and lease_token=p_lease and lease_expires_at>now();
  if not found then return false; end if;
  update public.organization_data_requests set status='completed',completed_at=now(),expires_at=now()+interval '24 hours',
    artifact_path=id::text || '/' || p_lease::text || '.json.gz',artifact_bytes=p_bytes,artifact_sha256=p_sha256,error_code=null where id=p_id;
  perform private.audit(j.organization_id,'organization.export_completed','data_request',p_id);
  return true;
end $$;

create function private.finish_organization_deletion(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.privacy_jobs;
begin
  select * into j from public.privacy_jobs where id=p_id;
  perform 1 from public.organizations where id=j.organization_id and status='deleted' and deleted_at is not null for update;
  if not found then return false; end if;
  perform 1 from public.privacy_jobs where id=p_id and kind='delete' and status='processing' and lease_token=p_lease and lease_expires_at>now() for update;
  if not found then return false; end if;
  -- Storage metadata must disappear through the Storage API before tenant rows are removed.
  if exists(select 1 from storage.objects where bucket_id in ('knowledge-private','privacy-exports') and split_part(name,'/',1)=j.organization_id::text)
    then raise exception 'STORAGE_CLEANUP_PENDING'; end if;
  insert into private.privacy_deletion_receipts(request_id,organization_id) values(p_id,j.organization_id) on conflict do nothing;
  delete from public.organizations where id=j.organization_id;
  return true;
end $$;

create function private.fail_privacy_job(p_id uuid,p_lease uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare j public.privacy_jobs;
begin
  select * into j from public.privacy_jobs where id=p_id;
  perform 1 from public.organizations where id=j.organization_id for update;
  update public.privacy_jobs set status=case when attempts<3 and p_error<>'EXPORT_TOO_LARGE' then 'queued' else 'failed' end,
    available_at=now()+power(2,attempts)*interval '1 second',lease_token=null,lease_expires_at=null,
    error_code=case when p_error='EXPORT_TOO_LARGE' then p_error else 'PRIVACY_OPERATION_FAILED' end
    where id=p_id and status='processing' and lease_token=p_lease and lease_expires_at>now() returning * into j;
  if found then update public.organization_data_requests set status=case when j.status='failed' then 'failed' else 'requested' end,error_code=j.error_code where id=p_id; end if;
end $$;

-- A purge invalidates existing exports as well as in-flight snapshot publication.
-- Keep the already-reviewed purge implementation and extend its deletion boundary.
alter function private.purge_reddit_post(uuid) rename to purge_reddit_post_before_privacy;
create function private.purge_reddit_post(p_reddit_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.purge_reddit_post_before_privacy(p_reddit_post_id);
  update public.organization_data_requests set status='revoked',expires_at=now(),error_code='SOURCE_CONTENT_DELETED'
    where kind='export' and status in ('requested','processing','completed') and organization_id in
      (select organization_id from public.opportunities where reddit_post_id=p_reddit_post_id);
  update public.privacy_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='SOURCE_CONTENT_DELETED'
    where kind='export' and organization_id in (select organization_id from public.opportunities where reddit_post_id=p_reddit_post_id);
  -- Attribution does not need public comment URLs after the source is gone.
  update public.tracking_links set status='revoked',revoked_at=coalesce(revoked_at,now())
    where opportunity_id in (select id from public.opportunities where reddit_post_id=p_reddit_post_id);
end $$;

revoke all on function private.claim_privacy_job(uuid,uuid),private.finish_privacy_export(uuid,uuid,integer,text),
  private.finish_organization_deletion(uuid,uuid),private.fail_privacy_job(uuid,uuid,text),
  private.purge_reddit_post(uuid),private.purge_reddit_post_before_privacy(uuid) from public,anon,authenticated;
revoke all on function public.list_organization_data_requests(uuid),public.begin_organization_export(uuid),
  public.get_organization_export(uuid),public.revoke_organization_export(uuid),public.confirm_organization_deletion(uuid,text) from public,anon;
grant execute on function public.list_organization_data_requests(uuid),public.begin_organization_export(uuid),
  public.get_organization_export(uuid),public.revoke_organization_export(uuid),public.confirm_organization_deletion(uuid,text) to authenticated;

-- Serialize new Storage metadata with the same organization lock as deletion.
-- Without it an upload admitted just before confirmation could commit after cleanup.
create or replace function private.knowledge_storage_access(p_name text,p_owner text,p_mode text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare parts text[]; b public.brands; s public.knowledge_sources;
begin
  if p_name is null or char_length(p_name)>250 then return false; end if;
  parts:=string_to_array(p_name,'/');
  if cardinality(parts)<>4 or parts[3] !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or parts[4] !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$' then return false; end if;
  if p_mode='insert' then
    perform 1 from public.organizations where id::text=parts[1] and status='active' and deleted_at is null for key share;
    if not found then return false; end if;
  end if;
  select * into b from public.brands where id::text=parts[2] and organization_id::text=parts[1];
  if not found or private.organization_role(b.organization_id) is null then return false; end if;
  select * into s from public.knowledge_sources where storage_path=p_name and id::text=parts[3] and brand_id=b.id and organization_id=b.organization_id;
  if p_mode='read' then
    return (s.id is not null and s.deleted_at is null)
      or (s.id is null and p_owner=auth.uid()::text and private.organization_role(b.organization_id) in ('owner','admin'));
  end if;
  if private.organization_role(b.organization_id) not in ('owner','admin') then return false; end if;
  if p_mode='delete' then return s.id is not null or p_owner=auth.uid()::text; end if;
  if p_mode='insert' then
    if b.status<>'active' or p_owner is distinct from auth.uid()::text or exists(select 1 from public.knowledge_sources where id::text=parts[3]) then return false; end if;
    perform private.require_available_plan(b.organization_id);
    return true;
  end if;
  return false;
end $$;
