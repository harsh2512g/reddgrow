import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from './lib/auth/proxy-session';
import { requestSecurity } from './lib/security-policy';

/** Security headers do not replace server authorization or PostgreSQL RLS. */
export async function proxy(request: NextRequest) {
  const security = requestSecurity({
    development: process.env.NODE_ENV === 'development',
    local: process.env.THREADSIGNAL_LOCAL === '1',
  });
  // Next reads CSP from the forwarded request to nonce its framework scripts.
  // Replace every incoming nonce/CSP/request ID so clients cannot choose trust material.
  request.headers.set('x-nonce', security.nonce);
  request.headers.set('x-request-id', security.requestId);
  request.headers.set('Content-Security-Policy', security.policy);
  const pathname = request.nextUrl.pathname;
  const sessionPath = pathname === '/login' || /^\/(?:app|internal)(?:\/|$)/.test(pathname);
  const response = sessionPath
    ? await refreshSession(request)
    : NextResponse.next({ request: { headers: request.headers } });
  response.headers.set('x-request-id', security.requestId);
  if (!/^\/(?:api|auth|go)(?:\/|$)/.test(pathname)) {
    response.headers.set('Content-Security-Policy', security.policy);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|threadsignal.js).*)'],
};
