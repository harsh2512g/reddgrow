import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { root, assertInside } from './isolation.mjs';
import {
  prepareSupabase,
  supabase,
  verifyDocker,
  localDatabaseUrl,
  recordServiceRuntime,
} from './service-utils.mjs';

if (process.env.THREADSIGNAL_LOCAL !== '1') throw new Error('Use the isolated local runner.');
verifyDocker();
const url = localDatabaseUrl();
prepareSupabase();
const [operation] = process.argv.slice(2);
if (operation === 'reset') {
  supabase(['db', 'reset', '--local', '--yes']);
  recordServiceRuntime();
  process.stdout.write('Project-local database reset and migration applied.\n');
} else if (operation === 'migrate') {
  supabase(['migration', 'up', '--local']);
  process.stdout.write('Pending project-local migrations applied without resetting data.\n');
} else if (operation === 'types') {
  const result = supabase(['gen', 'types', 'typescript', '--local', '--schema', 'public']);
  if (!result.stdout.includes('export type Database'))
    throw new Error('Database type generation returned unexpected output.');
  writeFileSync(assertInside(join(root, 'packages/database/src/database.types.ts')), result.stdout);
  process.stdout.write('Local database types regenerated.\n');
} else if (operation === 'seed' || operation === 'lint') {
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const source = operation === 'seed' ? 'supabase/seed.sql' : 'supabase/tests/foundation.sql';
    await sql.unsafe(readFileSync(join(root, source), 'utf8'));
    if (operation === 'lint') supabase(['db', 'lint', '--local', '--level', 'warning']);
    process.stdout.write(
      operation === 'seed'
        ? 'Idempotent local foundation seed applied.\n'
        : 'Migration foundation assertions and database lint passed.\n',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
} else throw new Error('Use reset, migrate, seed, types, or lint.');
