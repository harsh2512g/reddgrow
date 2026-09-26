-- Partial known usage must never be presented as a fully measured bill.
create or replace function private.platform_metrics(p_organization_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'jobs',coalesce((select jsonb_agg(to_jsonb(c) order by family,status) from (
      select family,status,count(*) as count from private.platform_job_metadata where p_organization_id is null or organization_id=p_organization_id group by family,status
    ) c),'[]'::jsonb),
    'knowledge_ready',(select count(*) from public.knowledge_sources where status in ('ready','partial') and deleted_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'knowledge_failed',(select count(*) from public.knowledge_sources where status='failed' and deleted_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_pass',(select count(*) from public.drafts where compliance_status='pass' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_warning',(select count(*) from public.drafts where compliance_status='warning' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'draft_blocked',(select count(*) from public.drafts where compliance_status='blocked' and purged_at is null and (p_organization_id is null or organization_id=p_organization_id)),
    'ai_unpriced_tasks',(select count(*) from public.ai_task_usage where estimated_cost_usd is null and (p_organization_id is null or organization_id=p_organization_id)),
    'ai_unreported_usage_tasks',(select count(*) from public.ai_task_usage where (input_tokens is null or output_tokens is null) and (p_organization_id is null or organization_id=p_organization_id)),
    'ai_input_tokens',(select coalesce(sum(input_tokens),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'ai_output_tokens',(select coalesce(sum(output_tokens),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'ai_estimated_cost_usd',(select coalesce(sum(estimated_cost_usd),0) from public.ai_task_usage where p_organization_id is null or organization_id=p_organization_id),
    'billing_applied',(select count(*) from public.billing_events where outcome='applied' and (p_organization_id is null or organization_id=p_organization_id)),
    'billing_stale',(select count(*) from public.billing_events where outcome='stale' and (p_organization_id is null or organization_id=p_organization_id)),
    'billing_last_received_at',(select max(created_at) from public.billing_events where p_organization_id is null or organization_id=p_organization_id)
  )
$$;
