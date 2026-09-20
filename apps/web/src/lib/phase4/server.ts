import 'server-only';
import { z } from 'zod';
import { notFound } from 'next/navigation';
import { personaInputSchema } from '@threadsignal/drafts';
import {
  reportDatabaseReadFailure,
  type DatabaseReadOperation,
} from '../database-read-diagnostics';
import { loadSignalWorkspace, loadOpportunity, localOpportunitiesEnabled } from '../phase3/server';
import { usageSchema } from '../phase3/schema';
import { draftRecordSchema, draftFiltersSchema, draftDetailSchema } from './schema';
export const localDraftsEnabled = localOpportunitiesEnabled;
export const draftColumns =
  'id,organization_id,brand_id,opportunity_id,persona_id,status,current_version,verified_version,current_content,strategy,brand_mentioned,disclosure_included,verification_status,compliance_status,approved_by,approved_at,inserted_at,inserted_version,published_at,published_version,published_comment_url,rejection_reason,error_code,purged_at,created_at,updated_at' as const;
export const personaColumns =
  'id,brand_id,name,real_role,tone,custom_tone,reply_length,default_disclosure,technical_depth,allowed_first_person_statements,prohibited_statements' as const;
export function readResult<T>(
  result: { data: T; error: unknown; status?: number },
  operation: DatabaseReadOperation,
) {
  if (result.error) {
    reportDatabaseReadFailure(operation, result.error, result.status);
    throw new Error('Draft workspace data could not be loaded.');
  }
  return result.data;
}
export function readPersona(input: unknown) {
  return personaInputSchema.parse(input);
}
export async function loadDrafts(input: unknown = {}) {
  const parsed = draftFiltersSchema.safeParse(input);
  const filters = parsed.success ? parsed.data : draftFiltersSchema.parse({});
  let invalidFilters = !parsed.success;
  let cursor: { created_at: string; id: string } | undefined;
  if (filters.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(filters.cursor)) throw new Error();
      cursor = z
        .object({ created_at: z.iso.datetime({ offset: true }), id: z.uuid() })
        .strict()
        .parse(JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8')));
    } catch {
      invalidFilters = true;
    }
  }
  const workspace = await loadSignalWorkspace(filters.brandId);
  let drafts: z.infer<typeof draftRecordSchema>[] = [];
  let titles: Array<{ id: string; summary: string }> = [];
  let usage: z.infer<typeof usageSchema> | null = null;
  let nextCursor: string | null = null;
  if (workspace.enabled) {
    let query = workspace.supabase
      .from('drafts')
      .select(draftColumns)
      .eq('organization_id', workspace.organization.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(51);
    if (workspace.brand) query = query.eq('brand_id', workspace.brand.id);
    if (filters.status) query = query.eq('status', filters.status);
    if (cursor)
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    if (filters.q)
      query = query.ilike('current_content', `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
    const rows = !invalidFilters
      ? z.array(draftRecordSchema).parse(readResult(await query, 'drafts.list'))
      : [];
    drafts = rows.slice(0, 50);
    const last = drafts.at(-1);
    if (rows.length > 50 && last)
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: last.created_at, id: last.id }),
      ).toString('base64url');
    if (drafts.length)
      titles = z.array(z.object({ id: z.uuid(), summary: z.string() })).parse(
        readResult(
          await workspace.supabase
            .from('opportunities')
            .select('id,summary')
            .eq('organization_id', workspace.organization.id)
            .in(
              'id',
              drafts.map((d) => d.opportunity_id),
            ),
          'drafts.titles',
        ),
      );
    usage = usageSchema.parse(
      readResult(
        await workspace.supabase.rpc('get_draft_usage', {
          p_organization_id: workspace.organization.id,
        }),
        'drafts.usage',
      ),
    );
  }
  return { ...workspace, drafts, titles, filters, invalidFilters, usage, nextCursor };
}
export async function loadPersona(brandId?: string) {
  const workspace = await loadSignalWorkspace(brandId);
  const persona = workspace.brand
    ? readPersona(
        readResult(
          await workspace.supabase
            .from('brand_personas')
            .select(personaColumns)
            .eq('organization_id', workspace.organization.id)
            .eq('brand_id', workspace.brand.id)
            .single(),
          'drafts.persona',
        ),
      )
    : null;
  return { ...workspace, persona };
}
export async function loadDraft(id: string) {
  const workspace = await loadSignalWorkspace();
  if (!workspace.enabled) return { ...workspace, detail: null };
  if (!z.uuid().safeParse(id).success) notFound();
  const row = readResult(
    await workspace.supabase
      .from('drafts')
      .select(draftColumns)
      .eq('organization_id', workspace.organization.id)
      .eq('id', id)
      .maybeSingle(),
    'drafts.detail',
  );
  if (!row) notFound();
  const draft = draftRecordSchema.parse(row);
  const { supabase, organization } = workspace;
  const results = await Promise.all([
    supabase
      .from('draft_versions')
      .select('id,version,content,source,instruction,created_by,created_at')
      .eq('organization_id', organization.id)
      .eq('draft_id', id)
      .order('version', { ascending: false })
      .limit(200),
    supabase
      .from('draft_claims')
      .select(
        'id,draft_version_id,claim_text,status,confidence,explanation,source_chunk_ids,provenance,evidence_kind',
      )
      .eq('organization_id', organization.id)
      .eq('draft_id', id)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('draft_compliance_checks')
      .select('id,draft_version_id,status,checks,safe_to_approve,created_at')
      .eq('organization_id', organization.id)
      .eq('draft_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('draft_jobs')
      .select('id,kind,version,status,attempts,error_code,created_at')
      .eq('organization_id', organization.id)
      .eq('draft_id', id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('brand_personas')
      .select(personaColumns)
      .eq('organization_id', organization.id)
      .eq('id', draft.persona_id)
      .single(),
    supabase.rpc('get_draft_review', { p_draft_id: id }),
  ]);
  const opportunity = await loadOpportunity(draft.opportunity_id);
  return {
    ...workspace,
    detail: draftDetailSchema.parse({
      draft,
      versions: readResult(results[0]!, 'drafts.versions'),
      claims: readResult(results[1]!, 'drafts.claims'),
      checks: readResult(results[2]!, 'drafts.compliance'),
      jobs: readResult(results[3]!, 'drafts.jobs'),
      persona: readPersona(readResult(results[4]!, 'drafts.persona')),
      review: readResult(results[5]!, 'drafts.review'),
      opportunity: opportunity.opportunity,
      rules: opportunity.rules,
    }),
  };
}
