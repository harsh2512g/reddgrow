import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const profile = JSON.parse(
  await readFile(new URL('../../config/extension-development.json', root), 'utf8'),
);
if (
  profile.apiOrigin !== 'http://127.0.0.1:3000' ||
  !/^[a-p]{32}$/.test(profile.extensionId) ||
  typeof profile.manifestKey !== 'string'
) {
  throw new Error('Invalid local extension profile.');
}
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
manifest.key = profile.manifestKey;
await rm(output, { recursive: true, force: true });
await mkdir(new URL('sidepanel/', output), { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/background/index.ts', 'src/sidepanel/index.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome116',
  sourcemap: false,
  minify: true,
});
await Promise.all([
  writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`),
  cp(new URL('src/sidepanel/index.html', root), new URL('sidepanel/index.html', output)),
  cp(new URL('src/sidepanel/styles.css', root), new URL('sidepanel/styles.css', output)),
]);
