'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Archive, Download, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { z } from 'zod';
import { privacyCreatedSchema, privacyRequestsSchema } from '@/lib/phase8/privacy-schema';
import { knowledgeRequest, requestMessage } from '../phase2/api';
import { ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';

type PrivacyControlsProps = {
  initial: z.infer<typeof privacyRequestsSchema>;
  organizationId: string;
  slug: string;
  canManage: boolean;
};

export function PrivacyControls(props: PrivacyControlsProps) {
  return <WorkspacePrivacyControls key={`${props.organizationId}:${props.canManage}`} {...props} />;
}

function WorkspacePrivacyControls({
  initial,
  organizationId,
  slug,
  canManage,
}: PrivacyControlsProps) {
  const [requests, setRequests] = useState(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function refresh(failureMessage?: string) {
    setBusy(true);
    setResult(null);
    try {
      setRequests(
        await knowledgeRequest(
          `/api/privacy/requests?organizationId=${organizationId}`,
          privacyRequestsSchema,
        ),
      );
      return true;
    } catch (error) {
      setResult({ status: 'error', message: failureMessage ?? requestMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create(kind: 'export' | 'deletion') {
    if (kind === 'deletion' && (!acknowledged || confirmation !== slug)) return;
    setBusy(true);
    setResult(null);
    try {
      await knowledgeRequest('/api/privacy/requests', privacyCreatedSchema, {
        method: 'POST',
        headers: { 'x-threadsignal-organization': organizationId },
        body: JSON.stringify({
          kind,
          organizationId,
          ...(kind === 'deletion' ? { confirmation } : {}),
        }),
      });
      if (kind === 'deletion') {
        setDeleting(true);
        setConfirming(false);
      } else {
        if (
          await refresh(
            'Your private export is queued, but the request list could not be refreshed. Use Refresh requests to try again.',
          )
        ) {
          setResult({
            status: 'success',
            message: 'Your private export is queued. Refresh its status when the worker finishes.',
          });
        }
      }
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setResult(null);
    try {
      await knowledgeRequest(`/api/privacy/requests/${id}/revoke`, privacyCreatedSchema, {
        method: 'POST',
        headers: { 'x-threadsignal-organization': organizationId },
        body: JSON.stringify({ organizationId }),
      });
      setRequests((current) =>
        current.map((request) =>
          request.id === id
            ? { ...request, status: 'revoked', download_available: false }
            : request,
        ),
      );
      if (
        await refresh(
          'The export is revoked, but the request list could not be refreshed. Use Refresh requests to try again.',
        )
      ) {
        setResult({
          status: 'success',
          message: 'The export is revoked. It can no longer be downloaded.',
        });
      }
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  if (deleting)
    return (
      <section className="panel mt-6 p-7" role="status">
        <h2 className="text-xl font-semibold">Organization deletion is underway.</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Access and processing are disabled. The worker will remove this organization’s files and
          records. Your sign-in account and other workspaces remain available.
        </p>
        <Link
          href="/app/onboarding"
          className="mt-5 inline-block text-sm font-semibold text-primary"
        >
          Continue to your other workspaces
        </Link>
      </section>
    );
  return (
    <section className="panel mt-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <ShieldCheck size={22} className="text-primary" aria-hidden="true" />
        <h2 className="text-xl font-semibold tracking-tight">Your organization, your data.</h2>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        Create a private download of your workspace or permanently delete its data. Only the current
        owner can manage or download exports.
      </p>
      {!canManage ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Ask the workspace owner to manage data exports and deletion.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border p-5">
              <Archive className="text-primary" size={20} aria-hidden="true" />
              <h3 className="mt-3 font-semibold">Take a copy</h3>
              <p className="my-3 text-xs leading-6 text-muted-foreground">
                Download a compressed JSON archive, including original uploaded files. Credentials
                and shared Reddit text are excluded. Each export expires automatically.
              </p>
              <Button variant="outline" disabled={busy} onClick={() => void create('export')}>
                Create private export
              </Button>
            </div>
            <div className="rounded-2xl border border-border p-5">
              <Trash2 className="text-muted-foreground" size={20} aria-hidden="true" />
              <h3 className="mt-3 font-semibold">Delete this workspace</h3>
              <p className="my-3 text-xs leading-6 text-muted-foreground">
                Permanently remove its records and private files. Download your export first. Other
                workspaces and your login remain intact.
              </p>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
                Review deletion
              </Button>
            </div>
          </div>
          {confirming && (
            <form
              className="mt-5 space-y-4 rounded-2xl border border-red-200 bg-red-50 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void create('deletion');
              }}
            >
              <h3 className="font-semibold text-red-900">Permanently delete this organization?</h3>
              <p className="text-sm leading-7 text-red-900">
                This cannot be undone. It immediately disables the workspace and revokes extension
                sessions, conversion keys and tracking links. Files and data are then removed by the
                worker.
              </p>
              <label htmlFor="deletion-confirmation" className="block text-sm font-semibold">
                Type {slug} to confirm
              </label>
              <input
                id="deletion-confirmation"
                className="field-input"
                autoComplete="off"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <label className="flex items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 size-4 accent-primary"
                />
                I have saved any data I need and understand deletion is permanent.
              </label>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy || confirmation !== slug || !acknowledged}>
                  {busy ? 'Confirming…' : 'Permanently delete organization'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setConfirmation('');
                    setAcknowledged(false);
                  }}
                >
                  Keep organization
                </Button>
              </div>
            </form>
          )}
          <div className="my-5">
            <ResultNotice result={result} />
          </div>
          <div className="mt-7 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Recent requests</h3>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
              Refresh requests
            </Button>
          </div>
          {!requests.length ? (
            <p className="mt-5 text-sm text-muted-foreground">No data requests yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold capitalize">
                      {request.kind === 'delete' ? 'Deletion' : 'Export'} · {request.status}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat('en', {
                        dateStyle: 'medium',
                        timeZone: 'UTC',
                      }).format(new Date(request.created_at))}
                      {!request.confirmed_at ? ' · Recorded for review; not scheduled' : ''}
                    </p>
                    {request.error_code && (
                      <p className="mt-2 max-w-lg text-xs leading-6 text-red-800">
                        {request.error_code === 'EXPORT_TOO_LARGE'
                          ? 'This archive exceeds the supported size. Ask the project operator for an assisted export.'
                          : 'Processing could not complete. The project operator can inspect its safe failure code.'}
                      </p>
                    )}
                    {request.expires_at && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Expires{' '}
                        {new Date(request.expires_at).toISOString().slice(0, 16).replace('T', ' ')}{' '}
                        UTC
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {request.download_available && (
                      <a
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary"
                        href={`/api/privacy/requests/${request.id}/download`}
                      >
                        <Download size={14} />
                        Download export
                      </a>
                    )}
                    {request.kind === 'export' &&
                      request.confirmed_at &&
                      ['requested', 'processing', 'completed'].includes(request.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void revoke(request.id)}
                        >
                          Revoke export
                        </Button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
