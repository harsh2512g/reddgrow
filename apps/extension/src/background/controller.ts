import { z } from 'zod';
import {
  currentResponseSchema,
  exchangeResponseSchema,
  handoffResponseSchema,
  normalizeRedditUrl,
} from '@threadsignal/extension-contracts';
import {
  credentialsSchema,
  panelMessageSchema,
  type Credentials,
  type PanelResponse,
} from '../shared/messages';
import { insertApprovedText, type ComposerResult } from '../content/insert-composer';
import { ExtensionApi, ExtensionError, safeError } from './api';

const STORAGE_KEY = 'threadsignalSession';
const versionResponse = z.object({ data: z.object({ version: z.number().int().positive() }) });
const revokeResponse = z.object({ data: z.object({ revoked: z.literal(true) }) });
type Current = z.infer<typeof currentResponseSchema>;
type Tab = { id?: number | undefined; url?: string | undefined };

export interface ExtensionPlatform {
  storage: {
    restrict(): Promise<void>;
    get(): Promise<unknown>;
    set(credentials: Credentials): Promise<void>;
    clear(): Promise<void>;
  };
  activeTab(): Promise<Tab | undefined>;
  tab(id: number): Promise<Tab>;
  insert(tabId: number, text: string, expectedUrl: string): Promise<ComposerResult>;
}

/** No tab listeners: every operation follows an explicit, validated panel message. */
export class ExtensionController {
  private readonly ready: Promise<void>;
  private current: { tabId: number; url: string; result: Current } | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly platform: ExtensionPlatform,
    private readonly api: ExtensionApi,
  ) {
    this.ready = platform.storage.restrict();
  }

  dispatch(input: unknown): Promise<PanelResponse> {
    const task = this.tail.then(async (): Promise<PanelResponse> => {
      try {
        await this.ready;
        const parsed = panelMessageSchema.safeParse(input);
        if (!parsed.success)
          throw new ExtensionError('INVALID_REQUEST', 'This action is not supported.');
        return { ok: true, data: await this.handle(parsed.data) };
      } catch (error) {
        if (error instanceof ExtensionError && error.code === 'EXTENSION_UNAUTHORIZED') {
          this.current = null;
          await this.platform.storage.clear().catch(() => undefined);
        }
        return { ok: false, error: safeError(error) };
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async credentials(required = true): Promise<Credentials | null> {
    const result = credentialsSchema.safeParse(await this.platform.storage.get());
    if (!result.success || Date.parse(result.data.session.expiresAt) <= Date.now()) {
      await this.platform.storage.clear();
      this.current = null;
      if (required)
        throw new ExtensionError(
          'EXTENSION_UNAUTHORIZED',
          'Connect your workspace before continuing.',
        );
      return null;
    }
    return result.data;
  }

  private async captured(draftId: string, version: number) {
    const context = this.current;
    if (
      !context ||
      context.result.draft?.id !== draftId ||
      context.result.draft.version !== version
    ) {
      throw new ExtensionError(
        'REFRESH_REQUIRED',
        'Look up this tab again to load the current approved draft.',
      );
    }
    const active = await this.platform.activeTab();
    const tab = await this.platform.tab(context.tabId);
    if (active?.id !== context.tabId || tab.url !== context.url) {
      throw new ExtensionError(
        'PAGE_CHANGED',
        'The active page changed. Look up the current tab again.',
      );
    }
    return context;
  }

  private async handle(message: z.infer<typeof panelMessageSchema>): Promise<unknown> {
    if (message.type === 'status')
      return { session: (await this.credentials(false))?.session ?? null };
    if (message.type === 'connect') {
      if (await this.credentials(false))
        throw new ExtensionError(
          'ALREADY_CONNECTED',
          'Disconnect the current workspace before connecting another.',
        );
      const result = await this.api.request(
        '/api/extension/exchange',
        z.object({ data: exchangeResponseSchema }).parse,
        { method: 'POST', body: { code: message.code } },
      );
      const credentials = credentialsSchema.parse(result.data);
      await this.platform.storage.set(credentials);
      return { session: credentials.session };
    }
    if (message.type === 'disconnect') {
      let revoked = false;
      try {
        const credentials = await this.credentials(false);
        if (credentials) {
          await this.api.request('/api/extension/disconnect', revokeResponse.parse, {
            token: credentials.token,
            method: 'POST',
            body: {},
          });
          revoked = true;
        }
      } catch {
        // Local logout still completes when the server cannot be reached.
      } finally {
        this.current = null;
        await this.platform.storage.clear();
      }
      return { revoked, session: null };
    }
    const credentials = await this.credentials();
    if (!credentials) throw new ExtensionError('EXTENSION_UNAUTHORIZED', 'Connect your workspace.');
    if (message.type === 'lookup') {
      this.current = null;
      const tab = await this.platform.activeTab();
      if (
        tab?.id === undefined ||
        !tab.url ||
        !normalizeRedditUrl(tab.url, { allowFixture: true })
      ) {
        throw new ExtensionError(
          'UNSUPPORTED_PAGE',
          'Open a supported Reddit post or the local composer fixture, then look up the tab.',
        );
      }
      const result = await this.api.request(
        `/api/extension/current?redditUrl=${encodeURIComponent(tab.url)}`,
        z.object({ data: currentResponseSchema }).parse,
        { token: credentials.token },
      );
      const latest = await this.platform.tab(tab.id);
      if (latest.url !== tab.url)
        throw new ExtensionError('PAGE_CHANGED', 'The page changed during lookup. Try again.');
      this.current = { tabId: tab.id, url: tab.url, result: result.data };
      return { current: result.data };
    }
    const context = await this.captured(message.draftId, message.expectedVersion);
    const path = `/api/extension/drafts/${message.draftId}`;
    if (message.type === 'save') {
      const result = await this.api.request(path, versionResponse.parse, {
        token: credentials.token,
        method: 'PATCH',
        body: { expectedVersion: message.expectedVersion, content: message.content },
      });
      this.current = null;
      return { version: result.data.version };
    }
    if (message.type === 'published') {
      const post = normalizeRedditUrl(context.url, { allowFixture: true });
      const comment = normalizeRedditUrl(message.commentUrl, { allowFixture: true });
      if (
        !comment?.commentId ||
        !post ||
        comment.postId !== post.postId ||
        comment.subreddit !== post.subreddit
      ) {
        throw new ExtensionError(
          'INVALID_COMMENT',
          'Paste the resulting comment URL from this same Reddit conversation.',
        );
      }
      const result = await this.api.request(`${path}/published`, versionResponse.parse, {
        token: credentials.token,
        method: 'POST',
        body: {
          expectedVersion: message.expectedVersion,
          commentUrl: message.commentUrl,
          confirmed: true,
        },
      });
      return { version: result.data.version, published: true };
    }
    const prepared = await this.api.request(
      `${path}/prepare`,
      z.object({ data: handoffResponseSchema }).parse,
      {
        token: credentials.token,
        method: 'POST',
        body: { expectedVersion: message.expectedVersion, redditUrl: context.url },
      },
    );
    // Approval/version and the active URL are checked again directly before handoff.
    await this.captured(message.draftId, message.expectedVersion);
    if (prepared.data.version !== message.expectedVersion)
      throw new ExtensionError('REFRESH_REQUIRED', 'The draft changed. Look up the tab again.');
    if (message.type === 'copy') return { content: prepared.data.content };
    const result = await this.platform.insert(context.tabId, prepared.data.content, context.url);
    if (!result.ok) {
      const messages: Record<string, string> = {
        PAGE_CHANGED: 'The page changed. Look up the tab again.',
        COMPOSER_NOT_EMPTY:
          'Your comment box already contains text. Copy the approved draft and merge it manually.',
        AMBIGUOUS_COMPOSER:
          'Several comment boxes are open. Keep one empty composer open or copy the approved draft.',
      };
      throw new ExtensionError(
        result.reason,
        messages[result.reason] ??
          'A supported empty comment box was not found. Use Copy approved draft instead.',
      );
    }
    try {
      await this.api.request(`${path}/inserted`, versionResponse.parse, {
        token: credentials.token,
        method: 'POST',
        body: { expectedVersion: message.expectedVersion, redditUrl: context.url },
      });
      return { inserted: true, recorded: true };
    } catch {
      return { inserted: true, recorded: false };
    }
  }
}

export function chromePlatform(): ExtensionPlatform {
  return {
    storage: {
      restrict: () => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      get: async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as unknown,
      set: (credentials) => chrome.storage.local.set({ [STORAGE_KEY]: credentials }),
      clear: () => chrome.storage.local.remove(STORAGE_KEY),
    },
    activeTab: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
    tab: (id) => chrome.tabs.get(id),
    insert: async (tabId, text, expectedUrl) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'ISOLATED',
        func: insertApprovedText,
        args: [text, expectedUrl],
      });
      const result = results[0]?.result;
      if (!result || typeof result !== 'object' || !('ok' in result))
        return { ok: false, reason: 'INSERTION_FAILED' };
      return result as ComposerResult;
    },
  };
}
