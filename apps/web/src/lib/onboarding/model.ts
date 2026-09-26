export type SetupSnapshot = {
  brandId: string | null;
  knowledgeReady: number;
  knowledgePending: number;
  knowledgeFailed: number;
  communities: number;
  keywords: number;
  opportunities: number;
  pipelineEnabled: boolean;
};

export function setupSteps(state: SetupSnapshot) {
  const query = state.brandId ? `?brandId=${encodeURIComponent(state.brandId)}` : '';
  return [
    {
      key: 'workspace',
      title: 'Create your workspace',
      complete: true,
      description: 'Your organization and membership are saved.',
      href: '/app/settings/organization',
      action: 'Review workspace',
    },
    {
      key: 'brand',
      title: 'Describe your product',
      complete: Boolean(state.brandId),
      description: 'Add your audience, competitors, product links and truthful affiliation.',
      href: state.brandId ? `/app/brands/${state.brandId}/edit` : '/app/brands/new',
      action: state.brandId ? 'Review brand' : 'Create your first brand',
    },
    {
      key: 'knowledge',
      title: 'Build your knowledge base',
      complete: state.knowledgeReady > 0,
      description:
        state.knowledgePending > 0
          ? `${state.knowledgePending} source(s) are processing. Review the extracted evidence when ready.`
          : state.knowledgeFailed > 0
            ? 'A source needs attention. Open its error details and retry after fixing it.'
            : 'Import approved website pages or private files, then review the extracted evidence.',
      href: `/app/knowledge${query}`,
      action: state.knowledgeReady ? 'Review knowledge' : 'Add product knowledge',
    },
    {
      key: 'communities',
      title: 'Choose communities',
      complete: state.communities > 0,
      description: 'Select relevant communities and review their rules before participating.',
      href: `/app/subreddits${query}`,
      action: 'Choose communities',
    },
    {
      key: 'keywords',
      title: 'Set keywords and intent',
      complete: state.keywords > 0,
      description:
        'Choose active product, problem and recommendation terms; add exclusions where needed.',
      href: `/app/keywords${query}`,
      action: 'Choose keywords',
    },
    {
      key: 'opportunities',
      title: 'Review your first opportunities',
      complete: state.opportunities > 0,
      description:
        state.opportunities > 0
          ? 'Scored conversations are ready. Read the score and community context before drafting.'
          : 'The worker imports and scores conversations from active communities. Progress updates automatically.',
      href: `/app/opportunities${query}`,
      action: 'Open opportunity feed',
    },
  ].map((step) => ({
    ...step,
    enabled:
      step.key === 'workspace' ||
      step.key === 'brand' ||
      (Boolean(state.brandId) && (step.key === 'knowledge' || state.pipelineEnabled)),
  }));
}

export const brandRoutes = [
  '/app/onboarding',
  '/app/knowledge',
  '/app/opportunities',
  '/app/drafts',
  '/app/subreddits',
  '/app/keywords',
  '/app/analytics',
  '/app/tracking',
  '/app/settings/persona',
  '/app/settings/integrations',
] as const;

/** Never carry an old brand's detail ID, filters or pagination into another brand. */
export function brandDestination(pathname: string, brandId: string) {
  const route = brandRoutes.find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  return `${route ?? '/app/onboarding'}?brandId=${encodeURIComponent(brandId)}`;
}
