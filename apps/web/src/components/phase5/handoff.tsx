'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowUpRight, Check, Puzzle, Hand, Link2 } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { normalizeRedditUrl } from '@threadsignal/extension-contracts';
import type { DraftDetail } from '@/lib/phase4/schema';
import { draftMessage, draftRequest, mutationVersionSchema } from '@/lib/phase4/client';
import { displayDate } from '../phase2/primitives';

export function DraftHandoff({
  detail,
  organizationId,
  canAct,
  disabled,
  onUpdated,
}: {
  detail: DraftDetail;
  organizationId: string;
  canAct: boolean;
  disabled: boolean;
  onUpdated: () => Promise<unknown>;
}) {
  const [commentUrl, setCommentUrl] = useState('');
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef(false);
  const { draft, opportunity } = detail;
  const confirmed = confirmedVersion === draft.current_version;
  const post = normalizeRedditUrl(opportunity.post.permalink ?? '', { allowFixture: true });
  const fixture = post?.postId.startsWith('fixture_') === true;
  const discussionUrl =
    post && fixture
      ? `http://127.0.0.1:3000/extension-fixture/reddit/r/${post.subreddit}/comments/${post.postId}/fixture`
      : post?.canonicalUrl;
  const recordedComment = normalizeRedditUrl(draft.published_comment_url ?? '', {
    allowFixture: true,
  });
  const approved =
    draft.status === 'approved' &&
    draft.verified_version === draft.current_version &&
    detail.review.context_current &&
    !draft.purged_at &&
    !opportunity.post.is_deleted &&
    !opportunity.is_blocked &&
    !detail.jobs.some((job) => ['queued', 'processing'].includes(job.status));
  const available = canAct && approved && !disabled && !pending && Boolean(post);
  const recordedCurrent =
    draft.published_version === draft.current_version && Boolean(draft.published_at);
  const input = normalizeRedditUrl(commentUrl.trim(), { allowFixture: true });
  const validComment = Boolean(
    input?.commentId && post && input.postId === post.postId && input.subreddit === post.subreddit,
  );
  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#ddd8eb] bg-[#faf8ff]"
      aria-labelledby="draft-handoff-heading"
    >
      <div className="border-b border-[#e5dfef] p-5 sm:p-6">
        <p className="eyebrow flex items-center gap-2">
          <Hand size={14} /> Your voice. Your final click.
        </p>
        <h2 id="draft-handoff-heading" className="mt-3 text-lg font-semibold">
          Take this reply to Reddit
        </h2>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          Open the discussion and use ThreadSignal’s Chrome side panel to insert your approved
          draft. Review the text, then submit it yourself on Reddit.
        </p>
        {available ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <a href={discussionUrl} target="_blank" rel="noopener noreferrer">
                {fixture ? 'Open mock discussion' : 'Open Reddit discussion'}{' '}
                <ArrowUpRight size={14} />
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/app/settings/integrations">
                <Puzzle size={14} />
                Connect extension
              </Link>
            </Button>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-950">
            {!canAct
              ? 'Your viewer role can read the handoff history. A member, admin, or owner can use an approved reply.'
              : disabled
                ? 'Save your changes and wait for the current action to finish before continuing.'
                : !approved
                  ? 'Approve the current saved version with up-to-date checks before using it on Reddit.'
                  : 'This discussion does not have a supported Reddit link.'}
          </p>
        )}
        <p className="mt-4 text-[11px] leading-6 text-muted-foreground">
          Edits made in the extension must return to ThreadSignal for fresh verification and
          approval. Inserting text does not publish it.
        </p>
        {fixture && (
          <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
            This synthetic opportunity opens a local practice composer. It is not a live Reddit
            discussion.
          </p>
        )}
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {(draft.inserted_at || draft.published_at) && (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold">Inserted into composer</dt>
              <dd className="mt-2 text-xs leading-6 text-muted-foreground">
                {draft.inserted_at
                  ? `Version ${draft.inserted_version} · ${displayDate(draft.inserted_at)}`
                  : 'No insertion recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold">Published manually</dt>
              <dd className="mt-2 text-xs leading-6 text-muted-foreground">
                {draft.published_at
                  ? `Version ${draft.published_version} · ${displayDate(draft.published_at)}`
                  : 'Not recorded'}
                {recordedComment?.commentId &&
                  post &&
                  recordedComment.postId === post.postId &&
                  recordedComment.subreddit === post.subreddit && (
                    <a
                      className="mt-1 block font-semibold text-primary"
                      href={fixture ? discussionUrl : recordedComment.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {fixture ? 'View local practice discussion ↗' : 'View recorded comment ↗'}
                    </a>
                  )}
              </dd>
            </div>
          </dl>
        )}
        {draft.published_at && (
          <p className="text-[11px] leading-6 text-muted-foreground">
            Publication is a teammate’s confirmation. ThreadSignal has not independently verified
            that the comment is live or accepted by moderators.
          </p>
        )}
        {canAct && !recordedCurrent && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              Already published it yourself?
            </summary>
            <form
              className="mt-4 space-y-4"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                if (!available || operation.current) return;
                setError(null);
                setNotice(null);
                if (!validComment || !input) {
                  setError(
                    'Enter the full Reddit comment URL from this discussion, including its comment ID.',
                  );
                  return;
                }
                if (!confirmed) {
                  setError('Confirm that you personally submitted this reply on Reddit.');
                  return;
                }
                operation.current = true;
                setPending(true);
                try {
                  await draftRequest(
                    `/api/drafts/${draft.id}/mark-published`,
                    mutationVersionSchema,
                    organizationId,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        expectedVersion: draft.current_version,
                        commentUrl: input.canonicalUrl,
                        confirmed: true,
                      }),
                    },
                  );
                  await onUpdated();
                  setConfirmedVersion(null);
                  setCommentUrl('');
                  setNotice('Recorded as published manually. No Reddit action was performed.');
                } catch (issue) {
                  setError(draftMessage(issue));
                } finally {
                  operation.current = false;
                  setPending(false);
                }
              }}
            >
              <label className="block text-xs font-semibold" htmlFor="published-comment-url">
                Resulting Reddit comment URL
                <input
                  id="published-comment-url"
                  value={commentUrl}
                  onChange={(event) => {
                    setCommentUrl(event.target.value);
                    setError(null);
                  }}
                  type="url"
                  maxLength={2048}
                  className="field-input mt-2"
                  placeholder="https://www.reddit.com/r/…/comments/…/…/…/"
                  disabled={!available}
                  aria-describedby="published-comment-hint"
                />
              </label>
              <p
                id="published-comment-hint"
                className="text-[11px] leading-6 text-muted-foreground"
              >
                Use the comment’s Share → Copy link action after you submit it. A link to the
                discussion alone is not enough.
              </p>
              <label className="flex items-start gap-3 text-xs leading-6">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) =>
                    setConfirmedVersion(event.target.checked ? draft.current_version : null)
                  }
                  disabled={!available}
                  className="mt-1 accent-primary"
                />
                I personally submitted this reply on Reddit and this is its comment link.
              </label>
              <Button
                type="submit"
                size="sm"
                disabled={!available || !confirmed || !commentUrl.trim()}
              >
                <Link2 size={14} />
                {pending ? 'Recording…' : 'Mark published manually'}
              </Button>
            </form>
          </details>
        )}
        {recordedCurrent && (
          <p className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
            <Check size={15} />
            Publication recorded for this version.
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-6 text-emerald-900"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-900"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
