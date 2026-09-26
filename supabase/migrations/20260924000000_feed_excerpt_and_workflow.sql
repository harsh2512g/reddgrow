-- Feed payloads stay bounded; original content remains available only on detail requests.
alter table public.reddit_posts
  add column body_excerpt text generated always as (left(body,500)) stored;
grant select (body_excerpt) on public.reddit_posts to authenticated;

-- Saved lifecycle label only. This cannot authorize approval or publication: those RPCs
-- recheck the live context, role, plan, source freshness and compliance independently.
-- SECURITY INVOKER preserves draft RLS when PostgREST evaluates this computed column.
create function public.opportunity_workflow_status(p_opportunity public.opportunities)
returns text language sql stable security invoker set search_path='' as $$
  select case
    when (p_opportunity).is_blocked then 'blocked'
    when (p_opportunity).status in ('blocked','dismissed','archived') then (p_opportunity).status
    when exists (
      select 1 from public.drafts d
      where d.organization_id=(p_opportunity).organization_id and d.opportunity_id=(p_opportunity).id
        and d.purged_at is null and d.published_at is not null and d.published_version>0
    ) then 'published_manually'
    when exists (
      select 1 from public.drafts d
      where d.organization_id=(p_opportunity).organization_id and d.opportunity_id=(p_opportunity).id
        and d.purged_at is null and d.status='approved' and d.current_version>0
        and d.verified_version=d.current_version
        and d.verification_status in ('pass','warning') and d.compliance_status in ('pass','warning')
    ) then 'approved'
    when exists (
      select 1 from public.drafts d
      where d.organization_id=(p_opportunity).organization_id and d.opportunity_id=(p_opportunity).id
        and d.purged_at is null and d.status in ('ready','warning') and d.current_version>0
        and d.verified_version=d.current_version
        and d.verification_status in ('pass','warning') and d.compliance_status in ('pass','warning')
    ) then 'draft_ready'
    else (p_opportunity).status
  end;
$$;
revoke all on function public.opportunity_workflow_status(public.opportunities) from public, anon;
grant execute on function public.opportunity_workflow_status(public.opportunities) to authenticated;
