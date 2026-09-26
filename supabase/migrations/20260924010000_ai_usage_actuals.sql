-- Real-provider receipts must not represent unreported usage/prices as measured zeros.
alter table public.ai_task_usage
  alter column input_tokens drop not null,
  alter column output_tokens drop not null,
  alter column estimated_cost_usd drop not null;

create or replace function private.record_draft_usage(p_job_id uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j public.draft_jobs; metadata jsonb:=coalesce(p_metadata,'{}'); v_provider text;
begin
  select * into strict j from public.draft_jobs where id=p_job_id;
  if jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>2000
    or exists(select 1 from jsonb_object_keys(metadata) k where k not in ('provider','model','input_tokens','output_tokens','token_count','estimated_cost_usd'))
    or (metadata ? 'provider' and (jsonb_typeof(metadata->'provider')<>'string' or char_length(metadata->>'provider') not between 1 and 100))
    or (metadata ? 'model' and (jsonb_typeof(metadata->'model')<>'string' or char_length(metadata->>'model') not between 1 and 150))
    or exists(select 1 from jsonb_each(metadata) e where e.key in ('input_tokens','output_tokens','token_count','estimated_cost_usd') and jsonb_typeof(e.value) not in ('number','null'))
    then raise exception 'INVALID_AI_USAGE'; end if;
  v_provider:=coalesce(metadata->>'provider','mock');
  if v_provider not in ('mock','openai') then raise exception 'INVALID_AI_USAGE'; end if;
  insert into public.ai_task_usage(organization_id,brand_id,draft_id,job_id,task,provider,model,input_tokens,output_tokens,estimated_cost_usd)
  values(j.organization_id,j.brand_id,j.draft_id,j.id,j.kind,v_provider,
    coalesce(metadata->>'model',case when v_provider='mock' then 'deterministic' else 'unreported' end),
    case when v_provider='mock' then 0 else (metadata->>'input_tokens')::integer end,
    case when v_provider='mock' then 0 else coalesce((metadata->>'output_tokens')::integer,(metadata->>'token_count')::integer) end,
    case when v_provider='mock' then 0 else (metadata->>'estimated_cost_usd')::numeric end)
  on conflict(job_id) do nothing;
end $$;

revoke all on function private.record_draft_usage(uuid,jsonb) from public,anon,authenticated;
