import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { loadWorkspaceChrome } from '@/lib/onboarding/server';
import { switchOrganizationAction } from './actions';
import { logoutAction } from '../login/actions';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const workspace = await loadWorkspaceChrome();
  return (
    <AppShell
      organizations={workspace.organizations.map(({ id, name, role }) => ({ id, name, role }))}
      activeOrganizationId={workspace.active?.id ?? ''}
      user={{ email: workspace.user.email ?? 'Signed in' }}
      switchAction={switchOrganizationAction}
      logoutAction={logoutAction}
      trialLabel={workspace.planName}
      tools={{
        brands: workspace.brands,
        draftUsage: workspace.draftUsage,
        knowledgeEnabled: workspace.knowledgeEnabled,
      }}
    >
      {children}
    </AppShell>
  );
}
