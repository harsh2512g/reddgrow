-- Additive, separately reviewed Phase 2 worker prerequisite. This operation is
-- also copied into the local Phase 8 migration; it does not activate later phases.
-- Hosted execution requires explicit authorization. No credentials or LOGIN changes.
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'WORKER_PROVISIONING_REQUIRES_PROJECT_ADMINISTRATOR';
  end if;
end $$;

-- The worker already reads jobs, but must not receive organization table access.
-- Bind the lock to existing runnable work, return only eligibility, and retain
-- the organization lock until the caller's transaction ends. The caller next
-- locks source then job and rechecks its generation/lease before any mutation.
create or replace function public.worker_lock_knowledge_organization(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  organization record;
begin
  select j.organization_id,j.brand_id,j.source_id,j.kind into candidate
  from public.knowledge_jobs j where j.id=p_job_id and j.status in ('queued','processing');
  if not found then return false; end if;
  select o.status,o.deleted_at into organization from public.organizations o
  where o.id=candidate.organization_id for update;
  if not found or (candidate.kind='ingest' and
    (organization.status<>'active' or organization.deleted_at is not null)) then
    return false;
  end if;
  return exists (
    select 1 from public.knowledge_jobs j join public.knowledge_sources s
      on s.id=j.source_id and s.organization_id=j.organization_id and s.brand_id=j.brand_id
    where j.id=p_job_id and j.organization_id=candidate.organization_id
      and j.source_id=candidate.source_id and j.brand_id=candidate.brand_id
      and j.kind=candidate.kind and j.status in ('queued','processing')
      and ((j.kind='ingest' and s.deleted_at is null)
        or (j.kind='delete' and s.deleted_at is not null and s.status='deleting'))
  );
end $$;

-- Dispatch exposes only existing worker-visible IDs and attempt counts. It does
-- not acquire organization locks; the claim/publication helper fences both races.
create or replace function public.worker_knowledge_dispatch(p_limit integer default 50)
returns table(id uuid,attempts integer) language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'INVALID_INPUT'; end if;
  return query select j.id,j.attempts from public.knowledge_jobs j
    join public.organizations o on o.id=j.organization_id
    join public.knowledge_sources s on s.id=j.source_id
      and s.organization_id=j.organization_id and s.brand_id=j.brand_id
    where ((j.kind='delete' and s.deleted_at is not null and s.status='deleting')
      or (j.kind='ingest' and s.deleted_at is null and o.status='active' and o.deleted_at is null))
      and ((j.status='queued' and j.available_at<=now())
        or (j.status='processing' and j.lease_expires_at<=now()))
    order by j.available_at,j.id limit p_limit;
end $$;

revoke all on function public.worker_lock_knowledge_organization(uuid),
  public.worker_knowledge_dispatch(integer) from public,anon,authenticated,service_role;

-- Local databases may already have the reviewed NOLOGIN verification role.
-- Never attach new authority to an unrecognized role with the same name.
do $$
begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_worker') then
    if not exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_worker'
      and pg_catalog.shobj_description(oid,'pg_authid')='ThreadSignal Phase 2 knowledge worker v1'
      and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication
      and not rolbypassrls and not rolinherit and rolconnlimit=4) then
      raise exception 'WORKER_ROLE_NOT_REVIEWED';
    end if;
    grant execute on function public.worker_lock_knowledge_organization(uuid),
      public.worker_knowledge_dispatch(integer) to threadsignal_worker;
  end if;
end $$;
