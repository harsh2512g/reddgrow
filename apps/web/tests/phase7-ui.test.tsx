import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@threadsignal/config';
import { BillingDashboard } from '../src/components/phase7/billing-dashboard';
import { NotificationSettings } from '../src/components/phase7/notification-settings';
import { GenerateDraftButton } from '../src/components/phase4/primitives';
import {
  notificationPreferencesSchema,
  type BillingDashboardProps,
  type BillingSubscription,
  type BillingUsage,
  type NotificationPreferences,
  type NotificationSettingsProps,
} from '../src/components/phase7/types';

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const organization = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic workspace',
  role: 'owner' as const,
};
const subscription: BillingSubscription = {
  organization_id: organization.id,
  provider: 'mock',
  plan_key: 'trial',
  status: 'trialing',
  period_start: '2026-09-19T00:00:00Z',
  period_end: '2026-09-26T00:00:00Z',
  trial_ends_at: '2026-09-26T00:00:00Z',
  grace_ends_at: null,
  cancel_at_period_end: false,
  active: true,
  can_manage: true,
  billing_email: 'owner@example.test',
  customer_id: null,
  subscription_id: null,
};
const usage: BillingUsage = {
  period_start: subscription.period_start,
  period_end: subscription.period_end,
  meters: [
    { metric: 'brands', used: 1, limit: 1 },
    { metric: 'communities', used: 2, limit: 3 },
    { metric: 'members', used: 1, limit: 1 },
    { metric: 'opportunities', used: 12, limit: 20 },
    { metric: 'ai_drafts', used: 10, limit: 10 },
  ],
  features: PLANS.trial.features,
};
const preferences: NotificationPreferences = {
  categories: {
    welcome: true,
    invitation: true,
    ingestion_complete: true,
    ingestion_failed: true,
    daily_digest: true,
    high_score_alert: true,
    trial_ending: true,
    usage_limit: true,
    payment_failed: true,
    subscription_changed: true,
  },
  digest_time: '09:00',
  minimum_score: 90,
  quiet_start: null,
  quiet_end: null,
  timezone: 'Asia/Kolkata',
};
const billingProps: BillingDashboardProps = {
  enabled: true,
  organization,
  subscription,
  usage,
  mock: true,
};
const preferencesProps: NotificationSettingsProps = {
  enabled: true,
  organization,
  preferences,
  dailyDigestAvailable: true,
  consoleMode: true,
};
const checkout = {
  id: '22222222-2222-4222-8222-222222222222',
  organization_id: organization.id,
  plan_key: 'solo',
  provider: 'mock',
  status: 'pending',
  expires_at: '2026-09-20T00:00:00Z',
};
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  navigation.push.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
const body = (index = 0): unknown => JSON.parse(String(request.mock.calls[index]?.[1]?.body));
const upgraded = {
  ...subscription,
  plan_key: 'solo' as const,
  status: 'active' as const,
  trial_ends_at: null,
};
const soloUsage = {
  ...usage,
  meters: usage.meters.map((meter) =>
    meter.metric === 'ai_drafts' ? { ...meter, limit: 60 } : meter,
  ),
  features: PLANS.solo.features,
};

describe('billing controls and source-backed usage', () => {
  it('renders every allowance with accessible actual usage and truthful development copy', () => {
    render(<BillingDashboard {...billingProps} />);
    expect(screen.getByRole('heading', { name: /^Trial plan/ })).toBeVisible();
    expect(screen.getAllByRole('meter')).toHaveLength(5);
    expect(screen.getByRole('meter', { name: 'AI drafts' })).toHaveAttribute(
      'aria-valuetext',
      '10 of 10 used',
    );
    expect(screen.getByText(/No card is collected/)).toBeVisible();
    expect(screen.getByText(/Includes pending invitations/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose Solo' })).toBeEnabled();
  });
  it('requires explicit confirmation and reads effective usage after idempotent mock completion', async () => {
    request
      .mockResolvedValueOnce(Response.json({ data: { request: checkout, url: null } }))
      .mockResolvedValueOnce(Response.json({ data: { subscription: upgraded } }))
      .mockResolvedValueOnce(Response.json({ data: upgraded }))
      .mockResolvedValueOnce(Response.json({ data: soloUsage }));
    render(<BillingDashboard {...billingProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Solo' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch to Solo?' });
    expect(request).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('without collecting payment details or charging money');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm development upgrade' }));
    await waitFor(() =>
      expect(screen.getByRole('meter', { name: 'AI drafts' })).toHaveAttribute(
        'aria-valuetext',
        '10 of 60 used',
      ),
    );
    expect(body()).toEqual({ planKey: 'solo', idempotencyKey: expect.any(String) });
    expect(body(1)).toEqual({ requestId: checkout.id });
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('x-threadsignal-organization'),
    ).toBe(organization.id);
    expect(screen.getByRole('status')).toHaveTextContent('Solo is active');
  });
  it('retains the idempotency key on retry and exposes a safe API failure in the dialog', async () => {
    request.mockResolvedValue(
      Response.json(
        { error: { code: 'TEMPORARY', message: 'Please retry the plan change.' } },
        { status: 503 },
      ),
    );
    render(<BillingDashboard {...billingProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Growth' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm development upgrade' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Please retry the plan change.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm development upgrade' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual(body(0));
  });
  it.each(['admin', 'member', 'viewer'] as const)(
    'makes billing read-only for %s even if a stale DTO claims management',
    (role) => {
      render(<BillingDashboard {...billingProps} organization={{ ...organization, role }} />);
      expect(screen.getByRole('button', { name: 'Choose Solo' })).toBeDisabled();
      expect(screen.getByText(/Only the organization owner/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument();
    },
  );
  it('schedules cancellation and resumes using distinct server actions without removing current access', async () => {
    const canceled = { ...upgraded, cancel_at_period_end: true };
    request
      .mockResolvedValueOnce(Response.json({ data: { subscription: canceled } }))
      .mockResolvedValueOnce(Response.json({ data: canceled }))
      .mockResolvedValueOnce(Response.json({ data: soloUsage }))
      .mockResolvedValueOnce(Response.json({ data: { subscription: upgraded } }))
      .mockResolvedValueOnce(Response.json({ data: upgraded }))
      .mockResolvedValueOnce(Response.json({ data: soloUsage }));
    render(<BillingDashboard {...billingProps} subscription={upgraded} usage={soloUsage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByRole('button', { name: 'Resume subscription' });
    expect(body()).toEqual({ action: 'cancel' });
    expect(screen.getByText(/Access continues until then/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resume subscription' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    await screen.findByRole('button', { name: 'Cancel subscription' });
    expect(body(3)).toEqual({ action: 'resume' });
  });
  it('shows payment grace and inactive states without pretending work is enabled', () => {
    render(
      <BillingDashboard
        {...billingProps}
        subscription={{
          ...upgraded,
          status: 'past_due',
          active: false,
          grace_ends_at: '2026-09-28T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('New usage is paused');
    expect(screen.getByRole('alert')).toHaveTextContent('Grace period ends');
  });
  it('fails closed without made-up usage when the runtime gate is unavailable', () => {
    render(<BillingDashboard {...billingProps} enabled={false} subscription={null} usage={null} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Billing is not available/ })).toBeVisible();
  });
  it('rejects an untrusted checkout destination before browser navigation', async () => {
    request.mockResolvedValueOnce(
      Response.json({
        data: {
          request: { ...checkout, provider: 'stripe' },
          url: 'https://checkout.stripe.com.attacker.example/session',
        },
      }),
    );
    render(
      <BillingDashboard
        {...billingProps}
        mock={false}
        subscription={{ ...subscription, provider: 'stripe' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose Solo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure checkout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A verified checkout destination was not returned',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects a different workspace in the refreshed subscription', async () => {
    request
      .mockResolvedValueOnce(Response.json({ data: { request: checkout, url: null } }))
      .mockResolvedValueOnce(Response.json({ data: { subscription: upgraded } }))
      .mockResolvedValueOnce(
        Response.json({
          data: { ...upgraded, organization_id: '33333333-3333-4333-8333-333333333333' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: soloUsage }));
    render(<BillingDashboard {...billingProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Solo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm development upgrade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('active workspace changed');
    expect(screen.getByRole('meter', { name: 'AI drafts' })).toHaveAttribute(
      'aria-valuetext',
      '10 of 10 used',
    );
  });
});

describe('personal notification preferences', () => {
  it('persists selected categories, score, timezone and overnight quiet hours for a viewer', async () => {
    const changed = {
      ...preferences,
      categories: { ...preferences.categories, welcome: false },
      minimum_score: 85,
      quiet_start: '22:00',
      quiet_end: '08:00',
    };
    request.mockResolvedValueOnce(Response.json({ data: { preferences: changed } }));
    render(
      <NotificationSettings
        {...preferencesProps}
        organization={{ ...organization, role: 'viewer' }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Welcome and onboarding/ }));
    fireEvent.change(screen.getByLabelText('Minimum opportunity score'), {
      target: { value: '85' },
    });
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByRole('status');
    expect(body()).toEqual(changed);
    expect(screen.getByRole('status')).toHaveTextContent('have been saved');
    expect(screen.getByText(/do not send real emails/)).toBeVisible();
  });
  it('blocks invalid scores and half-filled quiet hours before making requests', async () => {
    render(<NotificationSettings {...preferencesProps} />);
    fireEvent.change(screen.getByLabelText('Minimum opportunity score'), {
      target: { value: '101' },
    });
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText('Set both quiet-hour times, or leave both empty.')).toBeVisible();
  });
  it('preserves a stored digest preference on Trial while presenting its plan requirement', async () => {
    request.mockResolvedValueOnce(Response.json({ data: { preferences } }));
    render(<NotificationSettings {...preferencesProps} dailyDigestAvailable={false} />);
    const digest = screen.getByRole('checkbox', { name: /Daily opportunity digest/ });
    expect(digest).toBeDisabled();
    expect(digest).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByRole('status');
    expect(body()).toEqual(preferences);
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/app/settings/billing',
    );
  });
  it('preserves unsaved choices after a failed save', async () => {
    request.mockRejectedValueOnce(new TypeError('offline'));
    render(<NotificationSettings {...preferencesProps} />);
    fireEvent.change(screen.getByLabelText('Minimum opportunity score'), {
      target: { value: '82' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Minimum opportunity score')).toHaveValue(82);
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  });
  it('rejects malformed clocks, unknown categories, invalid zones and equal quiet-hour endpoints', () => {
    for (const invalid of [
      { digest_time: '25:00' },
      { timezone: 'not/a-zone' },
      { categories: { ...preferences.categories, arbitrary: true } },
      { quiet_start: '12:00', quiet_end: '12:00' },
    ])
      expect(notificationPreferencesSchema.safeParse({ ...preferences, ...invalid }).success).toBe(
        false,
      );
  });
});

it('offers the billing route only after the server reports the draft limit', async () => {
  request.mockResolvedValueOnce(
    Response.json(
      { error: { code: 'DRAFT_LIMIT', message: 'Draft allowance reached.' } },
      { status: 402 },
    ),
  );
  render(
    <GenerateDraftButton
      opportunityId="33333333-3333-4333-8333-333333333333"
      organizationId={organization.id}
    />,
  );
  expect(screen.queryByRole('link', { name: 'View plans and upgrade' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  expect(await screen.findByRole('link', { name: 'View plans and upgrade' })).toHaveAttribute(
    'href',
    '/app/settings/billing',
  );
  expect(navigation.push).not.toHaveBeenCalled();
});
