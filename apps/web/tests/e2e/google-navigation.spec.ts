import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { requestSecurity } from '../../src/lib/security-policy';

test('Google navigation preserves strict CSP and the PKCE cookie before leaving the app', async ({
  page,
  context,
}) => {
  // All requests are intercepted. No Google account, external Supabase project or real token is used.
  const app = 'https://threadsignal.example';
  const supabase = 'https://abcdefghijklmnopqrst.supabase.co';
  const destination = `${supabase}/auth/v1/authorize?provider=google&code_challenge=fixture`;
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import { googleSignInDestination } from './apps/web/src/lib/auth/google-client';
      document.querySelector('button').addEventListener('click', async () => {
        window.location.assign(await googleSignInDestination('/app', '${supabase}'));
      });
    `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const policy = requestSecurity({ development: false, local: false }).policy;
  // This external script gets a matching nonce; form-action stays self-only.
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  let requestBody: unknown;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === `${app}/login`)
      return route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': policy },
        body: `<button>Continue with Google</button><script nonce="${nonce}" src="/login.js"></script>`,
      });
    if (url === `${app}/login.js`)
      return route.fulfill({
        contentType: 'application/javascript',
        body: bundle.outputFiles[0]?.text ?? '',
      });
    if (url === `${app}/api/auth/google`) {
      expect(route.request().method()).toBe('POST');
      requestBody = route.request().postDataJSON();
      return route.fulfill({
        contentType: 'application/json',
        headers: {
          'Set-Cookie':
            'sb-threadsignal-auth-token-code-verifier=synthetic-pkce; Path=/; HttpOnly; Secure; SameSite=Lax',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ url: destination }),
      });
    }
    if (url === destination)
      return route.fulfill({
        contentType: 'text/html',
        body: '<h1>Fixture OAuth destination</h1>',
      });
    return route.abort();
  });
  await page.goto(`${app}/login`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(destination);
  expect(requestBody).toEqual({ next: '/app' });
  const cookie = (await context.cookies(app)).find(
    (value) => value.name === 'sb-threadsignal-auth-token-code-verifier',
  );
  expect(cookie).toMatchObject({
    value: 'synthetic-pkce',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });
  expect(policy).toContain("form-action 'self'");
});
