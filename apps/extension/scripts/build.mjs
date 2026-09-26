import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readPublicExtensionProfile } from './profile.mjs';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const deployment = args.length === 3 && args[0] === '--deployment' && args[1] === '--profile';
if (args.length && !deployment)
  throw new Error(
    'Use --deployment --profile <repository-relative-public.json>, or no arguments for development.',
  );
const profile = await readPublicExtensionProfile(
  fileURLToPath(new URL('../../', root)),
  deployment ? args[2] : 'config/extension-development.json',
  deployment,
);
const outputName = deployment ? 'dist-deployment' : 'dist';
const output = new URL(`${outputName}/`, root);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
manifest.key = profile.manifestKey;
manifest.host_permissions = [`${profile.apiOrigin}/*`];
manifest.content_security_policy.extension_pages = `script-src 'self'; object-src 'none'; connect-src ${profile.apiOrigin}; form-action 'none'; base-uri 'none'`;
await rm(output, { recursive: true, force: true });
await mkdir(new URL('sidepanel/', output), { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/background/index.ts', 'src/sidepanel/index.ts'],
  outdir: outputName,
  outbase: 'src',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome116',
  sourcemap: false,
  minify: true,
  define: {
    __THREADSIGNAL_EXTENSION_API_ORIGIN__: JSON.stringify(profile.apiOrigin),
    __THREADSIGNAL_EXTENSION_DEPLOYMENT__: JSON.stringify(deployment),
  },
});
let panel = await readFile(new URL('src/sidepanel/index.html', root), 'utf8');
panel = panel.replaceAll('http://127.0.0.1:3000', profile.apiOrigin);
if (deployment)
  panel = panel
    .replace(
      '<span class="local-pill">Local</span>',
      '<span class="local-pill">Connected app</span>',
    )
    .replace(
      'Open a supported Reddit post or the local composer fixture. Click below when you are',
      'Open a supported Reddit post. Click below when you are',
    );
await Promise.all([
  writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(new URL('sidepanel/index.html', output), panel),
  cp(new URL('src/sidepanel/styles.css', root), new URL('sidepanel/styles.css', output)),
]);
