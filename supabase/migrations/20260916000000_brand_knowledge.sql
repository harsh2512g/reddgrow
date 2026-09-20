-- Phase 2: tenant-scoped brand knowledge. Background jobs contain identifiers only.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  website_url text not null,
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 100000),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index brands_organization_idx on public.brands(organization_id, status);

create table public.brand_competitors (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
  name text not null, domain text not null, aliases jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade
);
create table public.brand_personas (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null unique,
  name text not null, real_role text not null, tone text not null, custom_tone text not null default '',
  reply_length text not null, default_disclosure text not null, prohibited_statements jsonb not null default '[]',
  is_default boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade
);
create table public.brand_keywords (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
  value text not null, kind text not null default 'category', is_exclusion boolean not null default false,
  status text not null default 'active' check (status in ('active','paused')), source text not null default 'manual',
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade,
  unique (brand_id, value, is_exclusion)
);
create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
  name text not null check (char_length(name) between 2 and 150),
  type text not null check (type in ('website','webpage','file','manual')),
  status text not null default 'pending' check (status in ('pending','processing','ready','partial','failed','deleting')),
  source_url text, storage_path text unique, filename text, mime_type text,
  manual_text text check (char_length(manual_text) <= 500000), selected_pages text[] not null default '{}',
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  page_count integer not null default 0 check (page_count >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  generation integer not null default 1 check (generation > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_ingested_at timestamptz, deleted_at timestamptz,
  foreign key (brand_id, organization_id) references public.brands(id, organization_id) on delete cascade,
  unique (id, brand_id, organization_id),
  check ((type = 'file') = (storage_path is not null)),
  check (cardinality(selected_pages) <= 100)
);
create index knowledge_sources_brand_idx on public.knowledge_sources(organization_id, brand_id, created_at);
create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, source_id uuid not null,
  document_key text not null check (char_length(document_key) between 1 and 2048),
  title text not null check (char_length(title) <= 500), canonical_url text,
  page_number integer check (page_number > 0), section_heading text,
  content text not null check (char_length(content) <= 500000),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'), is_included boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (source_id, brand_id, organization_id) references public.knowledge_sources(id, brand_id, organization_id) on delete cascade,
  unique (source_id, document_key), unique (id, source_id, brand_id, organization_id)
);
create index knowledge_documents_source_idx on public.knowledge_documents(organization_id, brand_id, source_id);
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, source_id uuid not null, document_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0), content text not null check (char_length(content) <= 20000), section_heading text,
  token_count integer not null check (token_count between 1 and 1200), embedding extensions.vector(512) not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (document_id, source_id, brand_id, organization_id) references public.knowledge_documents(id, source_id, brand_id, organization_id) on delete cascade,
  unique (document_id, chunk_index), unique (document_id, checksum)
);
create index knowledge_chunks_scope_idx on public.knowledge_chunks(organization_id, brand_id, source_id);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create table public.knowledge_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, source_id uuid not null,
  generation integer not null check (generation > 0), kind text not null check (kind in ('ingest','delete')),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (source_id, brand_id, organization_id) references public.knowledge_sources(id, brand_id, organization_id) on delete cascade,
  unique (source_id, generation, kind)
);
create index knowledge_jobs_dispatch_idx on public.knowledge_jobs(status, available_at, lease_expires_at);

-- Membership checks derive their identity from auth.uid(), never a caller-supplied ID.
do $$ declare t text; begin
  foreach t in array array['brands','brand_competitors','brand_personas','brand_keywords','knowledge_sources','knowledge_documents','knowledge_chunks','knowledge_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.organization_role(organization_id) is not null)', t || '_read_member', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    if t <> 'knowledge_jobs' then execute format('grant select on public.%I to authenticated', t); end if;
  end loop;
  foreach t in array array['brands','brand_competitors','brand_personas','knowledge_sources','knowledge_documents','knowledge_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
grant select(id,organization_id,brand_id,source_id,generation,kind,status,attempts,available_at,error_code,created_at,updated_at) on public.knowledge_jobs to authenticated;

create function private.valid_knowledge_url(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(char_length(p_url) <= 2048
    and p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+(/[^?#[:space:]\\]*)?$'
    and p_url !~ '^https://([0-9]+\.){3}[0-9]+(/|$)'
    and p_url !~ '^https://([^/]*\.)?(localhost|local|internal|test|invalid)(/|$)', false)
$$;
create function private.knowledge_host(p_url text) returns text
language sql immutable set search_path = '' as $$ select split_part(substr(p_url,9),'/',1) $$;
create function private.valid_knowledge_list(p_value jsonb,p_limit integer,p_width integer) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then return false; end if;
  if jsonb_array_length(p_value) > p_limit then return false; end if;
  return not exists(select 1 from jsonb_array_elements(p_value) v where jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) not between 1 and p_width);
end $$;
create function private.validate_brand_profile(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; limits integer[];
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 100000 then raise exception 'INVALID_BRAND'; end if;
  for k, limits in select * from (values
    ('name',array[2,100]),('description',array[10,2000]),('value_proposition',array[10,2000]),
    ('target_audience',array[3,1000]),('category',array[2,100]),('disclosure_text',array[10,500])
  ) bounds(field,width) loop
    if jsonb_typeof(p->k) is distinct from 'string' or char_length(btrim(p->>k)) not between limits[1] and limits[2] then raise exception 'INVALID_BRAND'; end if;
  end loop;
  if not private.valid_knowledge_url(p->>'website_url') then raise exception 'INVALID_WEBSITE'; end if;
  foreach k in array array['pricing_url','docs_url','support_url'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or ((p->>k) <> '' and not private.valid_knowledge_url(p->>k)) then raise exception 'INVALID_WEBSITE'; end if;
  end loop;
  if (p->>'tone') is null or (p->>'tone') not in ('Helpful and concise','Technical','Founder voice','Product specialist','Customer-support style','Custom')
    or (p->>'reply_length') is null or (p->>'reply_length') not in ('concise','standard','detailed')
    or (p->>'real_role') is null or (p->>'real_role') not in ('founder','employee','developer advocate','support','contractor','agency','consultant','other')
    or jsonb_typeof(p->'custom_tone') is distinct from 'string' or char_length(p->>'custom_tone') > 500
    or ((p->>'tone') = 'Custom' and char_length(btrim(p->>'custom_tone')) = 0) then raise exception 'INVALID_PERSONA'; end if;
  foreach k in array array['use_cases','avoid_claims','countries','keywords','exclusions'] loop
    if not private.valid_knowledge_list(p->k,30,200) then raise exception 'INVALID_BRAND_LIST'; end if;
  end loop;
  if not private.valid_knowledge_list(p->'allowed_links',20,2048) then raise exception 'INVALID_ALLOWED_LINK'; end if;
  for v in select value from jsonb_array_elements(p->'allowed_links') loop
    if not private.valid_knowledge_url(v #>> '{}') or private.knowledge_host(v #>> '{}') <> private.knowledge_host(p->>'website_url') then raise exception 'INVALID_ALLOWED_LINK'; end if;
  end loop;
  if jsonb_typeof(p->'competitors') is distinct from 'array' or jsonb_array_length(p->'competitors') > 20 then raise exception 'INVALID_COMPETITOR'; end if;
  for v in select value from jsonb_array_elements(p->'competitors') loop
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'name') is distinct from 'string'
      or char_length(btrim(v->>'name')) not between 2 and 100 or not private.valid_knowledge_url(v->>'domain')
      or not private.valid_knowledge_list(v->'aliases',30,200) then raise exception 'INVALID_COMPETITOR'; end if;
  end loop;
end $$;

create function private.require_brand_capacity(p_organization_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  perform private.require_available_plan(p_organization_id);
  select c.brand_limit into v_limit from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key where s.organization_id=p_organization_id;
  if (select count(*) from public.brands where organization_id=p_organization_id and status='active') >= v_limit then raise exception 'BRAND_LIMIT'; end if;
end $$;

create function public.save_brand(p_organization_id uuid,p_id uuid,p_profile jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  perform private.validate_brand_profile(p_profile);
  if p_id is null then
    perform private.require_brand_capacity(p_organization_id);
    insert into public.brands(organization_id,name,website_url,profile) values(p_organization_id,btrim(p_profile->>'name'),p_profile->>'website_url',p_profile) returning id into v_id;
  else
    select id into v_id from public.brands where id=p_id and organization_id=p_organization_id for update;
    if v_id is null then raise exception 'BRAND_NOT_FOUND'; end if;
    update public.brands set name=btrim(p_profile->>'name'),website_url=p_profile->>'website_url',profile=p_profile where id=v_id;
  end if;
  delete from public.brand_competitors where brand_id=v_id;
  insert into public.brand_competitors(organization_id,brand_id,name,domain,aliases)
    select p_organization_id,v_id,btrim(v->>'name'),v->>'domain',v->'aliases' from jsonb_array_elements(p_profile->'competitors') v;
  insert into public.brand_personas(organization_id,brand_id,name,real_role,tone,custom_tone,reply_length,default_disclosure,prohibited_statements)
    values(p_organization_id,v_id,'Default representative',p_profile->>'real_role',p_profile->>'tone',p_profile->>'custom_tone',p_profile->>'reply_length',p_profile->>'disclosure_text',p_profile->'avoid_claims')
    on conflict (brand_id) do update set real_role=excluded.real_role,tone=excluded.tone,custom_tone=excluded.custom_tone,reply_length=excluded.reply_length,default_disclosure=excluded.default_disclosure,prohibited_statements=excluded.prohibited_statements;
  delete from public.brand_keywords where brand_id=v_id;
  insert into public.brand_keywords(organization_id,brand_id,value,is_exclusion)
    select p_organization_id,v_id,btrim(value),false from jsonb_array_elements_text(p_profile->'keywords') on conflict do nothing;
  insert into public.brand_keywords(organization_id,brand_id,value,kind,is_exclusion)
    select p_organization_id,v_id,btrim(value),'exclusion',true from jsonb_array_elements_text(p_profile->'exclusions') on conflict do nothing;
  perform private.audit(p_organization_id,case when p_id is null then 'brand.created' else 'brand.updated' end,'brand',v_id);
  return v_id;
end $$;
create function public.archive_brand(p_brand_id uuid,p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_brand public.brands;
begin
  select * into v_brand from public.brands where id=p_brand_id;
  if not found then raise exception 'BRAND_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=v_brand.organization_id for update;
  perform private.require_role(v_brand.organization_id,array['owner','admin']::public.organization_role[]);
  select * into v_brand from public.brands where id=p_brand_id for update;
  if p_archived is null then raise exception 'INVALID_BRAND'; end if;
  if v_brand.status='archived' and not p_archived then perform private.require_brand_capacity(v_brand.organization_id); end if;
  update public.brands set status=case when p_archived then 'archived' else 'active' end where id=p_brand_id;
  perform private.audit(v_brand.organization_id,case when p_archived then 'brand.archived' else 'brand.restored' end,'brand',p_brand_id);
end $$;

-- The path has exactly organization/brand/source/filename components. No overwrite policy exists.
create function private.knowledge_storage_access(p_name text,p_owner text,p_mode text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; b public.brands; s public.knowledge_sources;
begin
  if p_name is null or char_length(p_name)>250 then return false; end if;
  parts := string_to_array(p_name,'/');
  if cardinality(parts)<>4 or parts[3] !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or parts[4] !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$' then return false; end if;
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
create policy knowledge_files_insert on storage.objects for insert to authenticated with check (bucket_id='knowledge-private' and private.knowledge_storage_access(name,owner_id,'insert'));
create policy knowledge_files_select on storage.objects for select to authenticated using (bucket_id='knowledge-private' and private.knowledge_storage_access(name,owner_id,'read'));
create policy knowledge_files_delete on storage.objects for delete to authenticated using (bucket_id='knowledge-private' and private.knowledge_storage_access(name,owner_id,'delete'));

create function private.require_knowledge_page_capacity(p_brand_id uuid,p_pages integer,p_skip_source uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_used integer;
begin
  select case when s.plan_key='growth' then 100 else 30 end into v_limit
    from public.brands b join public.subscriptions s on s.organization_id=b.organization_id where b.id=p_brand_id;
  select coalesce(sum(cardinality(selected_pages)),0) into v_used from public.knowledge_sources
    where brand_id=p_brand_id and deleted_at is null and (p_skip_source is null or id<>p_skip_source);
  if p_pages+v_used>v_limit then raise exception 'PAGE_LIMIT'; end if;
end $$;
create function public.add_knowledge_source(p_brand_id uuid,p_id uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.brands; v_type text; v_pages text[]; v_url text; v_storage text; v_filename text; v_mime text; v_object storage.objects;
begin
  select * into b from public.brands where id=p_brand_id;
  if not found then raise exception 'BRAND_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=b.organization_id for update;
  perform private.require_role(b.organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_available_plan(b.organization_id);
  select * into b from public.brands where id=p_brand_id for update;
  if b.status<>'active' then raise exception 'BRAND_ARCHIVED'; end if;
  if p_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>2100000 then raise exception 'INVALID_SOURCE'; end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string' or char_length(btrim(p_input->>'name')) not between 2 and 150 then raise exception 'INVALID_SOURCE'; end if;
  v_type:=p_input->>'type';
  if v_type is null or v_type not in ('website','webpage','manual','file') then raise exception 'INVALID_SOURCE'; end if;
  if not private.valid_knowledge_list(p_input->'pages',100,2048) then raise exception 'INVALID_SOURCE'; end if;
  select coalesce(array_agg(distinct value),'{}') into v_pages from jsonb_array_elements_text(p_input->'pages');
  if jsonb_typeof(p_input->'text') is distinct from 'string' or char_length(p_input->>'text')>500000 then raise exception 'INVALID_SOURCE'; end if;
  if v_type in ('website','webpage') then
    if cardinality(v_pages)=0 or (v_type='webpage' and cardinality(v_pages)<>1) then raise exception 'INVALID_SOURCE'; end if;
    foreach v_url in array v_pages loop
      if not private.valid_knowledge_url(v_url) or private.knowledge_host(v_url)<>private.knowledge_host(b.website_url) then raise exception 'UNAPPROVED_DOMAIN'; end if;
    end loop;
    perform private.require_knowledge_page_capacity(p_brand_id,cardinality(v_pages));
  elsif cardinality(v_pages)<>0 then raise exception 'INVALID_SOURCE'; end if;
  if v_type='manual' and char_length(btrim(p_input->>'text'))<20 then raise exception 'INVALID_SOURCE'; end if;
  if (select count(*) from public.knowledge_sources where brand_id=p_brand_id and deleted_at is null)>=100 then raise exception 'SOURCE_LIMIT'; end if;
  if v_type='file' then
    v_storage:=p_input->>'storage_path'; v_filename:=p_input->>'filename'; v_mime:=p_input->>'mime_type';
    if v_storage is null or v_filename is null or v_mime is null
      or v_filename !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$'
      or v_storage<>b.organization_id::text || '/' || b.id::text || '/' || p_id::text || '/' || v_filename
      or not ((lower(v_filename) like '%.pdf' and v_mime='application/pdf') or (lower(v_filename) like '%.md' and v_mime in ('text/markdown','text/plain')) or (lower(v_filename) like '%.txt' and v_mime='text/plain')) then raise exception 'INVALID_FILE'; end if;
    select * into v_object from storage.objects where bucket_id='knowledge-private' and name=v_storage for update;
    if not found or v_object.owner_id is distinct from auth.uid()::text then raise exception 'FILE_NOT_FOUND'; end if;
    if (v_object.metadata->>'size') is null or (v_object.metadata->>'size') !~ '^[0-9]+$' or (v_object.metadata->>'size')::numeric not between 1 and 10485760 or v_object.metadata->>'mimetype' is distinct from v_mime then raise exception 'INVALID_FILE'; end if;
  end if;
  insert into public.knowledge_sources(id,organization_id,brand_id,name,type,source_url,storage_path,filename,mime_type,manual_text,selected_pages)
    values(p_id,b.organization_id,b.id,btrim(p_input->>'name'),v_type,v_pages[1],v_storage,v_filename,v_mime,case when v_type='manual' then p_input->>'text' end,v_pages);
  insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(b.organization_id,b.id,p_id,1,'ingest');
  perform private.audit(b.organization_id,'knowledge.added','knowledge_source',p_id,jsonb_build_object('type',v_type));
  return p_id;
end $$;
create function public.retry_knowledge_source(p_source_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.knowledge_sources; b public.brands;
begin
  select * into s from public.knowledge_sources where id=p_source_id;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=s.organization_id for update;
  perform private.require_role(s.organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_available_plan(s.organization_id);
  select * into b from public.brands where id=s.brand_id for update;
  select * into s from public.knowledge_sources where id=p_source_id for update;
  if b.status<>'active' then raise exception 'BRAND_ARCHIVED'; end if;
  if s.deleted_at is not null then raise exception 'SOURCE_NOT_FOUND'; end if;
  if s.status in ('pending','processing') then return; end if;
  perform private.require_knowledge_page_capacity(s.brand_id,cardinality(s.selected_pages),s.id);
  update public.knowledge_sources set status='pending',error_code=null,generation=generation+1 where id=s.id returning * into s;
  insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(s.organization_id,s.brand_id,s.id,s.generation,'ingest');
  perform private.audit(s.organization_id,'knowledge.retry_requested','knowledge_source',s.id);
end $$;
create function public.delete_knowledge_source(p_source_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.knowledge_sources;
begin
  select * into s from public.knowledge_sources where id=p_source_id;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=s.organization_id for update;
  perform private.require_role(s.organization_id,array['owner','admin']::public.organization_role[]);
  select * into s from public.knowledge_sources where id=p_source_id for update;
  if s.deleted_at is not null then
    if exists(select 1 from public.knowledge_jobs where source_id=s.id and generation=s.generation and kind='delete' and status='failed') then
      update public.knowledge_sources set generation=generation+1,error_code=null where id=s.id returning * into s;
      insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(s.organization_id,s.brand_id,s.id,s.generation,'delete');
      perform private.audit(s.organization_id,'knowledge.delete_retried','knowledge_source',s.id);
    end if;
    return;
  end if;
  update public.knowledge_sources set status='deleting',deleted_at=now(),manual_text=null,selected_pages='{}',page_count=0,chunk_count=0,error_code=null,generation=generation+1 where id=s.id returning * into s;
  delete from public.knowledge_documents where source_id=s.id;
  insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(s.organization_id,s.brand_id,s.id,s.generation,'delete');
  perform private.audit(s.organization_id,'knowledge.delete_requested','knowledge_source',s.id);
end $$;
create function public.set_knowledge_document_included(p_document_id uuid,p_included boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.knowledge_documents;
begin
  select * into d from public.knowledge_documents where id=p_document_id;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  perform private.require_role(d.organization_id,array['owner','admin']::public.organization_role[]);
  perform 1 from public.knowledge_sources where id=d.source_id and deleted_at is null for update;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if p_included is null then raise exception 'INVALID_DOCUMENT'; end if;
  update public.knowledge_documents set is_included=p_included where id=d.id;
  perform private.audit(d.organization_id,'knowledge.document_inclusion_changed','knowledge_document',d.id,jsonb_build_object('included',p_included));
end $$;
create function public.search_knowledge(p_brand_id uuid,p_embedding extensions.vector(512),p_query text)
returns table(id uuid,source_id uuid,document_id uuid,title text,source_url text,page_number integer,content text,score double precision)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_embedding is null or extensions.vector_dims(p_embedding)<>512 or p_query is null or char_length(p_query) not between 1 and 500 then raise exception 'INVALID_SEARCH'; end if;
  return query select c.id,c.source_id,c.document_id,d.title,d.canonical_url,d.page_number,c.content,
    (0.8*(1-(c.embedding operator(extensions.<=>) p_embedding))+0.2*ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query)))::double precision
    from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id
    join public.knowledge_sources s on s.id=c.source_id join public.brands b on b.id=c.brand_id
    where c.brand_id=p_brand_id and b.status='active' and s.deleted_at is null and s.status in ('ready','partial') and d.is_included
    order by (0.8*(1-(c.embedding operator(extensions.<=>) p_embedding))+0.2*ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query))) desc,c.id
    limit 20;
end $$;

revoke all on function private.valid_knowledge_url(text),private.knowledge_host(text),private.valid_knowledge_list(jsonb,integer,integer),private.validate_brand_profile(jsonb),private.require_brand_capacity(uuid),private.knowledge_storage_access(text,text,text),private.require_knowledge_page_capacity(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function private.knowledge_storage_access(text,text,text) to authenticated;
revoke all on function public.save_brand(uuid,uuid,jsonb),public.archive_brand(uuid,boolean),public.add_knowledge_source(uuid,uuid,jsonb),public.retry_knowledge_source(uuid),public.delete_knowledge_source(uuid),public.set_knowledge_document_included(uuid,boolean),public.search_knowledge(uuid,extensions.vector,text) from public,anon;
grant execute on function public.save_brand(uuid,uuid,jsonb),public.archive_brand(uuid,boolean),public.add_knowledge_source(uuid,uuid,jsonb),public.retry_knowledge_source(uuid),public.delete_knowledge_source(uuid),public.set_knowledge_document_included(uuid,boolean),public.search_knowledge(uuid,extensions.vector,text) to authenticated;
