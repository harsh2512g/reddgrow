-- Preserve billed attempts independently of successful draft publication. The public
-- usage row remains one aggregate per job; private receipts make retries idempotent.
create table private.draft_ai_attempts (
  job_id uuid not null references public.draft_jobs(id) on delete cascade,
  attempt integer not null check(attempt between 1 and 3),
  lease_token uuid not null unique,
  metadata jsonb not null,
  created_at timestamptz not null default now(),
  primary key(job_id,attempt)
);
alter table private.draft_ai_attempts enable row level security;
revoke all on private.draft_ai_attempts from public,anon,authenticated;

-- Each of at most three attempts retains the existing per-attempt bounds.
alter table public.ai_task_usage drop constraint ai_task_usage_input_tokens_check;
alter table public.ai_task_usage drop constraint ai_task_usage_output_tokens_check;
alter table public.ai_task_usage drop constraint ai_task_usage_estimated_cost_usd_check;
alter table public.ai_task_usage add check(input_tokens between 0 and 3000000),
  add check(output_tokens between 0 and 3000000), add check(estimated_cost_usd between 0 and 300);

create function private.record_draft_attempt_usage(p_job_id uuid,p_attempt integer,p_lease uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  j public.draft_jobs; v_org uuid; prior private.draft_ai_attempts; v_metadata jsonb;
  v_provider text; v_model text; v_input integer; v_output integer; v_cost numeric; v_complete boolean;
begin
  if coalesce(nullif(current_setting('role',true),'none'),session_user) not in ('postgres','threadsignal_runtime_worker')
    then raise exception 'AI_USAGE_FORBIDDEN'; end if;
  if p_job_id is null or p_attempt is null or p_attempt not between 1 and 3 or p_lease is null
    then raise exception 'INVALID_AI_USAGE'; end if;
  -- Match deletion's organization-first ordering. A deleted job never recreates data.
  select organization_id into v_org from public.draft_jobs where id=p_job_id;
  if not found then return; end if;
  perform id from public.organizations where id=v_org for update;
  select * into j from public.draft_jobs where id=p_job_id for update;
  if not found then return; end if;
  if p_attempt>j.attempts then raise exception 'INVALID_AI_USAGE'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>2000
    then raise exception 'INVALID_AI_USAGE'; end if;
  if exists(select 1 from jsonb_object_keys(p_metadata) k where k not in ('provider','model','input_tokens','output_tokens','estimated_cost_usd'))
    or jsonb_typeof(p_metadata->'provider') is distinct from 'string'
    or p_metadata->>'provider' not in ('mock','openai')
    or jsonb_typeof(p_metadata->'model') is distinct from 'string'
    or char_length(p_metadata->>'model') not between 1 and 150
    or exists(select 1 from jsonb_each(p_metadata) e where e.key in ('input_tokens','output_tokens','estimated_cost_usd') and jsonb_typeof(e.value) not in ('number','null'))
    then raise exception 'INVALID_AI_USAGE'; end if;
  if exists(select 1 from jsonb_each(p_metadata) e where e.key in ('input_tokens','output_tokens') and e.value<>'null'::jsonb
      and (e.value::text !~ '^[0-9]{1,7}$' or (e.value::text)::numeric>1000000))
    or (p_metadata->>'estimated_cost_usd')::numeric not between 0 and 100
    then raise exception 'INVALID_AI_USAGE'; end if;
  v_metadata:=jsonb_build_object('provider',p_metadata->>'provider','model',p_metadata->>'model',
    'input_tokens',case when p_metadata->>'provider'='mock' then 0 else (p_metadata->>'input_tokens')::integer end,
    'output_tokens',case when p_metadata->>'provider'='mock' then 0 else (p_metadata->>'output_tokens')::integer end,
    'estimated_cost_usd',case when p_metadata->>'provider'='mock' then 0 else (p_metadata->>'estimated_cost_usd')::numeric end);
  insert into private.draft_ai_attempts(job_id,attempt,lease_token,metadata)
    values(p_job_id,p_attempt,p_lease,v_metadata) on conflict(job_id,attempt) do nothing;
  select * into strict prior from private.draft_ai_attempts where job_id=p_job_id and attempt=p_attempt;
  if (prior.lease_token,prior.metadata) is distinct from (p_lease,v_metadata)
    then raise exception 'AI_USAGE_OPERATION_CONFLICT'; end if;
  -- Missing/crashed attempt receipts cannot turn partial totals into measured totals.
  select count(*)=max(attempt),
    case when bool_or(metadata->>'provider'='openai') then 'openai' else 'mock' end,
    left(string_agg(distinct metadata->>'model',',' order by metadata->>'model'),150),
    case when bool_and(metadata->>'input_tokens' is not null) then sum((metadata->>'input_tokens')::integer) end,
    case when bool_and(metadata->>'output_tokens' is not null) then sum((metadata->>'output_tokens')::integer) end,
    case when bool_and(metadata->>'estimated_cost_usd' is not null) then sum((metadata->>'estimated_cost_usd')::numeric) end
    into v_complete,v_provider,v_model,v_input,v_output,v_cost from private.draft_ai_attempts where job_id=p_job_id;
  insert into public.ai_task_usage(organization_id,brand_id,draft_id,job_id,task,provider,model,input_tokens,output_tokens,estimated_cost_usd)
    values(j.organization_id,j.brand_id,j.draft_id,j.id,j.kind,v_provider,v_model,
      case when v_complete then v_input end,case when v_complete then v_output end,case when v_complete then v_cost end)
    on conflict(job_id) do update set provider=excluded.provider,model=excluded.model,
      input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,estimated_cost_usd=excluded.estimated_cost_usd;
end $$;
revoke all on function private.record_draft_attempt_usage(uuid,integer,uuid,jsonb) from public,anon,authenticated;
-- Existing approved runtime roles receive only this receipt writer, never table access.
do $$ begin
  if exists(select 1 from pg_roles where rolname='threadsignal_runtime_worker') then
    grant execute on function private.record_draft_attempt_usage(uuid,integer,uuid,jsonb) to threadsignal_runtime_worker;
  end if;
end $$;
