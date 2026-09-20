export const LOCAL_APP_ORIGIN = 'http://127.0.0.1:3000';
const RESPONSE_LIMIT = 512_000;

export class ExtensionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const messages: Record<string, string> = {
  EXTENSION_UNAUTHORIZED: 'Your connection expired or was revoked. Connect the workspace again.',
  SESSION_INVALID: 'Your connection expired or was revoked. Connect the workspace again.',
  INVALID_CODE: 'This connection code is invalid, expired, or already used. Create a new code.',
  CODE_INVALID: 'This connection code is invalid, expired, or already used. Create a new code.',
  EXTENSION_CODE_INVALID:
    'This connection code expired, was replaced, or was already used. Create a new code in ThreadSignal’s integration settings.',
  EXTENSION_SESSION_INVALID: 'Your connection expired or was revoked. Connect the workspace again.',
  EXTENSION_SESSION_LIMIT:
    'This workspace account already has five extension sessions. Disconnect one in ThreadSignal’s integration settings, then create a new connection code.',
  EXTENSION_SESSION_NOT_FOUND:
    'This connection is no longer available. Connect the workspace again from ThreadSignal’s integration settings.',
  EXTENSION_RATE_LIMIT: 'Too many requests. Wait a minute, then try again.',
  INVALID_INPUT: 'Check the entered fields, then try again.',
  WORKSPACE_CHANGED:
    'The workspace changed. Open ThreadSignal’s integration settings and connect the intended workspace again.',
  DRAFT_NOT_FOUND:
    'This draft is no longer available in your workspace. Look up the tab again or choose another opportunity in ThreadSignal.',
  DRAFT_NOT_APPROVED:
    'Review and approve the latest draft in ThreadSignal, then look up this tab again.',
  DRAFT_VERSION_CONFLICT: 'The draft changed. Look up this tab again before continuing.',
  VERSION_CONFLICT: 'The draft changed. Look up this tab again before continuing.',
  APPROVAL_STALE: 'The evidence or community context changed. Review and approve the draft again.',
  DRAFT_CONTEXT_CHANGED:
    'The evidence or community context changed. Verify and approve the draft again in ThreadSignal, then look up this tab again.',
  VERIFICATION_REQUIRED:
    'Verify and approve the current draft in ThreadSignal, then look up this tab again.',
  DRAFT_APPROVAL_BLOCKED:
    'This draft has unresolved checks. Fix them in ThreadSignal, verify and approve the draft, then look up this tab again.',
  INVALID_COMMENT_URL: 'Paste the resulting comment permalink from this same Reddit discussion.',
  PUBLICATION_ALREADY_RECORDED:
    'A different publication is already recorded for this draft. Review its existing comment link in ThreadSignal.',
  POST_DELETED:
    'This discussion was deleted and its draft is unavailable. Choose another opportunity in ThreadSignal.',
  POST_STALE:
    'Refresh community monitoring in ThreadSignal before using this discussion, then look up this tab again.',
  OPPORTUNITY_BLOCKED:
    'This discussion is blocked or closed for replies. Choose another opportunity in ThreadSignal.',
  OPPORTUNITY_UNAVAILABLE:
    'Reopen this opportunity in ThreadSignal before using its draft, then look up this tab again.',
  SUBREDDIT_PAUSED: 'Resume community monitoring in ThreadSignal, then look up this tab again.',
  BRAND_ARCHIVED: 'Restore the brand in ThreadSignal before using this draft.',
  ORGANIZATION_UNAVAILABLE:
    'This workspace is unavailable. Check your workspace access in ThreadSignal.',
  NOT_FOUND: 'This opportunity is no longer available to your workspace.',
  FORBIDDEN: 'Your current workspace role does not permit this action.',
  PLAN_INACTIVE: 'This workspace needs an active plan before this action is available.',
  PLAN_UNAVAILABLE:
    'The workspace plan could not be loaded. Check the plan in ThreadSignal, then retry.',
  TRIAL_EXPIRED: 'The workspace trial has ended. Review the plan in ThreadSignal.',
  RATE_LIMITED: 'Too many requests. Wait a moment, then try again.',
  LOCAL_ONLY: 'Start the local ThreadSignal app and worker to use this extension.',
  UNAVAILABLE: 'ThreadSignal is unavailable. Check the local app and worker, then retry.',
};

/** Never relay arbitrary upstream messages, bodies, stack traces, or credentials. */
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof ExtensionError) return { code: error.code, message: error.message };
  return {
    code: 'UNAVAILABLE',
    message: 'ThreadSignal is unavailable. Check the local app, then retry.',
  };
}

export class ExtensionApi {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly extensionId = '',
  ) {}

  async request<T>(
    path: string,
    parse: (value: unknown) => T,
    options: { token?: string; method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
  ): Promise<T> {
    // All paths are constructed internally. This also rejects absolute URLs and path traversal.
    if (!path.startsWith('/api/extension/') || /[\\\r\n]/.test(path)) {
      throw new ExtensionError('INVALID_REQUEST', 'This action is not supported.');
    }
    const target = new URL(path, LOCAL_APP_ORIGIN);
    if (target.origin !== LOCAL_APP_ORIGIN || !target.pathname.startsWith('/api/extension/')) {
      throw new ExtensionError('INVALID_REQUEST', 'This action is not supported.');
    }
    let response: Response;
    try {
      // Native worker fetch must not receive this ExtensionApi as its WebIDL receiver.
      const transport = this.transport;
      response = await transport(target.href, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'X-ThreadSignal-Extension': this.extensionId,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ExtensionError(
        'UNAVAILABLE',
        'ThreadSignal is unavailable. Check the local app, then retry.',
      );
    }
    if (response.status === 401) {
      throw new ExtensionError(
        'EXTENSION_UNAUTHORIZED',
        messages.EXTENSION_UNAUTHORIZED ?? 'Connect again.',
      );
    }
    if (response.status === 429) {
      throw new ExtensionError('RATE_LIMITED', messages.RATE_LIMITED ?? 'Retry later.');
    }
    let result: unknown;
    try {
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > RESPONSE_LIMIT || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.byteLength;
          if (length > RESPONSE_LIMIT) throw new Error();
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      result = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new ExtensionError(
        'INVALID_RESPONSE',
        'ThreadSignal returned an unreadable response. Retry the action.',
      );
    }
    if (!response.ok) {
      const candidate = result as { error?: { code?: unknown } } | null;
      const code =
        typeof candidate?.error?.code === 'string' ? candidate.error.code : 'REQUEST_FAILED';
      throw new ExtensionError(
        Object.hasOwn(messages, code) ? code : 'REQUEST_FAILED',
        Object.hasOwn(messages, code)
          ? messages[code]!
          : 'This action could not be completed. Check ThreadSignal and try again.',
      );
    }
    try {
      return parse(result);
    } catch {
      throw new ExtensionError(
        'INVALID_RESPONSE',
        'ThreadSignal returned an unexpected response. Refresh and retry.',
      );
    }
  }
}
