import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupSteps, brandDestination, type SetupSnapshot } from '../src/lib/onboarding/model';
import { SetupChecklist } from '../src/components/onboarding/checklist';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const empty: SetupSnapshot = {
  brandId: null,
  knowledgeReady: 0,
  knowledgePending: 0,
  knowledgeFailed: 0,
  communities: 0,
  keywords: 0,
  opportunities: 0,
  pipelineEnabled: true,
};
describe('guided workspace setup', () => {
  it('never equates workspace creation or a queued source with completed setup', () => {
    expect(setupSteps(empty).filter((step) => step.complete)).toHaveLength(1);
    const pending = setupSteps({ ...empty, brandId: 'brand-id', knowledgePending: 1 });
    expect(pending.find((step) => step.key === 'knowledge')).toMatchObject({
      complete: false,
      enabled: true,
    });
    expect(pending.find((step) => step.key === 'knowledge')?.description).toContain('processing');
  });
  it('requires all saved stages and exposes errors rather than fake progress', () => {
    const failed = setupSteps({ ...empty, brandId: 'brand-id', knowledgeFailed: 1 });
    expect(failed.find((step) => step.key === 'knowledge')?.description).toContain(
      'needs attention',
    );
    const completed = setupSteps({
      ...empty,
      brandId: 'brand-id',
      knowledgeReady: 1,
      communities: 1,
      keywords: 1,
      opportunities: 1,
    });
    expect(completed.every((step) => step.complete)).toBe(true);
  });
  it('preserves hosted phase gates and does not give a viewer setup mutations', () => {
    render(
      <SetupChecklist
        state={{ ...empty, brandId: 'brand-id', pipelineEnabled: false }}
        canManage={false}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Choose communities' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review brand' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '33');
    expect(screen.getByText(/Community processing is not enabled/)).toBeInTheDocument();
  });
  it('changes brands through collection routes without stale resource IDs or filter state', () => {
    expect(brandDestination('/app/opportunities/old-opportunity', 'next-brand')).toBe(
      '/app/opportunities?brandId=next-brand',
    );
    expect(brandDestination('/app/settings/organization', 'next-brand')).toBe(
      '/app/onboarding?brandId=next-brand',
    );
    expect(brandDestination('/app/opportunities-unsafe', 'next-brand')).toBe(
      '/app/onboarding?brandId=next-brand',
    );
  });
});
