import { z } from 'zod';
import { currentResponseSchema, type ExtensionCurrent } from '@threadsignal/extension-contracts';
import { sessionMetadataSchema, type PanelMessage } from '../shared/messages';
import { LOCAL_APP_ORIGIN } from '../background/api';

const envelope = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
const sessionResponse = z.object({ session: sessionMetadataSchema.nullable() });

export function createPanel(options: {
  document: Document;
  send: (message: PanelMessage) => Promise<unknown>;
  clipboard: (text: string) => Promise<void>;
  confirm: (message: string) => boolean;
  version: string;
}) {
  const { document, send } = options;
  function element<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error('Panel element missing.');
    return node as T;
  }
  let current: ExtensionCurrent | null = null;
  let original = '';
  let pendingReview = false;
  let busy = false;
  const editor = element<HTMLTextAreaElement>('draft-text');
  const status = element('status');
  const buttons = [...document.querySelectorAll('button')];
  const dirty = () => editor.value !== original;
  function announce(message: string, tone: 'neutral' | 'error' | 'success' = 'neutral') {
    status.textContent = message;
    status.className = `notice ${tone === 'neutral' ? '' : tone}`;
  }
  function controls() {
    for (const button of buttons) button.disabled = busy;
    const ready = Boolean(current?.draft) && !dirty() && !pendingReview && !busy;
    element<HTMLButtonElement>('insert').disabled = !ready;
    element<HTMLButtonElement>('copy').disabled = !ready;
    element<HTMLButtonElement>('published').disabled =
      !ready || !element<HTMLInputElement>('published-confirm').checked;
    element<HTMLButtonElement>('save').disabled =
      busy || !dirty() || pendingReview || !current?.draft;
    element<HTMLButtonElement>('discard').disabled = busy || !dirty() || pendingReview;
    editor.disabled = busy || pendingReview;
    element('word-count').textContent =
      `${editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0} words · ${editor.value.length.toLocaleString()} characters`;
    element('draft-state').textContent = pendingReview
      ? 'Needs review'
      : dirty()
        ? 'Unsaved edits'
        : 'Approved';
    element('approval-note').textContent = pendingReview
      ? 'Saved for verification. Review and approve the latest version in ThreadSignal, then look up this tab again.'
      : dirty()
        ? 'Local edits require fresh verification and approval. Save them before copying or inserting.'
        : 'Copy and insert recheck this approval and the active conversation before continuing.';
  }
  async function request(message: PanelMessage): Promise<unknown> {
    const response = envelope.parse(await send(message));
    if (!response.ok) {
      if (response.error.code === 'EXTENSION_UNAUTHORIZED') {
        connected(null);
      }
      throw new Error(response.error.message);
    }
    return response.data;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    controls();
    try {
      await action();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'The action failed. Try again.', 'error');
    } finally {
      busy = false;
      controls();
    }
  }
  function connected(session: z.infer<typeof sessionMetadataSchema> | null) {
    current = null;
    original = '';
    editor.value = '';
    pendingReview = false;
    element('connection').hidden = Boolean(session);
    element('connected').hidden = !session;
    element('lookup').hidden = !session;
    element('draft').hidden = true;
    element('opportunity').hidden = true;
    if (session) {
      element('connected-title').textContent = session.organizationName;
      element('session-name').textContent =
        `${session.name} · expires ${new Date(session.expiresAt).toLocaleDateString()}`;
    }
    controls();
  }
  function list(id: string, lines: string[], empty: string) {
    const container = element(id);
    container.replaceChildren();
    for (const line of lines.length ? lines : [empty]) {
      const li = document.createElement('li');
      li.textContent = line;
      container.append(li);
    }
  }
  function showCurrent(result: ExtensionCurrent) {
    current = result;
    pendingReview = false;
    const opportunity = result.opportunity;
    element('opportunity').hidden = !opportunity;
    element('draft').hidden = !result.draft;
    if (!opportunity) {
      announce(
        'No matching opportunity in this workspace. Add the community and review its opportunities in ThreadSignal.',
      );
      return;
    }
    element('subreddit').textContent = `r/${opportunity.subreddit} · ${opportunity.brand_name}`;
    element('score').textContent = `${opportunity.final_score}/100`;
    element('post-title').textContent = opportunity.title;
    element('post-summary').textContent = opportunity.summary;
    element('risk').textContent =
      `Community risk: ${opportunity.risk_level}. Read the latest rules before replying.`;
    const detail = `${LOCAL_APP_ORIGIN}/app/opportunities/${opportunity.id}`;
    element<HTMLAnchorElement>('open-detail').href = detail;
    element<HTMLAnchorElement>('open-review').href = result.draft
      ? `${LOCAL_APP_ORIGIN}/app/drafts/${result.draft.id}`
      : detail;
    list(
      'rules',
      result.rules.map((rule) => `${rule.title}: ${rule.description}`),
      'No rules were returned. Check the community rules directly before replying.',
    );
    if (!result.draft) {
      original = '';
      editor.value = '';
      announce(
        'This conversation has no current approved draft. Open ThreadSignal to generate, verify and approve one.',
      );
      return;
    }
    original = result.draft.content;
    editor.value = original;
    element('version').textContent = `Version ${result.draft.version}`;
    element<HTMLInputElement>('published-confirm').checked = false;
    element<HTMLInputElement>('comment-url').value = result.draft.published_comment_url ?? '';
    list(
      'evidence',
      result.claims.flatMap((claim) => [
        `${claim.status.replaceAll('_', ' ')} — ${claim.claim_text}`,
        ...claim.provenance.map(
          (source) =>
            `${source.title}${source.page_number ? `, page ${source.page_number}` : ''}${source.section_heading ? `, ${source.section_heading}` : ''}: ${source.excerpt}`,
        ),
      ]),
      'This draft contains general advice without a product-specific citation.',
    );
    list(
      'checks',
      [
        `Latest compliance review: ${result.draft.compliance_status}.`,
        result.draft.disclosure_included
          ? 'Affiliation disclosure is included.'
          : 'Review the persona disclosure requirements in ThreadSignal.',
        `Approved ${new Date(result.draft.approved_at).toLocaleString()}.`,
      ],
      'Review compliance in ThreadSignal.',
    );
    announce('Approved draft loaded. Review the evidence, then choose Copy or Insert.', 'success');
  }
  function target() {
    if (!current?.draft || pendingReview || dirty())
      throw new Error('Save, verify and approve the latest draft before continuing.');
    return { draftId: current.draft.id, expectedVersion: current.draft.version };
  }
  function on(id: string, action: () => Promise<void>) {
    element(id).addEventListener('click', () => {
      void run(action);
    });
  }
  on('connect', async () => {
    const code = element<HTMLInputElement>('connection-code').value.trim();
    element<HTMLInputElement>('connection-code').value = '';
    announce('Connecting your workspace…');
    connected(sessionResponse.parse(await request({ type: 'connect', code })).session);
    announce('Workspace connected. Open your conversation and look up the current tab.', 'success');
  });
  on('disconnect', async () => {
    if (dirty() && !options.confirm('Disconnect and discard these unsaved local edits?')) return;
    const response = z
      .object({ revoked: z.boolean(), session: z.null() })
      .parse(await request({ type: 'disconnect' }));
    connected(null);
    announce(
      response.revoked
        ? 'Disconnected. The session was revoked and local credentials were cleared.'
        : 'Local credentials were cleared. Server revocation could not be confirmed; revoke this session in integration settings.',
      response.revoked ? 'success' : 'neutral',
    );
  });
  on('refresh', async () => {
    if (
      dirty() &&
      !options.confirm('Discard these unsaved local edits and load the latest approved draft?')
    )
      return;
    announce('Looking up this conversation…');
    const response = z
      .object({ current: currentResponseSchema })
      .parse(await request({ type: 'lookup' }));
    showCurrent(response.current);
  });
  on('save', async () => {
    if (!current?.draft) return;
    const response = z.object({ version: z.number().int().positive() }).parse(
      await request({
        type: 'save',
        draftId: current.draft.id,
        expectedVersion: current.draft.version,
        content: editor.value,
      }),
    );
    original = editor.value;
    pendingReview = true;
    element('version').textContent = `Version ${response.version}`;
    announce('Edit saved for verification. Approve it in ThreadSignal before using it.', 'success');
  });
  on('discard', async () => {
    editor.value = original;
    announce('Local edits discarded. The loaded approved draft is restored.');
  });
  on('copy', async () => {
    const result = z
      .object({ content: z.string().max(12_000) })
      .parse(await request({ type: 'copy', ...target() }));
    try {
      await options.clipboard(result.content);
      announce(
        'Approved draft copied. Paste it, review it, then submit it yourself on Reddit.',
        'success',
      );
    } catch {
      // Selection stays in the extension page; no page clipboard or submit code is injected.
      editor.value = result.content;
      original = result.content;
      editor.disabled = false;
      editor.focus();
      editor.select();
      announce(
        'Clipboard permission was unavailable. The approved text is selected; press ⌘C or Ctrl+C to copy it.',
      );
    }
  });
  on('insert', async () => {
    const result = z
      .object({ inserted: z.literal(true), recorded: z.boolean() })
      .parse(await request({ type: 'insert', ...target() }));
    announce(
      result.recorded
        ? 'Draft inserted. Review the text, then submit it yourself on Reddit.'
        : 'Draft inserted, but the activity record could not be saved. Do not insert it again. Review the text and submit it yourself.',
      result.recorded ? 'success' : 'neutral',
    );
  });
  on('published', async () => {
    if (!element<HTMLInputElement>('published-confirm').checked) return;
    await request({
      type: 'published',
      ...target(),
      commentUrl: element<HTMLInputElement>('comment-url').value.trim(),
      confirmed: true,
    });
    element<HTMLInputElement>('published-confirm').checked = false;
    announce(
      'Your manual publication was recorded. ThreadSignal did not submit the reply.',
      'success',
    );
  });
  editor.addEventListener('input', controls);
  element('published-confirm').addEventListener('change', controls);
  document.defaultView?.addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  element('extension-version').textContent = `Version ${options.version}`;
  const ready = run(async () => {
    const result = sessionResponse.parse(await request({ type: 'status' }));
    connected(result.session);
    announce(
      result.session
        ? 'Workspace connected. Look up the current tab when you are ready.'
        : 'Connect your workspace to bring an approved reply into the conversation.',
    );
  });
  return { ready };
}
