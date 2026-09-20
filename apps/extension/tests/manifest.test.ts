import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('Phase 5 extension boundary', () => {
  it('uses temporary active-tab permission and only the local API host', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['sidePanel', 'storage', 'activeTab', 'scripting']);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1:3000/*']);
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(manifest).not.toHaveProperty('optional_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest).not.toHaveProperty('externally_connectable');
    expect(manifest.content_security_policy.extension_pages).toContain(
      'connect-src http://127.0.0.1:3000',
    );
    expect(manifest.content_security_policy.extension_pages).toContain("form-action 'none'");
  });

  it('contains no final-submit, synthetic keyboard, external messaging or browsing observer code', async () => {
    const root = new URL('../src/', import.meta.url);
    const files = await readdir(root, { recursive: true });
    const code = (
      await Promise.all(
        files
          .filter((file) => file.endsWith('.ts'))
          .map((file) => readFile(new URL(file, root), 'utf8')),
      )
    ).join('\n');
    expect(code).not.toMatch(/\.(?:submit|requestSubmit|click)\s*\(/);
    expect(code).not.toMatch(/\b(?:KeyboardEvent|MutationObserver|XMLHttpRequest|WebSocket)\b/);
    expect(code).not.toMatch(/chrome\.(?:webRequest|cookies|debugger|history)\b/);
    expect(code).not.toMatch(
      /(?:onMessageExternal|onConnectExternal|onActivated|onUpdated)\.addListener/,
    );
    expect(code).not.toMatch(/(?:api\/comment|api\/vote|api\/compose|execCommand|innerHTML\s*=)/);
  });

  it('never exposes credentials to the panel or injected function', async () => {
    const panel = await readFile(new URL('../src/sidepanel/panel.ts', import.meta.url), 'utf8');
    const content = await readFile(
      new URL('../src/content/insert-composer.ts', import.meta.url),
      'utf8',
    );
    expect(panel).not.toMatch(/chrome\.storage|Authorization|Bearer|credentialsSchema/);
    expect(content).not.toMatch(/chrome\.|fetch\(|storage|token|password/i);
  });
});
