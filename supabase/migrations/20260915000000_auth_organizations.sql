-- Phase 1: identities, tenant membership and a billing skeleton. No later-phase tables.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
alter default privileges in schema private revoke execute on functions from public;

create type public.organization_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.plan_key as enum ('trial', 'solo', 'growth');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://')),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_catalog (
  key public.plan_key primary key,
  name text not null,
  monthly_price_usd integer not null check (monthly_price_usd >= 0),
  trial_days integer check (trial_days > 0),
  organization_limit integer not null check (organization_limit > 0),
  brand_limit integer not null check (brand_limit > 0),
  subreddit_limit integer not null check (subreddit_limit > 0),
  opportunity_limit integer not null check (opportunity_limit > 0),
  ai_draft_limit integer not null check (ai_draft_limit > 0),
  member_limit integer not null check (member_limit > 0),
  opportunity_period text not null check (opportunity_period in ('trial', 'month')),
  features jsonb not null
);

insert into public.plan_catalog values
('trial','Trial',0,7,1,1,3,20,10,1,'trial','{"clickTracking":true,"conversionTracking":false,"dailyDigest":false,"advancedAnalytics":false,"conversionApi":false,"fasterMonitoring":false}'),
('solo','Solo',29,null,1,1,10,100,60,1,'month','{"clickTracking":true,"conversionTracking":true,"dailyDigest":true,"advancedAnalytics":false,"conversionApi":false,"fasterMonitoring":false}'),
('growth','Growth',79,null,1,3,40,500,300,5,'month','{"clickTracking":true,"conversionTracking":true,"dailyDigest":true,"advancedAnalytics":true,"conversionApi":true,"fasterMonitoring":true}');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  billing_email text not null check (char_length(billing_email) <= 254 and billing_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  timezone text not null default 'UTC',
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (trial_ends_at > trial_started_at)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null,
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role public.organization_role not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index organization_invitations_pending_email_idx
  on public.organization_invitations(organization_id, email)
  where accepted_at is null and revoked_at is null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'mock' check (provider in ('mock', 'stripe')),
  provider_customer_id text,
  provider_subscription_id text unique,
  plan_key public.plan_key not null references public.plan_catalog(key),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create table public.organization_data_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organization_data_requests_pending_idx on public.organization_data_requests(organization_id, kind)
  where status in ('requested', 'processing');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system')),
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_organization_created_idx on public.audit_logs(organization_id, created_at desc);

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();
create trigger organization_data_requests_updated_at before update on public.organization_data_requests for each row execute function private.set_updated_at();

-- Never derive privileged flags from user-editable Auth metadata.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger threadsignal_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
insert into public.profiles(id, full_name)
select id, left(coalesce(raw_user_meta_data->>'full_name', ''), 120) from auth.users on conflict (id) do nothing;

-- No caller-supplied user ID: policy helpers always derive identity from the JWT.
-- Definer lookup avoids recursive organization_members RLS evaluation.
create function private.organization_role(p_organization_id uuid) returns public.organization_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
    and o.status = 'active' and o.deleted_at is null
$$;

create function private.require_role(p_organization_id uuid, p_roles public.organization_role[]) returns public.organization_role
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.organization_role;
begin
  v_role := private.organization_role(p_organization_id);
  if v_role is null or not (v_role = any(p_roles)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return v_role;
end;
$$;

create function private.audit(p_organization_id uuid, p_action text, p_target_type text, p_target_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_organization_id, auth.uid(), p_action, p_target_type, p_target_id, p_metadata)
$$;

create function private.require_available_plan(p_organization_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_subscription public.subscriptions; v_limit integer;
begin
  select * into v_subscription from public.subscriptions where organization_id = p_organization_id;
  if not found then raise exception 'PLAN_UNAVAILABLE'; end if;
  if v_subscription.status = 'trialing' and v_subscription.current_period_end <= now() then
    raise exception 'TRIAL_EXPIRED';
  end if;
  if v_subscription.status not in ('trialing', 'active') or v_subscription.current_period_end <= now() then
    raise exception 'PLAN_INACTIVE';
  end if;
  select member_limit into v_limit from public.plan_catalog where key = v_subscription.plan_key;
  return v_limit;
end;
$$;

alter table public.profiles enable row level security;
alter table public.plan_catalog enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.organization_data_requests enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy plan_catalog_read on public.plan_catalog for select to authenticated using (true);
create policy organizations_read_member on public.organizations for select to authenticated using (private.organization_role(id) is not null);
create policy organization_members_read_member on public.organization_members for select to authenticated using (private.organization_role(organization_id) is not null);
create policy organization_invitations_read_manager on public.organization_invitations for select to authenticated using (private.organization_role(organization_id) in ('owner', 'admin'));
create policy subscriptions_read_owner on public.subscriptions for select to authenticated using (private.organization_role(organization_id) = 'owner');
create policy organization_data_requests_read_owner on public.organization_data_requests for select to authenticated using (private.organization_role(organization_id) = 'owner');
create policy audit_logs_read_manager on public.audit_logs for select to authenticated using (private.organization_role(organization_id) in ('owner', 'admin'));

revoke all on public.profiles, public.plan_catalog, public.organizations, public.organization_members,
 public.organization_invitations, public.subscriptions, public.organization_data_requests, public.audit_logs from public, anon, authenticated;
grant select on public.profiles, public.plan_catalog, public.organization_members, public.subscriptions, public.organization_data_requests, public.audit_logs to authenticated;
grant update(full_name, avatar_url) on public.profiles to authenticated;
grant select(id, name, slug, timezone, default_currency, status, trial_started_at, trial_ends_at, created_at, updated_at, deleted_at) on public.organizations to authenticated;
grant select(id, organization_id, email, role, expires_at, accepted_at, revoked_at, created_by, created_at) on public.organization_invitations to authenticated;

create function public.create_organization(p_name text, p_slug text, p_billing_email text, p_timezone text default 'UTC', p_default_currency text default 'USD')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid; v_days integer;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED'; end if;
  -- Lock the user so concurrent onboarding cannot create multiple trial organizations.
  perform 1 from auth.users where id = v_user and email_confirmed_at is not null for update;
  if not found then raise exception using errcode = '42501', message = 'EMAIL_NOT_VERIFIED'; end if;
  if exists(select 1 from public.organization_members where user_id = v_user and role = 'owner') then
    raise exception 'ORGANIZATION_LIMIT';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  select trial_days into v_days from public.plan_catalog where key = 'trial';
  insert into public.organizations(name, slug, billing_email, timezone, default_currency, trial_ends_at)
  values (btrim(p_name), lower(btrim(p_slug)), lower(btrim(p_billing_email)), p_timezone, upper(p_default_currency), now() + make_interval(days => v_days)) returning id into v_id;
  insert into public.organization_members(organization_id, user_id, role) values (v_id, v_user, 'owner');
  insert into public.subscriptions(organization_id, plan_key, status, current_period_start, current_period_end)
  values (v_id, 'trial', 'trialing', now(), now() + make_interval(days => v_days));
  perform private.audit(v_id, 'organization.created', 'organization', v_id);
  return v_id;
end;
$$;

create function public.get_organization_settings(p_organization_id uuid)
returns table(id uuid, name text, slug text, billing_email text, timezone text, default_currency text, status text, trial_started_at timestamptz, trial_ends_at timestamptz, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.organization_role;
begin
  v_role := private.require_role(p_organization_id, array['owner','admin','member','viewer']::public.organization_role[]);
  return query select o.id, o.name, o.slug, case when v_role = 'owner' then o.billing_email else null end,
    o.timezone, o.default_currency, o.status, o.trial_started_at, o.trial_ends_at, o.created_at, o.updated_at
    from public.organizations o where o.id = p_organization_id;
end;
$$;

create or replace function public.update_organization(p_organization_id uuid, p_name text, p_billing_email text default null, p_timezone text default 'UTC', p_default_currency text default 'USD')
returns void language plpgsql security definer set search_path = '' as $$
declare v_role public.organization_role;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  v_role := private.require_role(p_organization_id, array['owner','admin']::public.organization_role[]);
  if v_role <> 'owner' and p_billing_email is not null then raise exception using errcode = '42501', message = 'BILLING_OWNER_ONLY'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  update public.organizations set name = btrim(p_name), billing_email = coalesce(lower(btrim(p_billing_email)), billing_email),
    timezone = p_timezone, default_currency = upper(p_default_currency) where id = p_organization_id;
  perform private.audit(p_organization_id, 'organization.updated', 'organization', p_organization_id);
end;
$$;

create function public.get_organization_plan(p_organization_id uuid)
returns table(plan_key public.plan_key, status text, trial_ends_at timestamptz, seat_limit integer, seats_used bigint, seats_reserved bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_organization_id, array['owner','admin','member','viewer']::public.organization_role[]);
  return query select s.plan_key,
    case when s.current_period_end <= now() and s.status = 'trialing' then 'expired' else s.status end,
    o.trial_ends_at, p.member_limit,
    (select count(*) from public.organization_members m where m.organization_id = p_organization_id),
    (select count(*) from public.organization_invitations i where i.organization_id = p_organization_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  from public.subscriptions s join public.plan_catalog p on p.key = s.plan_key join public.organizations o on o.id = s.organization_id
  where s.organization_id = p_organization_id;
end;
$$;

create function public.list_organization_members(p_organization_id uuid)
returns table(user_id uuid, role public.organization_role, full_name text, avatar_url text, email text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.organization_role;
begin
  v_role := private.require_role(p_organization_id, array['owner','admin','member','viewer']::public.organization_role[]);
  return query select m.user_id, m.role, p.full_name, p.avatar_url,
    case when v_role in ('owner','admin') then u.email::text else null end, m.joined_at
  from public.organization_members m join public.profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id order by m.joined_at, m.user_id;
end;
$$;

create function public.invite_member(p_organization_id uuid, p_email text, p_role public.organization_role, p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.organization_role; v_limit integer; v_used bigint; v_reserved bigint; v_id uuid; v_email text := lower(btrim(p_email));
begin
  -- Every membership mutation locks this same parent row: pending invitations reserve seats.
  perform 1 from public.organizations where id = p_organization_id for update;
  v_actor_role := private.require_role(p_organization_id, array['owner','admin']::public.organization_role[]);
  if p_role = 'owner' and v_actor_role <> 'owner' then raise exception using errcode = '42501', message = 'OWNERSHIP_OWNER_ONLY'; end if;
  v_limit := private.require_available_plan(p_organization_id);
  if exists(select 1 from public.organization_members m join auth.users u on u.id = m.user_id where m.organization_id = p_organization_id and lower(u.email) = v_email) then raise exception 'ALREADY_MEMBER'; end if;
  update public.organization_invitations set revoked_at = now() where organization_id = p_organization_id and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists(select 1 from public.organization_invitations where organization_id = p_organization_id and email = v_email and accepted_at is null and revoked_at is null) then raise exception 'INVITATION_PENDING'; end if;
  select count(*) into v_used from public.organization_members where organization_id = p_organization_id;
  select count(*) into v_reserved from public.organization_invitations where organization_id = p_organization_id and accepted_at is null and revoked_at is null and expires_at > now();
  if v_used + v_reserved >= v_limit then raise exception 'SEAT_LIMIT'; end if;
  insert into public.organization_invitations(organization_id,email,role,token_hash,created_by)
  values(p_organization_id,v_email,p_role,p_token_hash,auth.uid()) returning id into v_id;
  perform private.audit(p_organization_id, 'invitation.created', 'invitation', v_id, jsonb_build_object('role',p_role));
  return v_id;
end;
$$;

create function public.accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invitation public.organization_invitations; v_org uuid; v_email text; v_limit integer; v_used bigint; v_reserved bigint;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED'; end if;
  select organization_id into v_org from public.organization_invitations where token_hash = p_token_hash;
  if v_org is null then raise exception 'INVITATION_INVALID'; end if;
  perform 1 from public.organizations where id = v_org and status = 'active' and deleted_at is null for update;
  if not found then raise exception 'INVITATION_INVALID'; end if;
  select * into v_invitation from public.organization_invitations where token_hash = p_token_hash for update;
  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null or v_invitation.expires_at <= now() then raise exception 'INVITATION_INVALID'; end if;
  -- Read the verified Auth record, not a caller-supplied email or mutable JWT claim.
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null or v_email <> v_invitation.email then raise exception 'INVITATION_INVALID'; end if;
  if exists(select 1 from public.organization_members where organization_id = v_org and user_id = auth.uid()) then raise exception 'ALREADY_MEMBER'; end if;
  v_limit := private.require_available_plan(v_org);
  select count(*) into v_used from public.organization_members where organization_id = v_org;
  select count(*) into v_reserved from public.organization_invitations where organization_id = v_org and accepted_at is null and revoked_at is null and expires_at > now() and id <> v_invitation.id;
  if v_used + v_reserved >= v_limit then raise exception 'SEAT_LIMIT'; end if;
  insert into public.organization_members(organization_id,user_id,role,invited_by) values(v_org,auth.uid(),v_invitation.role,v_invitation.created_by);
  update public.organization_invitations set accepted_at = now() where id = v_invitation.id;
  perform private.audit(v_org, 'invitation.accepted', 'invitation', v_invitation.id, jsonb_build_object('role',v_invitation.role));
  return v_org;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_actor_role public.organization_role; v_target_role public.organization_role;
begin
  select organization_id into v_org from public.organization_invitations where id = p_invitation_id;
  perform 1 from public.organizations where id = v_org for update;
  v_actor_role := private.require_role(v_org,array['owner','admin']::public.organization_role[]);
  select role into v_target_role from public.organization_invitations where id = p_invitation_id;
  if v_target_role = 'owner' and v_actor_role <> 'owner' then raise exception using errcode = '42501', message = 'OWNERSHIP_OWNER_ONLY'; end if;
  update public.organization_invitations set revoked_at = now() where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if found then perform private.audit(v_org,'invitation.revoked','invitation',p_invitation_id); end if;
end;
$$;

create function public.change_member_role(p_organization_id uuid,p_user_id uuid,p_role public.organization_role) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.organization_role; v_target_role public.organization_role;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  v_actor_role := private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  select role into v_target_role from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if v_actor_role <> 'owner' and (v_target_role = 'owner' or p_role = 'owner') then raise exception using errcode = '42501', message = 'OWNERSHIP_OWNER_ONLY'; end if;
  if v_target_role = 'owner' and p_role <> 'owner' and (select count(*) from public.organization_members where organization_id = p_organization_id and role = 'owner') <= 1 then raise exception 'LAST_OWNER'; end if;
  update public.organization_members set role = p_role where organization_id = p_organization_id and user_id = p_user_id;
  perform private.audit(p_organization_id,'member.role_changed','profile',p_user_id,jsonb_build_object('from',v_target_role,'to',p_role));
end;
$$;

create function public.remove_member(p_organization_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.organization_role; v_target_role public.organization_role;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  v_actor_role := private.require_role(p_organization_id,array['owner','admin']::public.organization_role[]);
  select role into v_target_role from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if v_actor_role <> 'owner' and v_target_role = 'owner' then raise exception using errcode = '42501', message = 'OWNERSHIP_OWNER_ONLY'; end if;
  if v_target_role = 'owner' and (select count(*) from public.organization_members where organization_id = p_organization_id and role = 'owner') <= 1 then raise exception 'LAST_OWNER'; end if;
  delete from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  perform private.audit(p_organization_id,'member.removed','profile',p_user_id);
end;
$$;

create function public.request_organization_data(p_organization_id uuid,p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  perform private.require_role(p_organization_id,array['owner']::public.organization_role[]);
  if p_kind not in ('export','delete') or p_kind is null then raise exception 'INVALID_REQUEST_KIND'; end if;
  select id into v_id from public.organization_data_requests where organization_id = p_organization_id and kind = p_kind and status in ('requested','processing');
  if v_id is not null then return v_id; end if;
  insert into public.organization_data_requests(organization_id,requested_by,kind) values(p_organization_id,auth.uid(),p_kind) returning id into v_id;
  perform private.audit(p_organization_id,'organization.' || p_kind || '_requested','data_request',v_id);
  return v_id;
end;
$$;

-- Explicit grants, including private helpers: functions otherwise inherit PUBLIC execute.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.organization_role(uuid) to authenticated;
revoke execute on function public.create_organization(text,text,text,text,text),
 public.get_organization_settings(uuid), public.update_organization(uuid,text,text,text,text),
 public.get_organization_plan(uuid), public.list_organization_members(uuid),
 public.invite_member(uuid,text,public.organization_role,text), public.accept_invitation(text),
 public.revoke_invitation(uuid), public.change_member_role(uuid,uuid,public.organization_role),
 public.remove_member(uuid,uuid), public.request_organization_data(uuid,text) from public, anon;
grant execute on function public.create_organization(text,text,text,text,text),
 public.get_organization_settings(uuid), public.update_organization(uuid,text,text,text,text),
 public.get_organization_plan(uuid), public.list_organization_members(uuid),
 public.invite_member(uuid,text,public.organization_role,text), public.accept_invitation(text),
 public.revoke_invitation(uuid), public.change_member_role(uuid,uuid,public.organization_role),
 public.remove_member(uuid,uuid), public.request_organization_data(uuid,text) to authenticated;
