import { z } from 'zod';

export const magicLinkInputSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    next: z.string().max(1024).optional(),
  })
  .strict();

function containsUnsafeCharacter(value: string): boolean {
  return [...value].some(
    (character) =>
      character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
  );
}

/** Only app and exact internal-admin paths may survive the auth round trip. Never accept protocol-relative URLs. */
export function safeNextPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.length > 1024 ||
    containsUnsafeCharacter(value)
  )
    return '/app';
  try {
    const decoded = decodeURIComponent(value);
    if (containsUnsafeCharacter(decoded) || decoded.startsWith('//')) return '/app';
    const url = new URL(value, 'https://threadsignal.invalid');
    if (
      url.origin !== 'https://threadsignal.invalid' ||
      !/^\/(?:app(?:\/|$)|internal\/admin(?:\/|$))/.test(url.pathname)
    )
      return '/app';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/app';
  }
}

export function hasTrustedOrigin(headers: Pick<Headers, 'get'>, appUrl: string): boolean {
  try {
    const origin = headers.get('origin');
    return (
      origin !== null &&
      origin === new URL(appUrl).origin &&
      headers.get('sec-fetch-site') !== 'cross-site'
    );
  } catch {
    return false;
  }
}

export const callbackInputSchema = z
  .object({
    code: z
      .string()
      .min(8)
      .max(2048)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    token_hash: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[a-fA-F0-9]+$/)
      .optional(),
    type: z.enum(['email', 'magiclink', 'signup', 'invite']).optional(),
    sb_flow_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
    next: z.string().max(1024).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.code
        ? Boolean(value.token_hash || value.type)
        : !value.token_hash || !value.type || Boolean(value.sb_flow_id)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A single supported sign-in token is required.',
      });
    }
  });

export function sessionCookieOptions(production: boolean, verifiedLocalHttp = false) {
  return {
    httpOnly: true,
    secure: production && !verifiedLocalHttp,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function isSessionCookie(name: string): boolean {
  return /^sb-threadsignal-auth-token(?:(?:-flow-[A-Za-z0-9_-]{8,64}|-flows)?-code-verifier)?(?:\.\d+)?$/.test(
    name,
  );
}
