import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  sourcemap: true,
  // Workspace TypeScript is bundled. Node libraries retain their native assets.
  external: [
    'bullmq',
    'ioredis',
    'postgres',
    'pino',
    'zod',
    '@threadsignal/knowledge',
    '@threadsignal/knowledge/pipeline',
  ],
});
