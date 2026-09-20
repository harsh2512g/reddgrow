import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { operationsJson, operationsQuery, operationsSession } from './http';
import { checked, OperationsError } from './errors';
import {
  exportDownloadSchema,
  privacyCreatedSchema,
  privacyRequestsSchema,
} from './privacy-schema';

export async function privacyRequests(request: Request) {
  const { supabase } = await operationsSession(request);
  const input = z.object({ organizationId: z.uuid() }).strict().parse(operationsQuery(request));
  return privacyRequestsSchema.parse(
    checked(
      await supabase.rpc('list_organization_data_requests', {
        p_organization_id: input.organizationId,
      }),
    ),
  );
}
export async function privacyCreate(request: Request) {
  const { supabase } = await operationsSession(request, true);
  const input = await operationsJson(
    request,
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('export'), organizationId: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal('deletion'),
          organizationId: z.uuid(),
          confirmation: z.string().min(3).max(48),
        })
        .strict(),
    ]),
  );
  if (request.headers.get('x-threadsignal-organization') !== input.organizationId)
    throw new OperationsError('WORKSPACE_CHANGED', 409);
  // These owner-only RPCs reauthorize membership in the same transaction as the request.
  const id =
    input.kind === 'export'
      ? checked(
          await supabase.rpc('begin_organization_export', {
            p_organization_id: input.organizationId,
          }),
        )
      : checked(
          await supabase.rpc('confirm_organization_deletion', {
            p_organization_id: input.organizationId,
            p_confirmation: input.confirmation,
          }),
        );
  return privacyCreatedSchema.parse({ id });
}
export async function privacyRevoke(request: Request, id: string) {
  const { supabase } = await operationsSession(request, true);
  const input = await operationsJson(request, z.object({ organizationId: z.uuid() }).strict());
  if (request.headers.get('x-threadsignal-organization') !== input.organizationId)
    throw new OperationsError('WORKSPACE_CHANGED', 409);
  const requests = privacyRequestsSchema.parse(
    checked(
      await supabase.rpc('list_organization_data_requests', {
        p_organization_id: input.organizationId,
      }),
    ),
  );
  if (!requests.some((item) => item.id === id && item.kind === 'export'))
    throw new OperationsError('NOT_FOUND', 404);
  checked(await supabase.rpc('revoke_organization_export', { p_request_id: z.uuid().parse(id) }));
  return { id };
}
export async function privacyDownload(request: Request, id: string) {
  const { supabase } = await operationsSession(request);
  const artifact = exportDownloadSchema.parse(
    checked(await supabase.rpc('get_organization_export', { p_request_id: z.uuid().parse(id) })),
  );
  if (!new RegExp(`^[a-f0-9-]{36}/${artifact.id}/[a-f0-9-]{36}\\.json\\.gz$`).test(artifact.path))
    throw new OperationsError('EXPORT_UNAVAILABLE', 409);
  const result = await supabase.storage.from(artifact.bucket).download(artifact.path);
  if (result.error || !result.data || result.data.size !== artifact.bytes)
    throw new OperationsError('EXPORT_UNAVAILABLE', 409);
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
    throw new OperationsError('EXPORT_UNAVAILABLE', 409);
  // Recheck access after object retrieval; revocation during download cannot leak the buffered artifact.
  const current = exportDownloadSchema.parse(
    checked(await supabase.rpc('get_organization_export', { p_request_id: artifact.id })),
  );
  if (current.path !== artifact.path || current.sha256 !== artifact.sha256)
    throw new OperationsError('EXPORT_UNAVAILABLE', 409);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="threadsignal-export-${artifact.id}.json.gz"`,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
