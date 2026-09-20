import { expect, test, type Locator, type Page } from '@playwright/test';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

// This file includes Auth later; never retain sessions/private sign-in URLs in artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(90_000);

async function assertSkipLink(page: Page) {
  await page.keyboard.press('Tab');
  const link = page.getByRole('link', { name: 'Skip to content', exact: true });
  await expect(link).toBeFocused();
  await expect(link).toBeVisible();
  const outline = await link.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
}

async function assertContrast(locator: Locator, minimum = 4.5) {
  const ratio = await locator.evaluate((element) => {
    // Sample computed sRGB colors after browser CSS-variable/OKLCH resolution.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Color sampling is unavailable.');
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const foreground = rgba(getComputedStyle(element).color);
    let background = [255, 255, 255, 255];
    const ancestors: Element[] = [];
    let parent: Element | null = element;
    while (parent) {
      ancestors.unshift(parent);
      parent = parent.parentElement;
    }
    for (const ancestor of ancestors) {
      const color = rgba(getComputedStyle(ancestor).backgroundColor);
      const alpha = (color[3] ?? 0) / 255;
      background = background.map((channel, index) =>
        index === 3 ? 255 : (color[index] ?? 0) * alpha + channel * (1 - alpha),
      );
    }
    const luminance = (color: number[]) =>
      color.slice(0, 3).reduce((total, channel, index) => {
        const value = channel / 255;
        return (
          total +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    const first = luminance(foreground),
      second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(minimum);
}

test('production CSP nonces permit hydration and reject client-chosen trust headers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('page-error'));
  await page.addInitScript(() => {
    const state = {
      scriptViolations: [] as { directive: string; blocked: string; line: number }[],
    };
    Object.defineProperty(window, '__threadsignalSecurityTest', { value: state });
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective.startsWith('script-src'))
        state.scriptViolations.push({
          directive: event.effectiveDirective,
          blocked: ['inline', 'eval'].includes(event.blockedURI) ? event.blockedURI : 'resource',
          line: event.lineNumber,
        });
    });
  });
  await page.setExtraHTTPHeaders({ 'x-nonce': 'client-chosen', 'x-request-id': 'client-chosen' });
  const response = await page.goto('/login');
  expect(response?.status()).toBe(200);
  const policy = response?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/]+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(nonce).not.toBe('client-chosen');
  const scriptDirective = policy.split(';').find((part) => part.trim().startsWith('script-src '));
  expect(scriptDirective).not.toContain('unsafe-inline');
  expect(scriptDirective).not.toContain('unsafe-eval');
  expect(response?.headers()['x-request-id']).not.toBe('client-chosen');
  const frameworkNonces = await page
    .locator('script[src*="/_next/"]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(frameworkNonces.length).toBeGreaterThan(0);
  expect(frameworkNonces.every((value) => value === nonce)).toBe(true);
  // A hydrated form responds to client validation without sending an Auth request.
  await page.getByLabel('Email address', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Send magic link', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __threadsignalSecurityTest: {
              scriptViolations: { directive: string; blocked: string; line: number }[];
            };
          }
        ).__threadsignalSecurityTest.scriptViolations,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  const next = await page.goto('/pricing');
  expect(next?.headers()['content-security-policy']).not.toBe(policy);
});

test('public pages preserve keyboard entry, readable colors and layout at three widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/pricing', '/security', '/login']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await assertSkipLink(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
      ).toBe('auto');
      await assertContrast(page.getByRole('heading', { level: 1 }));
      const muted = page.locator('main p.text-muted-foreground').first();
      if (await muted.count()) await assertContrast(muted);
    }
    await page.goto('/');
    await assertContrast(page.getByRole('link', { name: 'Start free trial', exact: true }).first());
    await page.locator('summary').filter({ hasText: 'Does ThreadSignal post for me?' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('No. A real person reviews the reply', { exact: false }),
    ).toBeVisible();
  }
});

test('authenticated settings retain keyboard focus, labels and narrow-screen actions', async ({
  page,
}) => {
  test.skip(
    process.env.THREADSIGNAL_SERVICES_READY !== '1',
    'Requires verified local Supabase and the isolated test inbox.',
  );
  const identity = uniqueIdentity('a11y');
  await signInWithMagicLink(page, identity.email);
  await createWorkspace(page, identity);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/settings/notifications');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await assertSkipLink(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await assertContrast(page.getByRole('heading', { level: 1 }));
    for (const input of await page.locator('main input:not([type=hidden]), main select').all()) {
      const name = await input.evaluate((element) => {
        const field = element as HTMLInputElement;
        return (
          field.getAttribute('aria-label') ||
          field.getAttribute('aria-labelledby') ||
          [...(field.labels ?? [])].map((label) => label.textContent?.trim()).join(' ')
        );
      });
      expect(name).toBeTruthy();
    }
  }
});
