-- Phase 6: Supabase-owned attribution. Public ingestion has function-only authority.
do $$ begin
  if exists(select 1 from pg_roles where rolname='threadsignal_tracking_api') then
    if exists(select 1 from pg_roles r where r.rolname='threadsignal_tracking_api' and (r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit or r.rolreplication or r.rolbypassrls or shobj_description(r.oid,'pg_authid') is distinct from 'ThreadSignal restricted tracking API role'))
      or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='threadsignal_tracking_api') then raise exception 'TRACKING_ROLE_CONFLICT'; end if;
  else
    create role threadsignal_tracking_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    comment on role threadsignal_tracking_api is 'ThreadSignal restricted tracking API role';
  end if;
end $$;
grant usage on schema private to threadsignal_tracking_api;
grant threadsignal_tracking_api to postgres with inherit false,set true;

create table public.tracking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  attribution_days integer not null default 30 check(attribution_days between 1 and 90),
  consent_text text not null default 'Allow privacy-respecting attribution of this visit and conversion events.' check(char_length(btrim(consent_text)) between 10 and 1000),
  updated_at timestamptz not null default now()
);
create table public.tracking_links (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,opportunity_id uuid not null,draft_id uuid not null,
  draft_version integer not null check(draft_version>0),draft_style text not null check(char_length(draft_style) between 1 and 100),
  code text not null unique check(code ~ '^[A-Za-z0-9_-]{12,32}$'),destination_url text not null check(char_length(destination_url)<=2048),
  utm_config jsonb not null default '{}',overwrite_utm boolean not null default false,
  status text not null default 'active' check(status in ('active','revoked')),created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),revoked_at timestamptz,
  foreign key(brand_id,organization_id) references public.brands(id,organization_id) on delete cascade,
  foreign key(opportunity_id,brand_id,organization_id) references public.opportunities(id,brand_id,organization_id) on delete cascade,
  foreign key(draft_id,brand_id,organization_id) references public.drafts(id,brand_id,organization_id) on delete cascade,
  unique(id,brand_id,organization_id),check((status='revoked')=(revoked_at is not null))
);
create index tracking_links_scope_idx on public.tracking_links(organization_id,brand_id,created_at desc,id);
create table public.tracking_clicks (
  id uuid primary key,organization_id uuid not null,brand_id uuid not null,tracking_link_id uuid not null,
  occurred_at timestamptz not null default now(),anonymous_visitor_id text check(anonymous_visitor_id ~ '^[a-f0-9]{64}$'),
  receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'),
  foreign key(tracking_link_id,brand_id,organization_id) references public.tracking_links(id,brand_id,organization_id) on delete cascade,
  unique(id,tracking_link_id,brand_id,organization_id)
);
create index tracking_clicks_scope_idx on public.tracking_clicks(organization_id,occurred_at,tracking_link_id);
create table public.conversion_api_keys (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,
  name text not null check(char_length(btrim(name)) between 1 and 80),key_prefix text not null check(key_prefix ~ '^tsk_[A-Za-z0-9_-]{8}$'),
  key_hash text not null unique check(key_hash ~ '^[a-f0-9]{64}$'),last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),revoked_at timestamptz,
  foreign key(brand_id,organization_id) references public.brands(id,organization_id) on delete cascade
);
create index conversion_api_keys_scope_idx on public.conversion_api_keys(organization_id,brand_id,created_at desc);
create table public.conversion_events (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,tracking_click_id uuid not null,tracking_link_id uuid not null,
  event_type text not null check(event_type in ('signup','lead','trial_started','purchase','custom')),
  external_id text check(external_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),idempotency_key uuid,
  value numeric(16,4) not null check(value between 0 and 999999999999.9999),currency text not null check(currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null,metadata jsonb not null default '{}',source text not null check(source in ('browser','server')),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
  foreign key(tracking_click_id,tracking_link_id,brand_id,organization_id) references public.tracking_clicks(id,tracking_link_id,brand_id,organization_id) on delete cascade,
  check(external_id is not null or idempotency_key is not null)
);
create unique index conversions_external_dedupe_idx on public.conversion_events(brand_id,event_type,external_id) where external_id is not null;
create unique index conversions_idempotency_idx on public.conversion_events(brand_id,idempotency_key) where idempotency_key is not null;
create index conversion_events_scope_idx on public.conversion_events(organization_id,occurred_at,brand_id,event_type);

do $$ declare t text; begin
  foreach t in array array['tracking_settings','tracking_links','tracking_clicks','conversion_api_keys','conversion_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,threadsignal_tracking_api',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.organization_role(organization_id) is not null)',t||'_member_read',t);
  end loop;
end $$;
grant select on public.tracking_settings,public.tracking_links to authenticated;
-- Event identifiers and receipts are not a browser-readable ingestion credential.
grant select(id,organization_id,brand_id,tracking_link_id,occurred_at) on public.tracking_clicks to authenticated;
grant select(id,organization_id,brand_id,tracking_click_id,tracking_link_id,event_type,value,currency,occurred_at,source,created_at) on public.conversion_events to authenticated;
drop policy conversion_api_keys_member_read on public.conversion_api_keys;
create policy conversion_api_keys_manager_read on public.conversion_api_keys for select to authenticated using(private.organization_role(organization_id) in ('owner','admin'));
grant select(id,organization_id,brand_id,name,key_prefix,last_used_at,created_by,created_at,revoked_at) on public.conversion_api_keys to authenticated;

create function private.require_tracking_feature(p_organization_id uuid,p_feature text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organizations where id=p_organization_id and status='active' and deleted_at is null) then raise exception 'ORGANIZATION_UNAVAILABLE'; end if;
  perform private.require_available_plan(p_organization_id);
  if not exists(select 1 from public.subscriptions s join public.plan_catalog c on c.key=s.plan_key where s.organization_id=p_organization_id and c.features->p_feature='true'::jsonb) then raise exception 'TRACKING_PLAN_REQUIRED'; end if;
end $$;
create function private.tracking_url_host(p_url text) returns text
language sql immutable set search_path='' as $$
  select case when p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+([/?][^#[:space:]\\]*)?$'
    and p_url !~ '^https://([0-9]+\.){3}[0-9]+([/?#]|$)'
    and p_url !~ '^https://([^/?#]*\.)?(localhost|local|internal|lan|home|onion|test|invalid)([/?#]|$)'
    and char_length(p_url)<=2048 then substring(p_url from '^https://([^/?#]+)') else null end
$$;
create function private.tracking_destination_allowed(p_brand_id uuid,p_destination text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(exists(select 1 from public.brands b where b.id=p_brand_id and b.status='active' and private.tracking_url_host(p_destination) is not null and
    (private.tracking_url_host(p_destination)=private.knowledge_host(b.website_url) or exists(select 1 from jsonb_array_elements_text(b.profile->'allowed_links') u where private.tracking_url_host(p_destination)=private.knowledge_host(u)))),false)
$$;
create function public.get_tracking_settings(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  return coalesce((select to_jsonb(s)-'organization_id' from public.tracking_settings s where s.organization_id=p_organization_id),jsonb_build_object('attribution_days',30,'consent_text','Allow privacy-respecting attribution of this visit and conversion events.','updated_at',null));
end $$;
create function public.update_tracking_settings(p_organization_id uuid,p_days integer,p_consent text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  if p_days is null or p_days not between 1 and 90 or p_consent is null or char_length(btrim(p_consent)) not between 10 and 1000 then raise exception 'INVALID_TRACKING_SETTINGS'; end if;
  insert into public.tracking_settings(organization_id,attribution_days,consent_text) values(p_organization_id,p_days,btrim(p_consent)) on conflict(organization_id) do update set attribution_days=excluded.attribution_days,consent_text=excluded.consent_text,updated_at=now();
  perform private.audit(p_organization_id,'tracking.settings_updated','organization',p_organization_id,jsonb_build_object('attribution_days',p_days));
  return public.get_tracking_settings(p_organization_id);
end $$;
create function public.create_tracking_link(p_organization_id uuid,p_draft_id uuid,p_expected_version integer,p_code text,p_destination text,p_utm jsonb,p_overwrite boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.drafts;l public.tracking_links;v_style text;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  perform private.require_tracking_feature(p_organization_id,'clickTracking');
  select * into d from public.drafts where id=p_draft_id and organization_id=p_organization_id for update;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  if p_expected_version is null or d.current_version<>p_expected_version then raise exception 'DRAFT_VERSION_CONFLICT'; end if;
  if d.status<>'approved' then raise exception 'DRAFT_NOT_APPROVED'; end if;
  perform private.require_draft_verified(d.id);
  if not private.tracking_destination_allowed(d.brand_id,p_destination) then raise exception 'TRACKING_DESTINATION_DENIED'; end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{12,32}$' or p_overwrite is null or p_utm is null or jsonb_typeof(p_utm)<>'object' or octet_length(p_utm::text)>2000
    or exists(select 1 from jsonb_each(p_utm) e where e.key not in ('utm_source','utm_medium','utm_campaign','utm_content','utm_term') or jsonb_typeof(e.value)<>'string' or char_length(e.value#>>'{}') not between 1 and 200 or e.value#>>'{}' ~ '[[:cntrl:]]') then raise exception 'INVALID_TRACKING_LINK'; end if;
  if (select count(*) from public.tracking_links where draft_id=d.id and status='active')>=20 then raise exception 'TRACKING_LINK_LIMIT'; end if;
  select tone into v_style from public.brand_personas where id=d.persona_id;
  insert into public.tracking_links(organization_id,brand_id,opportunity_id,draft_id,draft_version,draft_style,code,destination_url,utm_config,overwrite_utm,created_by)
    values(d.organization_id,d.brand_id,d.opportunity_id,d.id,d.current_version,v_style,p_code,p_destination,jsonb_build_object('utm_source','reddit','utm_medium','community','utm_campaign','threadsignal','utm_content',d.opportunity_id)||p_utm,p_overwrite,auth.uid()) returning * into l;
  perform private.audit(p_organization_id,'tracking.link_created','tracking_link',l.id);
  return to_jsonb(l);
end $$;
create function public.revoke_tracking_link(p_organization_id uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin','member']::public.organization_role[]);
  if not exists(select 1 from public.tracking_links where id=p_id and organization_id=p_organization_id) then raise exception 'TRACKING_LINK_NOT_FOUND'; end if;
  update public.tracking_links set status='revoked',revoked_at=now() where id=p_id and status='active';
  perform private.audit(p_organization_id,'tracking.link_revoked','tracking_link',p_id);
end $$;
create function public.create_conversion_api_key(p_organization_id uuid,p_brand_id uuid,p_name text,p_prefix text,p_hash text,p_replaces uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.conversion_api_keys;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  perform private.require_tracking_feature(p_organization_id,'conversionApi');
  if not exists(select 1 from public.brands where id=p_brand_id and organization_id=p_organization_id and status='active') then raise exception 'BRAND_NOT_FOUND'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_prefix is null or p_prefix !~ '^tsk_[A-Za-z0-9_-]{8}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_CONVERSION_KEY'; end if;
  if p_replaces is not null then
    update public.conversion_api_keys set revoked_at=now() where id=p_replaces and organization_id=p_organization_id and brand_id=p_brand_id and revoked_at is null;
    if not found then raise exception 'CONVERSION_KEY_NOT_FOUND'; end if;
  end if;
  if (select count(*) from public.conversion_api_keys where brand_id=p_brand_id and revoked_at is null)>=5 then raise exception 'CONVERSION_KEY_LIMIT'; end if;
  insert into public.conversion_api_keys(organization_id,brand_id,name,key_prefix,key_hash,created_by) values(p_organization_id,p_brand_id,btrim(p_name),p_prefix,p_hash,auth.uid()) returning * into k;
  perform private.audit(p_organization_id,'conversion.key_created','conversion_api_key',k.id,jsonb_build_object('rotated',p_replaces is not null));
  return to_jsonb(k)-'key_hash';
end $$;
create function public.revoke_conversion_api_key(p_organization_id uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  update public.conversion_api_keys set revoked_at=coalesce(revoked_at,now()) where id=p_id and organization_id=p_organization_id;
  if not found then raise exception 'CONVERSION_KEY_NOT_FOUND'; end if;
  perform private.audit(p_organization_id,'conversion.key_revoked','conversion_api_key',p_id);
end $$;
create function public.list_conversion_api_keys(p_organization_id uuid,p_brand_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  return coalesce((select jsonb_agg(to_jsonb(k)-'key_hash' order by k.created_at desc,k.id) from (select * from public.conversion_api_keys where organization_id=p_organization_id and brand_id=p_brand_id order by (revoked_at is null) desc,created_at desc limit 55) k),'[]'::jsonb);
end $$;
create function private.tracking_redirect(p_code text,p_click_id uuid,p_receipt_hash text,p_visitor_hash text default null,p_record_click boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.tracking_links;
begin
  select * into l from public.tracking_links where code=p_code;
  if not found then raise exception 'TRACKING_LINK_UNAVAILABLE'; end if;
  perform 1 from public.organizations where id=l.organization_id for update;
  select * into l from public.tracking_links where id=l.id for update;
  if not found or l.status<>'active' then raise exception 'TRACKING_LINK_UNAVAILABLE'; end if;
  perform private.require_tracking_feature(l.organization_id,'clickTracking');
  if not private.tracking_destination_allowed(l.brand_id,l.destination_url) then raise exception 'TRACKING_DESTINATION_DENIED'; end if;
  if not exists(select 1 from public.drafts d join public.opportunities o on o.id=d.opportunity_id join public.reddit_posts p on p.id=o.reddit_post_id where d.id=l.draft_id and d.purged_at is null and not p.is_deleted) then raise exception 'TRACKING_LINK_UNAVAILABLE'; end if;
  if p_record_click is false then return jsonb_build_object('destination_url',l.destination_url,'utm_config',l.utm_config,'overwrite_utm',l.overwrite_utm,'click_id',null,'brand_id',l.brand_id,'approved_domains',(select jsonb_build_array(private.knowledge_host(b.website_url))||(select coalesce(jsonb_agg(distinct private.knowledge_host(u)), '[]'::jsonb) from jsonb_array_elements_text(b.profile->'allowed_links') u) from public.brands b where b.id=l.brand_id),'attribution_days',coalesce((select attribution_days from public.tracking_settings where organization_id=l.organization_id),30)); end if;
  if p_record_click is null or p_click_id is null or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' or (p_visitor_hash is not null and p_visitor_hash !~ '^[a-f0-9]{64}$') then raise exception 'INVALID_TRACKING_CLICK'; end if;
  insert into public.tracking_clicks(id,organization_id,brand_id,tracking_link_id,receipt_hash,anonymous_visitor_id) values(p_click_id,l.organization_id,l.brand_id,l.id,p_receipt_hash,p_visitor_hash);
  return jsonb_build_object('destination_url',l.destination_url,'utm_config',l.utm_config,'overwrite_utm',l.overwrite_utm,'click_id',p_click_id,'brand_id',l.brand_id,'approved_domains',(select jsonb_build_array(private.knowledge_host(b.website_url))||(select coalesce(jsonb_agg(distinct private.knowledge_host(u)), '[]'::jsonb) from jsonb_array_elements_text(b.profile->'allowed_links') u) from public.brands b where b.id=l.brand_id),'attribution_days',coalesce((select attribution_days from public.tracking_settings where organization_id=l.organization_id),30));
end $$;

create function private.ingest_conversion(p_key_hash text,p_receipt_hash text,p_origin text,p_event jsonb,p_allow_fixture boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.tracking_clicks;l public.tracking_links;k public.conversion_api_keys;v_days integer;v_date timestamptz;v_source text;v_hash text;v_value numeric;v_id uuid;existing public.conversion_events;v_external text;v_idempotency uuid;v_metadata jsonb;
begin
  if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>5000 or exists(select 1 from jsonb_object_keys(p_event) f where f not in ('clickId','event','externalId','idempotencyKey','value','currency','occurredAt','metadata','consent','brandId'))
    or p_event->>'clickId' is null or p_event->>'clickId' !~ '^[a-f0-9-]{36}$' or p_event->>'event' is null or p_event->>'event' not in ('signup','lead','trial_started','purchase','custom')
    or jsonb_typeof(p_event->'value') is distinct from 'number' or p_event->>'currency' is null or p_event->>'currency' not in ('USD','EUR','GBP','INR','CAD','AUD','NZD','SGD','HKD','CHF','CNY','SEK','NOK','DKK','PLN','BRL','MXN','ZAR','AED','SAR','JPY','KRW','CLP','VND','BHD','KWD','OMR','TND')
    or p_event->>'occurredAt' is null or jsonb_typeof(p_event->'occurredAt')<>'string' then raise exception 'INVALID_CONVERSION'; end if;
  v_external:=p_event->>'externalId';
  if v_external is not null and v_external !~ '^[A-Za-z0-9_.:-]{1,128}$' then raise exception 'INVALID_CONVERSION'; end if;
  if p_event->>'idempotencyKey' is not null and p_event->>'idempotencyKey' !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_CONVERSION'; end if;
  v_idempotency:=(p_event->>'idempotencyKey')::uuid;
  if v_external is null and v_idempotency is null then raise exception 'CONVERSION_DEDUPE_REQUIRED'; end if;
  v_value:=(p_event->>'value')::numeric;
  if v_value<0 or v_value>1000000000 or v_value<>round(v_value,case when p_event->>'currency' in ('JPY','KRW','CLP','VND') then 0 when p_event->>'currency' in ('BHD','KWD','OMR','TND') then 3 else 2 end) then raise exception 'INVALID_CONVERSION_VALUE'; end if;
  v_metadata:=coalesce(p_event->'metadata','{}'::jsonb);
  if jsonb_typeof(v_metadata)<>'object' or exists(select 1 from jsonb_each(v_metadata) e where e.key not in ('plan','customName') or jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[A-Za-z0-9 _.-]{1,64}$') then raise exception 'INVALID_CONVERSION_METADATA'; end if;
  if p_event->>'event'='custom' and v_metadata->>'customName' is null then raise exception 'INVALID_CONVERSION_METADATA'; end if;
  begin v_date:=(p_event->>'occurredAt')::timestamptz; exception when others then raise exception 'INVALID_CONVERSION_TIME'; end;
  if not isfinite(v_date) or v_date>now()+interval '5 minutes' then raise exception 'INVALID_CONVERSION_TIME'; end if;
  select * into c from public.tracking_clicks where id=(p_event->>'clickId')::uuid;
  if not found then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  if p_event->>'brandId' is not null and p_event->>'brandId'<>c.brand_id::text then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  perform 1 from public.organizations where id=c.organization_id for update;
  select * into c from public.tracking_clicks where id=c.id;
  if not found then raise exception 'CONVERSION_CLICK_INVALID'; end if;
  select * into strict l from public.tracking_links where id=c.tracking_link_id;
  if l.status<>'active' or not private.tracking_destination_allowed(l.brand_id,l.destination_url) then raise exception 'TRACKING_LINK_UNAVAILABLE'; end if;
  perform private.require_tracking_feature(c.organization_id,'conversionTracking');
  if p_key_hash is not null then
    if p_receipt_hash is not null or p_origin is not null or p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'CONVERSION_KEY_INVALID'; end if;
    select * into k from public.conversion_api_keys where key_hash=p_key_hash and organization_id=c.organization_id and brand_id=c.brand_id and revoked_at is null for update;
    if not found then raise exception 'CONVERSION_KEY_INVALID'; end if;
    perform private.require_tracking_feature(c.organization_id,'conversionApi');
    v_source:='server';
  else
    if p_event->'consent' is distinct from 'true'::jsonb then raise exception 'CONVERSION_CONSENT_REQUIRED'; end if;
    if p_receipt_hash is null or p_receipt_hash is distinct from c.receipt_hash then raise exception 'CONVERSION_RECEIPT_INVALID'; end if;
    if p_origin is null or not ((p_origin='https://'||private.tracking_url_host(l.destination_url)) or (p_allow_fixture is true and p_origin='http://127.0.0.1:3000' and private.tracking_url_host(l.destination_url)='clarityscale.example')) then raise exception 'CONVERSION_ORIGIN_DENIED'; end if;
    v_source:='browser';
  end if;
  select coalesce((select attribution_days from public.tracking_settings where organization_id=c.organization_id),30) into v_days;
  if v_date<c.occurred_at or v_date>c.occurred_at+make_interval(days=>v_days) or now()>c.occurred_at+make_interval(days=>v_days)+interval '5 minutes' then raise exception 'CONVERSION_OUTSIDE_WINDOW'; end if;
  -- Credential/source are not part of logical identity: retries may safely cross transport.
  v_hash:=encode(extensions.digest(jsonb_build_object('clickId',c.id,'event',p_event->>'event','externalId',v_external,'value',v_value,'currency',p_event->>'currency','occurredAt',v_date,'metadata',v_metadata)::text,'sha256'),'hex');
  select * into existing from public.conversion_events where brand_id=c.brand_id and ((external_id=v_external and event_type=p_event->>'event') or (idempotency_key=v_idempotency)) order by created_at,id limit 1;
  if found then
    if existing.payload_hash<>v_hash then raise exception 'CONVERSION_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('id',existing.id,'duplicate',true);
  end if;
  insert into public.conversion_events(organization_id,brand_id,tracking_click_id,tracking_link_id,event_type,external_id,idempotency_key,value,currency,occurred_at,metadata,source,payload_hash)
    values(c.organization_id,c.brand_id,c.id,l.id,p_event->>'event',v_external,v_idempotency,v_value,p_event->>'currency',v_date,v_metadata,v_source,v_hash) returning id into v_id;
  if k.id is not null then update public.conversion_api_keys set last_used_at=now() where id=k.id; end if;
  return jsonb_build_object('id',v_id,'duplicate',false);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_CONVERSION';
end $$;

-- Each activity is represented once before grouping. Never join clicks to conversions
-- and then count the duplicated click/draft/opportunity rows.
create function private.attribution_rows(p_organization_id uuid,p_from timestamptz,p_to timestamptz,p_filters jsonb)
returns table(kind text,item_id uuid,click_id uuid,occurred_at timestamptz,brand_id uuid,brand_label text,subreddit_id uuid,subreddit_label text,opportunity_id uuid,intent text,competitors jsonb,style text,high_intent boolean,approved boolean,visitor text,currency text,value numeric)
language sql stable security definer set search_path='' as $$
  with context as (
    select o.*,b.name as brand_label,s.name as subreddit_label
    from public.opportunities o join public.brands b on b.id=o.brand_id join public.subreddits s on s.id=o.subreddit_id
    where o.organization_id=p_organization_id
      and (p_filters->>'brand_id' is null or o.brand_id=(p_filters->>'brand_id')::uuid)
      and (p_filters->>'subreddit_id' is null or o.subreddit_id=(p_filters->>'subreddit_id')::uuid)
      and (p_filters->>'opportunity_id' is null or o.id=(p_filters->>'opportunity_id')::uuid)
      and (p_filters->>'intent' is null or o.intent_category=p_filters->>'intent')
      and (p_filters->>'competitor_id' is null or o.matched_competitor_ids ? (p_filters->>'competitor_id'))
  ), rows as (
    select 'opportunity'::text as kind,o.id as item_id,null::uuid as click_id,o.created_at as occurred_at,o.brand_id,o.brand_label,o.subreddit_id,o.subreddit_label,o.id as opportunity_id,o.intent_category as intent,o.matched_competitor_ids as competitors,'Unspecified'::text as style,(o.final_score>=80 and not o.is_blocked) as high_intent,false as approved,null::text as visitor,null::text as currency,0::numeric as value from context o
    union all
    select 'draft',d.id,null,d.created_at,o.brand_id,o.brand_label,o.subreddit_id,o.subreddit_label,o.id,o.intent_category,o.matched_competitor_ids,coalesce((select l.draft_style from public.tracking_links l where l.draft_id=d.id order by l.created_at desc limit 1),p.tone),false,d.status='approved',null,null,0 from public.drafts d join context o on o.id=d.opportunity_id join public.brand_personas p on p.id=d.persona_id where d.current_version>0
    union all
    select 'published',d.id,null,d.published_at,o.brand_id,o.brand_label,o.subreddit_id,o.subreddit_label,o.id,o.intent_category,o.matched_competitor_ids,coalesce((select l.draft_style from public.tracking_links l where l.draft_id=d.id and l.draft_version=d.published_version order by l.created_at desc limit 1),p.tone),false,false,null,null,0 from public.drafts d join context o on o.id=d.opportunity_id join public.brand_personas p on p.id=d.persona_id where d.published_at is not null
    union all
    select 'click',c.id,c.id,c.occurred_at,o.brand_id,o.brand_label,o.subreddit_id,o.subreddit_label,o.id,o.intent_category,o.matched_competitor_ids,l.draft_style,false,false,coalesce(c.anonymous_visitor_id,c.id::text),null,0 from public.tracking_clicks c join public.tracking_links l on l.id=c.tracking_link_id join context o on o.id=l.opportunity_id
    union all
    select e.event_type,e.id,e.tracking_click_id,e.occurred_at,o.brand_id,o.brand_label,o.subreddit_id,o.subreddit_label,o.id,o.intent_category,o.matched_competitor_ids,l.draft_style,false,false,null,e.currency,e.value from public.conversion_events e join public.tracking_links l on l.id=e.tracking_link_id join context o on o.id=l.opportunity_id where p_filters->>'event' is null or e.event_type=p_filters->>'event'
  )
  select * from rows r where r.occurred_at>=p_from and r.occurred_at<p_to and (p_filters->>'style' is null or r.style=p_filters->>'style')
$$;
create function private.attribution_metrics(p_rows jsonb) returns jsonb
language sql immutable set search_path='' as $$
  with r as (select * from jsonb_to_recordset(p_rows) as r(kind text,item_id uuid,click_id uuid,high_intent boolean,approved boolean,visitor text,currency text,value numeric)),
  counts as (select count(*) filter(where kind='opportunity') as opportunities,count(*) filter(where kind='opportunity' and high_intent) as high_intent,
    count(*) filter(where kind='draft') as drafts,count(*) filter(where kind='draft' and approved) as approved_drafts,count(*) filter(where kind='published') as published,
    count(*) filter(where kind='click') as clicks,count(distinct visitor) filter(where kind='click') as unique_clicks,
    count(*) filter(where kind='signup') as signups,count(*) filter(where kind='lead') as leads,count(*) filter(where kind='purchase') as purchases from r)
  select to_jsonb(counts)||jsonb_build_object(
    'approval_rate',coalesce(round(100.0*approved_drafts/nullif(drafts,0),2),0),
    'click_to_signup_rate',coalesce(round(100.0*(select count(distinct c.click_id) from r c where c.kind='click' and exists(select 1 from r s where s.kind='signup' and s.click_id=c.click_id))/nullif(clicks,0),2),0),
    'signup_to_purchase_rate',coalesce(round(100.0*(select count(distinct s.click_id) from r s where s.kind='signup' and exists(select 1 from r p where p.kind='purchase' and p.click_id=s.click_id))/nullif((select count(distinct click_id) from r where kind='signup'),0),2),0),
    'revenue',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'value',total) order by currency) from (select currency,sum(value) as total from r where kind='purchase' group by currency) totals),'[]'::jsonb)
  ) from counts
$$;
create function private.compute_attribution_analytics(p_organization_id uuid,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from date;v_to date;v_rows jsonb;v_metrics jsonb;v_series jsonb;v_groups jsonb;v_breakdowns jsonb:='{}';v_dimension text;v_days integer;v_key text;
begin
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>2000 or exists(select 1 from jsonb_each(p_filters) e where e.key not in ('from','to','brand_id','subreddit_id','opportunity_id','event','intent','competitor_id','style') or jsonb_typeof(e.value)<>'string') then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  foreach v_key in array array['brand_id','subreddit_id','opportunity_id','competitor_id'] loop
    if p_filters->>v_key is not null and p_filters->>v_key !~ '^[a-f0-9-]{36}$' then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  end loop;
  if (p_filters->>'event' is not null and p_filters->>'event' not in ('signup','lead','trial_started','purchase','custom')) or (p_filters->>'intent' is not null and p_filters->>'intent' not in ('recommendation','alternative','comparison','problem','research','support','other')) or char_length(p_filters->>'style')>100 then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  v_from:=coalesce((p_filters->>'from')::date,(now() at time zone 'UTC')::date-29);
  v_to:=coalesce((p_filters->>'to')::date,(now() at time zone 'UTC')::date);
  if not isfinite(v_from) or not isfinite(v_to) or v_to<v_from or v_to-v_from>89 then raise exception 'INVALID_ANALYTICS_RANGE'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows from private.attribution_rows(p_organization_id,v_from::timestamp at time zone 'UTC',(v_to+1)::timestamp at time zone 'UTC',p_filters) r;
  v_metrics:=private.attribution_metrics(v_rows);
  select jsonb_agg(jsonb_build_object('date',d.day::date)||private.attribution_metrics(coalesce((select jsonb_agg(r) from jsonb_array_elements(v_rows) r where ((r->>'occurred_at')::timestamptz at time zone 'UTC')::date=d.day::date),'[]'::jsonb)) order by d.day) into v_series from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') d(day);
  foreach v_dimension in array array['brands','subreddits','intents','competitors','opportunities','styles'] loop
    with expanded as (
      select r as item,
        case v_dimension when 'brands' then r->>'brand_id' when 'subreddits' then r->>'subreddit_id' when 'intents' then r->>'intent' when 'opportunities' then r->>'opportunity_id' when 'styles' then r->>'style' when 'competitors' then competitor.id end as id,
        case v_dimension when 'brands' then r->>'brand_label' when 'subreddits' then r->>'subreddit_label' when 'intents' then r->>'intent' when 'opportunities' then r->>'opportunity_id' when 'styles' then r->>'style' when 'competitors' then coalesce((select c.name from public.brand_competitors c where c.organization_id=p_organization_id and c.id::text=competitor.id),'Removed competitor') end as label
      from jsonb_array_elements(v_rows) r left join lateral (select jsonb_array_elements_text(r->'competitors') as id where v_dimension='competitors') competitor on true
    ), grouped as (select id,max(label) as label,private.attribution_metrics(jsonb_agg(item)) as metrics from expanded where id is not null group by id)
    select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'label',g.label)||g.metrics order by (g.metrics->>'clicks')::integer desc,g.id),'[]'::jsonb) into v_groups from (select * from grouped order by (metrics->>'clicks')::integer desc,id limit 100) g;
    v_breakdowns:=v_breakdowns||jsonb_build_object(v_dimension,v_groups);
  end loop;
  select coalesce((select attribution_days from public.tracking_settings where organization_id=p_organization_id),30) into v_days;
  return jsonb_build_object('range',jsonb_build_object('from',v_from,'to',v_to),'attribution_days',v_days,'metrics',v_metrics,'timeseries',v_series,'breakdowns',v_breakdowns,'funnel',jsonb_build_array(
    jsonb_build_object('stage','opportunities','count',v_metrics->'opportunities'),jsonb_build_object('stage','drafts','count',v_metrics->'drafts'),jsonb_build_object('stage','published','count',v_metrics->'published'),jsonb_build_object('stage','clicks','count',v_metrics->'clicks'),jsonb_build_object('stage','signups','count',v_metrics->'signups'),jsonb_build_object('stage','purchases','count',v_metrics->'purchases')));
exception when invalid_text_representation or datetime_field_overflow then raise exception 'INVALID_ANALYTICS_FILTER';
end $$;

create table public.analytics_cache (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  report jsonb not null,generated_at timestamptz not null default now(),stale boolean not null default false
);
alter table public.analytics_cache enable row level security;
revoke all on public.analytics_cache from public,anon,authenticated,threadsignal_tracking_api;
create policy analytics_cache_member_read on public.analytics_cache for select to authenticated using(private.organization_role(organization_id) is not null);
grant select on public.analytics_cache to authenticated;
create function private.invalidate_attribution_cache() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'DELETE' then update public.analytics_cache set stale=true where organization_id=new.organization_id and not stale; end if;
  if tg_op<>'INSERT' then update public.analytics_cache set stale=true where organization_id=old.organization_id and not stale; end if;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['opportunities','drafts','brands','brand_personas','brand_competitors','tracking_settings','tracking_links','tracking_clicks','conversion_events'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.invalidate_attribution_cache()',t||'_invalidate_analytics',t);
  end loop;
end $$;
create function private.refresh_attribution_analytics(p_limit integer default 5) returns integer
language plpgsql security definer set search_path='' as $$
declare v_org uuid;v_count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'INVALID_ANALYTICS_BATCH'; end if;
  for v_org in select o.id from public.organizations o left join public.analytics_cache c on c.organization_id=o.id where o.status='active' and o.deleted_at is null and (c.organization_id is null or c.stale or c.generated_at<now()-interval '5 minutes') order by c.generated_at nulls first,o.id limit p_limit for update of o skip locked loop
    insert into public.analytics_cache(organization_id,report) values(v_org,private.compute_attribution_analytics(v_org,'{}'::jsonb)) on conflict(organization_id) do update set report=excluded.report,generated_at=now(),stale=false;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
create function public.get_attribution_analytics(p_organization_id uuid,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb;
begin
  perform private.require_role(p_organization_id,array['owner','admin','member','viewer']::public.organization_role[]);
  if p_filters='{}'::jsonb or p_filters=jsonb_build_object('from',((now() at time zone 'UTC')::date-29)::text,'to',((now() at time zone 'UTC')::date)::text) then
    select report into v_report from public.analytics_cache where organization_id=p_organization_id and not stale and generated_at>=now()-interval '5 minutes' and report->'range'->>'to'=((now() at time zone 'UTC')::date)::text;
    if found then return v_report; end if;
  end if;
  return private.compute_attribution_analytics(p_organization_id,p_filters);
end $$;

-- No ambient PUBLIC execute: only signed-in management RPCs and two narrow ingestion calls.
do $$ declare p record; begin
  for p in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('get_tracking_settings','update_tracking_settings','create_tracking_link','revoke_tracking_link','create_conversion_api_key','revoke_conversion_api_key','list_conversion_api_keys','get_attribution_analytics') loop
    execute format('revoke all on function %s from public,anon,authenticated',p.signature);
    execute format('grant execute on function %s to authenticated',p.signature);
  end loop;
  for p in select oid::regprocedure as signature from pg_proc where pronamespace='private'::regnamespace and proname in ('require_tracking_feature','tracking_url_host','tracking_destination_allowed','tracking_redirect','ingest_conversion','attribution_rows','attribution_metrics','compute_attribution_analytics','invalidate_attribution_cache','refresh_attribution_analytics') loop
    execute format('revoke all on function %s from public,anon,authenticated,threadsignal_tracking_api',p.signature);
  end loop;
end $$;
grant execute on function private.tracking_redirect(text,uuid,text,text,boolean),private.ingest_conversion(text,text,text,jsonb,boolean) to threadsignal_tracking_api;
