import { build } from 'esbuild';
await build({
  entryPoints: ['src/snippet.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  outfile: '../../apps/web/public/threadsignal.js',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
  banner: {
    js: '/* ThreadSignal consent-controlled attribution. No automatic events or third-party cookies. */',
  },
});
