import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Guided onboarding needs verified local Supabase services.',
);
test.setTimeout(180_000);

test('Journey A: saved guided setup leads from a new workspace to a scored opportunity feed', async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const identity = uniqueIdentity('guided');
  let organization: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    await expect(
      page.getByRole('progressbar', { name: 'Workspace setup completion' }),
    ).toHaveAttribute('value', '17');
    await page.getByRole('link', { name: 'Create your first brand', exact: true }).click();
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByLabel('Product vocabulary', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.getByLabel('Source name', { exact: true }).fill('Guided website evidence');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    await expect(page.locator('input[name="approved-pages"]')).toHaveCount(6);
    for (const input of await page.locator('input[name="approved-pages"]').all())
      await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45_000 });
    await page.goto(`/app/brands/${brand}/edit`);
    await page.getByRole('button', { name: 'Suggest product details', exact: true }).click();
    await page.getByLabel('Replace Product description', { exact: true }).check();
    await page
      .getByRole('button', { name: 'Apply selected suggestions to form', exact: true })
      .click();
    await expect(
      page.getByText(
        'Selected suggestions are in the form. Review your changes, then save the brand profile.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save brand profile', exact: true }).click();
    await expect(
      page.getByText('Your brand profile has been saved.', { exact: true }),
    ).toBeVisible();
    // Return in a new navigation: progress must come from persisted records.
    await page.goto(`/app/onboarding?brandId=${brand}`);
    await expect(
      page.getByRole('progressbar', { name: 'Workspace setup completion' }),
    ).toHaveAttribute('value', '50');
    await page.getByRole('link', { name: 'Choose keywords', exact: true }).click();
    await page.getByLabel('Keyword or phrase', { exact: true }).fill('image optimization API');
    await page.getByRole('button', { name: 'Add keyword', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'image optimization API', exact: true }),
    ).toBeVisible();
    await page.goto(`/app/onboarding?brandId=${brand}`);
    await page.getByRole('link', { name: 'Choose communities', exact: true }).click();
    await page.getByLabel('Community name', { exact: true }).fill('SaaS');
    await page.getByRole('button', { name: 'Search communities', exact: true }).click();
    await page.getByRole('button', { name: 'Monitor community', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'r/saas', exact: true })).toBeVisible();
    await page.goto(`/app/onboarding?brandId=${brand}`);
    await expect(
      page.getByRole('progressbar', { name: 'Workspace setup completion' }),
    ).toHaveAttribute('value', '100', { timeout: 60_000 });
    await page.reload();
    await expect(
      page.getByRole('progressbar', { name: 'Workspace setup completion' }),
    ).toHaveAttribute('value', '100');
    await page.getByRole('link', { name: 'Open opportunity feed', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/opportunities\\?brandId=${brand}`));
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByLabel('Current brand')).toHaveValue(brand);
    await page.getByRole('button', { name: 'Search workspace pages' }).click();
    await page.getByLabel('Search pages', { exact: true }).fill('knowledge');
    await page
      .getByRole('dialog', { name: 'Find a workspace page' })
      .getByRole('link', { name: 'Knowledge', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/knowledge\\?brandId=${brand}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 3 });
  }
});
