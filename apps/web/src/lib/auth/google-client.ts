import { googleAuthorizationUrl } from './policy';

/** A fetch followed by navigation avoids cross-origin form redirects under form-action 'self'. */
export async function googleSignInDestination(
  next: string,
  supabaseOrigin: string,
): Promise<string> {
  const response = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ next }),
  });
  if (response.status === 429)
    throw new Error('Too many sign-in attempts. Wait a few minutes and try again.');
  if (!response.ok) throw new Error('Google sign-in is temporarily unavailable. Please try again.');
  const result: unknown = await response.json();
  const url = googleAuthorizationUrl(
    typeof result === 'object' && result !== null && 'url' in result ? result.url : undefined,
    supabaseOrigin,
  );
  if (!url) throw new Error('Google sign-in is temporarily unavailable. Please try again.');
  return url;
}
