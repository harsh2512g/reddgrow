'use client';
import { useState } from 'react';
/** Synthetic composer harness. No Reddit network connection or publish capability. */
export function DiscussionFixture({ subreddit, postId }: { subreddit: string; postId: string }) {
  const [mode, setMode] = useState('textarea');
  const [attempts, setAttempts] = useState(0);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <p className="eyebrow">ThreadSignal · Local test discussion</p>
      <h1 className="text-3xl font-semibold">Practice your manual handoff.</h1>
      <p>
        This synthetic discussion belongs to r/{subreddit} ({postId}). Nothing on this page
        publishes to Reddit. Connect the extension, find this conversation, and insert an approved
        draft.
      </p>
      <label className="block">
        Composer variant{' '}
        <select
          aria-label="Composer variant"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          className="rounded border p-2"
        >
          <option value="textarea">Classic textarea</option>
          <option value="editable">Contenteditable</option>
          <option value="unknown">Unsupported composer (copy fallback)</option>
          <option value="ambiguous">Multiple composers (copy fallback)</option>
        </select>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setAttempts((value) => value + 1);
        }}
        className="space-y-4 rounded-2xl border bg-white p-6"
        key={mode}
      >
        {mode === 'editable' ? (
          <div
            contentEditable
            suppressContentEditableWarning
            data-lexical-editor="true"
            role="textbox"
            aria-label="Comment composer"
            className="min-h-40 whitespace-pre-wrap rounded border p-3"
          />
        ) : mode === 'unknown' ? (
          <input aria-label="Unsupported composer" className="w-full rounded border p-3" />
        ) : (
          <>
            <textarea
              name="text"
              aria-label="Comment composer"
              className="min-h-40 w-full rounded border p-3"
            />
            {mode === 'ambiguous' && (
              <textarea
                name="text"
                aria-label="Second composer"
                className="min-h-40 w-full rounded border p-3"
              />
            )}
          </>
        )}
        <button type="submit" onClick={() => undefined} className="rounded border px-4 py-2">
          Fixture submit sentinel
        </button>
      </form>
      <p role="status">
        Submit attempts: <output data-testid="submit-attempts">{attempts}</output>
      </p>
      <p className="text-sm">
        The extension must leave this count at zero. Review the inserted text yourself. Real Reddit
        publication always requires your own final action.
      </p>
    </main>
  );
}
