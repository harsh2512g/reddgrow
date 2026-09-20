import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod';

const appOrigin = 'http://127.0.0.1:3000';
const inboxOrigin = 'http://127.0.0.1:54324';
const messageSchema = z.object({
  ID: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  To: z.array(z.object({ Address: z.string() })),
});
const messagesSchema = z.object({ messages: z.array(messageSchema) });
const detailSchema = z.object({ HTML: z.string().optional(), Text: z.string().optional() });

export function uniqueIdentity(prefix = 'auth') {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  return {
    email: `threadsignal-${prefix}-${suffix}@example.test`,
    slug: `${prefix}-${suffix}`,
    name: `ThreadSignal ${prefix} ${suffix}`,
  };
}

async function inboxJson(path: string): Promise<unknown> {
  if (process.env.THREADSIGNAL_SERVICES_READY !== '1')
    throw new Error('Verified local services are required for auth tests.');
  try {
    // Node fetch has no browser cookie jar. Auth cookies are never forwarded to Mailpit.
    const response = await fetch(inboxOrigin + path, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Inbox request failed.');
    return await response.json();
  } catch {
    throw new Error('The project-local test inbox is unavailable.');
  }
}

async function messagesFor(email: string) {
  const parsed = messagesSchema.safeParse(await inboxJson('/api/v1/messages?limit=100'));
  if (!parsed.success)
    throw new Error('The project-local inbox returned an unsupported message list.');
  return parsed.data.messages.filter((message) =>
    message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
  );
}

function localSignInLink(content: string): string | undefined {
  const candidates = content.replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password) continue;
      if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/verify')
        return url.href;
      if (url.origin === appOrigin && ['/auth/callback', '/auth/confirm'].includes(url.pathname))
        return url.href;
    } catch {
      /* Ignore non-URL email text without logging it. */
    }
  }
  return undefined;
}

async function waitForSignInLink(email: string, previousIds: Set<string>): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const message of await messagesFor(email)) {
      if (previousIds.has(message.ID)) continue;
      const result = detailSchema.safeParse(await inboxJson(`/api/v1/message/${message.ID}`));
      if (!result.success) throw new Error('The test inbox returned an unsupported message.');
      const link = localSignInLink((result.data.HTML ?? '') + '\n' + (result.data.Text ?? ''));
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('A new sign-in message did not arrive in the project-local inbox.');
}

/** Auth suites must disable traces/screenshots/video; do not put private URLs in test titles. */
export async function navigatePrivateLink(page: Page, value: string): Promise<void> {
  try {
    const url = new URL(value, appOrigin);
    const allowed =
      (url.origin === appOrigin &&
        /^\/(?:login|app(?:\/|$)|auth\/callback|auth\/confirm)/.test(url.pathname)) ||
      (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/verify');
    if (!allowed || url.username || url.password) throw new Error('Invalid private test URL.');
    // A goto step includes its full URL in reports. Keep private URL values out of step titles.
    await page.evaluate((destination) => {
      window.location.assign(destination);
    }, url.href);
  } catch {
    throw new Error('Navigation using a project-local private link failed.');
  }
}

export async function signInWithMagicLink(
  page: Page,
  email: string,
  options: { next?: string } = {},
): Promise<void> {
  const previousIds = new Set((await messagesFor(email)).map((message) => message.ID));
  await page.goto('/login');
  if (options.next) {
    const login = new URL('/login', appOrigin);
    login.searchParams.set('next', options.next);
    await navigatePrivateLink(page, login.href);
    await page.waitForFunction(
      (expected) => window.location.pathname === '/login' && window.location.search === expected,
      login.search,
    );
  }
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send magic link', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible({
    timeout: 15_000,
  });
  const link = await waitForSignInLink(email, previousIds);
  await navigatePrivateLink(page, link);
  try {
    await page.waitForFunction(
      () =>
        window.location.origin === 'http://127.0.0.1:3000' &&
        window.location.pathname.startsWith('/app'),
      undefined,
      { timeout: 20_000 },
    );
  } catch {
    throw new Error(
      'The local magic-link exchange did not establish an authenticated app session.',
    );
  }
}

export async function createWorkspace(
  page: Page,
  identity: { name: string; slug: string; email: string },
): Promise<string> {
  await page.goto('/app/onboarding');
  await page.getByLabel('Organization name', { exact: true }).fill(identity.name);
  await page.getByLabel('Workspace slug', { exact: true }).fill(identity.slug);
  await page.getByLabel('Billing email', { exact: true }).fill(identity.email);
  await page.getByLabel('I agree to participate responsibly and publish replies manually.').check();
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(appOrigin + '/app');
  const id = await page.locator('#desktop-organization').inputValue();
  if (!z.uuid().safeParse(id).success)
    throw new Error('The created workspace selector did not contain a valid organization ID.');
  return id;
}

export async function signOutFromMenu(page: Page): Promise<void> {
  await page.getByLabel('Open user menu').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(appOrigin + '/login');
}
