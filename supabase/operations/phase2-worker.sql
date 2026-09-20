-- Phase 2 deployment operation, applied only after the application migration.
-- The caller supplies the transaction, advisory lock, and reviewed schema check.
-- This operation never creates a password or enables LOGIN. Provisioning does
-- that separately, in the same transaction, after checking effective privileges.
-- Existing roles are refused: an existing deployment must be verified, not reset.
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'WORKER_PROVISIONING_REQUIRES_PROJECT_ADMINISTRATOR';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'threadsignal_worker') then
    raise exception 'WORKER_ROLE_ALREADY_EXISTS';
  end if;
  if exists (
    select 1 from (values ('brands'), ('knowledge_sources'), ('knowledge_documents'),
      ('knowledge_chunks'), ('knowledge_jobs')) expected(name)
    left join pg_catalog.pg_namespace n on n.nspname = 'public'
    left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = expected.name
    where c.oid is null or c.relkind <> 'r' or not c.relrowsecurity
  ) then
    raise exception 'WORKER_REQUIRES_PHASE_2_RLS_TABLES';
  end if;
end $$;

create role threadsignal_worker nologin nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls noinherit connection limit 4;
comment on role threadsignal_worker is 'ThreadSignal Phase 2 knowledge worker v1';
alter role threadsignal_worker set search_path = '';
alter role threadsignal_worker set statement_timeout = '60s';
alter role threadsignal_worker set lock_timeout = '5s';
alter role threadsignal_worker set idle_in_transaction_session_timeout = '30s';

-- PostgreSQL does not support a per-role denial of a PUBLIC grant. Existing
-- PUBLIC CONNECT/TEMPORARY remain unchanged; temporary session objects are an
-- explicit boundary. The worker cannot create persistent application objects.
grant connect on database postgres to threadsignal_worker;
grant usage on schema public, extensions to threadsignal_worker;

-- Background processing needs all tenant jobs, but no organization/member/Auth
-- data and no ability to edit brand profiles or choose inputs on a user's behalf.
grant select (id, website_url) on public.brands to threadsignal_worker;
grant select on public.knowledge_sources, public.knowledge_documents,
  public.knowledge_chunks, public.knowledge_jobs to threadsignal_worker;
grant update (status, error_code, page_count, chunk_count, last_ingested_at)
  on public.knowledge_sources to threadsignal_worker;
grant delete on public.knowledge_sources to threadsignal_worker;
grant update (status, attempts, available_at, lease_token, lease_expires_at, error_code)
  on public.knowledge_jobs to threadsignal_worker;
grant insert (id, organization_id, brand_id, source_id, document_key, title,
  canonical_url, page_number, section_heading, content, checksum)
  on public.knowledge_documents to threadsignal_worker;
grant update (title, canonical_url, page_number, section_heading, content, checksum)
  on public.knowledge_documents to threadsignal_worker;
grant delete on public.knowledge_documents to threadsignal_worker;
grant insert (organization_id, brand_id, source_id, document_id, chunk_index,
  content, token_count, checksum, embedding, section_heading)
  on public.knowledge_chunks to threadsignal_worker;
grant delete on public.knowledge_chunks to threadsignal_worker;
grant execute on function public.worker_lock_knowledge_organization(uuid),
  public.worker_knowledge_dispatch(integer) to threadsignal_worker;

-- These policies target this role alone. It is not a member of authenticated,
-- service_role, or any tenant role. Browser sessions cannot assume this role.
create policy worker_brands_read on public.brands
  for select to threadsignal_worker using (true);
create policy worker_sources_read on public.knowledge_sources
  for select to threadsignal_worker using (true);
create policy worker_sources_update on public.knowledge_sources
  for update to threadsignal_worker using (true) with check (true);
create policy worker_sources_delete on public.knowledge_sources
  for delete to threadsignal_worker using (deleted_at is not null and status = 'deleting');
create policy worker_documents_read on public.knowledge_documents
  for select to threadsignal_worker using (true);
create policy worker_documents_insert on public.knowledge_documents
  for insert to threadsignal_worker with check (true);
create policy worker_documents_update on public.knowledge_documents
  for update to threadsignal_worker using (true) with check (true);
create policy worker_documents_delete on public.knowledge_documents
  for delete to threadsignal_worker using (true);
create policy worker_chunks_read on public.knowledge_chunks
  for select to threadsignal_worker using (true);
create policy worker_chunks_insert on public.knowledge_chunks
  for insert to threadsignal_worker with check (true);
create policy worker_chunks_delete on public.knowledge_chunks
  for delete to threadsignal_worker using (true);
create policy worker_jobs_read on public.knowledge_jobs
  for select to threadsignal_worker using (true);
create policy worker_jobs_update on public.knowledge_jobs
  for update to threadsignal_worker using (true) with check (true);

-- Refuse unexpected inherited authority rather than changing privileges for
-- Supabase's other roles. Check effective privileges, including PUBLIC grants.
do $$
declare worker_oid oid;
begin
  if to_regprocedure('public.worker_lock_knowledge_organization(uuid)') is null
    or to_regprocedure('public.worker_knowledge_dispatch(integer)') is null then
    raise exception 'WORKER_ORGANIZATION_GUARD_REQUIRES_REVIEWED_ADDITIVE_OPERATION';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p where p.oid in (
      'public.worker_lock_knowledge_organization(uuid)'::regprocedure,
      'public.worker_knowledge_dispatch(integer)'::regprocedure)
    and (not p.prosecdef or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
      or p.proconfig is distinct from array['search_path=""']::text[]
      or not has_function_privilege('threadsignal_worker',p.oid,'EXECUTE')
      or has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))
  ) then raise exception 'WORKER_ORGANIZATION_GUARD_PRIVILEGE_MISMATCH'; end if;
  select oid into strict worker_oid from pg_catalog.pg_roles where rolname = 'threadsignal_worker';
  if exists (select 1 from pg_catalog.pg_auth_members where member = worker_oid)
    or has_database_privilege('threadsignal_worker', current_database(), 'CREATE')
    or exists (
      select 1 from pg_catalog.pg_namespace n
      where n.nspname !~ '^pg_temp_' and n.nspname !~ '^pg_toast_temp_'
        and has_schema_privilege('threadsignal_worker', n.oid, 'CREATE')
    ) then
    raise exception 'WORKER_HAS_UNEXPECTED_CREATION_OR_ROLE_PRIVILEGES';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private', 'auth', 'storage') and c.relkind in ('r', 'p', 'v', 'm')
      and not (n.nspname = 'public' and c.relname in ('brands', 'knowledge_sources',
        'knowledge_documents', 'knowledge_chunks', 'knowledge_jobs'))
      and (has_any_column_privilege('threadsignal_worker', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
        or has_table_privilege('threadsignal_worker', c.oid, 'DELETE,TRUNCATE,TRIGGER'))
  ) then
    raise exception 'WORKER_HAS_UNEXPECTED_DATA_PRIVILEGES';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and not exists (select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('threadsignal_worker', p.oid, 'EXECUTE')
      and p.oid not in ('public.worker_lock_knowledge_organization(uuid)'::regprocedure,
        'public.worker_knowledge_dispatch(integer)'::regprocedure)
  ) then
    raise exception 'WORKER_HAS_UNEXPECTED_APPLICATION_FUNCTION_PRIVILEGES';
  end if;
end $$;
