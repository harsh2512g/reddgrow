-- Optional deployment operation, NOT a migration and NOT automatic activation.
-- Apply in one reviewed transaction after all application migrations. Refuse existing
-- names; never overwrite an existing identity or silently expand its authority.
-- Creates NOLOGIN roles only. A separately authorized operator supplies new personal
-- credentials and enables LOGIN afterward. No password or service key belongs here.
do $$
begin
  if current_user<>'postgres' then raise exception 'RUNTIME_PROVISIONING_REQUIRES_PROJECT_ADMINISTRATOR'; end if;
  if exists(select 1 from pg_catalog.pg_roles where rolname in ('threadsignal_runtime_worker','threadsignal_runtime_web')) then
    raise exception 'RUNTIME_ROLE_ALREADY_EXISTS';
  end if;
  if to_regprocedure('public.worker_knowledge_dispatch(integer)') is null
    or to_regprocedure('private.maintain_platform_operations(integer)') is null
    or to_regprocedure('private.finish_organization_deletion(uuid,uuid)') is null then
    raise exception 'RUNTIME_REQUIRES_COMPLETE_APPLICATION_SCHEMA';
  end if;
  if exists(select 1 from (values
    ('threadsignal_extension_api','ThreadSignal restricted extension API role'),
    ('threadsignal_tracking_api','ThreadSignal restricted tracking API role'),
    ('threadsignal_billing_api',null)) expected(name,description)
    left join pg_catalog.pg_roles r on r.rolname=expected.name
    where r.oid is null or r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole
      or r.rolinherit or r.rolreplication or r.rolbypassrls
      or pg_catalog.shobj_description(r.oid,'pg_authid') is distinct from expected.description
      or exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid)) then
    raise exception 'RUNTIME_BRIDGE_ROLE_NOT_REVIEWED';
  end if;
end $$;

create role threadsignal_runtime_web nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls connection limit 8;
comment on role threadsignal_runtime_web is 'ThreadSignal deployment web runtime v1';
alter role threadsignal_runtime_web set search_path='';
alter role threadsignal_runtime_web set statement_timeout='15s';
alter role threadsignal_runtime_web set lock_timeout='5s';
alter role threadsignal_runtime_web set idle_in_transaction_session_timeout='30s';
grant threadsignal_extension_api,threadsignal_tracking_api,threadsignal_billing_api
  to threadsignal_runtime_web with inherit false,set true;

create role threadsignal_runtime_worker nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls connection limit 4;
comment on role threadsignal_runtime_worker is 'ThreadSignal deployment worker runtime v1';
alter role threadsignal_runtime_worker set search_path='';
alter role threadsignal_runtime_worker set statement_timeout='60s';
alter role threadsignal_runtime_worker set lock_timeout='5s';
alter role threadsignal_runtime_worker set idle_in_transaction_session_timeout='30s';
do $$ begin
  execute format('grant connect on database %I to threadsignal_runtime_web,threadsignal_runtime_worker',current_database());
end $$;
grant usage on schema public,private,extensions,storage to threadsignal_runtime_worker;

-- All-tenant content access is necessary for asynchronous customer-authorized work.
-- No Auth/profile table, credential hash or raw provider billing identity is granted.
grant select on public.brands,public.brand_competitors,public.brand_personas,
  public.brand_keywords,public.brand_subreddits,public.knowledge_sources,
  public.knowledge_documents,public.knowledge_chunks,public.knowledge_jobs,
  public.subreddits,public.subreddit_rules,public.reddit_sync_checkpoints,
  public.reddit_posts,public.reddit_jobs,public.opportunities,public.drafts,
  public.draft_jobs,public.draft_versions,public.draft_claims,
  public.draft_compliance_checks,public.draft_feedback,public.tracking_settings,
  public.tracking_links,public.usage_counters,public.ai_task_usage,
  public.notification_preferences,public.responsible_use_acceptances,
  public.organization_data_requests,public.privacy_jobs,public.audit_logs
  to threadsignal_runtime_worker;
grant select(id,name,slug,billing_email,timezone,default_currency,status,trial_started_at,
  trial_ends_at,created_at,updated_at,deleted_at) on public.organizations to threadsignal_runtime_worker;
grant select(organization_id,user_id,role,invited_by,joined_at)
  on public.organization_members to threadsignal_runtime_worker;
grant select(id,organization_id,email,role,expires_at,accepted_at,revoked_at,created_by,created_at)
  on public.organization_invitations to threadsignal_runtime_worker;
grant select(id,organization_id,brand_id,tracking_link_id,occurred_at)
  on public.tracking_clicks to threadsignal_runtime_worker;
grant select(id,organization_id,brand_id,tracking_click_id,tracking_link_id,event_type,
  external_id,value,currency,occurred_at,metadata,source,created_at)
  on public.conversion_events to threadsignal_runtime_worker;
grant select(id,organization_id,brand_id,name,last_used_at,created_by,created_at,revoked_at)
  on public.conversion_api_keys to threadsignal_runtime_worker;
grant select(id,organization_id,provider,plan_key,status,current_period_start,current_period_end,
  cancel_at_period_end,grace_ends_at,created_at,updated_at)
  on public.subscriptions to threadsignal_runtime_worker;
grant select(id,organization_id,requested_by,plan_key,provider,status,expires_at,completed_at,created_at)
  on public.billing_checkout_requests to threadsignal_runtime_worker;
grant select(id,organization_id,provider,provider_created_at,outcome,created_at)
  on public.billing_events to threadsignal_runtime_worker;
grant select(id,organization_id,user_id,type,status,provider,attempts,available_at,created_at,updated_at,sent_at)
  on public.notification_deliveries to threadsignal_runtime_worker;
grant select(id,organization_id,user_id,name,last_used_at,expires_at,revoked_at,created_at)
  on public.extension_sessions to threadsignal_runtime_worker;

-- FOR UPDATE row locks need an UPDATE privilege, but WITH CHECK(false) prevents
-- changing these protected parent rows, including their IDs and organization state.
grant update(id) on public.organizations,public.brands to threadsignal_runtime_worker;
create policy runtime_worker_organization_lock on public.organizations
  for update to threadsignal_runtime_worker using(true) with check(false);
create policy runtime_worker_brand_lock on public.brands
  for update to threadsignal_runtime_worker using(true) with check(false);

grant update(status,error_code,page_count,chunk_count,last_ingested_at)
  on public.knowledge_sources to threadsignal_runtime_worker;
grant delete on public.knowledge_sources to threadsignal_runtime_worker;
grant update(status,attempts,available_at,lease_token,lease_expires_at,error_code)
  on public.knowledge_jobs,public.reddit_jobs,public.draft_jobs,public.privacy_jobs to threadsignal_runtime_worker;
grant insert(id,organization_id,brand_id,source_id,document_key,title,canonical_url,
  page_number,section_heading,content,checksum,embedding_identity) on public.knowledge_documents to threadsignal_runtime_worker;
grant update(title,canonical_url,page_number,section_heading,content,checksum,embedding_identity)
  on public.knowledge_documents to threadsignal_runtime_worker;
grant delete on public.knowledge_documents,public.knowledge_chunks to threadsignal_runtime_worker;
grant insert(organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,
  checksum,embedding,section_heading,embedding_identity) on public.knowledge_chunks to threadsignal_runtime_worker;
grant update(embedding_identity) on public.knowledge_chunks to threadsignal_runtime_worker;
grant update(provider,display_name,description,subscriber_count,is_nsfw,last_synced_at)
  on public.subreddits to threadsignal_runtime_worker;
grant insert(subreddit_id,provider_rule_id,title,description,kind,applies_to,raw_data),delete
  on public.subreddit_rules to threadsignal_runtime_worker;
grant insert(subreddit_id,sort,cursor,last_success_at,next_sync_at,last_rules_sync_at,last_error_at,
  consecutive_errors,error_code,provider_paused,provider_retry_at),
  update(cursor,last_success_at,next_sync_at,last_rules_sync_at,last_post_refresh_at,last_error_at,
  consecutive_errors,error_code,provider_paused,provider_retry_at)
  on public.reddit_sync_checkpoints to threadsignal_runtime_worker;
grant insert(provider,provider_post_id,subreddit_id,permalink,title,body,author_name,created_at_provider,
  score,num_comments,upvote_ratio,flair,is_nsfw,is_locked,is_archived,is_edited),
  update(permalink,title,body,author_name,score,num_comments,upvote_ratio,flair,is_nsfw,is_locked,
  is_archived,is_edited,created_at_provider,last_synced_at)
  on public.reddit_posts to threadsignal_runtime_worker;
grant update(status,suggested_action) on public.opportunities to threadsignal_runtime_worker;
grant update(status,error_code,verified_version,approved_at,approved_by)
  on public.drafts to threadsignal_runtime_worker;
grant update(status) on public.organization_data_requests to threadsignal_runtime_worker;
grant delete on public.notification_deliveries,public.audit_logs,public.tracking_clicks
  to threadsignal_runtime_worker;
grant select,delete on private.privacy_deletion_receipts to threadsignal_runtime_worker;

do $$ declare t text; begin
  foreach t in array array['organizations','organization_members','organization_invitations',
    'brands','brand_competitors','brand_personas','brand_keywords','brand_subreddits',
    'knowledge_sources','knowledge_documents','knowledge_chunks','knowledge_jobs',
    'subreddits','subreddit_rules','reddit_sync_checkpoints','reddit_posts','reddit_jobs',
    'opportunities','drafts','draft_jobs','draft_versions','draft_claims','draft_compliance_checks',
    'draft_feedback','tracking_settings','tracking_links','tracking_clicks','conversion_events',
    'conversion_api_keys','subscriptions','usage_counters','ai_task_usage','billing_checkout_requests',
    'billing_events','organization_data_requests','privacy_jobs','notification_preferences',
    'notification_deliveries','extension_sessions','responsible_use_acceptances','audit_logs'] loop
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relrowsecurity) then
      raise exception 'RUNTIME_REQUIRES_RLS_TABLE';
    end if;
    execute format('create policy runtime_worker_read on public.%I for select to threadsignal_runtime_worker using(true)',t);
  end loop;
  foreach t in array array['knowledge_sources','knowledge_documents','knowledge_chunks','knowledge_jobs','reddit_jobs',
    'draft_jobs','privacy_jobs','subreddits','reddit_sync_checkpoints','reddit_posts',
    'opportunities','organization_data_requests'] loop
    execute format('create policy runtime_worker_update on public.%I for update to threadsignal_runtime_worker using(true) with check(true)',t);
  end loop;
  foreach t in array array['knowledge_documents','knowledge_chunks','subreddit_rules','reddit_sync_checkpoints','reddit_posts'] loop
    execute format('create policy runtime_worker_insert on public.%I for insert to threadsignal_runtime_worker with check(true)',t);
  end loop;
  foreach t in array array['knowledge_documents','knowledge_chunks','subreddit_rules'] loop
    execute format('create policy runtime_worker_delete on public.%I for delete to threadsignal_runtime_worker using(true)',t);
  end loop;
end $$;
create policy runtime_worker_draft_failure on public.drafts for update to threadsignal_runtime_worker
  using(true) with check(status='error' and approved_at is null and approved_by is null);
create policy runtime_worker_source_delete on public.knowledge_sources for delete
  to threadsignal_runtime_worker using(deleted_at is not null and status='deleting');
create policy runtime_worker_notification_retention on public.notification_deliveries for delete
  to threadsignal_runtime_worker using(status in ('sent','suppressed','failed') and updated_at<now()-interval '30 days');
create policy runtime_worker_audit_retention on public.audit_logs for delete
  to threadsignal_runtime_worker using(created_at<now()-interval '180 days');
create policy runtime_worker_click_retention on public.tracking_clicks for delete
  to threadsignal_runtime_worker using(occurred_at<now()-interval '400 days');
grant select(id,bucket_id,name,created_at) on storage.objects to threadsignal_runtime_worker;
create policy runtime_worker_storage_metadata on storage.objects for select
  to threadsignal_runtime_worker using(bucket_id in ('knowledge-private','privacy-exports'));

grant execute on function public.worker_lock_knowledge_organization(uuid),public.worker_knowledge_dispatch(integer),
  private.billing_plan_active(uuid),private.queue_reddit_job(text,uuid,text,uuid,uuid,uuid),
  private.purge_reddit_post(uuid),private.publish_opportunity(uuid,uuid,jsonb),
  private.require_draft_available(uuid),private.draft_context_checksum(uuid),
  private.publish_draft_generation(uuid,uuid,text,jsonb),private.publish_draft_verification(uuid,uuid,text,jsonb),
  private.publish_draft_compliance(uuid,uuid,text,jsonb),private.refresh_attribution_analytics(integer),
  private.claim_notification(uuid,uuid),private.finish_notification(uuid,uuid,text,text,text,text),
  private.maintain_billing_periods(integer),private.schedule_notifications(integer),
  private.claim_privacy_job(uuid,uuid),private.finish_privacy_export(uuid,uuid,integer,text),
  private.finish_organization_deletion(uuid,uuid),private.fail_privacy_job(uuid,uuid,text),
  private.maintain_platform_operations(integer),private.cleanup_expired_extension_sessions(),
  private.cleanup_expired_invitations(integer),private.record_ai_usage(uuid,uuid,uuid,text,jsonb),
  private.record_draft_attempt_usage(uuid,integer,uuid,jsonb)
  to threadsignal_runtime_worker;

-- A fresh role must not accidentally acquire sensitive PUBLIC privileges or creation
-- rights from a project that differs from the reviewed application baseline.
do $$ declare role_name text; begin
  foreach role_name in array array['threadsignal_runtime_worker','threadsignal_runtime_web'] loop
    if has_database_privilege(role_name,current_database(),'CREATE') or exists(
      select 1 from pg_catalog.pg_namespace n where n.nspname !~ '^pg_(toast_)?temp_'
        and has_schema_privilege(role_name,n.oid,'CREATE')) then
      raise exception 'RUNTIME_HAS_UNEXPECTED_CREATION_PRIVILEGES';
    end if;
    if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where (n.nspname='auth' or (n.nspname='public' and c.relname in ('profiles','extension_connection_codes')))
        and c.relkind in ('r','p','v','m')
        and (has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          or has_table_privilege(role_name,c.oid,'DELETE,TRUNCATE,TRIGGER'))) then
      raise exception 'RUNTIME_HAS_UNEXPECTED_IDENTITY_ACCESS';
    end if;
    if has_column_privilege(role_name,'public.organization_invitations','token_hash','SELECT')
      or has_column_privilege(role_name,'public.extension_sessions','token_hash','SELECT')
      or has_column_privilege(role_name,'public.conversion_api_keys','key_hash','SELECT')
      or has_column_privilege(role_name,'public.tracking_clicks','receipt_hash','SELECT')
      or has_column_privilege(role_name,'public.subscriptions','provider_customer_id','SELECT') then
      raise exception 'RUNTIME_HAS_UNEXPECTED_SECRET_ACCESS';
    end if;
  end loop;
end $$;
