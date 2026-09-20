import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { assertInside, root, state, localEnvironment } from './isolation.mjs';
import { parseHostedProfile } from './hosted-profile.mjs';

export const workerProfilePath = join(state, 'hosted-worker.json');
const workerSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.literal('personal-development'),
  projectRef: z.string().regex(/^[a-z]{20}$/),
  host: z.string().max(256),
  port: z.literal(5432),
  username: z.string().max(128),
  password: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export function parseHostedWorkerProfile(input, projectRef) {
  const parsed = workerSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid hosted worker profile.');
  const value = parsed.data;
  const direct = value.host === `db.${projectRef}.supabase.co`;
  if (
    value.projectRef !== projectRef ||
    (!direct && !/^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(value.host)) ||
    value.username !== (direct ? 'threadsignal_worker' : `threadsignal_worker.${projectRef}`)
  )
    throw new Error('Invalid hosted worker profile.');
  return value;
}

function readRegularFile(path, limit, privateFile = false) {
  const descriptor = openSync(assertInside(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit || (privateFile && stat.mode & 0o077))
      throw new Error('Invalid private configuration file.');
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function readHostedWorkerProfile(projectRef) {
  try {
    return parseHostedWorkerProfile(
      JSON.parse(readRegularFile(workerProfilePath, 4096, true)),
      projectRef,
    );
  } catch {
    throw new Error('Prepare the dedicated hosted worker profile first.');
  }
}

export function createHostedWorkerProfile(projectRef, adminConfig) {
  const profile = parseHostedWorkerProfile(
    {
      version: 1,
      purpose: 'personal-development',
      projectRef,
      host: adminConfig.host,
      port: 5432,
      username:
        adminConfig.host === `db.${projectRef}.supabase.co`
          ? 'threadsignal_worker'
          : `threadsignal_worker.${projectRef}`,
      password: randomBytes(32).toString('base64url'),
    },
    projectRef,
  );
  mkdirSync(assertInside(state), { recursive: true, mode: 0o700 });
  // Exclusive creation: never replace a working worker credential automatically.
  writeFileSync(assertInside(workerProfilePath), JSON.stringify(profile) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return profile;
}

export function parseHostedStorageSecret(source) {
  try {
    const lines = source
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:export\s+)?SUPABASE_SECRET_KEY\s*=/.test(line));
    if (lines.length !== 1) throw new Error();
    const key = parseEnv(lines[0]).SUPABASE_SECRET_KEY;
    if (!/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(key ?? '')) throw new Error();
    return key;
  } catch {
    throw new Error(
      'Configure the new personal project SUPABASE_SECRET_KEY in ignored root .env.local.',
    );
  }
}

export function readHostedStorageSecret() {
  return parseHostedStorageSecret(readRegularFile(join(root, '.env.local'), 131072));
}

export function workerDatabaseConfig(profile, ca) {
  return {
    host: profile.host,
    port: profile.port,
    database: 'postgres',
    username: profile.username,
    password: profile.password,
    ssl: { ca, rejectUnauthorized: true },
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
    connection: { application_name: 'threadsignal-hosted-worker-check', statement_timeout: 15000 },
  };
}

export function hostedWorkerEnvironment(profile, publicProfile, ca, storageKey) {
  publicProfile = parseHostedProfile(publicProfile);
  const valid = parseHostedWorkerProfile(profile, publicProfile.projectRef);
  const database = new URL(`postgresql://${valid.host}:5432/postgres`);
  database.username = valid.username;
  database.password = valid.password;
  return {
    ...localEnvironment(),
    THREADSIGNAL_WORKER_MODE: 'personal-development',
    THREADSIGNAL_SUPABASE_MODE: 'personal-development',
    THREADSIGNAL_SUPABASE_PROJECT_REF: valid.projectRef,
    NEXT_PUBLIC_SUPABASE_URL: publicProfile.url,
    DATABASE_URL: database.toString(),
    SUPABASE_SECRET_KEY: storageKey,
    THREADSIGNAL_DATABASE_CA: ca,
    WORKER_PORT: '3003',
  };
}

// Generate the SCRAM verifier locally: SQL never contains the plaintext password.
export function scramVerifier(password, salt = randomBytes(16)) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error('Invalid generated worker password.');
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}
