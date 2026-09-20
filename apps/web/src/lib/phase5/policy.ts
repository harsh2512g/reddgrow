import development from '../../../../../config/extension-development.json';
import { codeSchema, tokenSchema } from '@threadsignal/extension-contracts';
export const extensionId = development.extensionId;
export const extensionOrigin = `chrome-extension://${extensionId}`;
export { codeSchema, tokenSchema };
export function trustedExtensionHost(request: Request) {
  // NextURL canonicalizes loopback IPs to localhost. Require the exact incoming
  // Host as well, so normalization never grants another loopback name or address.
  const url = new URL(request.url);
  return (
    request.headers.get('host') === new URL(development.apiOrigin).host &&
    (url.origin === development.apiOrigin || url.origin === 'http://localhost:3000')
  );
}
export function trustedExtensionRequest(request: Request) {
  // Chrome can omit Origin on same-extension background GETs. The explicit ID is
  // a routing constraint, never authentication; every data operation needs a token.
  const origin = request.headers.get('origin');
  return (
    request.headers.get('x-threadsignal-extension') === extensionId &&
    (origin === null || origin === extensionOrigin) &&
    trustedExtensionHost(request) &&
    !request.headers.has('cookie')
  );
}
export function extensionCors(request: Request): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.headers.get('origin') === extensionOrigin)
    headers.set('Access-Control-Allow-Origin', extensionOrigin);
  return headers;
}
