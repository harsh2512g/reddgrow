import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsDashboard, MetricTiles } from '../src/components/phase6/analytics-dashboard';
import { AttributionOverview } from '../src/components/phase6/overview';
import { TrackingStudio, type TrackingStudioProps } from '../src/components/phase6/tracking-studio';
import {
  ConversionSettings,
  type ConversionSettingsProps,
} from '../src/components/phase6/conversion-settings';
import {
  analyticsFixture,
  p6ids,
  phase6Brand,
  phase6Key,
  phase6Link,
  phase6Settings,
} from './phase6-fixture';
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
let request: ReturnType<typeof vi.fn<typeof fetch>>;
let copy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  navigation.push.mockClear();
  request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});
const tracking: TrackingStudioProps = {
  enabled: true,
  organization: { id: p6ids.organization, role: 'owner' },
  canAct: true,
  brands: [phase6Brand],
  brand: phase6Brand,
  apiOrigin: 'http://127.0.0.1:3000',
  links: [],
  drafts: [
    { id: p6ids.draft, current_version: 3, title: 'A useful conversation', brand_id: p6ids.brand },
  ],
  features: { clickTracking: true, conversionTracking: true, conversionApi: true },
};
const settings: ConversionSettingsProps = {
  enabled: true,
  organization: { id: p6ids.organization },
  canManage: true,
  brands: [phase6Brand],
  brand: phase6Brand,
  apiOrigin: 'http://127.0.0.1:3000',
  keys: [],
  settings: phase6Settings,
  features: { conversionTracking: true, conversionApi: true },
};
function dashboard(report = analyticsFixture()) {
  return render(
    <AnalyticsDashboard
      enabled
      organization={{ id: p6ids.organization, name: 'Synthetic test workspace', role: 'owner' }}
      analytics={report}
      filters={report.range}
      options={{
        brands: [{ id: p6ids.brand, name: phase6Brand.name }],
        subreddits: [{ id: p6ids.subreddit, name: 'r/SaaS' }],
        opportunities: [],
        competitors: [],
      }}
    />,
  );
}
function body(index = 0) {
  return JSON.parse(String(request.mock.calls[index]?.[1]?.body)) as unknown;
}
describe('attribution analytics presentation', () => {
  it('reports all metrics and separates currencies without invented aggregate revenue', () => {
    dashboard();
    expect(screen.getByTestId('revenue-USD')).toHaveTextContent('99.00');
    expect(screen.getByTestId('revenue-EUR')).toHaveTextContent('25.00');
    expect(screen.queryByText(/124\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^metric-/)).toHaveLength(12);
    expect(screen.getByTestId('metric-draft-approval-rate')).toHaveTextContent('50%');
    expect(screen.getByText(/distinct click receipts, not identified people/)).toBeInTheDocument();
  });
  it('offers accessible chart data and contextual drilldowns preserving the report range', () => {
    dashboard();
    expect(
      screen.getByRole('table', { name: 'Recorded activity by selected breakdown' }),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'r/SaaS' });
    expect(links.at(-1)).toHaveAttribute(
      'href',
      `/app/analytics?from=2026-09-01&to=2026-09-18&subredditId=${p6ids.subreddit}`,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Intent$/ }));
    expect(screen.getByRole('link', { name: 'recommendation' })).toHaveAttribute(
      'href',
      '/app/analytics?from=2026-09-01&to=2026-09-18&intent=recommendation',
    );
  });
  it('shows no revenue and undefined rates without claiming a positive result', () => {
    const report = analyticsFixture();
    report.metrics = { ...report.metrics, revenue: [], drafts: 0, clicks: 0, signups: 0 };
    render(<MetricTiles report={report} />);
    expect(screen.getByTestId('metric-draft-approval-rate')).toHaveTextContent('—');
    expect(screen.getByTestId('metric-click-to-signup-rate')).toHaveTextContent('—');
    expect(screen.getByTestId('metric-signup-to-purchase-rate')).toHaveTextContent('—');
  });
  it('validates date limits before navigation and sends selected filters through the URL', () => {
    dashboard();
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Analytics filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent('90-day');
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Brands'), { target: { value: p6ids.brand } });
    fireEvent.submit(screen.getByRole('form', { name: 'Analytics filters' }));
    expect(navigation.push).toHaveBeenCalledWith(
      `/app/analytics?from=2026-09-01&to=2026-09-18&brandId=${p6ids.brand}`,
    );
  });
  it('keeps advanced dimensions unavailable outside Growth with a clear plan explanation', () => {
    dashboard();
    expect(screen.getByRole('button', { name: 'Competitors' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draft style' })).toBeDisabled();
    expect(screen.getByLabelText('Competitors')).toBeDisabled();
    expect(screen.getByLabelText('Draft style')).toBeDisabled();
    expect(
      screen.getByText(/Competitor and draft-style breakdowns require Growth/),
    ).toBeInTheDocument();
  });
  it('overview presents the real report and keeps the manual workflow visible', () => {
    render(
      <AttributionOverview organizationName="Synthetic workspace" report={analyticsFixture()} />,
    );
    expect(screen.getAllByTestId(/^metric-/)).toHaveLength(12);
    expect(screen.getByRole('link', { name: /Connect a reply to results/ })).toHaveAttribute(
      'href',
      '/app/tracking',
    );
    expect(screen.getByText(/Currencies stay separate/)).toBeInTheDocument();
  });
});
describe('approved-draft tracking links', () => {
  it('sends the approved version and organization, preserves existing UTMs and copies only on request', async () => {
    request.mockResolvedValueOnce(Response.json({ data: { link: phase6Link } }));
    render(<TrackingStudio {...tracking} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create tracking link' }));
    await screen.findByLabelText('New tracking URL');
    expect(body()).toEqual({
      draftId: p6ids.draft,
      expectedVersion: 3,
      destinationUrl: phase6Brand.website_url,
      utm: { source: 'reddit', medium: 'community', campaign: 'threadsignal' },
      overwriteUtm: false,
    });
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('X-ThreadSignal-Organization'),
    ).toBe(p6ids.organization);
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy new link' }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(`http://127.0.0.1:3000/go/${phase6Link.code}`),
    );
  });
  it('selects the exact approved draft requested by the review studio and never silently substitutes a stale draft', () => {
    const alternative = {
      ...tracking.drafts[0]!,
      id: p6ids.opportunity,
      current_version: 4,
      title: 'Another approved reply',
    };
    const view = render(
      <TrackingStudio
        {...tracking}
        drafts={[...tracking.drafts, alternative]}
        initialDraftId={alternative.id}
      />,
    );
    expect(screen.getByLabelText('Approved draft')).toHaveValue(alternative.id);
    view.unmount();
    render(<TrackingStudio {...tracking} initialDraftId={p6ids.key} />);
    expect(screen.getByLabelText('Approved draft')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('requested draft is not available');
    expect(request).not.toHaveBeenCalled();
  });
  it('requires explicit selection before overwriting destination UTMs', async () => {
    request.mockResolvedValueOnce(Response.json({ data: { link: phase6Link } }));
    render(<TrackingStudio {...tracking} />);
    fireEvent.click(screen.getByText('Campaign labels and existing UTM values'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Replace UTM values/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create tracking link' }));
    await waitFor(() => expect(body()).toMatchObject({ overwriteUtm: true }));
  });
  it('disables viewer changes, archived brands and revoked-link copying', () => {
    const view = render(
      <TrackingStudio
        {...tracking}
        canAct={false}
        links={[{ ...phase6Link, status: 'revoked' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Create tracking link' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show revoked links' }));
    expect(
      screen.getByRole('button', { name: `Copy tracking link ${phase6Link.code}` }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Revoke tracking link/ })).not.toBeInTheDocument();
    view.unmount();
    render(<TrackingStudio {...tracking} brand={{ ...phase6Brand, status: 'archived' }} />);
    expect(screen.getByRole('button', { name: 'Create tracking link' })).toBeDisabled();
  });
  it('paginates older records without changing the selected brand', () => {
    const view = render(
      <TrackingStudio
        {...tracking}
        pagination={{ page: 2, pageSize: 50, total: 125, totalPages: 3 }}
      />,
    );
    const pages = screen.getByRole('navigation', { name: 'Tracking link pages' });
    expect(within(pages).getByRole('link', { name: 'Previous links' })).toHaveAttribute(
      'href',
      `/app/tracking?brandId=${p6ids.brand}&page=1`,
    );
    expect(within(pages).getByRole('link', { name: 'Next links' })).toHaveAttribute(
      'href',
      `/app/tracking?brandId=${p6ids.brand}&page=3`,
    );
    view.unmount();
    render(
      <TrackingStudio
        {...tracking}
        pagination={{ page: 1, pageSize: 50, total: 1, totalPages: 1 }}
      />,
    );
    expect(
      screen.queryByRole('navigation', { name: 'Tracking link pages' }),
    ).not.toBeInTheDocument();
  });
  it('retains the form after a server refusal and does not invent a link', async () => {
    request.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'DRAFT_NOT_APPROVED',
            message: 'Approve the current draft version before creating a link.',
          },
        },
        { status: 409 },
      ),
    );
    render(<TrackingStudio {...tracking} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create tracking link' }));
    await screen.findByText('Approve the current draft version before creating a link.');
    expect(screen.queryByLabelText('New tracking URL')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Destination URL/)).toHaveValue(phase6Brand.website_url);
  });
  it('confirms revocation, keeps recorded history and blocks further copying', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    request.mockResolvedValueOnce(Response.json({ data: { revoked: true } }));
    render(<TrackingStudio {...tracking} links={[phase6Link]} />);
    fireEvent.click(
      screen.getByRole('button', { name: `Revoke tracking link ${phase6Link.code}` }),
    );
    await screen.findByText('Tracking link revoked. Existing analytics are retained.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show revoked links' }));
    expect(
      screen.getByRole('button', { name: `Copy tracking link ${phase6Link.code}` }),
    ).toBeDisabled();
    expect(request.mock.calls[0]?.[0]).toBe(`/api/tracking-links/${p6ids.link}/revoke`);
  });
});
describe('conversion integration controls', () => {
  it('shows a newly created key once in a masked field, without clipboard or persistent storage side effects', async () => {
    const key = `tsk_${'x'.repeat(43)}`;
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    request.mockResolvedValueOnce(Response.json({ data: { key, record: phase6Key } }));
    render(<ConversionSettings {...settings} />);
    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'Test server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversion key' }));
    const input = await screen.findByLabelText('One-time conversion key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue(key);
    expect(copy).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(body()).toEqual({ brandId: p6ids.brand, name: 'Test server' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(screen.queryByLabelText('One-time conversion key')).not.toBeInTheDocument();
    expect(screen.getByText('tsk_unit…')).toBeInTheDocument();
  });
  it('rotates an existing key only after confirmation and uses the scoped rotation field', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    request.mockResolvedValueOnce(
      Response.json({
        data: { key: `tsk_${'y'.repeat(43)}`, record: { ...phase6Key, id: p6ids.link } },
      }),
    );
    render(<ConversionSettings {...settings} keys={[phase6Key]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Test server' }));
    expect(request).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Test server' }));
    await screen.findByLabelText('One-time conversion key');
    expect(body()).toEqual({ brandId: p6ids.brand, name: 'Test server', rotateKeyId: p6ids.key });
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });
  it('does not offer viewer mutations or growth key creation on a lower plan', () => {
    const view = render(<ConversionSettings {...settings} canManage={false} keys={[phase6Key]} />);
    expect(screen.getByLabelText('Attribution window (days)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create conversion key' })).not.toBeInTheDocument();
    expect(screen.queryByText('tsk_unit…')).not.toBeInTheDocument();
    view.unmount();
    render(
      <ConversionSettings
        {...settings}
        features={{ conversionTracking: true, conversionApi: false }}
        keys={[phase6Key]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Create conversion key' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke Test server' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Rotate Test server' })).not.toBeInTheDocument();
  });
  it('saves validated consent settings, without implying that saving grants consent', async () => {
    request.mockResolvedValueOnce(
      Response.json({ data: { settings: { ...phase6Settings, attribution_days: 14 } } }),
    );
    render(<ConversionSettings {...settings} />);
    fireEvent.change(screen.getByLabelText('Attribution window (days)'), {
      target: { value: '14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save attribution settings' }));
    await screen.findByText(/Attribution settings saved/);
    expect(body()).toEqual({ attributionDays: 14, consentText: phase6Settings.consent_text });
    expect(screen.getByText(/does not grant visitor consent/)).toBeInTheDocument();
  });
  it('documents a public consent-first browser snippet that never embeds a server key', () => {
    render(<ConversionSettings {...settings} keys={[phase6Key]} />);
    fireEvent.click(screen.getByText('View installation snippet'));
    const snippet = screen.getByLabelText('Browser tracking installation snippet');
    expect(snippet).toHaveTextContent('consent: false');
    expect(snippet).toHaveTextContent('/api/v1/browser-events');
    expect(snippet).not.toHaveTextContent('tsk_');
    expect(within(snippet).getByText(/DOMContentLoaded/)).toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
  });
});
