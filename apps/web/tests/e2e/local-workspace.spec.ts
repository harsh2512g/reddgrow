import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import {
  createWorkspace,
  signInWithMagicLink,
  signOutFromMenu,
  uniqueIdentity,
} from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Local workspace navigation requires verified local Supabase and Mailpit services.',
);
test.setTimeout(90_000);

test('local sign-in retains the requested tab and one session opens every workspace tab', async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { statement_timeout: 10000, application_name: 'threadsignal-navigation-e2e' },
  });
  const identity = uniqueIdentity('navigation');
  let organization: string | undefined;
  try {
    const featurePaths = [
      '/app/brands',
      '/app/knowledge',
      '/app/opportunities',
      '/app/subreddits',
      '/app/keywords',
    ];
    for (const path of featurePaths) {
      await page.goto(path);
      await expect(page).toHaveURL(`http://127.0.0.1:3000/login?next=${encodeURIComponent(path)}`);
      await expect(
        page.getByText('Your hosted sign-in does not sign you in locally.'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'local inbox', exact: true })).toHaveAttribute(
        'href',
        'http://127.0.0.1:54324',
      );
    }

    // A unique local identity avoids exhausting the real per-email sign-in limit
    // across repeated suites. The seeded role matrix separately covers viewer access.
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    await signOutFromMenu(page);
    await signInWithMagicLink(page, identity.email, { next: '/app/knowledge' });
    await expect(page).toHaveURL('http://127.0.0.1:3000/app/knowledge');
    for (const path of [
      '/app',
      ...featurePaths,
      '/app/settings/organization',
      '/app/settings/team',
      '/app/settings/billing',
      '/app/settings/integrations',
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(`http://127.0.0.1:3000${path}`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByLabel('Email address', { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await signOutFromMenu(page);
  } finally {
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
  }
});
