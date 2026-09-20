-- Phase 5: revocable manual-posting extension sessions. No Reddit write API or attribution.
-- The local server enters this NOLOGIN role inside a transaction. It has no table authority.
do $$ begin
  if exists(select 1 from pg_roles where rolname='threadsignal_extension_api') then
    -- A local database reset retains cluster roles; reuse only this marked restricted role.
    if exists(select 1 from pg_roles r where r.rolname='threadsignal_extension_api' and (r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit or r.rolreplication or r.rolbypassrls or shobj_description(r.oid,'pg_authid') is distinct from 'ThreadSignal restricted extension API role'))
      or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='threadsignal_extension_api') then raise exception 'EXTENSION_ROLE_CONFLICT'; end if;
  else
    create role threadsignal_extension_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    comment on role threadsignal_extension_api is 'ThreadSignal restricted extension API role';
  end if;
end $$;
grant usage on schema private to threadsignal_extension_api;

create table public.extension_connection_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
  name text not null check(char_length(btrim(name)) between 1 and 80),
  expires_at timestamptz not null default now()+interval '5 minutes',
  consumed_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create index extension_codes_user_idx on public.extension_connection_codes(organization_id,user_id,created_at desc);
create table public.extension_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  extension_origin text not null check(extension_origin ~ '^chrome-extension://[a-p]{32}$'),
  name text not null check(char_length(btrim(name)) between 1 and 80),
  last_used_at timestamptz, expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz, created_at timestamptz not null default now(),
  rate_window_started_at timestamptz not null default now(),
  rate_window_count integer not null default 0 check(rate_window_count between 0 and 120),
  check(expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create index extension_sessions_user_idx on public.extension_sessions(organization_id,user_id,created_at desc);
alter table public.extension_connection_codes enable row level security;
alter table public.extension_sessions enable row level security;
revoke all on public.extension_connection_codes,public.extension_sessions from public,anon,authenticated,threadsignal_extension_api;
create policy extension_sessions_safe_read on public.extension_sessions for select to authenticated using (
  private.organization_role(organization_id) in ('owner','admin') or
  (user_id=(select auth.uid()) and private.organization_role(organization_id)='member')
);
grant select(id,organization_id,user_id,name,last_used_at,expires_at,revoked_at,created_at) on public.extension_sessions to authenticated;

alter table public.drafts add column inserted_at timestamptz;
alter table public.drafts add column inserted_version integer check(inserted_version>0);
alter table public.drafts add column published_at timestamptz;
alter table public.drafts add column published_version integer check(published_version>0);
alter table public.drafts add column published_comment_url text check(char_length(published_comment_url)<=2048);
alter table public.drafts add constraint drafts_insertion_receipt check((inserted_at is null)=(inserted_version is null));
alter table public.drafts add constraint drafts_publication_receipt check((published_at is null)=(published_version is null));

create function private.clear_purged_extension_url() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.purged_at is not null then new.published_comment_url:=null; end if;
  return new;
end $$;
create trigger drafts_clear_purged_extension_url before update on public.drafts for each row execute function private.clear_purged_extension_url();

create function public.create_extension_connection_code(p_organization_id uuid,p_code_hash text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.extension_connection_codes;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  perform private.require_available_plan(p_organization_id);
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'INVALID_EXTENSION_CONNECTION'; end if;
  if (select count(*) from public.extension_connection_codes where organization_id=p_organization_id and user_id=auth.uid() and created_at>now()-interval '10 minutes')>=10 then raise exception 'EXTENSION_RATE_LIMIT'; end if;
  if (select count(*) from public.extension_sessions where organization_id=p_organization_id and user_id=auth.uid() and expires_at>now() and revoked_at is null)>=5 then raise exception 'EXTENSION_SESSION_LIMIT'; end if;
  update public.extension_connection_codes set revoked_at=now() where organization_id=p_organization_id and user_id=auth.uid() and consumed_at is null and revoked_at is null;
  insert into public.extension_connection_codes(organization_id,user_id,code_hash,name) values(p_organization_id,auth.uid(),p_code_hash,btrim(p_name)) returning * into c;
  perform private.audit(p_organization_id,'extension.connection_requested','extension_connection',c.id);
  return jsonb_build_object('id',c.id,'expires_at',c.expires_at);
end $$;

create function public.list_extension_sessions(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.organization_role;
begin
  r:=private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'organization_id',s.organization_id,'user_id',s.user_id,'name',s.name,'last_used_at',s.last_used_at,'expires_at',s.expires_at,'revoked_at',s.revoked_at,'created_at',s.created_at) order by s.created_at desc,s.id)
    from public.extension_sessions s where s.organization_id=p_organization_id and (r in ('owner','admin') or s.user_id=auth.uid())),'[]'::jsonb);
end $$;

create function public.revoke_extension_sessions(p_organization_id uuid,p_session_id uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.organization_role; v_count integer;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  r:=private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  if p_session_id is not null and not exists(select 1 from public.extension_sessions where id=p_session_id and organization_id=p_organization_id and (r in ('owner','admin') or user_id=auth.uid())) then raise exception 'EXTENSION_SESSION_NOT_FOUND'; end if;
  update public.extension_sessions set revoked_at=now() where organization_id=p_organization_id and revoked_at is null and (p_session_id is null or id=p_session_id) and (r in ('owner','admin') or user_id=auth.uid());
  get diagnostics v_count=row_count;
  if p_session_id is null then
    update public.extension_connection_codes set revoked_at=now() where organization_id=p_organization_id and revoked_at is null and consumed_at is null and (r in ('owner','admin') or user_id=auth.uid());
  end if;
  perform private.audit(p_organization_id,'extension.revoked','extension_session',p_session_id,jsonb_build_object('count',v_count,'all',p_session_id is null));
  return v_count;
end $$;

create function private.exchange_extension_code(p_code_hash text,p_token_hash text,p_extension_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.extension_connection_codes; s public.extension_sessions; v_name text;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_extension_origin is null or p_extension_origin !~ '^chrome-extension://[a-p]{32}$' then raise exception 'INVALID_EXTENSION_CONNECTION'; end if;
  select * into c from public.extension_connection_codes where code_hash=p_code_hash;
  if not found then raise exception 'EXTENSION_CODE_INVALID'; end if;
  perform 1 from public.organizations where id=c.organization_id for update;
  select * into c from public.extension_connection_codes where id=c.id for update;
  if not found or c.expires_at<=now() or c.consumed_at is not null or c.revoked_at is not null then raise exception 'EXTENSION_CODE_INVALID'; end if;
  perform set_config('request.jwt.claim.sub',c.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c.user_id,'role','authenticated')::text,true);
  perform private.require_role(c.organization_id,array['owner','admin','member']::public.organization_role[]);
  perform private.require_available_plan(c.organization_id);
  if (select count(*) from public.extension_sessions where organization_id=c.organization_id and user_id=c.user_id and expires_at>now() and revoked_at is null)>=5 then raise exception 'EXTENSION_SESSION_LIMIT'; end if;
  insert into public.extension_sessions(organization_id,user_id,token_hash,extension_origin,name) values(c.organization_id,c.user_id,p_token_hash,p_extension_origin,c.name) returning * into s;
  update public.extension_connection_codes set consumed_at=now() where id=c.id;
  select name into v_name from public.organizations where id=c.organization_id;
  perform private.audit(c.organization_id,'extension.connected','extension_session',s.id);
  return jsonb_build_object('session_id',s.id,'organization_id',s.organization_id,'organization_name',v_name,'name',s.name,'expires_at',s.expires_at);
end $$;

-- Every token operation locks organization before session, then derives the only allowed user.
create function private.require_extension_session(p_token_hash text,p_extension_origin text) returns public.extension_sessions
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'EXTENSION_SESSION_INVALID'; end if;
  select * into s from public.extension_sessions where token_hash=p_token_hash;
  if not found then raise exception 'EXTENSION_SESSION_INVALID'; end if;
  perform 1 from public.organizations where id=s.organization_id for update;
  select * into s from public.extension_sessions where id=s.id for update;
  if not found or s.revoked_at is not null or s.expires_at<=now() or s.extension_origin is distinct from p_extension_origin then raise exception 'EXTENSION_SESSION_INVALID'; end if;
  perform set_config('request.jwt.claim.sub',s.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'role','authenticated')::text,true);
  perform private.require_role(s.organization_id,array['owner','admin','member']::public.organization_role[]);
  perform private.require_available_plan(s.organization_id);
  if s.rate_window_started_at<=now()-interval '1 minute' then
    update public.extension_sessions set rate_window_started_at=now(),rate_window_count=1,last_used_at=now() where id=s.id;
  elsif s.rate_window_count>=120 then raise exception 'EXTENSION_RATE_LIMIT';
  else update public.extension_sessions set rate_window_count=rate_window_count+1,last_used_at=now() where id=s.id;
  end if;
  return s;
end $$;

create function private.extension_scoped_draft(p_session public.extension_sessions,p_draft_id uuid,p_expected_version integer,p_post_id text,p_subreddit text,p_require_approved boolean default true) returns public.drafts
language plpgsql security definer set search_path='' as $$
declare d public.drafts;
begin
  select d0.* into d from public.drafts d0 join public.opportunities o on o.id=d0.opportunity_id join public.reddit_posts p on p.id=o.reddit_post_id join public.subreddits r on r.id=p.subreddit_id
    where d0.id=p_draft_id and d0.organization_id=p_session.organization_id and p.provider_post_id=p_post_id and lower(r.name)=lower(p_subreddit) for update of d0;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  if p_expected_version is null or d.current_version<>p_expected_version then raise exception 'DRAFT_VERSION_CONFLICT'; end if;
  perform private.require_draft_available(d.id);
  if p_require_approved then
    if d.status<>'approved' then raise exception 'DRAFT_NOT_APPROVED'; end if;
    perform private.require_draft_verified(d.id);
  end if;
  return d;
end $$;

create function private.extension_current(p_token_hash text,p_extension_origin text,p_post_id text,p_subreddit text,p_draft_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions; o public.opportunities; d public.drafts; candidate public.drafts; p public.reddit_posts; v_brand text; v_org text; v_rules jsonb; v_claims jsonb:='[]'; v_reason text; v_draft jsonb;
begin
  s:=private.require_extension_session(p_token_hash,p_extension_origin);
  if p_post_id is null or p_post_id !~ '^[a-z0-9_]{1,64}$' or p_subreddit is null or lower(p_subreddit) !~ '^([a-z0-9_]{2,21}|artificialintelligence)$' then raise exception 'INVALID_REDDIT_URL'; end if;
  select name into v_org from public.organizations where id=s.organization_id;
  select o0.* into o from public.opportunities o0 join public.reddit_posts p0 on p0.id=o0.reddit_post_id join public.subreddits r on r.id=p0.subreddit_id join public.brands b on b.id=o0.brand_id
    where o0.organization_id=s.organization_id and p0.provider_post_id=p_post_id and lower(r.name)=lower(p_subreddit) and not p0.is_deleted and b.status='active'
      and (p_draft_id is null or exists(select 1 from public.drafts selected where selected.id=p_draft_id and selected.opportunity_id=o0.id and selected.organization_id=s.organization_id))
    order by exists(select 1 from public.drafts ready where ready.opportunity_id=o0.id and ready.status='approved') desc,o0.updated_at desc,o0.id limit 1;
  if not found then return jsonb_build_object('organization_id',s.organization_id,'organization_name',v_org,'opportunity',null,'draft',null,'draft_unavailable_reason','OPPORTUNITY_NOT_FOUND','rules','[]'::jsonb,'claims','[]'::jsonb); end if;
  select * into strict p from public.reddit_posts where id=o.reddit_post_id;
  select name into v_brand from public.brands where id=o.brand_id;
  select coalesce(jsonb_agg(jsonb_build_object('title',title,'description',description) order by id),'[]'::jsonb) into v_rules from public.subreddit_rules where subreddit_id=p.subreddit_id;
  v_reason:='DRAFT_NOT_APPROVED';
  for candidate in select * from public.drafts where opportunity_id=o.id and organization_id=s.organization_id and (p_draft_id is null or id=p_draft_id) order by (status='approved') desc,approved_at desc nulls last,updated_at desc,id limit 20 loop
    begin
      if candidate.status<>'approved' then continue; end if;
      perform private.require_draft_verified(candidate.id);
      d:=candidate; v_reason:=null; exit;
    exception when raise_exception then
      if sqlerrm in ('POST_DELETED','POST_STALE','OPPORTUNITY_BLOCKED','OPPORTUNITY_UNAVAILABLE','SUBREDDIT_PAUSED','BRAND_ARCHIVED','VERIFICATION_REQUIRED','DRAFT_CONTEXT_CHANGED','DRAFT_APPROVAL_BLOCKED') then v_reason:=sqlerrm;
      else raise; end if;
    end;
  end loop;
  if d.id is not null then
    v_draft:=jsonb_build_object('id',d.id,'version',d.current_version,'content',d.current_content,'strategy',d.strategy,'approved_at',d.approved_at,'disclosure_included',d.disclosure_included,'compliance_status',d.compliance_status,'inserted_at',d.inserted_at,'inserted_version',d.inserted_version,'published_at',d.published_at,'published_version',d.published_version,'published_comment_url',d.published_comment_url);
    select coalesce(jsonb_agg(jsonb_build_object('claim_text',c.claim_text,'status',c.status,'explanation',c.explanation,'provenance',c.provenance) order by c.created_at,c.id),'[]'::jsonb) into v_claims
      from public.draft_claims c join public.draft_versions v on v.id=c.draft_version_id where c.draft_id=d.id and v.version=d.current_version;
  end if;
  return jsonb_build_object('organization_id',s.organization_id,'organization_name',v_org,
    'opportunity',jsonb_build_object('id',o.id,'brand_id',o.brand_id,'brand_name',v_brand,'title',p.title,'summary',o.summary,'final_score',o.final_score,'risk_level',o.risk_level,'permalink',p.permalink,'subreddit',lower(p_subreddit),'post_id',p_post_id),
    'draft',v_draft,'draft_unavailable_reason',v_reason,'rules',v_rules,'claims',v_claims);
end $$;

create function private.extension_save_draft(p_token_hash text,p_extension_origin text,p_draft_id uuid,p_expected_version integer,p_content text) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions; d public.drafts;
begin
  s:=private.require_extension_session(p_token_hash,p_extension_origin);
  select * into d from public.drafts where id=p_draft_id and organization_id=s.organization_id for update;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform private.require_draft_available(d.id);
  return public.save_draft_edit(d.id,p_expected_version,p_content);
end $$;

create function private.extension_prepare_handoff(p_token_hash text,p_extension_origin text,p_draft_id uuid,p_expected_version integer,p_post_id text,p_subreddit text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions; d public.drafts;
begin
  s:=private.require_extension_session(p_token_hash,p_extension_origin);
  d:=private.extension_scoped_draft(s,p_draft_id,p_expected_version,p_post_id,p_subreddit);
  perform private.audit(s.organization_id,'extension.handoff_prepared','draft',d.id,jsonb_build_object('version',d.current_version,'session_id',s.id));
  return jsonb_build_object('content',d.current_content,'version',d.current_version);
end $$;

create function private.extension_mark_inserted(p_token_hash text,p_extension_origin text,p_draft_id uuid,p_expected_version integer,p_post_id text,p_subreddit text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions; d public.drafts;
begin
  s:=private.require_extension_session(p_token_hash,p_extension_origin);
  d:=private.extension_scoped_draft(s,p_draft_id,p_expected_version,p_post_id,p_subreddit);
  if d.inserted_version=d.current_version then return; end if;
  update public.drafts set inserted_at=now(),inserted_version=d.current_version where id=d.id;
  perform private.audit(s.organization_id,'draft.inserted','draft',d.id,jsonb_build_object('version',d.current_version,'session_id',s.id));
end $$;

-- Recording is a human declaration; this function never contacts Reddit.
create function private.record_draft_publication(p_draft_id uuid,p_expected_version integer,p_comment_url text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.drafts; v_post text; v_subreddit text; v_parts text[];
begin
  d:=private.lock_draft(p_draft_id,p_expected_version);
  if d.status<>'approved' then raise exception 'DRAFT_NOT_APPROVED'; end if;
  perform private.require_draft_verified(d.id);
  select p.provider_post_id,lower(r.name) into strict v_post,v_subreddit from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id join public.subreddits r on r.id=p.subreddit_id where o.id=d.opportunity_id;
  if p_comment_url is null or char_length(p_comment_url)>2048 then raise exception 'INVALID_COMMENT_URL'; end if;
  v_parts:=regexp_match(p_comment_url,'^https://www[.]reddit[.]com/r/([a-z0-9_]{2,21}|artificialintelligence)/comments/([a-z0-9_]{1,64})/[a-z0-9_-]{1,200}/([a-z0-9]{1,16})/$');
  if v_parts is null or v_parts[1]<>v_subreddit or v_parts[2]<>v_post then raise exception 'INVALID_COMMENT_URL'; end if;
  if d.published_version is not null then
    if d.published_version=d.current_version and d.published_comment_url=p_comment_url then return; end if;
    raise exception 'PUBLICATION_ALREADY_RECORDED';
  end if;
  update public.drafts set published_at=now(),published_version=d.current_version,published_comment_url=p_comment_url where id=d.id;
  perform private.audit(d.organization_id,'draft.published_manually','draft',d.id,jsonb_build_object('version',d.current_version));
end $$;

create function private.extension_mark_published(p_token_hash text,p_extension_origin text,p_draft_id uuid,p_expected_version integer,p_post_id text,p_subreddit text,p_comment_url text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions; d public.drafts;
begin
  s:=private.require_extension_session(p_token_hash,p_extension_origin);
  d:=private.extension_scoped_draft(s,p_draft_id,p_expected_version,p_post_id,p_subreddit);
  perform private.record_draft_publication(d.id,p_expected_version,p_comment_url);
end $$;

create function public.mark_draft_published(p_organization_id uuid,p_draft_id uuid,p_expected_version integer,p_comment_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  if not exists(select 1 from public.drafts where id=p_draft_id and organization_id=p_organization_id) then raise exception 'DRAFT_NOT_FOUND'; end if;
  perform private.record_draft_publication(p_draft_id,p_expected_version,p_comment_url);
end $$;

create function private.disconnect_extension(p_token_hash text,p_extension_origin text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.extension_sessions;
begin
  -- Logout remains possible after plan expiry, membership removal or a prior revocation.
  select * into s from public.extension_sessions where token_hash=p_token_hash and extension_origin=p_extension_origin;
  if not found then return; end if;
  perform 1 from public.organizations where id=s.organization_id for update;
  select * into s from public.extension_sessions where id=s.id for update;
  if not found or s.revoked_at is not null then return; end if;
  perform set_config('request.jwt.claim.sub',s.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'role','authenticated')::text,true);
  update public.extension_sessions set revoked_at=now() where id=s.id;
  perform private.audit(s.organization_id,'extension.disconnected','extension_session',s.id);
end $$;

create function private.cleanup_expired_extension_sessions() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_codes integer:=0; v_sessions integer:=0; v_count integer;
begin
  -- A bounded batch retains connection-code rows for abuse limits and session metadata for 24h after revocation.
  -- The same sorted organization locks prevent cleanup racing a session handoff or revocation.
  for v_org in select o.id from public.organizations o where
    exists(select 1 from public.extension_connection_codes c where c.organization_id=o.id and c.expires_at<now()-interval '1 day') or
    exists(select 1 from public.extension_sessions s where s.organization_id=o.id and (s.expires_at<=now() or s.revoked_at<now()-interval '1 day'))
    order by o.id limit 50 for update skip locked loop
    delete from public.extension_connection_codes where id in (select id from public.extension_connection_codes where organization_id=v_org and expires_at<now()-interval '1 day' order by id limit greatest(500-v_codes,0));
    get diagnostics v_count=row_count; v_codes:=v_codes+v_count;
    delete from public.extension_sessions where id in (select id from public.extension_sessions where organization_id=v_org and (expires_at<=now() or revoked_at<now()-interval '1 day') order by id limit greatest(500-v_sessions,0));
    get diagnostics v_count=row_count; v_sessions:=v_sessions+v_count;
    exit when v_codes>=500 and v_sessions>=500;
  end loop;
  return jsonb_build_object('codes_deleted',v_codes,'sessions_deleted',v_sessions);
end $$;

revoke all on function private.clear_purged_extension_url(),private.require_extension_session(text,text),private.extension_scoped_draft(public.extension_sessions,uuid,integer,text,text,boolean),private.record_draft_publication(uuid,integer,text) from public,anon,authenticated,threadsignal_extension_api;
revoke all on function private.exchange_extension_code(text,text,text),private.extension_current(text,text,text,text,uuid),private.extension_save_draft(text,text,uuid,integer,text),private.extension_prepare_handoff(text,text,uuid,integer,text,text),private.extension_mark_inserted(text,text,uuid,integer,text,text),private.extension_mark_published(text,text,uuid,integer,text,text,text),private.disconnect_extension(text,text),private.cleanup_expired_extension_sessions() from public,anon,authenticated;
grant execute on function private.exchange_extension_code(text,text,text),private.extension_current(text,text,text,text,uuid),private.extension_save_draft(text,text,uuid,integer,text),private.extension_prepare_handoff(text,text,uuid,integer,text,text),private.extension_mark_inserted(text,text,uuid,integer,text,text),private.extension_mark_published(text,text,uuid,integer,text,text,text),private.disconnect_extension(text,text),private.cleanup_expired_extension_sessions() to threadsignal_extension_api;
revoke all on function public.create_extension_connection_code(uuid,text,text),public.list_extension_sessions(uuid),public.revoke_extension_sessions(uuid,uuid),public.mark_draft_published(uuid,uuid,integer,text) from public,anon,threadsignal_extension_api;
grant execute on function public.create_extension_connection_code(uuid,text,text),public.list_extension_sessions(uuid),public.revoke_extension_sessions(uuid,uuid),public.mark_draft_published(uuid,uuid,integer,text) to authenticated;
