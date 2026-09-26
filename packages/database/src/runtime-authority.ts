import type { Sql } from 'postgres';

const workerTables = [
  'organizations',
  'organization_members',
  'organization_invitations',
  'brands',
  'brand_competitors',
  'brand_personas',
  'brand_keywords',
  'brand_subreddits',
  'knowledge_sources',
  'knowledge_documents',
  'knowledge_chunks',
  'knowledge_jobs',
  'subreddits',
  'subreddit_rules',
  'reddit_sync_checkpoints',
  'reddit_posts',
  'reddit_jobs',
  'opportunities',
  'drafts',
  'draft_jobs',
  'draft_versions',
  'draft_claims',
  'draft_compliance_checks',
  'draft_feedback',
  'tracking_settings',
  'tracking_links',
  'tracking_clicks',
  'conversion_events',
  'conversion_api_keys',
  'subscriptions',
  'usage_counters',
  'ai_task_usage',
  'billing_checkout_requests',
  'billing_events',
  'organization_data_requests',
  'privacy_jobs',
  'notification_preferences',
  'notification_deliveries',
  'extension_sessions',
  'responsible_use_acceptances',
  'audit_logs',
] as const;

const workerFunctions = [
  'public.worker_lock_knowledge_organization(uuid)',
  'public.worker_knowledge_dispatch(integer)',
  'private.billing_plan_active(uuid)',
  'private.queue_reddit_job(text,uuid,text,uuid,uuid,uuid)',
  'private.purge_reddit_post(uuid)',
  'private.publish_opportunity(uuid,uuid,jsonb)',
  'private.require_draft_available(uuid)',
  'private.draft_context_checksum(uuid)',
  'private.publish_draft_generation(uuid,uuid,text,jsonb)',
  'private.publish_draft_verification(uuid,uuid,text,jsonb)',
  'private.publish_draft_compliance(uuid,uuid,text,jsonb)',
  'private.refresh_attribution_analytics(integer)',
  'private.claim_notification(uuid,uuid)',
  'private.finish_notification(uuid,uuid,text,text,text,text)',
  'private.maintain_billing_periods(integer)',
  'private.schedule_notifications(integer)',
  'private.claim_privacy_job(uuid,uuid)',
  'private.finish_privacy_export(uuid,uuid,integer,text)',
  'private.finish_organization_deletion(uuid,uuid)',
  'private.fail_privacy_job(uuid,uuid,text)',
  'private.maintain_platform_operations(integer)',
  'private.cleanup_expired_extension_sessions()',
  'private.cleanup_expired_invitations(integer)',
  'private.record_ai_usage(uuid,uuid,uuid,text,jsonb)',
  'private.record_draft_attempt_usage(uuid,integer,uuid,jsonb)',
] as const;

const bridgeFunctions = {
  threadsignal_extension_api: [
    'private.exchange_extension_code(text,text,text)',
    'private.extension_current(text,text,text,text,uuid)',
    'private.extension_save_draft(text,text,uuid,integer,text)',
    'private.extension_prepare_handoff(text,text,uuid,integer,text,text)',
    'private.extension_mark_inserted(text,text,uuid,integer,text,text)',
    'private.extension_mark_published(text,text,uuid,integer,text,text,text)',
    'private.disconnect_extension(text,text)',
    'private.cleanup_expired_extension_sessions()',
  ],
  threadsignal_tracking_api: [
    'private.tracking_redirect(text,uuid,text,text,boolean)',
    'private.ingest_conversion(text,text,text,jsonb,boolean)',
    'private.tracking_browser_origin_allowed(uuid,text,boolean)',
  ],
  threadsignal_billing_api: [
    'private.record_ai_usage(uuid,uuid,uuid,text,jsonb)',
    'private.register_billing_session(uuid,text,text,text)',
    'private.apply_billing_event(jsonb)',
    'public.complete_mock_checkout(uuid,uuid)',
    'public.manage_mock_subscription(uuid,text,text)',
  ],
} as const;

const workerWrites = {
  organizations: { UPDATE: 'id' },
  brands: { UPDATE: 'id' },
  knowledge_sources: { UPDATE: 'status,error_code,page_count,chunk_count,last_ingested_at' },
  knowledge_jobs: {
    UPDATE: 'status,attempts,available_at,lease_token,lease_expires_at,error_code',
  },
  reddit_jobs: { UPDATE: 'status,attempts,available_at,lease_token,lease_expires_at,error_code' },
  draft_jobs: { UPDATE: 'status,attempts,available_at,lease_token,lease_expires_at,error_code' },
  privacy_jobs: { UPDATE: 'status,attempts,available_at,lease_token,lease_expires_at,error_code' },
  knowledge_documents: {
    INSERT:
      'id,organization_id,brand_id,source_id,document_key,title,canonical_url,page_number,section_heading,content,checksum,embedding_identity',
    UPDATE: 'title,canonical_url,page_number,section_heading,content,checksum,embedding_identity',
  },
  knowledge_chunks: {
    INSERT:
      'organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,checksum,embedding,section_heading,embedding_identity',
    UPDATE: 'embedding_identity',
  },
  subreddits: {
    UPDATE: 'provider,display_name,description,subscriber_count,is_nsfw,last_synced_at',
  },
  subreddit_rules: {
    INSERT: 'subreddit_id,provider_rule_id,title,description,kind,applies_to,raw_data',
  },
  reddit_sync_checkpoints: {
    INSERT:
      'subreddit_id,sort,cursor,last_success_at,next_sync_at,last_rules_sync_at,last_error_at,consecutive_errors,error_code,provider_paused,provider_retry_at',
    UPDATE:
      'cursor,last_success_at,next_sync_at,last_rules_sync_at,last_post_refresh_at,last_error_at,consecutive_errors,error_code,provider_paused,provider_retry_at',
  },
  reddit_posts: {
    INSERT:
      'provider,provider_post_id,subreddit_id,permalink,title,body,author_name,created_at_provider,score,num_comments,upvote_ratio,flair,is_nsfw,is_locked,is_archived,is_edited',
    UPDATE:
      'permalink,title,body,author_name,score,num_comments,upvote_ratio,flair,is_nsfw,is_locked,is_archived,is_edited,created_at_provider,last_synced_at',
  },
  opportunities: { UPDATE: 'status,suggested_action' },
  drafts: { UPDATE: 'status,error_code,verified_version,approved_at,approved_by' },
  organization_data_requests: { UPDATE: 'status' },
} as const;
const workerDeleteTables = [
  'knowledge_sources',
  'knowledge_documents',
  'knowledge_chunks',
  'subreddit_rules',
  'notification_deliveries',
  'audit_logs',
  'tracking_clicks',
];
const writeCapabilities = Object.entries(workerWrites).flatMap(([table_name, privileges]) =>
  Object.entries(privileges).flatMap(([privilege, columns]) =>
    columns.split(',').map((column_name) => ({ table_name, privilege, column_name })),
  ),
);

/** Verify catalog authority before serving traffic; no credential or customer row is read. */
export async function verifyDeploymentDatabaseAuthority(
  sql: Sql,
  runtime: 'web' | 'worker',
): Promise<void> {
  const roleName = `threadsignal_runtime_${runtime}`;
  try {
    const [identity] = await sql`select r.oid from pg_catalog.pg_roles r
      where r.rolname=${roleName} and r.rolname=current_user
        and pg_catalog.shobj_description(r.oid,'pg_authid')=${`ThreadSignal deployment ${runtime} runtime v1`}
        and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole and not r.rolinherit
        and not r.rolreplication and not r.rolbypassrls and r.rolconnlimit=${runtime === 'web' ? 8 : 4}
        and not has_database_privilege(r.oid,current_database(),'CREATE')
        and not exists(select 1 from pg_catalog.pg_namespace n where n.nspname !~ '^pg_(toast_)?temp_'
          and (n.nspowner=r.oid or has_schema_privilege(r.oid,n.oid,'CREATE')))
        and not exists(select 1 from pg_catalog.pg_class c where c.relowner=r.oid)
        and not exists(select 1 from pg_catalog.pg_proc p where p.proowner=r.oid)
        and not exists(select 1 from pg_catalog.pg_type t where t.typowner=r.oid)
        and not exists(select 1 from pg_catalog.pg_database d where d.datdba=r.oid)`;
    if (!identity) throw new Error();
    const memberships = await sql`select r.rolname,m.inherit_option,m.set_option,m.admin_option,
      r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
      exists(select 1 from pg_catalog.pg_auth_members inherited where inherited.member=r.oid) as nested
      from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.roleid
      where m.member=${identity.oid}`;
    const expected = runtime === 'web' ? Object.keys(bridgeFunctions) : [];
    if (
      memberships.length !== expected.length ||
      memberships.some(
        (role) =>
          !expected.includes(String(role.rolname)) ||
          role.inherit_option !== false ||
          role.set_option !== true ||
          role.admin_option !== false ||
          role.rolcanlogin !== false ||
          role.rolsuper !== false ||
          role.rolcreatedb !== false ||
          role.rolcreaterole !== false ||
          role.rolinherit !== false ||
          role.rolreplication !== false ||
          role.rolbypassrls !== false ||
          role.nested !== false,
      )
    )
      throw new Error();

    const roles = runtime === 'web' ? [roleName, ...expected] : [roleName];
    for (const role of roles) {
      const worker = role === 'threadsignal_runtime_worker';
      const [boundary] = await sql`select
        not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname in ('auth','public','private','storage') and c.relkind in ('r','p','v','m')
            and not (${worker} and ((n.nspname='public' and c.relname=any(${[...workerTables]}::text[]) and c.relrowsecurity)
              or (n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
              or (n.nspname='private' and c.relname='privacy_deletion_receipts')))
            and (has_any_column_privilege(${role},c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
              or has_table_privilege(${role},c.oid,'DELETE,TRUNCATE,TRIGGER'))) as tables_safe,
        not has_column_privilege(${role},'public.organization_invitations','token_hash','SELECT')
          and not has_column_privilege(${role},'public.extension_sessions','token_hash','SELECT')
          and not has_column_privilege(${role},'public.conversion_api_keys','key_hash','SELECT')
          and not has_column_privilege(${role},'public.tracking_clicks','receipt_hash','SELECT')
          and not has_column_privilege(${role},'public.subscriptions','provider_customer_id','SELECT')
          and not has_column_privilege(${role},'public.subscriptions','provider_subscription_id','SELECT')
          and not has_column_privilege(${role},'public.billing_checkout_requests','provider_session_id','SELECT')
          and not has_column_privilege(${role},'public.billing_checkout_requests','provider_customer_id','SELECT') as credentials_safe`;
      if (boundary?.tables_safe !== true || boundary.credentials_safe !== true) throw new Error();
      const [writes] = await sql`select not exists(
        select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        cross join unnest(array['INSERT','UPDATE','REFERENCES']) capability(privilege)
        where n.nspname in ('public','private','auth','storage') and c.relkind in ('r','p','v','m')
          and has_column_privilege(${role},c.oid,a.attnum,capability.privilege)
          and not exists(select 1 from jsonb_to_recordset(${JSON.stringify(worker ? writeCapabilities : [])}::text::jsonb)
            allowed(table_name text,column_name text,privilege text) where n.nspname='public'
              and allowed.table_name=c.relname and allowed.column_name=a.attname and allowed.privilege=capability.privilege)
        ) and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname in ('public','private','auth','storage') and c.relkind in ('r','p','v','m')
            and (has_table_privilege(${role},c.oid,'TRUNCATE,TRIGGER')
              or (has_table_privilege(${role},c.oid,'DELETE') and not (${worker}
                and ((n.nspname='public' and c.relname=any(${workerDeleteTables}::text[]))
                  or (n.nspname='private' and c.relname='privacy_deletion_receipts')))))) as safe`;
      if (writes?.safe !== true) throw new Error();
      const functions = worker
        ? [...workerFunctions]
        : role in bridgeFunctions
          ? [...bridgeFunctions[role as keyof typeof bridgeFunctions]]
          : [];
      const [routines] = await sql`with expected as (
        select p.oid from unnest(${functions}::text[]) expected_signature
        left join (select p.oid,n.nspname||'.'||p.proname||'('||replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' as signature
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace) p on p.signature=expected_signature
      ) select
        not exists(select 1 from expected e left join pg_catalog.pg_proc p on p.oid=e.oid
          where p.oid is null or not p.prosecdef or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
            or p.proconfig is distinct from array['search_path=""']::text[]
            or not has_function_privilege(${role},p.oid,'EXECUTE'))
        and not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','private') and p.prokind='f'
            and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
            and has_function_privilege(${role},p.oid,'EXECUTE') and not exists(select 1 from expected e where e.oid=p.oid)) as safe`;
      if (routines?.safe !== true) throw new Error();
    }
  } catch {
    throw new Error('DEPLOYMENT_DATABASE_AUTHORITY_INVALID');
  }
}
