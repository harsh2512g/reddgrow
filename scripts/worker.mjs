import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { root, assertInside, localEnvironment, rejectAppEnvFiles } from './isolation.mjs';
import { loadVerifiedServiceRuntime, supabase, verifyDocker } from './service-utils.mjs';
import { parseWorkerStorageKey } from './worker-storage.mjs';

try {
  const mode = process.argv[2];
  if (
    !['dev', 'start'].includes(mode) ||
    process.argv.length !== 3 ||
    process.env.THREADSIGNAL_LOCAL !== '1'
  )
    throw new Error();
  rejectAppEnvFiles();
  verifyDocker();
  const runtime = loadVerifiedServiceRuntime();
  if (!runtime) throw new Error();
  // This key is fetched only after exact project context and container ownership verification.
  // It is not written to disk, printed, inherited by the web app, or included in queue payloads.
  const key = parseWorkerStorageKey(supabase(['status', '--output', 'json']).stdout);
  const policy = z
    .object({
      maxPostAgeDays: z.number().int().min(1).max(30),
      contentRetentionDays: z.number().int().min(1).max(30),
    })
    .strict()
    .refine((value) => value.maxPostAgeDays <= value.contentRetentionDays)
    .parse(
      JSON.parse(readFileSync(assertInside(join(root, 'config/reddit-development.json')), 'utf8')),
    );
  const draftPolicy = z
    .object({
      maxSourceCharacters: z.number().int().min(1000).max(24_000),
      maxContextCharacters: z.number().int().min(20_000).max(80_000),
    })
    .strict()
    .refine((value) => value.maxSourceCharacters <= value.maxContextCharacters)
    .parse(
      JSON.parse(readFileSync(assertInside(join(root, 'config/drafts-development.json')), 'utf8')),
    );
  const env = {
    ...localEnvironment(),
    DATABASE_URL: runtime.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: key,
    REDDIT_MAX_POST_AGE_DAYS: String(policy.maxPostAgeDays),
    REDDIT_CONTENT_RETENTION_DAYS: String(policy.contentRetentionDays),
    DRAFT_MAX_SOURCE_CHARACTERS: String(draftPolicy.maxSourceCharacters),
    DRAFT_MAX_CONTEXT_CHARACTERS: String(draftPolicy.maxContextCharacters),
  };
  const child =
    mode === 'dev'
      ? spawn('tsx', ['watch', 'src/index.ts'], {
          cwd: join(root, 'apps/worker'),
          env,
          stdio: 'inherit',
        })
      : spawn(process.execPath, ['dist/index.js'], {
          cwd: join(root, 'apps/worker'),
          env,
          stdio: 'inherit',
        });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', () => {
    process.stderr.write('Worker process could not start.\n');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  process.stderr.write(
    'Start the local worker through ./scripts/local after project services are healthy.\n',
  );
  process.exitCode = 1;
}
