import { expect, test } from '@playwright/test';
import {
  createWorkspace,
  signInWithMagicLink,
  signOutFromMenu,
  uniqueIdentity,
} from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Authentication journeys require the verified project-local Supabase and Mailpit services.',
);
test.setTimeout(90_000);

test('magic-link signup creates a workspace, protects cookies, and signs out', async ({
  page,
  context,
}) => {
  const identity = uniqueIdentity('onboarding');
  await signInWithMagicLink(page, identity.email);
  await expect(page).toHaveURL('http://127.0.0.1:3000/app/onboarding');
  await createWorkspace(page, identity);
  const cookieFlags = (await context.cookies())
    .filter(
      (cookie) =>
        cookie.name.startsWith('sb-threadsignal-auth-token') &&
        !cookie.name.includes('code-verifier'),
    )
    .map(({ httpOnly, sameSite, path }) => ({ httpOnly, sameSite, path }));
  expect(cookieFlags.length).toBeGreaterThan(0);
  for (const flags of cookieFlags)
    expect(flags).toEqual({ httpOnly: true, sameSite: 'Lax', path: '/' });
  await page.goto('/app/settings/organization');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue(identity.name);
  await page.goto('/app/settings/billing');
  await expect(page.getByRole('heading', { name: /plan/i }).first()).toBeVisible();
  await signOutFromMenu(page);
  expect(
    (await context.cookies()).some((cookie) =>
      cookie.name.startsWith('sb-threadsignal-auth-token'),
    ),
  ).toBe(false);
  await page.goto('/app/settings/organization');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings%2Forganization$/);
  await signInWithMagicLink(page, identity.email, { next: '/app/settings/organization' });
  await expect(page).toHaveURL('http://127.0.0.1:3000/app/settings/organization');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue(identity.name);
});

test('auth endpoint rejects foreign origins and keeps Google disabled locally', async ({
  request,
}) => {
  const foreign = await request.post('/api/auth/magic-link', {
    headers: { origin: 'https://untrusted.example' },
    data: { email: uniqueIdentity('csrf').email },
  });
  expect(foreign.status()).toBe(403);
  const google = await request.post('/api/auth/google', {
    headers: { origin: 'http://127.0.0.1:3000' },
    data: {},
  });
  expect(google.status()).toBe(503);
  expect(await google.json()).toMatchObject({ error: { code: 'AUTH_PROVIDER_UNAVAILABLE' } });
});
