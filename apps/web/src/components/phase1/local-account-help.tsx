export function LocalAccountHelp() {
  return (
    <aside className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-sm leading-6">
      <p className="font-semibold">Your hosted sign-in does not sign you in locally.</p>
      <p className="mt-2 text-muted-foreground">
        The local workspace has separate accounts and data. If the next page asks you to sign in:
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Enter <strong className="break-all text-foreground">owner@threadsignal.test</strong> to
          explore the seeded demo, or use your existing local account.
        </li>
        <li>Choose Send magic link.</li>
        <li>
          Open the message in the{' '}
          <a
            href="http://127.0.0.1:54324"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary underline underline-offset-4"
          >
            local inbox
          </a>{' '}
          and follow its sign-in link in this browser. It will not arrive in your regular email
          inbox.
        </li>
      </ol>
    </aside>
  );
}
