import 'server-only';
import { z } from 'zod';
import { extensionSessionSchema } from '@threadsignal/extension-contracts';
import type { requireOrganization } from '../organizations/server';
import { localDraftsEnabled } from '../phase4/server';
import { extensionId } from './policy';
export async function loadExtensionSettings(
  context: Awaited<ReturnType<typeof requireOrganization>>,
) {
  const enabled = localDraftsEnabled();
  const result =
    enabled && context.organization.role !== 'viewer'
      ? await context.supabase.rpc('list_extension_sessions', {
          p_organization_id: context.organization.id,
        })
      : { data: [], error: null };
  if (result.error) throw new Error('Extension connections could not be loaded.');
  return {
    enabled,
    organizationId: context.organization.id,
    userId: context.user.id,
    role: context.organization.role,
    initialSessions: z.array(extensionSessionSchema).parse(result.data),
    extensionId,
  };
}
