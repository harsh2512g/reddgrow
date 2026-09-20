import { randomBytes, randomUUID } from 'node:crypto';

/** Generated here, never accepted from client headers or cookies. */
export function requestSecurity(input: { development: boolean; local: boolean }) {
  const nonce = randomBytes(24).toString('base64');
  const requestId = randomUUID();
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${input.development ? " 'unsafe-eval'" : ''}`,
    // React/Radix and chart dimensions use style attributes. This does not permit inline scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${input.development && input.local ? ' ws://127.0.0.1:3000 ws://localhost:3002' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!input.local ? ['upgrade-insecure-requests'] : []),
  ];
  return { nonce, requestId, policy: directives.join('; ') };
}
