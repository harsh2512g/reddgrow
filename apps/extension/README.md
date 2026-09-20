# ThreadSignal reply studio

Phase 5 adds a Manifest V3 side panel for an explicitly connected local workspace.
It looks up the active conversation only when the user clicks **Look up current tab**,
shows a current approved draft and its evidence, and can copy or insert that draft.
The user personally performs Reddit's final submit action.

## Build and install locally

Run from the repository root:

```sh
./scripts/local pnpm extension:build
```

Load `apps/extension/dist` as an unpacked extension in a newly created personal
Chrome profile using `chrome://extensions` → Developer mode → Load unpacked.
Do not use an office profile or reuse an existing browser session. Pin ThreadSignal,
then click its toolbar icon to open the side panel. Chrome 116 or newer is required.
After rebuilding, click Reload on its extension card and reopen the panel.

The build embeds the public manifest key in `config/extension-development.json`.
That public identifier keeps the unpacked extension ID stable across repository paths;
it is not a credential. This build connects only to `http://127.0.0.1:3000`.
Hosted connection and Chrome Web Store publication are not enabled by this build.

## Connect and use

1. Start the local app and worker using the repository's documented local setup.
2. Sign in to the local web app and open **Settings → Integrations**.
3. Create a one-time connection code for the intended workspace. Paste it into
   the extension's password-style code field, then click **Connect workspace**.
   The field is cleared immediately and the token is never displayed.
4. Open a supported conversation or the local composer fixture. Click the
   extension toolbar icon on that tab, then **Look up current tab**.
5. Read the opportunity, community guidance, draft and evidence. Only a current
   approved draft can be copied or inserted.
6. To edit, change the reply and click **Save for verification**. Open its review
   page, wait for independent verification, and approve the latest version.
   Return to the conversation and click **Look up current tab** again.
7. Click **Insert into comment box** only after opening one empty supported
   composer. Review the inserted text, then submit it yourself on Reddit.
8. If insertion is unavailable, click **Copy approved draft** and paste it yourself.
   If clipboard permission is unavailable, the extension selects the approved
   text and explains how to copy using ⌘C or Ctrl+C.
9. After publishing personally, expand **Already published it yourself?**, paste
   the resulting comment URL, confirm the manual action, and click **I published
   this**. This records an attestation; it does not submit or independently verify
   publication on Reddit.

Editing locally immediately disables copy and insertion. Saving invalidates the
loaded approval until the web app verifies and a human approves the new version.
Navigating to a different active tab or URL requires another explicit lookup.
Multiple matching drafts are selected by the server within the connected workspace;
no unrelated workspace records are returned.

## Permissions and credential boundary

| Permission                | Reason                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| `sidePanel`               | Open the packaged reply studio after the toolbar action.              |
| `storage`                 | Retain this extension's revocable session token.                      |
| `activeTab`               | Temporarily access the tab explicitly selected by the user.           |
| `scripting`               | Insert approved text into a supported composer in the isolated world. |
| `http://127.0.0.1:3000/*` | Contact the local ThreadSignal API and local fixture.                 |

There is no permanent Reddit host permission, history permission, browsing listener,
automatic content script, external message receiver, or remote script. The toolbar
activation supplies temporary access to the chosen Reddit tab. Only its URL and
composer structure are examined; post contents are not scraped.

The background service worker restricts `chrome.storage.local` to
`TRUSTED_CONTEXTS` before reading it. Packaged panel messages pass exact runtime-ID,
URL and origin checks plus Zod validation. The token is never returned to the panel,
injected into a page, written into a URL, logged, or sent to Reddit. Requests omit
cookies, refuse redirects, have a deadline and response-size limit, validate response
schemas, and target the fixed local API. No Supabase key is included in the extension.

**Disconnect** attempts server revocation and always clears local credentials. If
revocation cannot be confirmed because the local app is unavailable, the panel
explains that the session must also be revoked in web integration settings. Web
revocation/expiry is enforced on the next request and removes local credentials when
reported. Idle panels do not poll or inspect tabs. Local edits remain in panel memory
until saved; they are not put into extension storage.

Official API references: [isolated script execution](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage),
and [self-contained injected functions](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Composer support and safety

Supported adapters cover `textarea[name=text]`, known lexical/Draft.js desktop
contenteditable editors, and open shadow roots of known composer elements. The
injected function is self-contained. Its only mutations set composer text and fire
`input`/`change` events. It never clicks, focuses through a click, submits forms,
synthesizes keyboard input, observes DOM changes, fetches Reddit, votes, or messages.

An unknown, hidden, disabled, read-only, ambiguous, or nonempty composer fails closed.
Existing text is preserved. Exact URL and fresh server approval checks precede
handoff; the injected function checks the URL again immediately before mutation.
DOM changes on live Reddit can make an adapter unavailable. Copy remains the
fallback; live Reddit interfaces have not been exercised with this local build.

## Manual fixture QA

Use a synthetic local opportunity with an approved draft. The seeded SaaS example
uses this fixture:

```text
http://127.0.0.1:3000/extension-fixture/reddit/r/saas/comments/fixture_001/fixture
```

- Verify lookup renders the matching workspace opportunity and evidence.
- Insert into an empty textarea and lexical editor. Confirm the exact approved
  text appears and the fixture's submit-attempt counter stays **0**.
- Try an unsupported editor, multiple composers, and existing text. Confirm the
  page is unchanged and Copy remains available.
- Change the active tab after lookup. Confirm handoff refuses until refreshed.
- Edit locally. Confirm copy/insertion are unavailable until saving, verification,
  human approval in the app, and a fresh lookup.
- Revoke the session in the web app and retry. Confirm the panel asks to reconnect.
- Disconnect while the API is offline. Confirm local credentials are cleared and
  the revocation warning remains visible.

For any separately authorized live manual QA, open only a personal Reddit account,
verify the correct conversation and community rules, and stop after inserting or
copying. Publishing requires the human's own separate decision and action.

## Automated verification

```sh
./scripts/local pnpm exec vitest run apps/extension/tests
./scripts/local pnpm --filter @threadsignal/extension typecheck
./scripts/local pnpm exec eslint apps/extension
./scripts/local pnpm extension:build
```

Unit tests cover strict sender/message boundaries, credential exchange/storage and
revocation, stale approval/tab changes, edit invalidation, bounded requests, safe UI
rendering, copy fallback, and composer insertion. Both behavioral submit/click spies
and a source guard reject final-submit and synthetic keyboard APIs. The phase's
browser verification uses a fresh repository-local profile with the actual built
extension and synthetic local composer pages; see the Phase 5 verification record
for executed browser results and limitations.
