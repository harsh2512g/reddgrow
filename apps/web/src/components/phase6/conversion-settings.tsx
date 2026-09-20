'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import {
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import {
  attributionSettingsSchema,
  conversionKeySchema,
  createConversionKeyInputSchema,
} from '@threadsignal/tracking';
import type { Brand } from '@threadsignal/knowledge';
import { draftMessage, draftRequest } from '@/lib/phase4/client';
import { PermissionNotice, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import {
  conversionKeyRecordSchema,
  trackingSettingsRecordSchema,
  type ConversionKeyRecord,
  type TrackingSettingsRecord,
} from './tracking-schema';
import { formatDate } from './format';

export type ConversionSettingsProps = {
  organization: { id: string };
  enabled: boolean;
  canManage: boolean;
  brands: Brand[];
  brand: Brand | null;
  apiOrigin: string;
  keys: ConversionKeyRecord[];
  settings: TrackingSettingsRecord;
  features: { conversionTracking: boolean; conversionApi: boolean };
};
export function ConversionSettings({
  organization,
  enabled,
  canManage,
  brands,
  brand,
  apiOrigin,
  keys: initialKeys,
  settings: initialSettings,
  features,
}: ConversionSettingsProps) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [settings, setSettings] = useState(initialSettings);
  const [revealed, setRevealed] = useState<{ key: string; record: ConversionKeyRecord } | null>(
    null,
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const mayCreateKey = enabled && canManage && features.conversionApi && Boolean(brand);
  async function run(action: string, work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(action);
    setResult(null);
    try {
      await work();
    } catch (error) {
      setResult({ status: 'error', message: draftMessage(error) });
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }
  async function createKey(name: string, rotateKeyId?: string) {
    if (!mayCreateKey || !brand) return;
    const parsed = createConversionKeyInputSchema.safeParse({
      brandId: brand.id,
      name,
      ...(rotateKeyId ? { rotateKeyId } : {}),
    });
    if (!parsed.success) {
      setResult({
        status: 'error',
        message: 'Enter a descriptive key name between 1 and 80 characters.',
      });
      return;
    }
    if (
      rotateKeyId &&
      !window.confirm(
        'Rotate this key? Its replacement will be shown once and the old key will stop working immediately.',
      )
    )
      return;
    if (
      revealed &&
      !window.confirm(
        'The current key is still shown. Continue only if you have saved it securely; it cannot be shown again.',
      )
    )
      return;
    await run(rotateKeyId ? `rotate:${rotateKeyId}` : 'create-key', async () => {
      setRevealed(null);
      const data = await draftRequest(
        '/api/conversion-keys',
        z.object({ key: conversionKeySchema, record: conversionKeyRecordSchema }),
        organization.id,
        { method: 'POST', body: JSON.stringify(parsed.data) },
      );
      setRevealed(data);
      setKeys((previous) => [
        data.record,
        ...previous.map((key) =>
          key.id === rotateKeyId ? { ...key, revoked_at: new Date().toISOString() } : key,
        ),
      ]);
      setResult({
        status: 'success',
        message: rotateKeyId
          ? 'Key rotated. Save the replacement securely and update your server configuration.'
          : 'Key created. It will be shown once; save it securely on your server.',
      });
    });
  }
  async function revokeKey(key: ConversionKeyRecord) {
    if (
      !canManage ||
      !window.confirm(
        `Revoke “${key.name}”? Events sent with this key will be refused. Existing analytics remain.`,
      )
    )
      return;
    await run(`revoke:${key.id}`, async () => {
      await draftRequest(
        `/api/conversion-keys/${key.id}/revoke`,
        z.object({ revoked: z.literal(true) }),
        organization.id,
        { method: 'POST', body: '{}' },
      );
      setKeys((previous) =>
        previous.map((item) =>
          item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item,
        ),
      );
      if (revealed?.record.id === key.id) setRevealed(null);
      setResult({
        status: 'success',
        message: 'Conversion key revoked. Existing analytics are retained.',
      });
    });
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || !canManage) return;
    const data = new FormData(event.currentTarget);
    const parsed = attributionSettingsSchema.safeParse({
      attributionDays: Number(data.get('attributionDays')),
      consentText: data.get('consentText'),
    });
    if (!parsed.success) {
      setResult({
        status: 'error',
        message: 'Choose 1–90 attribution days and consent text between 20 and 500 characters.',
      });
      return;
    }
    await run('settings', async () => {
      const saved = await draftRequest(
        '/api/tracking-settings',
        z.object({ settings: trackingSettingsRecordSchema }),
        organization.id,
        { method: 'PATCH', body: JSON.stringify(parsed.data) },
      );
      setSettings(saved.settings);
      setResult({
        status: 'success',
        message:
          'Attribution settings saved. Update your site’s consent notice and snippet window to match.',
      });
    });
  }
  const snippet = brand
    ? `<script src="${apiOrigin}/threadsignal.js" defer></script>\n<script>\n  window.addEventListener('DOMContentLoaded', () => {\n    window.threadSignal.init({\n      brandId: '${brand.id}',\n      endpoint: '${apiOrigin}/api/v1/browser-events',\n      consent: false,\n      cookieDays: ${settings.attribution_days}\n    });\n  });\n\n  // In your site's consent callback, after the person agrees:\n  // window.threadSignal.setConsent(true);\n\n  // After a real signup, with your own opaque event ID:\n  // window.threadSignal.track('signup', { externalId: 'signup_123' });\n\n  // After a real purchase, with its actual amount and currency:\n  // window.threadSignal.track('purchase', {\n  //   externalId: 'order_123', value: 99, currency: 'USD'\n  // });\n\n  // When consent is withdrawn:\n  // window.threadSignal.setConsent(false);\n</script>`
    : '';
  return (
    <section
      id="conversion-settings"
      className="mb-7 scroll-mt-24 overflow-hidden rounded-[26px] border border-[#d8d4e9] bg-white"
      aria-labelledby="conversion-settings-title"
    >
      <div className="relative overflow-hidden border-b border-violet-100 bg-[#f1eef8] p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-9 -top-16 size-64 rounded-full border-[25px] border-white/45"
        />
        <div className="relative flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary">
            <Code2 size={24} />
          </span>
          <div>
            <p className="eyebrow">The story after the click</p>
            <h2
              id="conversion-settings-title"
              className="mt-3 text-2xl font-semibold tracking-tight"
            >
              Connect actions to conversations.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Track consented browser events or send verified actions from your server. Keep keys
              private, respect consent, and describe results as attributed.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-7 p-6 sm:p-8">
        {!enabled ? (
          <p className="text-sm leading-7 text-muted-foreground">
            Attribution is not enabled for this workspace yet. Tracking requires the verified
            database and application runtime.
          </p>
        ) : (
          <>
            {result && <ResultNotice result={result} />}
            {!canManage && (
              <PermissionNotice>
                Only a workspace owner or admin can manage conversion keys and attribution settings.
                You can review the installation guidance below.
              </PermissionNotice>
            )}
            <form
              onSubmit={(event) => void saveSettings(event)}
              className="rounded-2xl border border-border p-5"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={16} className="text-primary" /> Attribution and consent
              </h3>
              <fieldset
                disabled={!canManage || Boolean(busy)}
                className="mt-5 grid gap-5 sm:grid-cols-[160px_1fr]"
              >
                <label className="block text-xs font-semibold">
                  Attribution window (days)
                  <input
                    name="attributionDays"
                    type="number"
                    min={1}
                    max={90}
                    required
                    defaultValue={settings.attribution_days}
                    className="form-input mt-2 w-full"
                  />
                </label>
                <label className="block text-xs font-semibold">
                  Consent notice
                  <textarea
                    name="consentText"
                    rows={3}
                    minLength={20}
                    maxLength={500}
                    required
                    defaultValue={settings.consent_text}
                    className="form-input mt-2 w-full text-xs leading-6"
                  />
                </label>
                <p className="text-[11px] leading-6 text-muted-foreground sm:col-span-2">
                  Apply this notice in your site’s consent interface. Saving it here does not grant
                  visitor consent or update your website automatically. Browser events stop when
                  consent is withdrawn or a privacy signal is present.
                </p>
                {canManage && (
                  <Button type="submit" className="justify-self-start sm:col-span-2">
                    <Check size={14} />
                    {busy === 'settings' ? 'Saving…' : 'Save attribution settings'}
                  </Button>
                )}
              </fieldset>
            </form>
            <label className="block text-xs font-semibold">
              Conversion brand
              <select
                aria-label="Conversion brand"
                className="form-input mt-2 w-full max-w-md"
                value={brand?.id ?? ''}
                onChange={(event) => {
                  if (
                    revealed &&
                    !window.confirm(
                      'Changing brands hides this one-time key. Continue only if you saved it securely.',
                    )
                  )
                    return;
                  setRevealed(null);
                  router.push(
                    `/app/settings/integrations?brandId=${encodeURIComponent(event.target.value)}#conversion-settings`,
                  );
                }}
              >
                {!brands.length && <option value="">No brands yet</option>}
                {brands.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {!brand ? (
              <p className="rounded-xl bg-muted/40 p-5 text-xs leading-6 text-muted-foreground">
                Create a brand to configure its browser events and server conversion keys.
              </p>
            ) : (
              <>
                <section aria-labelledby="browser-snippet-title">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 id="browser-snippet-title" className="text-sm font-semibold">
                        Browser tracking, with consent
                      </h3>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        Install this on your approved product website. It contains a public brand
                        identifier and no server key.
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${features.conversionTracking ? 'bg-emerald-50 text-positive' : 'bg-amber-50 text-warning'}`}
                    >
                      {features.conversionTracking
                        ? 'Included in your plan'
                        : 'Conversion tracking requires Solo or Growth'}
                    </span>
                  </div>
                  <details className="mt-4 rounded-xl border border-border p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      View installation snippet
                    </summary>
                    <pre
                      tabIndex={0}
                      aria-label="Browser tracking installation snippet"
                      className="mt-4 max-h-96 overflow-auto rounded-xl bg-[#25243c] p-4 text-[11px] leading-6 text-violet-100"
                    >
                      <code>{snippet}</code>
                    </pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run('copy-snippet', async () => {
                          await navigator.clipboard.writeText(snippet);
                          setResult({
                            status: 'success',
                            message:
                              'Public installation snippet copied. Connect it to your site’s consent controls before using it.',
                          });
                        })
                      }
                    >
                      <Copy size={13} />
                      Copy installation snippet
                    </Button>
                    <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
                      Use unique opaque event IDs, never customer emails or names. Keep the same ID
                      for retries. Call <code>retry(result.idempotencyKey)</code> after a failed
                      request to resend the exact event. This snippet honors browser privacy signals
                      and makes no event request before consent.
                    </p>
                  </details>
                </section>
                <section
                  aria-labelledby="server-keys-title"
                  className="border-t border-border pt-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3
                        id="server-keys-title"
                        className="flex items-center gap-2 text-sm font-semibold"
                      >
                        <KeyRound size={16} className="text-primary" /> Server conversion keys
                      </h3>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        Keys are scoped to this brand, stored as hashes, and shown only once.
                      </p>
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium">
                      Growth plan
                    </span>
                  </div>
                  {!features.conversionApi && (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-warning">
                      Server-to-server conversion ingestion is available on Growth.{' '}
                      <Link href="/app/settings/billing" className="font-semibold underline">
                        Review your plan
                      </Link>
                      .
                    </p>
                  )}
                  {mayCreateKey && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void createKey(String(form.get('keyName') ?? ''));
                      }}
                      className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-end"
                    >
                      <label className="block w-full text-xs font-semibold sm:max-w-sm">
                        Key name
                        <input
                          name="keyName"
                          required
                          maxLength={80}
                          placeholder="Personal development server"
                          className="form-input mt-2 w-full text-xs"
                          disabled={Boolean(busy)}
                        />
                      </label>
                      <Button type="submit" disabled={Boolean(busy)}>
                        <KeyRound size={14} />
                        {busy === 'create-key' ? 'Creating…' : 'Create conversion key'}
                      </Button>
                    </form>
                  )}
                  {revealed && (
                    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
                      <p className="text-xs font-semibold text-amber-900">
                        Save this key now. It cannot be displayed again.
                      </p>
                      <label className="mt-3 block text-xs font-medium">
                        One-time conversion key
                        <input
                          type="password"
                          autoComplete="off"
                          readOnly
                          value={revealed.key}
                          className="form-input mt-2 w-full font-mono text-xs"
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run('copy-key', async () => {
                              await navigator.clipboard.writeText(revealed.key);
                              setResult({
                                status: 'success',
                                message:
                                  'Conversion key copied. Store it only in your server’s secret configuration.',
                              });
                            })
                          }
                        >
                          <Copy size={13} />
                          Copy key
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevealed(null)}
                        >
                          <EyeOff size={13} />
                          Hide key
                        </Button>
                      </div>
                      <p className="mt-3 text-[11px] leading-6 text-amber-900">
                        Never place this key in browser code, URLs, chat, analytics events, or a
                        source-control repository.
                      </p>
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-5 divide-y divide-border rounded-xl border border-border">
                      {keys.length ? (
                        keys.map((key) => (
                          <article key={key.id} className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h4 className="text-xs font-semibold">{key.name}</h4>
                                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                                  {key.key_prefix}…
                                </p>
                                <p className="mt-1.5 text-[10px] text-muted-foreground">
                                  Created {formatDate(key.created_at)} ·{' '}
                                  {key.last_used_at
                                    ? `Last used ${formatDate(key.last_used_at)}`
                                    : 'Never used'}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-semibold ${key.revoked_at ? 'bg-muted text-muted-foreground' : 'bg-emerald-50 text-positive'}`}
                              >
                                {key.revoked_at ? 'Revoked' : 'Active'}
                              </span>
                            </div>
                            {!key.revoked_at && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {features.conversionApi && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => void createKey(key.name, key.id)}
                                    aria-label={`Rotate ${key.name}`}
                                  >
                                    <RefreshCw size={13} />
                                    Rotate
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => void revokeKey(key)}
                                  aria-label={`Revoke ${key.name}`}
                                >
                                  <Trash2 size={13} />
                                  Revoke
                                </Button>
                              </div>
                            )}
                          </article>
                        ))
                      ) : (
                        <p className="p-5 text-xs leading-6 text-muted-foreground">
                          No server conversion keys for this brand.
                        </p>
                      )}
                    </div>
                  )}
                  <details className="mt-4 rounded-xl border border-border p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      Server integration reference
                    </summary>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      Send a POST request to{' '}
                      <code className="break-all">{apiOrigin}/api/v1/conversions</code> from your
                      server. Supply the key as an Authorization bearer header, along with the
                      recorded click ID, event, opaque external ID, timestamp, amount and currency.
                      Retries use the same external ID or idempotency key.
                    </p>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      A key never belongs in the browser snippet. The server rechecks the key’s
                      brand, current plan, event time and attribution window.
                    </p>
                  </details>
                </section>
              </>
            )}
            <Link
              href="/app/analytics"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Explore attributed results <ArrowUpRight size={14} />
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
