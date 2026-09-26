-- General task receipts share existing RLS, exports and organization-level metrics.
alter table public.ai_task_usage
  alter column draft_id drop not null,
  alter column job_id drop not null,
  add column operation_id uuid,
  add constraint ai_task_usage_operation_unique unique(operation_id),
  add constraint ai_task_usage_brand_scope foreign key(brand_id,organization_id)
    references public.brands(id,organization_id) on delete cascade,
  add constraint ai_task_usage_receipt_identity check(
    (draft_id is null)=(job_id is null) and (operation_id is null)=(draft_id is not null));
alter table public.ai_task_usage drop constraint ai_task_usage_task_check;
alter table public.ai_task_usage add constraint ai_task_usage_task_check check(task in (
  'generate','verify','compliance','knowledge.embed','opportunity.evaluate',
  'knowledge.search','keyword.suggest','subreddit.suggest','brand.extract'));

create function private.record_ai_usage(
  p_organization_id uuid,p_brand_id uuid,p_operation_id uuid,p_task text,p_metadata jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
  v_user uuid; v_provider text; v_model text; v_input integer; v_output integer; v_cost numeric;
  prior public.ai_task_usage;
begin
  if p_organization_id is null or p_brand_id is null or p_operation_id is null
    or p_task is null or p_task not in ('knowledge.embed','opportunity.evaluate','knowledge.search','keyword.suggest','subreddit.suggest','brand.extract')
    then raise exception 'INVALID_AI_USAGE'; end if;
  if v_role='threadsignal_billing_api' then
    v_user:=auth.uid();
    if v_user is null or p_task not in ('knowledge.search','keyword.suggest','subreddit.suggest','brand.extract')
      or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=v_user)
      then raise exception 'AI_USAGE_FORBIDDEN'; end if;
  elsif v_role='threadsignal_runtime_worker' then
    if p_task not in ('knowledge.embed','opportunity.evaluate') then raise exception 'AI_USAGE_FORBIDDEN'; end if;
  elsif v_role<>'postgres' then
    raise exception 'AI_USAGE_FORBIDDEN';
  end if;
  if not exists(select 1 from public.brands where id=p_brand_id and organization_id=p_organization_id)
    then raise exception 'AI_USAGE_FORBIDDEN'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>2000
    then raise exception 'INVALID_AI_USAGE'; end if;
  if exists(select 1 from jsonb_object_keys(p_metadata) k where k not in ('provider','model','input_tokens','output_tokens','estimated_cost_usd'))
    or jsonb_typeof(p_metadata->'provider') is distinct from 'string'
    or p_metadata->>'provider' not in ('mock','openai')
    or (p_metadata ? 'model' and (jsonb_typeof(p_metadata->'model')<>'string' or char_length(p_metadata->>'model') not between 1 and 150))
    or exists(select 1 from jsonb_each(p_metadata) e where e.key in ('input_tokens','output_tokens','estimated_cost_usd') and jsonb_typeof(e.value) not in ('number','null'))
    then raise exception 'INVALID_AI_USAGE'; end if;
  if exists(select 1 from jsonb_each(p_metadata) e where e.key in ('input_tokens','output_tokens') and e.value<>'null'::jsonb
      and (e.value::text !~ '^[0-9]{1,7}$' or (e.value::text)::numeric>1000000))
    or (p_metadata->>'estimated_cost_usd')::numeric not between 0 and 100
    then raise exception 'INVALID_AI_USAGE'; end if;
  v_provider:=p_metadata->>'provider';
  v_model:=coalesce(p_metadata->>'model',case when v_provider='mock' then 'deterministic' else 'unreported' end);
  v_input:=case when v_provider='mock' then 0 else (p_metadata->>'input_tokens')::integer end;
  v_output:=case when v_provider='mock' then 0 else (p_metadata->>'output_tokens')::integer end;
  v_cost:=case when v_provider='mock' then 0 else (p_metadata->>'estimated_cost_usd')::numeric end;
  insert into public.ai_task_usage(organization_id,brand_id,operation_id,task,provider,model,input_tokens,output_tokens,estimated_cost_usd)
    values(p_organization_id,p_brand_id,p_operation_id,p_task,v_provider,v_model,v_input,v_output,v_cost)
    on conflict(operation_id) do nothing;
  select * into strict prior from public.ai_task_usage where operation_id=p_operation_id;
  if (prior.organization_id,prior.brand_id,prior.task,prior.provider,prior.model,prior.input_tokens,prior.output_tokens,prior.estimated_cost_usd)
    is distinct from (p_organization_id,p_brand_id,p_task,v_provider,v_model,v_input,v_output,v_cost)
    then raise exception 'AI_USAGE_OPERATION_CONFLICT'; end if;
end $$;
revoke all on function private.record_ai_usage(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.record_ai_usage(uuid,uuid,uuid,text,jsonb) to threadsignal_billing_api;
