import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { X509Certificate } from 'node:crypto';
import { assertInside, root } from './isolation.mjs';

// Only the owner-authorized DATABASE_URL is read. Never export root dotenv values
// to a child process or include the parser's original errors in diagnostics.
export function parseHostedDatabaseConfig(source, projectRef) {
  try {
    if (!/^[a-z]{20}$/.test(projectRef)) throw new Error();
    const lines = source
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line));
    if (lines.length !== 1) throw new Error();
    const value = parseEnv(lines[0]).DATABASE_URL;
    if (!value || value.length > 4096 || /[\r\n]/.test(value)) throw new Error();
    const url = new URL(value);
    const direct = url.hostname === `db.${projectRef}.supabase.co`;
    const pooler = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(url.hostname);
    const username = decodeURIComponent(url.username);
    // A lone percent sign cannot be a URI escape. Preserve it as a literal,
    // in memory only; valid escapes still decode exactly once.
    const password = decodeURIComponent(url.password.replace(/%(?![0-9a-f]{2})/gi, '%25'));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      (!direct && !pooler) ||
      (direct ? username !== 'postgres' : username !== `postgres.${projectRef}`) ||
      !password ||
      /\[YOUR[^\]]*\]/i.test(password) ||
      !['', '5432'].includes(url.port) ||
      url.pathname !== '/postgres' ||
      url.hash ||
      [...url.searchParams].some(
        ([key, item]) => key !== 'sslmode' || !['require', 'verify-full'].includes(item),
      )
    )
      throw new Error();
    return {
      host: url.hostname,
      port: 5432,
      database: 'postgres',
      username,
      password,
      ssl: { rejectUnauthorized: true },
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      connection: { application_name: 'threadsignal-hosted-migration', statement_timeout: 15000 },
      onnotice: () => undefined,
    };
  } catch {
    throw new Error(
      'Invalid DATABASE_URL: use this personal project’s complete direct or session-pooler URI on port 5432, with its URL-encoded database password.',
    );
  }
}

export function readHostedDatabaseConfig(projectRef) {
  let descriptor;
  try {
    descriptor = openSync(
      assertInside(join(root, '.env.local')),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 131072) throw new Error();
    return parseHostedDatabaseConfig(readFileSync(descriptor, 'utf8'), projectRef);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid DATABASE_URL:')) throw error;
    throw new Error('Cannot read DATABASE_URL from the repository’s regular .env.local file.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function safeDatabaseError(error) {
  const codes = new Set([
    '28P01',
    '28000',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'CONNECT_TIMEOUT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    '42501',
    '42P01',
    '42710',
    '55P03',
    '57014',
  ]);
  return codes.has(error?.code) ? error.code : 'HOSTED_DATABASE_CHECK_FAILED';
}

// URL verified against Supabase's public Studio custom-content.json. No account
// configuration or machine-wide trust store is read or changed.
export async function loadSupabaseCertificate(request = fetch) {
  const response = await request(
    'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',
    {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error('Supabase public CA download failed.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Supabase public CA download failed.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10000) throw new Error('Invalid Supabase public CA.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const ca = Buffer.concat(chunks).toString('utf8');
  const cert = new X509Certificate(ca);
  if (
    !cert.ca ||
    !cert.verify(cert.publicKey) ||
    Date.parse(cert.validTo) <= Date.now() ||
    Date.parse(cert.validFrom) > Date.now()
  )
    throw new Error('Invalid Supabase public CA.');
  return ca;
}
