import { expect, test } from '@playwright/test';

test('public design leads to real account access', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Start free trial', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `.threadsignal/verification/screenshots/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Start free trial' }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await page.screenshot({
    path: `.threadsignal/verification/screenshots/login-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('workspace routes require sign-in and preserve their destination', async ({ page }) => {
  await page.goto('/app/settings/team');
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/app/settings/team');
  await expect(page.getByLabel('Email address')).toBeVisible();
});

test('public pricing and responsible-use pages are accessible on small screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/pricing', '/security', '/privacy', '/terms']) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Trial', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Growth', exact: true })).toBeVisible();
});

test('liveness exposes only safe operational fields', async ({ request }) => {
  const response = await request.get('/api/health', {
    headers: { 'x-request-id': 'untrusted-content' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['cache-control']).toBe('no-store');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ status: 'ok', service: 'threadsignal-web' });
  expect(JSON.stringify(body)).not.toContain('untrusted-content');
  expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
    'requestId',
    'service',
    'status',
  ]);
});

test('unknown public pages return an accessible 404', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This page isn’t here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
});
