'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ArrowUpRight,
  Check,
  Puzzle,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { draftMessage, draftRequest } from '@/lib/phase4/client';
import { PermissionNotice } from '../phase1/primitives';
import { LocalAccountHelp } from '../phase1/local-account-help';
import { displayDate } from '../phase2/primitives';

export const extensionSessionSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string().max(80),
  created_at: z.iso.datetime({ offset: true }),
  last_used_at: z.iso.datetime({ offset: true }).nullable(),
  expires_at: z.iso.datetime({ offset: true }),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
});
const codeSchema = z.object({
  code: z.string().min(8).max(200),
  expiresAt: z.iso.datetime({ offset: true }),
});
const sessionsSchema = z.object({ sessions: z.array(extensionSessionSchema) });
const revokedSchema = z.object({ revoked: z.number().int().nonnegative() });
export type ExtensionSession = z.infer<typeof extensionSessionSchema>;

export function ExtensionConnectionsPanel({
  organizationId,
  userId,
  role,
  enabled,
  initialSessions,
  extensionId,
}: {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  enabled: boolean;
  initialSessions: ExtensionSession[];
  extensionId: string;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [name, setName] = useState('Chrome on this device');
  const [connection, setConnection] = useState<z.infer<typeof codeSchema> | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const canConnect = enabled && role !== 'viewer';
  const canManageAll = role === 'owner' || role === 'admin';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connection) return;
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(connection.expiresAt) - Date.now()) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0) {
        setConnection(null);
        setNotice('The connection code expired. Create another when your extension is ready.');
      }
    };
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [connection]);

  async function refresh() {
    const data = await draftRequest('/api/extension/sessions', sessionsSchema, organizationId);
    setSessions(data.sessions);
  }
  async function run(key: string, action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      await action();
    } catch (issue) {
      setError(draftMessage(issue));
    } finally {
      setBusy(null);
      operation.current = false;
    }
  }
  const activeSessions = sessions.filter(
    (session) => !session.revoked_at && Date.parse(session.expires_at) > now,
  );
  return (
    <section
      className="mb-7 overflow-hidden rounded-[26px] border border-[#d8d4e9] bg-white"
      aria-labelledby="extension-heading"
    >
      <div className="relative overflow-hidden border-b border-[#ded9ed] bg-[#f1eef8] p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-10 -top-12 size-60 rounded-full border-[24px] border-white/45"
        />
        <div className="relative flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
            <Puzzle size={25} />
          </span>
          <div>
            <p className="eyebrow">The last step is yours</p>
            <h2 id="extension-heading" className="mt-3 text-2xl font-semibold tracking-tight">
              From approved words to a real conversation.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Bring your reviewed draft beside Reddit. Insert or copy it, review the final wording,
              then personally press Reddit’s submit button.
            </p>
            <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-primary">
              <ShieldCheck size={15} /> The extension never submits a comment.
            </p>
          </div>
        </div>
      </div>
      {!enabled ? (
        <div className="p-6 sm:p-8">
          <h3 className="font-semibold">Connect from your local workspace.</h3>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Extension connections and approved drafts currently live in the local workspace. Your
            hosted account and data stay separate.
          </p>
          <Button asChild className="mt-5">
            <a href="http://127.0.0.1:3000/app/settings/integrations">
              Open local Integrations <ArrowUpRight size={15} />
            </a>
          </Button>
          <div className="mt-5">
            <LocalAccountHelp />
          </div>
        </div>
      ) : (
        <div className="space-y-7 p-6 sm:p-8">
          <ol className="grid gap-5 md:grid-cols-3">
            {[
              [
                '01',
                'Install your extension',
                'Use the local Chrome build, then pin ThreadSignal in your toolbar.',
              ],
              [
                '02',
                'Connect this workspace',
                'Create a one-time code here and enter it in the extension’s side panel.',
              ],
              [
                '03',
                'Review, then insert',
                'Open a matching Reddit discussion, choose your approved draft, and insert it yourself.',
              ],
            ].map(([number, title, description]) => (
              <li key={number} className="border-t border-border pt-4">
                <span className="font-mono text-xs text-primary">{number}</span>
                <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
              </li>
            ))}
          </ol>
          <details className="rounded-xl border border-border bg-muted/20 p-4 text-xs">
            <summary className="cursor-pointer font-semibold">
              Install the local Chrome extension
            </summary>
            <ol className="mt-4 list-decimal space-y-3 pl-5 leading-6 text-muted-foreground">
              <li>
                In Chrome, open{' '}
                <code className="break-all text-foreground">chrome://extensions</code> and enable
                Developer mode.
              </li>
              <li>
                Choose <strong>Load unpacked</strong> and select{' '}
                <code className="break-all text-foreground">apps/extension/dist</code> inside this
                ThreadSignal project.
              </li>
              <li>
                Pin ThreadSignal from Chrome’s Extensions menu. Open it to see the connection form.
              </li>
            </ol>
            <p className="mt-4 break-all leading-6 text-muted-foreground">
              Build identity: <code>{extensionId}</code>
            </p>
            <p className="mt-2 leading-6 text-muted-foreground">
              This is a local development build, not a Chrome Web Store release. Only connect the
              ThreadSignal build you installed.
            </p>
          </details>
          {!canConnect && (
            <PermissionNotice>
              Your viewer role can inspect these settings. An owner, admin, or member can connect an
              extension and use approved drafts.
            </PermissionNotice>
          )}
          {canConnect && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound size={16} className="text-primary" /> Connect this browser
              </h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                The code connects an extension as you in this workspace. It is shown here once,
                expires shortly, and can be used only once.
              </p>
              {!connection && (
                <label
                  className="mt-4 block text-xs font-semibold"
                  htmlFor="extension-browser-name"
                >
                  Browser name
                  <input
                    id="extension-browser-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    className="field-input mt-2"
                    placeholder="Chrome on my laptop"
                  />
                </label>
              )}
              {!connection ? (
                <Button
                  className="mt-4"
                  disabled={busy !== null || !name.trim()}
                  onClick={() =>
                    void run('connect', async () => {
                      const data = await draftRequest(
                        '/api/extension/connection-code',
                        codeSchema,
                        organizationId,
                        { method: 'POST', body: JSON.stringify({ name: name.trim() }) },
                      );
                      setRemaining(
                        Math.max(0, Math.ceil((Date.parse(data.expiresAt) - Date.now()) / 1000)),
                      );
                      setConnection(data);
                    })
                  }
                >
                  <Puzzle size={15} />
                  {busy === 'connect' ? 'Creating code…' : 'Connect Chrome extension'}
                </Button>
              ) : (
                <div className="mt-4 space-y-3">
                  <label
                    className="block text-xs font-semibold"
                    htmlFor="extension-connection-code"
                  >
                    One-time connection code
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="extension-connection-code"
                      readOnly
                      autoComplete="off"
                      spellCheck={false}
                      value={connection.code}
                      className="field-input min-w-0 flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      disabled={busy !== null || remaining === 0}
                      onClick={() =>
                        void run('copy', async () => {
                          if (!navigator.clipboard)
                            throw new Error(
                              'Clipboard access is unavailable. Select the code and copy it manually.',
                            );
                          await navigator.clipboard.writeText(connection.code);
                          setNotice(
                            'Connection code copied. Paste it only into your ThreadSignal extension.',
                          );
                        })
                      }
                    >
                      <Copy size={14} />
                      Copy code
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires in{' '}
                    <span className="font-mono tabular-nums">
                      {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                    </span>
                    . Keep this code private.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      setConnection(null);
                      setNotice('Code hidden. It remains valid until used, replaced, or expired.');
                    }}
                  >
                    Hide code
                  </Button>
                </div>
              )}
            </div>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6 text-emerald-900"
            >
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-6 text-red-900"
            >
              {error}
            </p>
          )}
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Connected browsers</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {canManageAll
                    ? 'Owners and admins can review and revoke every connection in this workspace.'
                    : 'Your connections to this workspace. Revocation takes effect on the next extension request.'}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run('refresh', refresh)}
              >
                <RefreshCw size={14} />
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh connections'}
              </Button>
            </div>
            {sessions.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-border p-6">
                <p className="text-sm font-semibold">No connected browsers yet.</p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  After entering a code in the extension, refresh this list to see its connection.
                </p>
              </div>
            ) : (
              <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
                {sessions.map((session) => {
                  const active = !session.revoked_at && Date.parse(session.expires_at) > now;
                  const state = session.revoked_at ? 'Revoked' : active ? 'Connected' : 'Expired';
                  const canRevoke = canConnect && (canManageAll || session.user_id === userId);
                  return (
                    <li
                      key={session.id}
                      className="flex flex-wrap items-start justify-between gap-4 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold">
                          {session.name}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {session.user_id === userId ? 'You' : 'Teammate'}
                          </span>
                        </p>
                        <p className="mt-2 text-xs leading-6 text-muted-foreground">
                          Connected {displayDate(session.created_at)} ·{' '}
                          {session.last_used_at
                            ? `Last used ${displayDate(session.last_used_at)}`
                            : 'Not used yet'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Expires {displayDate(session.expires_at)}
                        </p>
                        <span
                          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${active ? 'bg-emerald-50 text-emerald-800' : 'bg-muted text-muted-foreground'}`}
                        >
                          {active && <Check size={11} />}
                          {state}
                        </span>
                      </div>
                      {canRevoke && active && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          aria-label={`Revoke ${session.name}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Disconnect ${session.name} from this workspace? It will need a new code to reconnect.`,
                              )
                            )
                              void run(session.id, async () => {
                                await draftRequest(
                                  '/api/extension/revoke',
                                  revokedSchema,
                                  organizationId,
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({ sessionId: session.id }),
                                  },
                                );
                                await refresh();
                                setNotice('Extension connection revoked.');
                              });
                          }}
                        >
                          <Unplug size={14} />
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canConnect && activeSessions.length > 0 && (
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  const scope = canManageAll
                    ? 'all extension connections in this workspace'
                    : 'all your extension connections in this workspace';
                  if (
                    window.confirm(`Revoke ${scope}? Each browser will need a new connection code.`)
                  )
                    void run('revoke-all', async () => {
                      await draftRequest('/api/extension/revoke', revokedSchema, organizationId, {
                        method: 'POST',
                        body: JSON.stringify({ all: true }),
                      });
                      setConnection(null);
                      await refresh();
                      setNotice(
                        'Extension connections revoked. Reconnect only the browsers you want to use.',
                      );
                    });
                }}
              >
                <Unplug size={14} />
                {canManageAll ? 'Revoke all workspace connections' : 'Revoke all my connections'}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ExtensionConnectionsLoading() {
  return (
    <div role="status" aria-label="Loading extension connections" className="space-y-6">
      <div className="h-48 animate-pulse rounded-[26px] bg-muted" />
      <div className="h-80 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
