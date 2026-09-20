/** Accept only the fresh service-role JWT returned by this repository's owned local stack. */
export function parseWorkerStorageKey(raw) {
  try {
    const value = JSON.parse(raw);
    const url = new URL(value.API_URL);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.protocol !== 'http:' ||
      url.port !== '54321' ||
      !['', '/'].includes(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error();
    const key = value.SERVICE_ROLE_KEY;
    if (
      typeof key !== 'string' ||
      key.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
    )
      throw new Error();
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (claims.role !== 'service_role') throw new Error();
    return key;
  } catch {
    throw new Error('Local worker storage configuration is invalid.');
  }
}
