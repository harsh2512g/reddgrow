import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';

if (process.env.THREADSIGNAL_LOCAL !== '1') {
  throw new Error('Use the isolated ThreadSignal launcher.');
}

const artifacts = resolve('.threadsignal/verification');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(artifacts, 'extension-profile-'));
const extension = resolve('apps/extension/dist');
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 420, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const manifest = await background.evaluate(() => globalThis.chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['sidePanel']);
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
  const id = new URL(background.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel/index.html`);
  await expect(
    page.getByRole('heading', { name: 'Good conversations start with care.' }),
  ).toBeVisible();
  await expect(page.locator('#extension-version')).toHaveText('Version 0.1.0');
  await expect(
    page.getByText('ThreadSignal never submits comments automatically', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('form, button[type="submit"], textarea')).toHaveCount(0);
  await page.screenshot({
    path: join(artifacts, 'screenshots/extension-chromium.png'),
    fullPage: true,
  });
  process.stdout.write(
    'Extension Chromium smoke passed: fresh profile, loaded MV3 background and panel, runtime version rendered, manual-only shell verified.\n',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
