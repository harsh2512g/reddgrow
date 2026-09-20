// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanel } from '../src/sidepanel/panel';
import type { PanelMessage } from '../src/shared/messages';

const uuid = '00000000-0000-4000-8000-000000000001';
const session = {
  id: uuid,
  organizationId: uuid,
  organizationName: 'Demo workspace',
  name: 'My browser',
  expiresAt: '2099-01-01T00:00:00Z',
};
const current = {
  organization_id: uuid,
  organization_name: 'Demo workspace',
  opportunity: {
    id: uuid,
    brand_id: uuid,
    brand_name: 'Demo',
    title: '<script>unsafe()</script>',
    summary: 'Synthetic conversation',
    final_score: 95,
    risk_level: 'low',
    permalink: 'https://www.reddit.com/r/SaaS/comments/demo/thread/',
    subreddit: 'SaaS',
    post_id: 'demo',
  },
  draft: {
    id: uuid,
    version: 1,
    content: 'I work with the team. Review the documented limitation.',
    strategy: 'Help first',
    approved_at: '2026-09-17T00:00:00Z',
    disclosure_included: true,
    compliance_status: 'pass',
    inserted_at: null,
    inserted_version: null,
    published_at: null,
    published_version: null,
    published_comment_url: null,
  },
  rules: [{ title: 'Disclose affiliation', description: 'Be transparent.' }],
  claims: [],
  draft_unavailable_reason: null,
};

function node<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function click(id: string) {
  node(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
function setup(connected = true) {
  const send = vi.fn(async (message: PanelMessage): Promise<unknown> => {
    if (message.type === 'status')
      return { ok: true, data: { session: connected ? session : null } };
    if (message.type === 'lookup') return { ok: true, data: { current } };
    if (message.type === 'save') return { ok: true, data: { version: 2 } };
    if (message.type === 'copy') return { ok: true, data: { content: current.draft.content } };
    if (message.type === 'insert') return { ok: true, data: { inserted: true, recorded: true } };
    return { ok: true, data: { session } };
  });
  const clipboard = vi.fn().mockResolvedValue(undefined);
  const panel = createPanel({ document, send, clipboard, confirm: () => true, version: '0.5.0' });
  return { panel, send, clipboard };
}

beforeEach(async () => {
  const html = await readFile('apps/extension/src/sidepanel/index.html', 'utf8');
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
});

describe('reply studio safety and states', () => {
  it('starts disconnected without reading the active tab', async () => {
    const { panel, send } = setup(false);
    await panel.ready;
    expect(node('connection').hidden).toBe(false);
    expect(node('lookup').hidden).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'status' });
  });

  it('renders approved content as text and enables only explicit handoff actions', async () => {
    const { panel } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    expect(node('draft').hidden).toBe(false);
    expect(node('post-title').textContent).toBe('<script>unsafe()</script>');
    expect(node('post-title').querySelector('script')).toBeNull();
    expect(node<HTMLButtonElement>('insert').disabled).toBe(false);
    expect(node<HTMLButtonElement>('save').disabled).toBe(true);
    expect(node<HTMLButtonElement>('published').disabled).toBe(true);
  });

  it('disables copy and insertion immediately after any local edit', async () => {
    const { panel, clipboard } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    node<HTMLTextAreaElement>('draft-text').value += ' An unsupported claim.';
    node('draft-text').dispatchEvent(new Event('input'));
    expect(node<HTMLButtonElement>('copy').disabled).toBe(true);
    expect(node<HTMLButtonElement>('insert').disabled).toBe(true);
    expect(node<HTMLButtonElement>('save').disabled).toBe(false);
    expect(node('approval-note').textContent).toContain('fresh verification and approval');
    expect(clipboard).not.toHaveBeenCalled();
  });

  it('saves edits for verification and requires app approval before further handoff', async () => {
    const { panel, send } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    node<HTMLTextAreaElement>('draft-text').value += ' More context.';
    node('draft-text').dispatchEvent(new Event('input'));
    click('save');
    await settle();
    expect(send).toHaveBeenLastCalledWith({
      type: 'save',
      draftId: uuid,
      expectedVersion: 1,
      content: expect.stringContaining('More context.'),
    });
    expect(node('draft-state').textContent).toBe('Needs review');
    expect(node<HTMLButtonElement>('insert').disabled).toBe(true);
    expect(node<HTMLButtonElement>('copy').disabled).toBe(true);
    expect(node<HTMLTextAreaElement>('draft-text').disabled).toBe(true);
  });

  it('copies only the freshly approved server response', async () => {
    const { panel, clipboard, send } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    click('copy');
    await settle();
    expect(send).toHaveBeenLastCalledWith({ type: 'copy', draftId: uuid, expectedVersion: 1 });
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(current.draft.content);
    expect(node('status').textContent).toContain('submit it yourself');
  });

  it('provides a manual keyboard-copy fallback when clipboard access is unavailable', async () => {
    const { panel, clipboard } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    clipboard.mockRejectedValueOnce(new Error('denied'));
    click('copy');
    await settle();
    const editor = node<HTMLTextAreaElement>('draft-text');
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(current.draft.content.length);
    expect(node('status').textContent).toContain('Ctrl+C');
  });

  it('shows a safe insertion error without replacing the saved draft', async () => {
    const { panel, send } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    send.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'COMPOSER_NOT_EMPTY',
        message: 'Your comment box already contains text. Use Copy instead.',
      },
    });
    click('insert');
    await settle();
    expect(node('status').textContent).toContain('Use Copy instead');
    expect(node<HTMLTextAreaElement>('draft-text').value).toBe(current.draft.content);
    expect(node<HTMLButtonElement>('copy').disabled).toBe(false);
  });

  it('clears connected UI after revoked credentials are reported', async () => {
    const { panel, send } = setup();
    await panel.ready;
    click('refresh');
    await settle();
    send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'EXTENSION_UNAUTHORIZED', message: 'Reconnect your workspace.' },
    });
    click('copy');
    await settle();
    expect(node('connection').hidden).toBe(false);
    expect(node('draft').hidden).toBe(true);
    expect(node<HTMLTextAreaElement>('draft-text').value).toBe('');
  });
});
