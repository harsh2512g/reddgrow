import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityStudio } from '../src/components/phase3/communities';
import { KeywordStudio } from '../src/components/phase3/keywords';
import {
  OpportunityActions,
  OpportunityFeed,
  OpportunityWorkspace,
  filterHref,
} from '../src/components/phase3/opportunities';
import { LocalSignalsNotice } from '../src/components/phase3/primitives';
import { SignalLoading } from '../src/components/phase3/loading';
import { feedFilterSchema, monitoringSchema, opportunitySchema } from '../src/lib/phase3/schema';
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const organizationId = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const subredditId = '44444444-4444-4444-8444-444444444444';
const sourceId = '55555555-5555-4555-8555-555555555555';
const community = {
  id: subredditId,
  name: 'saas',
  display_name: 'SaaS',
  description: 'Synthetic SaaS community',
  subscriber_count: 1000,
  is_nsfw: false,
  last_synced_at: null,
};
const monitoring = monitoringSchema.parse({
  id: targetId,
  organization_id: organizationId,
  brand_id: brandId,
  subreddit_id: subredditId,
  status: 'active',
  priority: 3,
  minimum_score: 40,
  risk_level: 'low',
  product_relevance: 75,
  allowed_reply_style: 'helpful',
  internal_notes: 'Answer the question first.',
  internal_interpretation: 'Disclose affiliations.',
  monitor_new: true,
  monitor_hot: true,
  monitor_rising: true,
  subreddit: community,
});
const opportunity = opportunitySchema.parse({
  id: targetId,
  organization_id: organizationId,
  brand_id: brandId,
  subreddit_id: subredditId,
  status: 'new',
  summary: 'A team needs an image optimization API.',
  user_need: 'Batch processing with clear limitations',
  intent_category: 'recommendation',
  risk_level: 'low',
  semantic_relevance: 90,
  buying_intent: 95,
  freshness: 90,
  engagement_velocity: 70,
  rule_fit: 90,
  competitor_context: 50,
  penalty_score: 0,
  final_score: 86,
  suggested_action: 'reply',
  is_blocked: false,
  risk_reasons: [],
  matched_capabilities: ['Batch processing'],
  missing_capabilities: ['Unlimited image reconstruction'],
  matched_competitor_ids: [],
  reasoning_summary: 'Relevant product knowledge supports the stated need.',
  knowledge_citations: [
    {
      chunk_id: sourceId,
      source_id: sourceId,
      title: 'Batch guide',
      source_url: 'https://clarityscale.example/docs',
      excerpt: 'The image API supports asynchronous batch processing.',
    },
  ],
  evaluated_at: '2026-09-18T00:00:00Z',
  created_at: '2026-09-18T00:00:00Z',
  post: {
    id: targetId,
    title: 'Looking for a batch image API',
    body: 'Our team needs to optimize batches of images.',
    permalink: 'https://www.reddit.com/r/SaaS/comments/fixture/',
    created_at_provider: '2026-09-18T00:00:00Z',
    score: 12,
    num_comments: 4,
    is_deleted: false,
    is_locked: false,
    is_archived: false,
  },
  subreddit: community,
});
const feedProps = {
  items: [opportunity],
  filters: feedFilterSchema.parse({ brandId }),
  nextCursor: null,
  organizationId,
  canAct: true,
  communities: [community],
  competitors: [],
  usage: { quantity: 1, limit: 20, plan_key: 'trial' },
  invalidFilters: false,
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});
describe('community and keyword workflows', () => {
  it('shows real empty monitoring and read-only permissions', () => {
    render(
      <CommunityStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage={false}
        communities={[]}
        rules={[]}
      />,
    );
    expect(screen.getByText('Make room for useful conversations.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add by name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest communities' })).not.toBeInTheDocument();
    expect(screen.getByText(/0 monitored communities/)).toBeInTheDocument();
  });
  it('reviews a mock community suggestion before adding it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          communities: [
            {
              name: 'SaaS',
              displayTitle: 'SaaS builders',
              description: 'Software discussion',
              isNsfw: false,
              reason: 'Relevant to your product category.',
            },
          ],
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ data: { id: targetId } }));
    render(
      <CommunityStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage
        communities={[]}
        rules={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Suggest communities' }));
    expect(await screen.findByText('Mock AI suggestion:')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Monitor community' }));
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/brands/${brandId}/subreddits`);
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-ThreadSignal-Organization'),
    ).toBe(organizationId);
  });
  it('preserves a typed community name when the plan refuses it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 'SUBREDDIT_LIMIT', message: 'Your community limit is full.' } },
        { status: 409 },
      ),
    );
    render(
      <CommunityStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage
        communities={[]}
        rules={[]}
      />,
    );
    await user.type(screen.getByLabelText('Community name'), 'SaaS');
    await user.click(screen.getByRole('button', { name: 'Add by name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your community limit is full.');
    expect(screen.getByLabelText('Community name')).toHaveValue('SaaS');
  });
  it('distinguishes unassessed community metadata from failed processing', () => {
    render(
      <CommunityStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage
        communities={[
          {
            ...monitoring,
            sync: {
              paused: false,
              failed: true,
              last_success_at: null,
              next_sync_at: '2026-09-18T00:00:00Z',
            },
          },
        ]}
        rules={[]}
      />,
    );
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.getByText(/The last sync could not finish/)).toBeInTheDocument();
    expect(screen.queryByText('medium risk')).not.toBeInTheDocument();
  });
  it('requires explicit confirmation before removing monitoring', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: targetId } }));
    render(
      <CommunityStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage
        communities={[monitoring]}
        rules={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/brand-subreddits/${targetId}`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
  it('normalizes the exclusion category into an exclusion flag', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { id: targetId } }));
    render(
      <KeywordStudio brandId={brandId} organizationId={organizationId} canManage keywords={[]} />,
    );
    await user.type(screen.getByLabelText('Keyword or phrase'), 'free credits');
    await user.selectOptions(screen.getByLabelText('Category'), 'exclusion');
    await user.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      value: 'free credits',
      kind: 'exclusion',
      is_exclusion: true,
    });
  });
  it('shows preview terms and exclusions without permitting viewer edits', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({
        data: {
          matches: [
            {
              post: {
                id: 'mock',
                title: 'Need an image API',
                body: 'An image API with free credits',
                subreddit: 'SaaS',
              },
              matched_terms: ['image API'],
              excluded_terms: ['free credits'],
              matched: false,
            },
          ],
        },
      }),
    );
    render(
      <KeywordStudio
        brandId={brandId}
        organizationId={organizationId}
        canManage={false}
        keywords={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add keyword' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview matching posts' }));
    expect(await screen.findByText('Need an image API')).toBeInTheDocument();
    expect(screen.getByText(/Exclusions: free credits/)).toBeInTheDocument();
  });
});
describe('opportunity review states', () => {
  it('prevents blocked save and monitor actions and hides viewer controls', () => {
    const { rerender } = render(
      <OpportunityActions
        item={{ ...opportunity, is_blocked: true, status: 'blocked' }}
        organizationId={organizationId}
        canAct
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Monitor' })).toBeDisabled();
    rerender(
      <OpportunityActions item={opportunity} organizationId={organizationId} canAct={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Viewer access · Read only')).toBeInTheDocument();
  });
  it('submits only selected visible items and the chosen dismissal reason', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ data: { count: 1 } }));
    render(<OpportunityFeed {...feedProps} />);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    await user.click(screen.getByLabelText(`Select ${opportunity.post.title}`));
    await user.selectOptions(screen.getByLabelText('Bulk dismissal reason'), 'product_cannot_help');
    await user.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    expect(await screen.findByText('1 opportunities dismissed.')).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ids: [targetId],
      reason: 'product_cannot_help',
    });
    expect(screen.getByLabelText(`Select ${opportunity.post.title}`)).not.toBeChecked();
  });
  it('exposes table navigation, filters, and stable next-page links', () => {
    render(
      <OpportunityFeed
        {...feedProps}
        filters={{ ...feedProps.filters, view: 'table' }}
        nextCursor="encoded_cursor"
        canAct={false}
      />,
    );
    expect(screen.getByRole('table', { name: 'Scored opportunities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      expect.stringContaining('cursor=encoded_cursor'),
    );
    expect(screen.getByLabelText('Minimum score')).toHaveValue(40);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(filterHref({ ...feedProps.filters, cursor: 'old' }, { risk: 'high' })).not.toContain(
      'cursor=old',
    );
  });
  it('renders honest empty and invalid-filter states, then resets controls on navigation', () => {
    const { rerender } = render(<OpportunityFeed {...feedProps} items={[]} invalidFilters />);
    expect(screen.getByText('A quieter radar, for now.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Some filters are invalid');
    fireEvent.change(screen.getByLabelText('Minimum score'), { target: { value: '75' } });
    rerender(
      <OpportunityFeed {...feedProps} filters={{ ...feedProps.filters, minimumScore: 10 }} />,
    );
    expect(screen.getByLabelText('Minimum score')).toHaveValue(10);
  });
  it('shows viewer evidence without generation or submission controls', () => {
    render(
      <OpportunityWorkspace
        item={opportunity}
        rules={[]}
        organizationId={organizationId}
        canAct={false}
        monitoring={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'An explainable score.' })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(6);
    expect(screen.getByText(/Unlimited image reconstruction/)).toBeInTheDocument();
    expect(screen.getByText('Batch guide')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /generate|publish|submit/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/every final Reddit submission stays manual/i)).toBeInTheDocument();
  });
  it('never renders unsafe source URLs as clickable links', () => {
    render(
      <OpportunityWorkspace
        item={{ ...opportunity, post: { ...opportunity.post, permalink: 'javascript:alert(1)' } }}
        rules={[]}
        organizationId={organizationId}
        canAct={false}
        monitoring={null}
      />,
    );
    expect(
      screen.queryByRole('link', { name: 'Original Reddit URL (fixture)' }),
    ).not.toBeInTheDocument();
  });
  it.each(['/app/opportunities', '/app/subreddits', '/app/keywords'] as const)(
    'preserves the local tab destination %s and announces loading accessibly',
    (destination) => {
      const { unmount } = render(<LocalSignalsNotice destination={destination} />);
      expect(screen.getByRole('link', { name: /Continue to local/ })).toHaveAttribute(
        'href',
        `http://127.0.0.1:3000${destination}`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      unmount();
      render(<SignalLoading />);
      expect(screen.getByRole('status', { name: 'Loading conversation radar' })).toHaveTextContent(
        'Loading your communities and opportunities',
      );
    },
  );
});
