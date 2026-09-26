'use client';
import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { z } from 'zod';
import { draftControlsSchema } from '@threadsignal/drafts';
import { Button } from '@threadsignal/ui';
import {
  ArrowLeft,
  Check,
  Copy,
  History,
  Link2,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { draftDetailSchema, approvalAvailable, type DraftDetail } from '@/lib/phase4/schema';
import {
  createEditor,
  editorReducer,
  editorDirty,
  editorLocked,
  wordCount,
  changedText,
} from '@/lib/phase4/editor';
import {
  draftRequest,
  draftMessage,
  draftFailureMessage,
  DraftRequestError,
  mutationIdSchema,
  mutationVersionSchema,
} from '@/lib/phase4/client';
import { DraftBadge, DraftUpgradeNotice } from './primitives';
import { EvidencePanel, CompliancePanel, ClaimHighlights } from './evidence';
import { displayDate } from '../phase2/primitives';
import { PermissionNotice } from '../phase1/primitives';
import { DraftHandoff } from '../phase5/handoff';

export function DraftStudio({
  initial,
  organizationId,
  canAct,
  allowLocalFixture = false,
}: {
  initial: DraftDetail;
  organizationId: string;
  canAct: boolean;
  allowLocalFixture?: boolean;
}) {
  const [detail, setDetail] = useState(initial);
  const [editor, dispatch] = useReducer(
    editorReducer,
    createEditor(initial.draft.current_content, initial.draft.current_version),
  );
  const [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState(false),
    [responsible, setResponsible] = useState(initial.review.responsible_use_accepted);
  const [instruction, setInstruction] = useState(''),
    [capability, setCapability] = useState(''),
    [action, setAction] = useState('shorter'),
    [length, setLength] = useState<string>(initial.persona.reply_length);
  const [regenerationKey, setRegenerationKey] = useState(() => crypto.randomUUID());
  const [quotaReached, setQuotaReached] = useState(false);
  const [rejection, setRejection] = useState(''),
    [rating, setRating] = useState('useful'),
    [feedbackNotes, setFeedbackNotes] = useState('');
  const [comparison, setComparison] = useState<number | null>(null);
  const requestSequence = useRef(0),
    operation = useRef(false);
  const id = initial.draft.id;
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const value = await draftRequest(`/api/drafts/${id}`, draftDetailSchema);
    if (sequence !== requestSequence.current) return value;
    setDetail((previous) =>
      value.draft.current_version >= previous.draft.current_version ? value : previous,
    );
    dispatch({
      type: 'remote',
      text: value.draft.current_content,
      version: value.draft.current_version,
    });
    return value;
  }, [id]);
  const dirty = editorDirty(editor),
    locked = editorLocked(editor);
  const pendingJobs = detail.jobs.some((job) => ['queued', 'processing'].includes(job.status));
  const generating = detail.draft.status === 'generating';
  const purged = Boolean(detail.draft.purged_at) || detail.opportunity.post.is_deleted;
  const current = detail.versions.find((version) => version.version === editor.version);
  const claims = detail.claims.filter((claim) => claim.draft_version_id === current?.id);
  const stale =
    locked || editor.version !== detail.draft.current_version || !detail.review.context_current;
  const canApprove = canAct && !busy && !purged && approvalAvailable(detail, stale);
  const hasWarnings =
    detail.draft.verification_status === 'warning' || detail.draft.compliance_status === 'warning';
  const actionsDisabled = !canAct || locked || Boolean(busy) || generating || purged;

  const save = useCallback(async () => {
    if (
      operation.current ||
      !canAct ||
      !editorDirty(editor) ||
      editor.pending ||
      editor.conflict ||
      !editor.text.trim() ||
      editor.text.length > 12000
    )
      return;
    operation.current = true;
    dispatch({ type: 'saving' });
    setNotice(null);
    setError(null);
    try {
      const result = await draftRequest(
        `/api/drafts/${id}`,
        mutationVersionSchema,
        organizationId,
        {
          method: 'PATCH',
          body: JSON.stringify({ expectedVersion: editor.version, content: editor.text }),
        },
      );
      dispatch({ type: 'saved', version: result.version });
      await refresh();
      setNotice('Saved. Evidence and compliance checks are queued for this version.');
    } catch (issue) {
      dispatch({
        type: 'failed',
        message: draftMessage(issue),
        conflict: issue instanceof DraftRequestError && issue.code === 'DRAFT_VERSION_CONFLICT',
      });
    } finally {
      operation.current = false;
    }
  }, [editor, canAct, id, organizationId, refresh]);
  useEffect(() => {
    if (
      !dirty ||
      editor.pending ||
      editor.error ||
      editor.conflict ||
      !canAct ||
      generating ||
      purged ||
      busy
    )
      return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [
    dirty,
    editor.pending,
    editor.error,
    editor.conflict,
    canAct,
    generating,
    purged,
    busy,
    save,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !operation.current && !editorLocked(editor))
        void refresh().catch((issue) => setError(draftMessage(issue)));
    }, 4000);
    return () => clearInterval(timer);
  }, [editor, refresh]);
  useEffect(() => {
    if (!locked) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    const confirmLeaving = () =>
      window.confirm('This draft has unsaved edits or a save in progress. Leave without waiting?');
    const interceptLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      )
        return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin === window.location.origin &&
        (url.pathname !== window.location.pathname || url.search !== window.location.search) &&
        !confirmLeaving()
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const interceptWorkspace = (event: Event) => {
      if (!confirmLeaving()) event.preventDefault();
    };
    const interceptTraversal = (event: NavigateEvent) => {
      // Browsers can deliberately make repeated/cross-document traversals noncancelable.
      // Do not rewrite Next.js history or show a confirmation we cannot honor.
      if (
        event.navigationType === 'traverse' &&
        event.destination.sameDocument &&
        !event.hashChange &&
        event.cancelable &&
        !event.defaultPrevented &&
        !confirmLeaving()
      )
        event.preventDefault();
    };
    const browserNavigation = window.navigation;
    browserNavigation?.addEventListener('navigate', interceptTraversal);
    document.addEventListener('click', interceptLink, true);
    window.addEventListener('threadsignal:before-navigation', interceptWorkspace);
    return () => {
      window.removeEventListener('beforeunload', prevent);
      browserNavigation?.removeEventListener('navigate', interceptTraversal);
      document.removeEventListener('click', interceptLink, true);
      window.removeEventListener('threadsignal:before-navigation', interceptWorkspace);
    };
  }, [locked]);
  async function run(
    kind: 'verify' | 'approve' | 'reject' | 'restore' | 'regenerate' | 'feedback' | 'copy',
    extra: Record<string, unknown> = {},
  ) {
    if (operation.current || actionsDisabled) return;
    operation.current = true;
    setBusy(kind);
    setQuotaReached(false);
    setNotice(null);
    setError(null);
    try {
      const body = kind === 'feedback' ? extra : { expectedVersion: editor.version, ...extra };
      await draftRequest(
        `/api/drafts/${id}/${kind}`,
        z.union([mutationVersionSchema, mutationIdSchema]),
        organizationId,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (kind === 'copy') {
        if (!navigator.clipboard)
          throw new Error(
            'Clipboard access is unavailable. Keep this approved draft open and use your browser’s text selection.',
          );
        await navigator.clipboard.writeText(editor.savedText);
      }
      if (kind === 'regenerate') setRegenerationKey(crypto.randomUUID());
      setWarnings(false);
      await refresh();
      setNotice(
        {
          verify: 'Verification queued.',
          approve: 'This version is approved. Review once more before you publish manually.',
          reject: 'Draft rejected. Your reason is recorded.',
          restore: 'Version restored as a new edit. Checks are queued.',
          regenerate: 'A new version is being generated.',
          feedback: 'Feedback saved for this draft.',
          copy: 'Approved text copied. You decide where and when to publish.',
        }[kind],
      );
    } catch (issue) {
      setError(draftMessage(issue));
      setQuotaReached(issue instanceof DraftRequestError && issue.code === 'DRAFT_LIMIT');
      if (issue instanceof DraftRequestError && issue.code === 'DRAFT_VERSION_CONFLICT')
        dispatch({ type: 'failed', message: draftMessage(issue), conflict: true });
    } finally {
      setBusy(null);
      operation.current = false;
    }
  }
  const selectedVersion =
    detail.versions.find((version) => version.version === comparison) ??
    detail.versions.filter((version) => version.source === 'ai').at(-1) ??
    detail.versions.at(-1);
  const difference = changedText(selectedVersion?.content ?? '', editor.text);
  const displayStatus = dirty || editor.pending ? 'editing' : detail.draft.status;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/drafts"
          className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
        >
          <ArrowLeft size={14} />
          Draft library
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            Version {editor.version || '—'}
          </span>
          <DraftBadge status={displayStatus} />
        </div>
      </div>
      <header className="relative overflow-hidden rounded-[26px] border border-violet-200 bg-[#f2eff8] p-6 sm:p-8">
        <p className="eyebrow">Words with evidence</p>
        <h1 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight tracking-[-0.035em] sm:text-3xl">
          {detail.opportunity.post.title ?? 'Deleted discussion'}
        </h1>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>r/{detail.opportunity.subreddit.name}</span>
          <span>
            {detail.persona.name} · {detail.persona.real_role}
          </span>
          <Link
            href={`/app/opportunities/${detail.draft.opportunity_id}`}
            className="font-semibold text-primary"
          >
            Original research ↗
          </Link>
          <Link
            href={`/app/settings/persona?brandId=${detail.draft.brand_id}`}
            className="font-semibold text-primary"
          >
            Persona & disclosure ↗
          </Link>
        </div>
      </header>
      {!canAct && (
        <PermissionNotice>
          Your viewer role can inspect drafts and evidence. An owner, admin, or member can edit and
          approve.
        </PermissionNotice>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6 text-emerald-900"
        >
          {notice}
        </p>
      )}
      {quotaReached && <DraftUpgradeNotice />}
      {(error || editor.error) && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-6 text-red-900"
        >
          <p>{error ?? editor.error}</p>
          {editor.conflict ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={async () => {
                try {
                  const value = await refresh();
                  dispatch({
                    type: 'reload',
                    text: value.draft.current_content,
                    version: value.draft.current_version,
                  });
                  setError(null);
                } catch (issue) {
                  setError(draftMessage(issue));
                }
              }}
            >
              Discard local edits and load latest
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                dispatch({ type: 'retry' });
                setError(null);
                if (dirty) void save();
                else void refresh().catch((issue) => setError(draftMessage(issue)));
              }}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {purged && (
        <p role="status" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
          The source discussion was deleted. Draft content and derived evidence have been purged.
        </p>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-base font-semibold">Your reply</h2>
                <p role="status" className="mt-1 text-[11px] text-muted-foreground">
                  {editor.pending
                    ? 'Saving this edit…'
                    : dirty
                      ? 'Unsaved changes · autosave after a pause'
                      : pendingJobs
                        ? 'Saved · checks are processing'
                        : `Saved version ${editor.version}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !canAct ||
                  !dirty ||
                  Boolean(editor.pending) ||
                  editor.conflict ||
                  generating ||
                  purged ||
                  Boolean(busy) ||
                  !editor.text.trim()
                }
                onClick={() => void save()}
              >
                <Save size={14} />
                Save now
              </Button>
            </div>
            {generating ? (
              <div role="status" className="p-8">
                <div className="mb-5 h-2 animate-pulse rounded-full bg-violet-100" />
                <h3 className="font-semibold">Building an answer from your sources.</h3>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  Generation, claim verification, and an independent compliance pass run in
                  sequence. This view refreshes automatically.
                </p>
              </div>
            ) : (
              <div className="p-5 sm:p-6">
                <label htmlFor="draft-content" className="sr-only">
                  Editable draft
                </label>
                <textarea
                  id="draft-content"
                  value={editor.text}
                  maxLength={12000}
                  rows={14}
                  disabled={!canAct || purged || Boolean(busy)}
                  onChange={(event) => {
                    dispatch({ type: 'edit', text: event.target.value });
                    setWarnings(false);
                    setNotice(null);
                  }}
                  className="w-full resize-y rounded-xl border border-border bg-[#fffefb] p-4 text-sm leading-8 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-80"
                  placeholder="The generated reply will appear here."
                />
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>
                    {wordCount(editor.text)} words · {editor.text.length.toLocaleString()} / 12,000
                    characters
                  </span>
                  <span>Edits require fresh verification.</span>
                </div>
                {claims.some((c) =>
                  ['unsupported', 'contradicted', 'partial'].includes(c.status),
                ) &&
                  !dirty && (
                    <details
                      open
                      className="mt-5 rounded-xl border border-amber-200 bg-[#fffdf8] p-4"
                    >
                      <summary className="cursor-pointer text-xs font-semibold">
                        Claim highlights in this version
                      </summary>
                      <div className="mt-3">
                        <ClaimHighlights text={editor.text} claims={claims} />
                      </div>
                    </details>
                  )}
              </div>
            )}
            {detail.draft.strategy && (
              <div className="border-t border-border bg-muted/25 p-5">
                <p className="eyebrow">Response strategy</p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {detail.draft.strategy}
                </p>
              </div>
            )}
          </section>
          {canAct && !purged && (
            <section className="panel p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Sparkles size={17} className="text-primary" />
                <h2 className="text-base font-semibold">Shape the next version</h2>
              </div>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Each regeneration uses one draft allowance. Earlier versions stay in history.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold">
                  Direction
                  <select
                    className="field-input mt-2"
                    value={action}
                    onChange={(event) => {
                      setAction(event.target.value);
                      setRegenerationKey(crypto.randomUUID());
                    }}
                  >
                    {[
                      ['shorter', 'Shorter'],
                      ['more_technical', 'More technical'],
                      ['less_promotional', 'Less promotional'],
                      ['no_brand', 'Advice only (keep disclosure)'],
                      ['add_disclosure', 'Add disclosure'],
                      ['focus_capability', 'Focus on a capability'],
                      ['custom', 'Custom instruction'],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Reply length
                  <select
                    className="field-input mt-2"
                    value={length}
                    onChange={(event) => {
                      setLength(event.target.value);
                      setRegenerationKey(crypto.randomUUID());
                    }}
                  >
                    {['concise', 'standard', 'detailed'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              {action === 'focus_capability' && (
                <label className="mt-4 block text-xs font-semibold">
                  Capability
                  <input
                    value={capability}
                    maxLength={200}
                    className="field-input mt-2"
                    onChange={(event) => {
                      setCapability(event.target.value);
                      setRegenerationKey(crypto.randomUUID());
                    }}
                  />
                </label>
              )}
              {action === 'custom' && (
                <label className="mt-4 block text-xs font-semibold">
                  Instructions
                  <textarea
                    value={instruction}
                    maxLength={1500}
                    rows={3}
                    className="field-input mt-2"
                    onChange={(event) => {
                      setInstruction(event.target.value);
                      setRegenerationKey(crypto.randomUUID());
                    }}
                  />
                </label>
              )}
              <Button
                className="mt-5"
                size="sm"
                variant="outline"
                disabled={
                  actionsDisabled ||
                  pendingJobs ||
                  (action === 'focus_capability' && !capability.trim()) ||
                  (action === 'custom' && !instruction.trim())
                }
                onClick={() => {
                  const parsed = draftControlsSchema.safeParse({
                    action,
                    length,
                    ...(action === 'custom' ? { instruction } : {}),
                    ...(action === 'focus_capability' ? { capability } : {}),
                  });
                  if (parsed.success)
                    void run('regenerate', {
                      idempotencyKey: regenerationKey,
                      options: parsed.data,
                    });
                }}
              >
                <RotateCcw size={14} />
                {busy === 'regenerate' ? 'Queuing…' : 'Regenerate draft'}
              </Button>
            </section>
          )}
          <DraftHandoff
            detail={detail}
            organizationId={organizationId}
            canAct={canAct}
            allowLocalFixture={allowLocalFixture}
            disabled={actionsDisabled || stale || pendingJobs}
            onUpdated={refresh}
          />
          <section className="panel p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <History size={17} className="text-primary" />
              Version history
            </h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Compare a saved version with the current editor. Restoring creates a new version and
              queues verification.
            </p>
            {detail.versions.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                The first version is still being generated.
              </p>
            ) : (
              <>
                <select
                  aria-label="Compare with version"
                  value={selectedVersion?.version ?? ''}
                  className="field-input mt-4"
                  onChange={(event) => setComparison(Number(event.target.value))}
                >
                  {detail.versions.map((version) => (
                    <option key={version.id} value={version.version}>
                      Version {version.version} ·{' '}
                      {version.source === 'ai'
                        ? 'AI generation'
                        : version.source === 'user'
                          ? 'Human edit'
                          : 'Restored'}{' '}
                      · {displayDate(version.created_at)}
                    </option>
                  ))}
                </select>
                <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/20 p-4 text-xs leading-7">
                  {difference.prefix}
                  {difference.removed && (
                    <del className="bg-red-100 text-red-900">{difference.removed}</del>
                  )}
                  {difference.added && (
                    <ins className="bg-emerald-100 text-emerald-900 no-underline">
                      {difference.added}
                    </ins>
                  )}
                  {difference.suffix}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Red: removed · Green: current additions
                  {selectedVersion?.instruction ? ` · ${selectedVersion.instruction}` : ''}
                </p>
                {canAct && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4"
                    disabled={
                      actionsDisabled ||
                      pendingJobs ||
                      !selectedVersion ||
                      selectedVersion.version === editor.version
                    }
                    onClick={() =>
                      void run('restore', { restoreVersion: selectedVersion?.version })
                    }
                  >
                    Restore selected version
                  </Button>
                )}
              </>
            )}
          </section>
          <section className="panel p-5 sm:p-6">
            <h2 className="text-base font-semibold">Review decision</h2>
            {detail.draft.approved_at && (
              <p className="mt-3 text-xs leading-6 text-emerald-800">
                Approved {displayDate(detail.draft.approved_at)}
              </p>
            )}
            {detail.draft.rejection_reason && (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                <strong>Rejection reason:</strong> {detail.draft.rejection_reason}
              </p>
            )}
            {canAct && (
              <>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  Approval applies only to this saved version and its current evidence. Unsupported
                  and contradicted claims must be fixed.
                </p>
                {stale && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-950">
                    {dirty
                      ? 'Save your edits before verifying or approving.'
                      : 'Verification is pending or context has changed. Run the checks again before approval.'}
                  </p>
                )}
                <Button
                  className="mt-4"
                  variant="outline"
                  size="sm"
                  disabled={actionsDisabled || pendingJobs || editor.version === 0}
                  onClick={() => void run('verify')}
                >
                  <ShieldCheck size={14} />
                  Verify current version
                </Button>
                {hasWarnings && (
                  <label className="mt-5 flex items-start gap-3 text-xs leading-6">
                    <input
                      type="checkbox"
                      checked={warnings}
                      onChange={(event) => setWarnings(event.target.checked)}
                      disabled={!canApprove}
                      className="mt-1 accent-primary"
                    />
                    I reviewed the warnings and accept responsibility for this wording.
                  </label>
                )}
                {!detail.review.responsible_use_accepted && (
                  <label className="mt-4 flex items-start gap-3 text-xs leading-6">
                    <input
                      type="checkbox"
                      checked={responsible}
                      onChange={(event) => setResponsible(event.target.checked)}
                      className="mt-1 accent-primary"
                    />
                    I will disclose my affiliation, follow community rules, and publish manually
                    after review. Approval is not a guarantee of moderator acceptance.
                  </label>
                )}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    disabled={
                      !canApprove ||
                      (hasWarnings && !warnings) ||
                      (!detail.review.responsible_use_accepted && !responsible)
                    }
                    onClick={() =>
                      void run('approve', {
                        acknowledgeWarnings: warnings,
                        acceptResponsibleUse: responsible,
                      })
                    }
                  >
                    <Check size={15} />
                    Approve version {editor.version || '—'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={actionsDisabled || stale || detail.draft.status !== 'approved'}
                    onClick={() => void run('copy')}
                  >
                    <Copy size={15} />
                    Copy approved draft
                  </Button>
                  {actionsDisabled || dirty || stale || detail.draft.status !== 'approved' ? (
                    <Button variant="outline" disabled>
                      <Link2 size={15} /> Create tracked link
                    </Button>
                  ) : (
                    <Button variant="outline" asChild>
                      <Link
                        href={`/app/tracking?brandId=${detail.draft.brand_id}&draftId=${detail.draft.id}`}
                      >
                        <Link2 size={15} /> Create tracked link
                      </Link>
                    </Button>
                  )}
                </div>
                <details className="mt-6 border-t border-border pt-5">
                  <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                    Reject this draft
                  </summary>
                  <label className="mt-4 block text-xs">
                    Rejection reason
                    <textarea
                      rows={3}
                      value={rejection}
                      maxLength={1000}
                      className="field-input mt-2"
                      onChange={(event) => setRejection(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={actionsDisabled || rejection.trim().length < 3}
                    onClick={() => void run('reject', { reason: rejection })}
                  >
                    Reject with reason
                  </Button>
                </details>
                <details className="mt-5 border-t border-border pt-5">
                  <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                    Share feedback
                  </summary>
                  <label className="mt-4 block text-xs">
                    Feedback
                    <select
                      className="field-input mt-2"
                      value={rating}
                      onChange={(event) => setRating(event.target.value)}
                    >
                      {[
                        'useful',
                        'too_promotional',
                        'incorrect',
                        'irrelevant',
                        'wrong_tone',
                        'other',
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-3 block text-xs">
                    Notes (optional)
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={feedbackNotes}
                      className="field-input mt-2"
                      onChange={(event) => setFeedbackNotes(event.target.value)}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={actionsDisabled}
                    onClick={() => void run('feedback', { rating, notes: feedbackNotes })}
                  >
                    Save feedback
                  </Button>
                </details>
              </>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-6">
          <EvidencePanel claims={claims} stale={stale} />
          <CompliancePanel detail={detail} stale={stale} />
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Your affiliation</h2>
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              {detail.persona.default_disclosure}
            </p>
            <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
              A persona shapes tone. It never creates a different identity.
            </p>
          </section>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Community context</h2>
            {detail.rules.map((rule) => (
              <details key={rule.id} className="mt-4 text-xs">
                <summary className="cursor-pointer font-semibold">{rule.title}</summary>
                <p className="mt-2 whitespace-pre-wrap leading-6 text-muted-foreground">
                  {rule.description}
                </p>
              </details>
            ))}
          </section>
          {detail.jobs.some((job) => job.status === 'failed') && (
            <section className="panel border-amber-200 p-5">
              <h2 className="text-sm font-semibold">Processing history</h2>
              {detail.jobs
                .filter((job) => job.status === 'failed')
                .slice(0, 3)
                .map((job) => (
                  <p key={job.id} className="mt-3 text-xs leading-6 text-muted-foreground">
                    {job.kind} stopped after {job.attempts} attempt(s).{' '}
                    {draftFailureMessage(job.error_code)}
                  </p>
                ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
