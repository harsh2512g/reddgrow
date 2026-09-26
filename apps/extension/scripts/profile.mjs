import { createHash, createPublicKey } from 'node:crypto';
import { isIP } from 'node:net';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export function chromeIdForPublicKey(manifestKey) {
  if (
    typeof manifestKey !== 'string' ||
    manifestKey.length > 2048 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(manifestKey)
  )
    throw new Error('Extension profile requires a DER SPKI public key encoded as base64.');
  const bytes = Buffer.from(manifestKey, 'base64');
  if (bytes.toString('base64') !== manifestKey)
    throw new Error('Extension public key must use canonical base64.');
  let publicKey;
  try {
    publicKey = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  } catch {
    throw new Error('Extension manifest key must be a valid public SPKI key.');
  }
  if (
    publicKey.asymmetricKeyType !== 'rsa' ||
    (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
    !publicKey.export({ format: 'der', type: 'spki' }).equals(bytes)
  )
    throw new Error(
      'Extension manifest key must be a canonical RSA public key of at least 2048 bits.',
    );
  return [...createHash('sha256').update(bytes).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('');
}

export function validateExtensionProfile(input, deployment = false) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'apiOrigin,extensionId,manifestKey'
  )
    throw new Error(
      'Extension profile accepts only public apiOrigin, extensionId and manifestKey fields.',
    );
  const { apiOrigin, extensionId, manifestKey } = input;
  if (
    typeof apiOrigin !== 'string' ||
    typeof extensionId !== 'string' ||
    !/^[a-p]{32}$/.test(extensionId)
  )
    throw new Error('Invalid extension origin or extension ID.');
  if (deployment) {
    let url;
    try {
      url = new URL(apiOrigin);
    } catch {
      throw new Error('Deployment extension origin must be canonical HTTPS.');
    }
    if (
      url.origin !== apiOrigin ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      isIP(url.hostname) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|lan|home|onion)$/.test(url.hostname)
    )
      throw new Error(
        'Deployment extension origin must be one public HTTPS DNS origin without credentials, paths or ports.',
      );
  } else if (apiOrigin !== 'http://127.0.0.1:3000')
    throw new Error('Default extension uses only the fixed local API origin.');
  if (chromeIdForPublicKey(manifestKey) !== extensionId)
    throw new Error('Extension ID does not match the manifest public key.');
  return { apiOrigin, extensionId, manifestKey };
}

/** Validate the path before reading; reject symlinked ancestors and credential files. */
export async function readPublicExtensionProfile(repositoryRoot, profilePath, deployment = false) {
  if (
    typeof profilePath !== 'string' ||
    isAbsolute(profilePath) ||
    profilePath.includes('\\') ||
    !profilePath.endsWith('.json')
  )
    throw new Error('Extension profile must be a repository-relative public JSON file.');
  const parts = profilePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /^\.env(?:\.|$)/i.test(part)))
    throw new Error(
      'Extension profile path cannot traverse directories or name an environment file.',
    );
  const root = resolve(repositoryRoot);
  let candidate = root;
  for (let index = 0; index < parts.length; index++) {
    candidate = join(candidate, parts[index]);
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error(
        'Extension profile must be a regular file with no symlinked path components.',
      );
    if (index === parts.length - 1 && info.size > 16_384)
      throw new Error('Extension public profile is too large.');
  }
  const scoped = relative(root, candidate);
  if (scoped.startsWith(`..${sep}`) || isAbsolute(scoped))
    throw new Error('Extension profile must stay in the repository.');
  let value;
  try {
    value = JSON.parse(await readFile(candidate, 'utf8'));
  } catch {
    throw new Error('Extension public profile is not valid JSON.');
  }
  return validateExtensionProfile(value, deployment);
}
