-- Phase 4: local, source-backed drafting. No extension, posting, tracking or hosted grants.
alter table public.brand_personas add column technical_depth text not null default 'balanced' check (technical_depth in ('general','balanced','technical'));
alter table public.brand_personas add column allowed_first_person_statements jsonb not null default '[]' check (jsonb_typeof(allowed_first_person_statements)='array');
alter table public.brand_personas add constraint brand_personas_scoped_identity unique(id,brand_id,organization_id);
alter table public.opportunities add constraint opportunities_draft_identity unique(id,brand_id,organization_id);
alter table public.usage_counters drop constraint usage_counters_metric_check;
alter table public.usage_counters add constraint usage_counters_metric_check check(metric in ('opportunities','ai_drafts'));

create table public.drafts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
  opportunity_id uuid not null, persona_id uuid not null,
  status text not null default 'generating' check(status in ('generating','ready','editing','warning','blocked','approved','rejected','error')),
  current_version integer not null default 0 check(current_version>=0), verified_version integer,
  current_content text not null default '' check(char_length(current_content)<=12000),
  strategy text not null default '' check(char_length(strategy)<=2000),
  brand_mentioned boolean not null default false, disclosure_included boolean not null default false,
  suggested_link text check(char_length(suggested_link)<=2048), generation_metadata jsonb not null default '{}',
  verification_status text not null default 'pending' check(verification_status in ('pending','pass','warning','fail')),
  compliance_status text not null default 'pending' check(compliance_status in ('pending','pass','warning','blocked')),
  context_checksum text check(context_checksum ~ '^[a-f0-9]{64}$'),
  approved_by uuid references public.profiles(id) on delete set null, approved_at timestamptz,
  warnings_acknowledged_at timestamptz, rejection_reason text check(char_length(rejection_reason)<=1000),
  error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'), purged_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(opportunity_id,brand_id,organization_id) references public.opportunities(id,brand_id,organization_id) on delete cascade,
  foreign key(persona_id,brand_id,organization_id) references public.brand_personas(id,brand_id,organization_id) on delete cascade,
  unique(id,organization_id), unique(id,brand_id,organization_id),
  check(verified_version is null or (verified_version>0 and verified_version<=current_version)),
  check(status<>'approved' or (approved_at is not null and verified_version=current_version and verification_status in ('pass','warning') and compliance_status in ('pass','warning')))
);
create index drafts_review_idx on public.drafts(organization_id,brand_id,status,updated_at desc,id);
create index drafts_opportunity_idx on public.drafts(opportunity_id,created_at desc);
create table public.draft_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, draft_id uuid not null,
  version integer not null check(version>0), content text not null check(char_length(content)<=12000),
  source text not null check(source in ('ai','user','system_fix')), instruction text not null default '' check(char_length(instruction)<=2000),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  foreign key(draft_id,organization_id) references public.drafts(id,organization_id) on delete cascade,
  unique(draft_id,version), unique(id,draft_id,organization_id)
);
create table public.draft_claims (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, draft_id uuid not null, draft_version_id uuid not null,
  claim_text text not null check(char_length(claim_text) between 1 and 3000),
  status text not null check(status in ('verified','partial','unsupported','contradicted','general_advice')),
  confidence text not null check(confidence in ('high','medium','low')),
  explanation text not null check(char_length(explanation)<=2000), source_chunk_ids uuid[] not null default '{}',
  evidence_kind text not null default 'none' check(evidence_kind in ('current_documentation','inferred','stale','none','advice')),
  provenance jsonb not null default '[]' check(jsonb_typeof(provenance)='array'),
  created_at timestamptz not null default now(),
  foreign key(draft_version_id,draft_id,organization_id) references public.draft_versions(id,draft_id,organization_id) on delete cascade,
  check(cardinality(source_chunk_ids)<=8), check(status<>'verified' or cardinality(source_chunk_ids)>0)
);
create index draft_claims_version_idx on public.draft_claims(draft_id,draft_version_id);
create table public.draft_compliance_checks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, draft_id uuid not null, draft_version_id uuid not null,
  status text not null check(status in ('pass','warning','blocked')), checks jsonb not null,
  safe_to_approve boolean not null, model_metadata jsonb not null default '{}', context_checksum text not null check(context_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key(draft_version_id,draft_id,organization_id) references public.draft_versions(id,draft_id,organization_id) on delete cascade,
  unique(draft_version_id)
);
create table public.draft_feedback (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, opportunity_id uuid not null, draft_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  rating text not null check(rating in ('useful','too_promotional','incorrect','irrelevant','wrong_tone','other')),
  notes text not null default '' check(char_length(notes)<=2000), created_at timestamptz not null default now(),
  foreign key(draft_id,brand_id,organization_id) references public.drafts(id,brand_id,organization_id) on delete cascade,
  foreign key(opportunity_id,brand_id,organization_id) references public.opportunities(id,brand_id,organization_id) on delete cascade,
  unique(draft_id,user_id)
);
create table public.draft_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, draft_id uuid not null,
  kind text not null check(kind in ('generate','verify','compliance')), version integer not null check(version>=0),
  options jsonb not null default '{}' check(jsonb_typeof(options)='object' and octet_length(options::text)<=5000),
  request_key uuid, request_fingerprint text, requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  attempts integer not null default 0 check(attempts between 0 and 3), available_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz, error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(draft_id,brand_id,organization_id) references public.drafts(id,brand_id,organization_id) on delete cascade,
  unique(organization_id,request_key), check((kind='generate')=(request_key is not null)),
  check((request_key is null)=(request_fingerprint is null))
);
create unique index draft_jobs_pending_idx on public.draft_jobs(draft_id,kind,version) where status in ('queued','processing');
create index draft_jobs_dispatch_idx on public.draft_jobs(status,available_at,lease_expires_at);
create table public.ai_task_usage (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, draft_id uuid not null,
  job_id uuid not null references public.draft_jobs(id) on delete cascade, task text not null check(task in ('generate','verify','compliance')),
  provider text not null, model text not null, input_tokens integer not null default 0 check(input_tokens between 0 and 1000000),
  output_tokens integer not null default 0 check(output_tokens between 0 and 1000000),
  estimated_cost_usd numeric not null default 0 check(estimated_cost_usd between 0 and 100),
  created_at timestamptz not null default now(), unique(job_id),
  foreign key(draft_id,brand_id,organization_id) references public.drafts(id,brand_id,organization_id) on delete cascade
);
create table public.responsible_use_acceptances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notice_version text not null default '2026-09-07', accepted_at timestamptz not null default now(), primary key(organization_id,user_id)
);
do $$ declare t text; begin
  foreach t in array array['drafts','draft_versions','draft_claims','draft_compliance_checks','draft_feedback','draft_jobs','ai_task_usage','responsible_use_acceptances'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for select to authenticated using (private.organization_role(organization_id) is not null)',t||'_read_member',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    if t<>'draft_jobs' then execute format('grant select on public.%I to authenticated',t); end if;
  end loop;
  foreach t in array array['drafts','draft_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',t||'_updated_at',t);
  end loop;
end $$;
grant select(id,organization_id,brand_id,draft_id,kind,version,status,attempts,available_at,error_code,created_at,updated_at) on public.draft_jobs to authenticated;

create function private.validate_draft_options(p jsonb) returns void language plpgsql immutable set search_path='' as $$
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>5000
    or exists(select 1 from jsonb_object_keys(p) k where k not in ('length','action','instruction','capability'))
    or (p ? 'length' and (p->>'length' is null or p->>'length' not in ('concise','standard','detailed')))
    or (p ? 'action' and (p->>'action' is null or p->>'action' not in ('shorter','more_technical','less_promotional','no_brand','add_disclosure','focus_capability','custom')))
    or (p ? 'instruction' and (jsonb_typeof(p->'instruction')<>'string' or char_length(p->>'instruction')>2000))
    or (p ? 'capability' and (jsonb_typeof(p->'capability')<>'string' or char_length(p->>'capability')>500)) then raise exception 'INVALID_DRAFT_OPTIONS'; end if;
end $$;
create function private.draft_context_checksum(p_draft_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(jsonb_build_object(
    'brand',jsonb_build_object('profile',b.profile,'status',b.status),
    'persona',to_jsonb(persona)-'created_at'-'updated_at',
    'opportunity',jsonb_build_object('id',o.id,'action_allowed',o.status not in ('dismissed','archived'),'blocked',o.is_blocked,'risk',o.risk_level,'summary',o.summary,'need',o.user_need,'capabilities',o.matched_capabilities,'missing',o.missing_capabilities),
    'post',jsonb_build_object('title',p.title,'body',p.body,'deleted',p.is_deleted,'locked',p.is_locked,'archived',p.is_archived,'nsfw',p.is_nsfw,'fresh',p.last_synced_at>=now()-interval '48 hours' and p.created_at_provider>=now()-interval '30 days'),
    'monitor',(select to_jsonb(m)-'created_at'-'updated_at' from public.brand_subreddits m where m.brand_id=b.id and m.subreddit_id=p.subreddit_id),
    'rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'raw',r.raw_data) order by r.id) from public.subreddit_rules r where r.subreddit_id=p.subreddit_id),'[]'::jsonb),
    'knowledge',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'checksum',c.checksum,'document',k.id,'document_checksum',k.checksum,'source',s.id,'generation',s.generation,'date',s.last_ingested_at,'section',c.section_heading,'title',k.title,'url',k.canonical_url) order by c.id)
      from public.knowledge_chunks c join public.knowledge_documents k on k.id=c.document_id join public.knowledge_sources s on s.id=c.source_id
      where c.brand_id=b.id and c.organization_id=b.organization_id and k.is_included and s.deleted_at is null and s.status in ('ready','partial') and s.last_ingested_at>now()-interval '90 days'),'[]'::jsonb)
  )::text,'sha256'),'hex')
  from public.drafts d join public.brands b on b.id=d.brand_id join public.brand_personas persona on persona.id=d.persona_id
    join public.opportunities o on o.id=d.opportunity_id join public.reddit_posts p on p.id=o.reddit_post_id where d.id=p_draft_id
$$;
create function private.require_draft_available(p_draft_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts; o public.opportunities; p public.reddit_posts;
begin
  select * into strict d from public.drafts where id=p_draft_id;
  perform private.require_available_plan(d.organization_id);
  if not exists(select 1 from public.organizations where id=d.organization_id and status='active' and deleted_at is null) then raise exception 'ORGANIZATION_UNAVAILABLE'; end if;
  if not exists(select 1 from public.brands where id=d.brand_id and status='active') then raise exception 'BRAND_ARCHIVED'; end if;
  select * into strict o from public.opportunities where id=d.opportunity_id;
  select * into strict p from public.reddit_posts where id=o.reddit_post_id;
  if p.is_deleted or d.purged_at is not null then raise exception 'POST_DELETED'; end if;
  if o.is_blocked or p.is_locked or p.is_archived or p.is_nsfw then raise exception 'OPPORTUNITY_BLOCKED'; end if;
  if o.status in ('dismissed','archived') then raise exception 'OPPORTUNITY_UNAVAILABLE'; end if;
  if p.last_synced_at<now()-interval '48 hours' or p.created_at_provider<now()-interval '30 days' then raise exception 'POST_STALE'; end if;
  if not exists(select 1 from public.brand_subreddits where brand_id=d.brand_id and subreddit_id=p.subreddit_id and status='active') then raise exception 'SUBREDDIT_PAUSED'; end if;
end $$;
create function private.lock_draft(p_draft_id uuid,p_expected_version integer) returns public.drafts
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  select * into d from public.drafts where id=p_draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=d.organization_id for update;
  perform private.require_role(d.organization_id,array['owner','admin','member']::public.organization_role[]);
  select * into strict d from public.drafts where id=p_draft_id for update;
  if p_expected_version is null or d.current_version<>p_expected_version then raise exception 'DRAFT_VERSION_CONFLICT'; end if;
  if d.purged_at is not null then raise exception 'POST_DELETED'; end if;
  return d;
end $$;
create function private.reserve_draft_usage(p_organization_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions; v_limit integer; v_count bigint;
begin
  perform private.require_available_plan(p_organization_id);
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select ai_draft_limit into strict v_limit from public.plan_catalog where key=s.plan_key;
  insert into public.usage_counters(organization_id,metric,period_start,period_end) values(p_organization_id,'ai_drafts',s.current_period_start,s.current_period_end) on conflict do nothing;
  update public.usage_counters set quantity=quantity+1 where organization_id=p_organization_id and metric='ai_drafts' and period_start=s.current_period_start and period_end=s.current_period_end and quantity<v_limit returning quantity into v_count;
  if v_count is null then raise exception 'DRAFT_LIMIT'; end if;
  if (select count(*) from public.draft_jobs where organization_id=p_organization_id and kind='generate' and created_at>now()-interval '1 minute')>=10 then raise exception 'DRAFT_RATE_LIMIT'; end if;
end $$;
create function private.queue_draft_stage(p_draft_id uuid,p_kind text,p_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.drafts; v_id uuid;
begin
  select * into strict d from public.drafts where id=p_draft_id;
  if p_kind not in ('verify','compliance') or p_version<=0 then raise exception 'INVALID_DRAFT_JOB'; end if;
  select id into v_id from public.draft_jobs where draft_id=p_draft_id and kind=p_kind and version=p_version and status in ('queued','processing');
  if v_id is null then
    insert into public.draft_jobs(organization_id,brand_id,draft_id,kind,version,requested_by) values(d.organization_id,d.brand_id,d.id,p_kind,p_version,auth.uid()) returning id into v_id;
  end if;
  return v_id;
end $$;
create function public.request_draft(p_opportunity_id uuid,p_idempotency_key uuid,p_options jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.opportunities; v_id uuid; v_persona uuid; v_fingerprint text; existing public.draft_jobs;
begin
  select * into o from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=o.organization_id for update;
  perform private.require_role(o.organization_id,array['owner','admin','member']::public.organization_role[]);
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.validate_draft_options(p_options);
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('opportunity',p_opportunity_id,'options',p_options,'operation','create')::text,'sha256'),'hex');
  select * into existing from public.draft_jobs where organization_id=o.organization_id and request_key=p_idempotency_key;
  if found then
    if existing.request_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.draft_id;
  end if;
  select id into strict v_persona from public.brand_personas where brand_id=o.brand_id;
  insert into public.drafts(organization_id,brand_id,opportunity_id,persona_id,created_by)
    values(o.organization_id,o.brand_id,o.id,v_persona,auth.uid()) returning id into v_id;
  perform private.require_draft_available(v_id);
  perform private.reserve_draft_usage(o.organization_id);
  insert into public.draft_jobs(organization_id,brand_id,draft_id,kind,version,options,request_key,request_fingerprint,requested_by)
    values(o.organization_id,o.brand_id,v_id,'generate',0,p_options,p_idempotency_key,v_fingerprint,auth.uid());
  perform private.audit(o.organization_id,'draft.generation_requested','draft',v_id);
  return v_id;
end $$;
create function public.regenerate_draft(p_draft_id uuid,p_expected_version integer,p_idempotency_key uuid,p_options jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.drafts; existing public.draft_jobs; v_fingerprint text; v_job uuid;
begin
  select * into d from public.drafts where id=p_draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=d.organization_id for update;
  perform private.require_role(d.organization_id,array['owner','admin','member']::public.organization_role[]);
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.validate_draft_options(p_options);
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('draft',p_draft_id,'version',p_expected_version,'options',p_options,'operation','regenerate')::text,'sha256'),'hex');
  select * into existing from public.draft_jobs where organization_id=d.organization_id and request_key=p_idempotency_key;
  if found then
    if existing.request_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.id;
  end if;
  d:=private.lock_draft(p_draft_id,p_expected_version);
  perform private.require_draft_available(d.id);
  if exists(select 1 from public.draft_jobs where draft_id=d.id and kind='generate' and status in ('queued','processing')) then raise exception 'DRAFT_GENERATION_PENDING'; end if;
  perform private.reserve_draft_usage(d.organization_id);
  update public.drafts set status='generating',approved_by=null,approved_at=null,warnings_acknowledged_at=null,verified_version=null,verification_status='pending',compliance_status='pending',context_checksum=null,error_code=null,rejection_reason=null where id=d.id;
  insert into public.draft_jobs(organization_id,brand_id,draft_id,kind,version,options,request_key,request_fingerprint,requested_by)
    values(d.organization_id,d.brand_id,d.id,'generate',d.current_version,p_options,p_idempotency_key,v_fingerprint,auth.uid()) returning id into v_job;
  perform private.audit(d.organization_id,'draft.regeneration_requested','draft',d.id);
  return v_job;
end $$;
create function public.save_draft_edit(p_draft_id uuid,p_expected_version integer,p_content text) returns integer
language plpgsql security definer set search_path='' as $$
declare d public.drafts; v_version integer;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if p_content is null or char_length(btrim(p_content)) not between 1 and 12000 then raise exception 'INVALID_DRAFT_CONTENT'; end if;
  if d.current_version=0 or d.status='generating' then raise exception 'DRAFT_GENERATION_PENDING'; end if;
  if p_content=d.current_content then return d.current_version; end if;
  v_version:=d.current_version+1;
  insert into public.draft_versions(organization_id,draft_id,version,content,source,created_by) values(d.organization_id,d.id,v_version,p_content,'user',auth.uid());
  update public.drafts set current_content=p_content,current_version=v_version,status='editing',verified_version=null,verification_status='pending',compliance_status='pending',context_checksum=null,approved_by=null,approved_at=null,warnings_acknowledged_at=null,error_code=null,rejection_reason=null where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='DRAFT_SUPERSEDED' where draft_id=d.id and version<v_version and status in ('queued','processing');
  perform private.queue_draft_stage(d.id,'verify',v_version);
  perform private.audit(d.organization_id,'draft.edited','draft',d.id,jsonb_build_object('version',v_version));
  return v_version;
end $$;
create function public.restore_draft_version(p_draft_id uuid,p_expected_version integer,p_restore_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare d public.drafts; v_content text; v_version integer;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if d.current_version=0 or d.status='generating' then raise exception 'DRAFT_GENERATION_PENDING'; end if;
  select content into v_content from public.draft_versions where draft_id=d.id and version=p_restore_version;
  if not found then raise exception 'DRAFT_VERSION_NOT_FOUND'; end if;
  v_version:=d.current_version+1;
  insert into public.draft_versions(organization_id,draft_id,version,content,source,instruction,created_by) values(d.organization_id,d.id,v_version,v_content,'system_fix','Restored version '||p_restore_version,auth.uid());
  update public.drafts set current_content=v_content,current_version=v_version,status='editing',verified_version=null,verification_status='pending',compliance_status='pending',context_checksum=null,approved_by=null,approved_at=null,warnings_acknowledged_at=null,error_code=null,rejection_reason=null where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='DRAFT_SUPERSEDED' where draft_id=d.id and version<v_version and status in ('queued','processing');
  perform private.queue_draft_stage(d.id,'verify',v_version);
  perform private.audit(d.organization_id,'draft.restored','draft',d.id,jsonb_build_object('version',v_version,'restored_version',p_restore_version));
  return v_version;
end $$;
create function public.verify_draft(p_draft_id uuid,p_expected_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  perform private.require_draft_available(d.id);
  if d.current_version=0 or d.status='generating' then raise exception 'DRAFT_GENERATION_PENDING'; end if;
  if (select count(*) from public.draft_jobs where organization_id=d.organization_id and kind='verify' and created_at>now()-interval '1 minute')>=30 then raise exception 'DRAFT_RATE_LIMIT'; end if;
  update public.drafts set status='editing',verified_version=null,verification_status='pending',compliance_status='pending',context_checksum=null,approved_by=null,approved_at=null,warnings_acknowledged_at=null,error_code=null where id=d.id;
  return private.queue_draft_stage(d.id,'verify',d.current_version);
end $$;

-- Publication requires an unexpired lease, unchanged draft version, and a current authoritative context.
create function private.draft_job_current(p_job_id uuid,p_lease_token uuid,p_context_checksum text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; d public.drafts;
begin
  select * into j from public.draft_jobs where id=p_job_id;
  if not found then return false; end if;
  perform 1 from public.organizations where id=j.organization_id for update;
  select * into d from public.drafts where id=j.draft_id for update;
  select * into j from public.draft_jobs where id=p_job_id for update;
  if j.status<>'processing' or p_lease_token is null or j.lease_token is null or j.lease_expires_at is null or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp()
    or d.current_version<>j.version or d.purged_at is not null or d.status='rejected' then return false; end if;
  if p_context_checksum is null or p_context_checksum !~ '^[a-f0-9]{64}$'
    or private.draft_context_checksum(d.id) is distinct from p_context_checksum then return false; end if;
  perform private.require_draft_available(d.id);
  return true;
end $$;
create function private.record_draft_usage(p_job_id uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; metadata jsonb:=coalesce(p_metadata,'{}');
begin
  select * into strict j from public.draft_jobs where id=p_job_id;
  if jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>2000
    or exists(select 1 from jsonb_object_keys(metadata) k where k not in ('provider','model','input_tokens','output_tokens','token_count','estimated_cost_usd'))
    or (metadata ? 'provider' and (jsonb_typeof(metadata->'provider')<>'string' or char_length(metadata->>'provider') not between 1 and 100))
    or (metadata ? 'model' and (jsonb_typeof(metadata->'model')<>'string' or char_length(metadata->>'model') not between 1 and 150))
    or exists(select 1 from jsonb_each(metadata) e where e.key in ('input_tokens','output_tokens','token_count','estimated_cost_usd') and jsonb_typeof(e.value)<>'number') then raise exception 'INVALID_AI_USAGE'; end if;
  insert into public.ai_task_usage(organization_id,brand_id,draft_id,job_id,task,provider,model,input_tokens,output_tokens,estimated_cost_usd)
    values(j.organization_id,j.brand_id,j.draft_id,j.id,j.kind,coalesce(metadata->>'provider','mock'),coalesce(metadata->>'model','deterministic'),coalesce((metadata->>'input_tokens')::integer,0),coalesce((metadata->>'output_tokens')::integer,(metadata->>'token_count')::integer,0),coalesce((metadata->>'estimated_cost_usd')::numeric,0)) on conflict(job_id) do nothing;
end $$;
create function private.publish_draft_generation(p_job_id uuid,p_lease_token uuid,p_context_checksum text,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; d public.drafts; c jsonb; v_version integer;
begin
  if not private.draft_job_current(p_job_id,p_lease_token,p_context_checksum) then return false; end if;
  select * into strict j from public.draft_jobs where id=p_job_id;
  select * into strict d from public.drafts where id=j.draft_id;
  if j.kind<>'generate' then raise exception 'INVALID_DRAFT_JOB'; end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>100000
    or jsonb_typeof(p_result->'draft') is distinct from 'string' or char_length(btrim(p_result->>'draft')) not between 1 and 12000
    or jsonb_typeof(p_result->'strategy') is distinct from 'string' or char_length(p_result->>'strategy')>2000
    or jsonb_typeof(p_result->'brand_mentioned') is distinct from 'boolean' or jsonb_typeof(p_result->'affiliation_disclosure_included') is distinct from 'boolean'
    or jsonb_typeof(p_result->'claims') is distinct from 'array' or jsonb_array_length(p_result->'claims')>60
    or not private.valid_knowledge_list(p_result->'limitations_mentioned',30,1000) or not private.valid_knowledge_list(p_result->'uncertainties',30,1000)
    or (p_result->>'suggested_link' is not null and not private.valid_knowledge_url(p_result->>'suggested_link')) then raise exception 'INVALID_DRAFT_GENERATION'; end if;
  for c in select value from jsonb_array_elements(p_result->'claims') loop
    if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'text') is distinct from 'string' or char_length(c->>'text') not between 1 and 3000
      or c->>'confidence' is null or c->>'confidence' not in ('high','medium','low')
      or not private.valid_knowledge_list(c->'source_chunk_ids',8,36) then raise exception 'INVALID_DRAFT_GENERATION'; end if;
    if exists(select 1 from jsonb_array_elements_text(c->'source_chunk_ids') x where not exists(
      select 1 from public.knowledge_chunks chunk join public.knowledge_documents doc on doc.id=chunk.document_id join public.knowledge_sources s on s.id=chunk.source_id
      where chunk.id::text=x and chunk.brand_id=d.brand_id and chunk.organization_id=d.organization_id and doc.is_included and s.deleted_at is null and s.status in ('ready','partial') and s.last_ingested_at>now()-interval '90 days')) then raise exception 'INVALID_KNOWLEDGE_REFERENCE'; end if;
  end loop;
  v_version:=d.current_version+1;
  insert into public.draft_versions(organization_id,draft_id,version,content,source,instruction,created_by)
    values(d.organization_id,d.id,v_version,p_result->>'draft','ai',coalesce(j.options->>'instruction',''),j.requested_by);
  update public.drafts set current_content=p_result->>'draft',current_version=v_version,status='editing',strategy=p_result->>'strategy',brand_mentioned=(p_result->>'brand_mentioned')::boolean,disclosure_included=(p_result->>'affiliation_disclosure_included')::boolean,suggested_link=p_result->>'suggested_link',generation_metadata=p_result-'draft'-'claims',verified_version=null,verification_status='pending',compliance_status='pending',context_checksum=p_context_checksum,error_code=null where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  perform private.record_draft_usage(j.id,p_result->'provider_metadata');
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='DRAFT_SUPERSEDED' where draft_id=d.id and version<v_version and status in ('queued','processing');
  perform private.queue_draft_stage(d.id,'verify',v_version);
  perform private.audit(d.organization_id,'draft.generated','draft',d.id,jsonb_build_object('version',v_version));
  return true;
end $$;
create function private.publish_draft_verification(p_job_id uuid,p_lease_token uuid,p_context_checksum text,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; d public.drafts; v_version uuid; c jsonb; v_ids uuid[]; v_provenance jsonb; v_status text;
begin
  if not private.draft_job_current(p_job_id,p_lease_token,p_context_checksum) then return false; end if;
  select * into strict j from public.draft_jobs where id=p_job_id;
  select * into strict d from public.drafts where id=j.draft_id;
  if j.kind<>'verify' then raise exception 'INVALID_DRAFT_JOB'; end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>200000 or p_result->>'overall_status' is null
    or p_result->>'overall_status' not in ('pass','warning','fail') or jsonb_typeof(p_result->'claims') is distinct from 'array'
    or jsonb_array_length(p_result->'claims') not between 1 and 100 then raise exception 'INVALID_DRAFT_VERIFICATION'; end if;
  select id into strict v_version from public.draft_versions where draft_id=d.id and version=d.current_version;
  delete from public.draft_claims where draft_version_id=v_version;
  for c in select value from jsonb_array_elements(p_result->'claims') loop
    if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'claim_text') is distinct from 'string' or char_length(c->>'claim_text') not between 1 and 3000
      or c->>'status' is null or c->>'status' not in ('verified','partial','unsupported','contradicted','general_advice')
      or c->>'confidence' is null or c->>'confidence' not in ('high','medium','low')
      or jsonb_typeof(c->'explanation') is distinct from 'string' or char_length(c->>'explanation')>2000
      or not private.valid_knowledge_list(c->'source_chunk_ids',8,36)
      or exists(select 1 from jsonb_array_elements_text(c->'source_chunk_ids') x where x !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'INVALID_DRAFT_VERIFICATION'; end if;
    select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements_text(c->'source_chunk_ids') x;
    if c->>'status'='verified' and cardinality(v_ids)=0 then raise exception 'INVALID_KNOWLEDGE_REFERENCE'; end if;
    if exists(select 1 from unnest(v_ids) x where not exists(
      select 1 from public.knowledge_chunks chunk join public.knowledge_documents doc on doc.id=chunk.document_id join public.knowledge_sources s on s.id=chunk.source_id
      where chunk.id=x and chunk.brand_id=d.brand_id and chunk.organization_id=d.organization_id and doc.is_included and s.deleted_at is null and s.status in ('ready','partial') and s.last_ingested_at>now()-interval '90 days')) then raise exception 'INVALID_KNOWLEDGE_REFERENCE'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('chunk_id',chunk.id,'source_id',s.id,'document_id',doc.id,'title',doc.title,'source_url',doc.canonical_url,'filename',s.filename,'page_number',doc.page_number,'section_heading',coalesce(chunk.section_heading,doc.section_heading),'updated_at',s.last_ingested_at,'excerpt',left(chunk.content,300)) order by chunk.id),'[]'::jsonb) into v_provenance
      from public.knowledge_chunks chunk join public.knowledge_documents doc on doc.id=chunk.document_id join public.knowledge_sources s on s.id=chunk.source_id where chunk.id=any(v_ids);
    insert into public.draft_claims(organization_id,draft_id,draft_version_id,claim_text,status,confidence,explanation,source_chunk_ids,provenance,evidence_kind)
      values(d.organization_id,d.id,v_version,c->>'claim_text',c->>'status',c->>'confidence',c->>'explanation',v_ids,v_provenance,case when c->>'status'='verified' then 'current_documentation' when c->>'status'='general_advice' then 'advice' when c->>'evidence_kind'='stale' then 'stale' when c->>'status'='partial' then 'inferred' else 'none' end);
  end loop;
  v_status:=case when exists(select 1 from public.draft_claims where draft_version_id=v_version and status in ('unsupported','contradicted')) then 'fail'
    when exists(select 1 from public.draft_claims where draft_version_id=v_version and status='partial') then 'warning' else p_result->>'overall_status' end;
  update public.drafts set verification_status=v_status,compliance_status='pending',context_checksum=p_context_checksum,verified_version=null,status='editing' where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  perform private.record_draft_usage(j.id,p_result->'provider_metadata');
  perform private.queue_draft_stage(d.id,'compliance',d.current_version);
  return true;
end $$;
create function private.publish_draft_compliance(p_job_id uuid,p_lease_token uuid,p_context_checksum text,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; d public.drafts; v_version uuid; c jsonb; v_status text; v_codes text[];
  expected_codes text[]:=array['RELEVANCE','UNSUPPORTED_CLAIMS','FAKE_CUSTOMER_EXPERIENCE','AFFILIATION_DISCLOSURE','EXCESSIVE_PROMOTION','MISLEADING_COMPARISON','DISALLOWED_LINK','SUBREDDIT_RULE_CONFLICT','HARASSMENT_MANIPULATION','PERSONAL_DATA','LIMITATION_OMITTED','NO_VENDORS_REQUEST'];
begin
  if not private.draft_job_current(p_job_id,p_lease_token,p_context_checksum) then return false; end if;
  select * into strict j from public.draft_jobs where id=p_job_id;
  select * into strict d from public.drafts where id=j.draft_id;
  if j.kind<>'compliance' or d.verification_status='pending' or d.context_checksum is distinct from p_context_checksum then raise exception 'INVALID_DRAFT_JOB'; end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>50000 or p_result->>'status' is null
    or p_result->>'status' not in ('pass','warning','blocked') or jsonb_typeof(p_result->'safe_to_approve') is distinct from 'boolean'
    or jsonb_typeof(p_result->'checks') is distinct from 'array' or jsonb_array_length(p_result->'checks')<>12 then raise exception 'INVALID_DRAFT_COMPLIANCE'; end if;
  for c in select value from jsonb_array_elements(p_result->'checks') loop
    if jsonb_typeof(c)<>'object' or c->>'code' is null or not(c->>'code'=any(expected_codes))
      or c->>'status' is null or c->>'status' not in ('pass','warning','fail')
      or jsonb_typeof(c->'message') is distinct from 'string' or char_length(c->>'message') not between 1 and 1000
      or (c->>'suggested_fix' is not null and (jsonb_typeof(c->'suggested_fix')<>'string' or char_length(c->>'suggested_fix')>1000)) then raise exception 'INVALID_DRAFT_COMPLIANCE'; end if;
  end loop;
  select array_agg(distinct value->>'code') into v_codes from jsonb_array_elements(p_result->'checks');
  if cardinality(v_codes)<>12 then raise exception 'INVALID_DRAFT_COMPLIANCE'; end if;
  select id into strict v_version from public.draft_versions where draft_id=d.id and version=d.current_version;
  if not exists(select 1 from public.draft_claims where draft_version_id=v_version) then raise exception 'VERIFICATION_REQUIRED'; end if;
  v_status:=case when d.verification_status='fail' or p_result->>'status'='blocked' or not (p_result->>'safe_to_approve')::boolean
    or exists(select 1 from jsonb_array_elements(p_result->'checks') x where x->>'status'='fail') then 'blocked'
    when d.verification_status='warning' or p_result->>'status'='warning' or exists(select 1 from jsonb_array_elements(p_result->'checks') x where x->>'status'='warning') then 'warning' else 'pass' end;
  insert into public.draft_compliance_checks(organization_id,draft_id,draft_version_id,status,checks,safe_to_approve,model_metadata,context_checksum)
    values(d.organization_id,d.id,v_version,v_status,p_result->'checks',v_status<>'blocked',coalesce(p_result->'provider_metadata','{}'),p_context_checksum)
    on conflict(draft_version_id) do update set status=excluded.status,checks=excluded.checks,safe_to_approve=excluded.safe_to_approve,model_metadata=excluded.model_metadata,context_checksum=excluded.context_checksum,created_at=now();
  update public.drafts set compliance_status=v_status,verified_version=current_version,status=case v_status when 'pass' then 'ready' else v_status end,context_checksum=p_context_checksum,error_code=null where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code=null where id=j.id;
  perform private.record_draft_usage(j.id,p_result->'provider_metadata');
  perform private.audit(d.organization_id,case when v_status='blocked' then 'draft.policy_blocked' else 'draft.verified' end,'draft',d.id,jsonb_build_object('version',d.current_version,'status',v_status));
  return true;
end $$;
create function private.require_draft_verified(p_draft_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts; c public.draft_compliance_checks; v_version uuid;
begin
  select * into strict d from public.drafts where id=p_draft_id;
  perform private.require_draft_available(d.id);
  if d.current_version=0 or d.verified_version is distinct from d.current_version or d.verification_status='pending' or d.compliance_status='pending'
    or exists(select 1 from public.draft_jobs where draft_id=d.id and status in ('queued','processing')) then raise exception 'VERIFICATION_REQUIRED'; end if;
  if d.context_checksum is null or d.context_checksum is distinct from private.draft_context_checksum(d.id) then raise exception 'DRAFT_CONTEXT_CHANGED'; end if;
  select id into strict v_version from public.draft_versions where draft_id=d.id and version=d.current_version;
  select * into c from public.draft_compliance_checks where draft_version_id=v_version;
  if not found or c.context_checksum is distinct from d.context_checksum then raise exception 'VERIFICATION_REQUIRED'; end if;
  if d.verification_status='fail' or d.compliance_status='blocked' or c.status='blocked' or not c.safe_to_approve
    or not exists(select 1 from public.draft_claims where draft_version_id=v_version)
    or exists(select 1 from public.draft_claims where draft_version_id=v_version and status in ('unsupported','contradicted'))
    or exists(select 1 from jsonb_array_elements(c.checks) x where x->>'status'='fail') then raise exception 'DRAFT_APPROVAL_BLOCKED'; end if;
end $$;
create function public.approve_draft(p_draft_id uuid,p_expected_version integer,p_acknowledge_warnings boolean,p_accept_responsible_use boolean) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if d.status='rejected' then raise exception 'DRAFT_REJECTED'; end if;
  perform private.require_draft_verified(d.id);
  if (d.verification_status='warning' or d.compliance_status='warning') and p_acknowledge_warnings is distinct from true then raise exception 'WARNINGS_ACKNOWLEDGEMENT_REQUIRED'; end if;
  if not exists(select 1 from public.responsible_use_acceptances where organization_id=d.organization_id and user_id=auth.uid()) then
    if p_accept_responsible_use is distinct from true then raise exception 'RESPONSIBLE_USE_REQUIRED'; end if;
    insert into public.responsible_use_acceptances(organization_id,user_id) values(d.organization_id,auth.uid());
    perform private.audit(d.organization_id,'responsible_use.accepted','draft',d.id,jsonb_build_object('notice_version','2026-09-07'));
  end if;
  if d.status='approved' then return; end if;
  update public.drafts set status='approved',approved_by=auth.uid(),approved_at=now(),warnings_acknowledged_at=case when p_acknowledge_warnings then now() else null end,rejection_reason=null where id=d.id;
  perform private.audit(d.organization_id,'draft.approved','draft',d.id,jsonb_build_object('version',d.current_version,'warnings_acknowledged',p_acknowledge_warnings));
end $$;
create function public.reject_draft(p_draft_id uuid,p_expected_version integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  update public.drafts set status='rejected',approved_by=null,approved_at=null,warnings_acknowledged_at=null,rejection_reason=btrim(p_reason) where id=d.id;
  update public.draft_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='DRAFT_REJECTED' where draft_id=d.id and status in ('queued','processing');
  perform private.audit(d.organization_id,'draft.rejected','draft',d.id,jsonb_build_object('version',d.current_version));
end $$;
create function public.submit_draft_feedback(p_draft_id uuid,p_rating text,p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.drafts; v_id uuid;
begin
  select * into d from public.drafts where id=p_draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=d.organization_id for update;
  perform private.require_role(d.organization_id,array['owner','admin','member']::public.organization_role[]);
  select * into strict d from public.drafts where id=p_draft_id for update;
  if d.purged_at is not null then raise exception 'POST_DELETED'; end if;
  if p_rating is null or p_rating not in ('useful','too_promotional','incorrect','irrelevant','wrong_tone','other') or p_notes is null or char_length(p_notes)>2000 then raise exception 'INVALID_DRAFT_FEEDBACK'; end if;
  insert into public.draft_feedback(organization_id,brand_id,opportunity_id,draft_id,user_id,rating,notes)
    values(d.organization_id,d.brand_id,d.opportunity_id,d.id,auth.uid(),p_rating,p_notes)
    on conflict(draft_id,user_id) do update set rating=excluded.rating,notes=excluded.notes,created_at=now() returning id into v_id;
  perform private.audit(d.organization_id,'draft.feedback_recorded','draft',d.id,jsonb_build_object('rating',p_rating));
  return v_id;
end $$;
create function public.record_draft_copy(p_draft_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if d.status<>'approved' then raise exception 'DRAFT_NOT_APPROVED'; end if;
  perform private.require_draft_verified(d.id);
  perform private.audit(d.organization_id,'draft.copied','draft',d.id,jsonb_build_object('version',d.current_version));
end $$;
create function public.get_draft_usage(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.subscriptions; v_limit integer; v_count bigint;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  select * into strict s from public.subscriptions where organization_id=p_organization_id;
  select ai_draft_limit into strict v_limit from public.plan_catalog where key=s.plan_key;
  select quantity into v_count from public.usage_counters where organization_id=p_organization_id and metric='ai_drafts' and period_start=s.current_period_start and period_end=s.current_period_end;
  return jsonb_build_object('quantity',coalesce(v_count,0),'limit',v_limit,'plan_key',s.plan_key,'period_start',s.current_period_start,'period_end',s.current_period_end);
end $$;
create function public.get_draft_review(p_draft_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.drafts;
begin
  select * into d from public.drafts where id=p_draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform private.require_role(d.organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  return jsonb_build_object('context_current',coalesce(d.verified_version=d.current_version and d.context_checksum=private.draft_context_checksum(d.id) and d.purged_at is null and not exists(select 1 from public.draft_jobs where draft_id=d.id and status in ('queued','processing')),false),
    'responsible_use_accepted',exists(select 1 from public.responsible_use_acceptances where organization_id=d.organization_id and user_id=auth.uid()));
end $$;
create function public.update_brand_persona(p_brand_id uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.brands; v_id uuid;
begin
  select * into b from public.brands where id=p_brand_id;
  if not found then raise exception 'BRAND_NOT_FOUND'; end if;
  perform 1 from public.organizations where id=b.organization_id for update;
  perform private.require_role(b.organization_id,array['owner','admin']::public.organization_role[]);
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>50000
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','real_role','tone','custom_tone','reply_length','technical_depth','default_disclosure','allowed_first_person_statements','prohibited_statements'))
    or jsonb_typeof(p_input->'name') is distinct from 'string' or char_length(btrim(p_input->>'name')) not between 1 and 100
    or p_input->>'real_role' is null or p_input->>'real_role' not in ('founder','employee','developer advocate','support','contractor','agency','consultant','other')
    or p_input->>'tone' is null or p_input->>'tone' not in ('Helpful and concise','Technical','Founder voice','Product specialist','Customer-support style','Custom')
    or jsonb_typeof(p_input->'custom_tone') is distinct from 'string' or char_length(p_input->>'custom_tone')>500
    or (p_input->>'tone'='Custom' and char_length(btrim(p_input->>'custom_tone'))=0)
    or p_input->>'reply_length' is null or p_input->>'reply_length' not in ('concise','standard','detailed')
    or p_input->>'technical_depth' is null or p_input->>'technical_depth' not in ('general','balanced','technical')
    or jsonb_typeof(p_input->'default_disclosure') is distinct from 'string' or char_length(btrim(p_input->>'default_disclosure')) not between 10 and 500
    or not private.valid_knowledge_list(p_input->'allowed_first_person_statements',30,500)
    or not private.valid_knowledge_list(p_input->'prohibited_statements',30,500) then raise exception 'INVALID_PERSONA'; end if;
  update public.brand_personas set name=btrim(p_input->>'name'),real_role=p_input->>'real_role',tone=p_input->>'tone',custom_tone=p_input->>'custom_tone',reply_length=p_input->>'reply_length',technical_depth=p_input->>'technical_depth',default_disclosure=btrim(p_input->>'default_disclosure'),allowed_first_person_statements=p_input->'allowed_first_person_statements',prohibited_statements=p_input->'prohibited_statements' where brand_id=b.id returning id into v_id;
  perform private.audit(b.organization_id,'persona.updated','persona',v_id);
  return v_id;
end $$;

-- All derived Reddit text, including user edits and feedback, is removed with the upstream content.
create or replace function private.purge_reddit_post(p_reddit_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Match all user/publication paths: organizations (sorted), post, drafts, then jobs.
  -- Taking draft locks before child mutations prevents late publications recreating derived text.
  perform 1 from public.organizations organization where organization.id in (
    select opportunity.organization_id from public.opportunities opportunity where opportunity.reddit_post_id=p_reddit_post_id
    union select draft.organization_id from public.drafts draft join public.opportunities opportunity on opportunity.id=draft.opportunity_id where opportunity.reddit_post_id=p_reddit_post_id
  ) order by organization.id for update;
  perform 1 from public.reddit_posts where id=p_reddit_post_id for update;
  perform 1 from public.drafts draft join public.opportunities opportunity on opportunity.id=draft.opportunity_id where opportunity.reddit_post_id=p_reddit_post_id order by draft.id for update of draft;
  update public.reddit_posts set title=null,body=null,author_name=null,permalink=null,flair=null,raw_metadata='{}',is_deleted=true,purged_at=coalesce(purged_at,now()),last_synced_at=now() where id=p_reddit_post_id;
  delete from public.draft_claims where draft_id in (select d.id from public.drafts d join public.opportunities o on o.id=d.opportunity_id where o.reddit_post_id=p_reddit_post_id);
  delete from public.draft_compliance_checks where draft_id in (select d.id from public.drafts d join public.opportunities o on o.id=d.opportunity_id where o.reddit_post_id=p_reddit_post_id);
  delete from public.draft_feedback where draft_id in (select d.id from public.drafts d join public.opportunities o on o.id=d.opportunity_id where o.reddit_post_id=p_reddit_post_id);
  update public.draft_versions set content='',instruction='' where draft_id in (select d.id from public.drafts d join public.opportunities o on o.id=d.opportunity_id where o.reddit_post_id=p_reddit_post_id);
  update public.draft_jobs set status='completed',options='{}',lease_token=null,lease_expires_at=null,error_code='POST_DELETED' where draft_id in (select d.id from public.drafts d join public.opportunities o on o.id=d.opportunity_id where o.reddit_post_id=p_reddit_post_id);
  update public.drafts set status='blocked',current_content='',strategy='',suggested_link=null,generation_metadata='{}',verification_status='fail',compliance_status='blocked',context_checksum=null,verified_version=null,approved_by=null,approved_at=null,warnings_acknowledged_at=null,rejection_reason=null,error_code='POST_DELETED',purged_at=coalesce(purged_at,now()) where opportunity_id in (select id from public.opportunities where reddit_post_id=p_reddit_post_id);
  update public.opportunities set status='archived',summary='',user_need='',reasoning_summary='',risk_reasons='[]',matched_capabilities='[]',missing_capabilities='[]',matched_competitor_ids='[]',knowledge_citations='[]',model_metadata='{}',input_checksum=repeat('0',64),suggested_action='blocked',risk_level='blocked',is_blocked=true,dismissed_reason=null where reddit_post_id=p_reddit_post_id;
end $$;

revoke all on function private.validate_draft_options(jsonb),private.draft_context_checksum(uuid),private.require_draft_available(uuid),private.lock_draft(uuid,integer),private.reserve_draft_usage(uuid),private.queue_draft_stage(uuid,text,integer),private.draft_job_current(uuid,uuid,text),private.record_draft_usage(uuid,jsonb),private.publish_draft_generation(uuid,uuid,text,jsonb),private.publish_draft_verification(uuid,uuid,text,jsonb),private.publish_draft_compliance(uuid,uuid,text,jsonb),private.require_draft_verified(uuid) from public,anon,authenticated;
revoke all on function public.request_draft(uuid,uuid,jsonb),public.regenerate_draft(uuid,integer,uuid,jsonb),public.save_draft_edit(uuid,integer,text),public.restore_draft_version(uuid,integer,integer),public.verify_draft(uuid,integer),public.approve_draft(uuid,integer,boolean,boolean),public.reject_draft(uuid,integer,text),public.submit_draft_feedback(uuid,text,text),public.record_draft_copy(uuid,integer),public.get_draft_usage(uuid),public.get_draft_review(uuid),public.update_brand_persona(uuid,jsonb) from public,anon;
grant execute on function public.request_draft(uuid,uuid,jsonb),public.regenerate_draft(uuid,integer,uuid,jsonb),public.save_draft_edit(uuid,integer,text),public.restore_draft_version(uuid,integer,integer),public.verify_draft(uuid,integer),public.approve_draft(uuid,integer,boolean,boolean),public.reject_draft(uuid,integer,text),public.submit_draft_feedback(uuid,text,text),public.record_draft_copy(uuid,integer),public.get_draft_usage(uuid),public.get_draft_review(uuid),public.update_brand_persona(uuid,jsonb) to authenticated;
