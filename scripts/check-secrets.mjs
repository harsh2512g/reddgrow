import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { join, extname } from 'node:path';
import { root, assertInside, localEnvironment } from './isolation.mjs';

const result = spawnSync(
  'git',
  ['-c', 'core.fsmonitor=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    env: {
      ...localEnvironment(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
    },
    encoding: 'utf8',
  },
);
if (result.status !== 0) throw new Error('Unable to inspect repository file names.');
let failures = 0;
let checked = 0;
for (const path of [...new Set(result.stdout.split('\0').filter(Boolean))]) {
  if (
    /(^|\/)(node_modules|\.threadsignal|\.pnpm-store)(\/|$)/.test(path) ||
    /(^|\/)\.env(?!\.example$)/.test(path) ||
    /\.(pem|p12|pfx|key)$/.test(path)
  ) {
    process.stderr.write(`Forbidden tracked/unignored file: ${path}\n`);
    failures++;
    continue;
  }
  const file = assertInside(join(root, path));
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || ['.ico', '.png', '.jpg', '.woff2'].includes(extname(path))) continue;
  const text = readFileSync(file, 'utf8');
  checked++;
  if (path.endsWith('.env.example')) {
    if (
      text
        .split('\n')
        .some((line) => line.trim() && !line.startsWith('#') && !/^[A-Z][A-Z0-9_]*=$/.test(line))
    ) {
      process.stderr.write(`Environment example contains more than variable names: ${path}\n`);
      failures++;
    }
    continue;
  }
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk_live_|rk_live_)[A-Za-z0-9]{20,}/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  ];
  for (const pattern of forbidden)
    if (pattern.test(text)) {
      process.stderr.write(`Potential secret pattern in ${path}; value withheld.\n`);
      failures++;
    }
  if (
    !['AGENTS.md', 'scripts/check-secrets.mjs'].includes(path) &&
    /gofynd|pixelbin|\bfynd\b/i.test(text)
  ) {
    process.stderr.write(`Disallowed operational reference in ${path}; value withheld.\n`);
    failures++;
  }
}
if (failures) {
  process.stderr.write(`${failures} repository hygiene findings.\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    `${checked} repository text files checked; no tracked env/dependencies, supported secret patterns, or operational employer references. Instruction prohibitions are excluded.\n`,
  );
