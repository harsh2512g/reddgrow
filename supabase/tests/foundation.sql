do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'pgvector is missing';
  end if;
  if not exists (select 1 from storage.buckets where id = 'knowledge-private' and public = false) then
    raise exception 'Private knowledge bucket is missing';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('profiles','organizations','organization_members','organization_invitations','subscriptions','plan_catalog','audit_logs','organization_data_requests')
      and c.relrowsecurity) <> 8 then
    raise exception 'Phase 1 tables must all have row-level security';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('brands','brand_competitors','brand_personas','brand_keywords','knowledge_sources','knowledge_documents','knowledge_chunks','knowledge_jobs')
      and c.relrowsecurity) <> 8 then
    raise exception 'Phase 2 tables must all have row-level security';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('subreddits','brand_subreddits','subreddit_rules','reddit_sync_checkpoints','reddit_posts','opportunities','usage_counters','reddit_jobs')
      and c.relrowsecurity) <> 8 then
    raise exception 'Phase 3 tables must all have row-level security';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('drafts','draft_versions','draft_claims','draft_compliance_checks','draft_feedback','draft_jobs','ai_task_usage','responsible_use_acceptances') and c.relrowsecurity) <> 8 then
    raise exception 'Phase 4 tables must all have row-level security';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('extension_connection_codes','extension_sessions') and c.relrowsecurity) <> 2 then
    raise exception 'Phase 5 tables must have row-level security';
  end if;
  if has_column_privilege('authenticated','public.extension_sessions','token_hash','SELECT')
    or has_column_privilege('authenticated','public.extension_connection_codes','code_hash','SELECT') then
    raise exception 'Application users must not read extension credential hashes';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('tracking_settings','tracking_links','tracking_clicks','conversion_api_keys','conversion_events','analytics_cache') and c.relrowsecurity) <> 6 then
    raise exception 'Phase 6 tables must have row-level security';
  end if;
  if has_column_privilege('authenticated','public.conversion_api_keys','key_hash','SELECT')
    or has_column_privilege('authenticated','public.tracking_clicks','receipt_hash','SELECT')
    or has_table_privilege('authenticated','public.analytics_cache','SELECT') then
    raise exception 'Tracking credentials and raw analytics cache must not be selectable';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('notification_preferences','notification_deliveries','billing_events') and c.relrowsecurity) <> 3 then
    raise exception 'Phase 7 tables must have row-level security';
  end if;
  if has_column_privilege('authenticated','public.organization_invitations','token_hash','SELECT') then
    raise exception 'Invitation hashes must not be selectable by application users';
  end if;
  if has_column_privilege('authenticated','public.profiles','is_platform_admin','UPDATE') then
    raise exception 'Users must not be able to promote themselves to platform admin';
  end if;
  if not exists(select 1 from storage.buckets where id='privacy-exports' and public=false and file_size_limit=67108864 and allowed_mime_types=array['application/gzip']) then
    raise exception 'Privacy export bucket must remain private, bounded and gzip-only';
  end if;
  if not exists(select 1 from pg_class where oid='public.privacy_jobs'::regclass and relrowsecurity) then
    raise exception 'Privacy jobs must have row-level security';
  end if;
  if has_table_privilege('authenticated','private.platform_operations_audit','SELECT') or has_table_privilege('anon','private.platform_operations_audit','SELECT') then
    raise exception 'Platform operation audits must remain private';
  end if;
  if (select count(*) from public.plan_catalog) <> 3 then
    raise exception 'The central plan mirror is incomplete';
  end if;
end $$;
