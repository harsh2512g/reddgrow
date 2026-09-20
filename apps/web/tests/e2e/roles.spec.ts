import { expect, test, type Page } from '@playwright/test';
import { navigatePrivateLink, signInWithMagicLink, uniqueIdentity } from './local-auth';

const origin = 'http://127.0.0.1:3000';
const organizationId = '20000000-0000-4000-8000-000000000001';
const otherOrganizationId = '20000000-0000-4000-8000-000000000002';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Role journeys require the verified project-local seeded services.',
);
test.skip(
  ({ isMobile }) => isMobile,
  'The seeded-role matrix runs once; mobile navigation is exercised within the desktop journey.',
);
test.setTimeout(180_000);

const syntheticInvitee = /^threadsignal-invited-[a-f0-9]{16}@example\.test$/;

async function loadTeam(page: Page): Promise<void> {
  await page.goto('/app/settings/team');
  await expect(page.getByRole('heading', { name: 'Good work is a team thing.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People in your workspace' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Pending invitations', exact: true }),
  ).toBeVisible();
}

async function removeSyntheticInvitee(page: Page, email: string): Promise<void> {
  if (!syntheticInvitee.test(email))
    throw new Error('Only this test’s synthetic invitees may be cleaned up.');
  const remove = page.getByRole('button', { name: `Remove ${email}`, exact: true });
  if (await remove.count()) {
    page.once('dialog', (dialog) => dialog.accept());
    await remove.click();
    await expect(remove).toHaveCount(0);
  }
  const pending = page.locator('li').filter({ has: page.getByText(email, { exact: true }) });
  const revoke = pending.getByRole('button', { name: 'Revoke', exact: true });
  if (await revoke.count()) {
    await revoke.click();
    await expect(revoke).toHaveCount(0);
  }
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
}

async function cleanPreviousSyntheticInvitees(page: Page): Promise<void> {
  await loadTeam(page);
  const emails = new Set(await page.getByText(syntheticInvitee).allTextContents());
  for (const email of emails) await removeSyntheticInvitee(page, email);
  await expect(page.getByText('4 of 5 seats', { exact: true })).toBeVisible();
}

async function screenshotCleanDashboard(page: Page, name: string): Promise<void> {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Good conversations start here.' })).toBeVisible();
  await expect(page.locator('#desktop-organization')).toHaveValue(organizationId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Only the dashboard is captured, with menus closed and no private link or auth data visible.
  await page.screenshot({ path: `.threadsignal/verification/${name}.png`, fullPage: true });
}

test('seeded roles enforce tenant and billing boundaries and accept an email-bound invitation', async ({
  page,
  context,
  browser,
}) => {
  await signInWithMagicLink(page, 'owner@threadsignal.test');
  const own = await page.request.get(`/api/organizations/${organizationId}`);
  expect(own.status()).toBe(200);
  expect((await own.json()).organization.id).toBe(organizationId);
  expect((await page.request.get(`/api/organizations/${otherOrganizationId}`)).status()).toBe(404);
  expect(
    (await page.request.get(`/api/billing/subscription?organizationId=${organizationId}`)).status(),
  ).toBe(200);
  await cleanPreviousSyntheticInvitees(page);

  await context.addCookies([
    {
      name: 'threadsignal_organization',
      value: otherOrganizationId,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/app');
  await expect(page.locator('#desktop-organization')).toHaveValue(organizationId);
  await screenshotCleanDashboard(page, 'phase1-workspace-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Your workspace' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'People & access', exact: true }).click();
  await expect(page).toHaveURL(origin + '/app/settings/team');
  await expect(drawer).not.toBeVisible();
  await screenshotCleanDashboard(page, 'phase1-workspace-mobile');
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const role of ['admin', 'member', 'viewer'] as const) {
    const memberContext = await browser.newContext({ baseURL: origin });
    try {
      const memberPage = await memberContext.newPage();
      await signInWithMagicLink(memberPage, `${role}@threadsignal.test`);
      expect(
        (await memberPage.request.get(`/api/organizations/${otherOrganizationId}`)).status(),
      ).toBe(404);
      const summary = await memberPage.request.get(
        `/api/billing/subscription?organizationId=${organizationId}`,
      );
      expect(summary.status()).toBe(200);
      expect((await summary.json()).data).toMatchObject({
        organization_id: organizationId,
        can_manage: false,
        billing_email: null,
        customer_id: null,
        subscription_id: null,
      });
      expect(
        (
          await memberPage.request.post('/api/billing/checkout', {
            headers: { origin, 'x-threadsignal-organization': organizationId },
            data: { planKey: 'growth', idempotencyKey: crypto.randomUUID() },
          })
        ).status(),
      ).toBe(403);
      await memberPage.goto('/app/settings/organization');
      if (role === 'admin') {
        await expect(memberPage.getByLabel('Organization name', { exact: true })).toBeEnabled();
        await expect(memberPage.getByLabel('Billing email', { exact: true })).toHaveValue('');
        await expect(memberPage.getByLabel('Billing email', { exact: true })).toHaveAttribute(
          'readonly',
          '',
        );
      } else {
        await expect(memberPage.getByLabel('Organization name', { exact: true })).toBeDisabled();
        const denied = await memberPage.request.patch(`/api/organizations/${organizationId}`, {
          headers: { origin },
          data: { name: 'Blocked mutation' },
        });
        expect(denied.status()).toBe(403);
      }
    } finally {
      await memberContext.close();
    }
  }

  const invitee = uniqueIdentity('invited');
  const inviteeContext = await browser.newContext({ baseURL: origin });
  try {
    await loadTeam(page);
    await page.getByLabel('Email address', { exact: true }).fill(invitee.email);
    await page.getByLabel('Role', { exact: true }).selectOption('viewer');
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(page.getByText('Your invitation is ready.', { exact: true })).toBeVisible();
    // Keep clipboard data in this disposable test page; never touch the host clipboard.
    await page.evaluate(() => {
      const localWindow = window as Window & { threadsignalTestClipboard?: string };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            localWindow.threadsignalTestClipboard = value;
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Copy invitation link', exact: true }).click();
    const privateLink = await page.evaluate(
      () => (window as Window & { threadsignalTestClipboard?: string }).threadsignalTestClipboard,
    );
    if (!privateLink)
      throw new Error('The isolated test clipboard did not receive the invitation.');
    const invitedPage = await inviteeContext.newPage();
    await invitedPage.goto('/login');
    await navigatePrivateLink(invitedPage, privateLink);
    try {
      await invitedPage.waitForFunction(
        () => window.location.pathname === '/login' && window.location.search.includes('next='),
      );
    } catch {
      throw new Error('The protected invitation did not redirect to sign-in.');
    }
    await signInWithMagicLink(invitedPage, invitee.email, { next: new URL(privateLink).pathname });
    await expect(invitedPage.getByRole('heading', { name: 'You’re invited.' })).toBeVisible();
    await invitedPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invitedPage).toHaveURL(origin + '/app');
    const access = await invitedPage.request.get(`/api/organizations/${organizationId}`);
    expect(access.status()).toBe(200);
    expect((await access.json()).role).toBe('viewer');
  } finally {
    try {
      await loadTeam(page);
      await removeSyntheticInvitee(page, invitee.email);
      await expect(page.getByText('4 of 5 seats', { exact: true })).toBeVisible();
    } finally {
      await inviteeContext.close();
    }
  }
});
