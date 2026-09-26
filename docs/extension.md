# Chrome extension: reply studio

Phase 5 connects the Chrome side panel to one ThreadSignal workspace. It shows the current conversation, rules and supporting evidence, and lets a person copy or insert an approved reply. It never performs Reddit's final submit action.

## Try it locally

1. Start the local app and worker with `./scripts/local pnpm dev`, then open `http://127.0.0.1:3000`. Local sign-in uses the inbox at `http://127.0.0.1:54324`; it is separate from hosted sign-in.
2. Run `./scripts/local pnpm extension:build`. In a fresh personal Chrome profile, open `chrome://extensions`, enable Developer mode and load unpacked `apps/extension/dist`. Pin ThreadSignal and open its side panel. Do not use an office profile or an existing signed-in session for testing.
3. In ThreadSignal, open **Settings → Integrations**, name the browser and select **Connect Chrome extension**. Paste the one-time code into the extension. The code expires in five minutes and works once. Creating another replaces it.
4. Create a synthetic brand, add its fixture knowledge and monitor a community. In **Opportunities**, generate a draft; in **Drafts**, review the evidence, edit if necessary and approve the current version.
5. Select **Open mock discussion**. On that fixture tab, open the extension and select **Look up current tab**. Choose **Insert into comment box**. The fixture's **Submit attempts** counter must stay at zero.
6. Try the fixture's unsupported/nonempty/multiple composer variants. Insertion refuses them and explains the explicit **Copy approved draft** fallback.

Editing in the panel disables copy and insertion. **Save for verification**, reopen the draft in ThreadSignal, review and approve the new version, then look up the tab again. No unsaved edit is inserted. Recording a published comment requires a matching comment permalink and explicit confirmation that you published it yourself. These records are self-reported; ThreadSignal does not verify them with Reddit or treat them as conversion events.

The fixture is synthetic and cannot publish. Its page requires both the isolated local launcher and local Supabase mode, plus ready draft processing. Deployment and hosted workspaces never offer a loopback practice link, even with mock Reddit data. The default build connects only to the local app on port 3000. The separate deployment build described below does not activate any hosted service or publish to the Chrome Web Store. After rebuilding, reload the unpacked extension and reopen its panel.

## Connection, permissions and data

Owners, admins and members can connect their own extension. A viewer cannot connect or change drafts. Settings lists safe connection metadata and supports single/all revocation; managers may revoke workspace sessions, members their own. Disconnect in the panel revokes the current token and clears local storage. If the server is unreachable, local logout still completes and the panel tells you to revoke the connection in Settings when available. Sessions expire in thirty days.

The manifest requests `sidePanel`, `storage`, `activeTab`, `scripting`, and only `http://127.0.0.1:3000/*` as a permanent host permission. `activeTab` grants temporary access after the user invokes the extension. There is no browsing-history permission, permanent Reddit host permission, automatic content script, tab observer or external-message listener. The checked-in manifest key is a public build identifier, never an API credential.

Tokens stay in Chrome trusted extension storage and are sent by the background worker only to the API origin fixed at build time. The database stores hashes. Current-tab lookup happens only on request; it sends URL identifiers to find an already ingested opportunity. Insertion inspects only known composer elements and writes approved text after a fresh server check. It never scrapes conversation content, sends Reddit network requests, clicks buttons, submits forms or simulates typing. No Reddit password, Supabase key or paid-provider secret is stored in the extension.

API calls have bounded bodies/responses, atomic Redis rate limits, safe errors and request IDs. PostgreSQL independently enforces membership, organization isolation, expiry, revocation, current evidence and approval. Settings retains every active connection in its list and displays up to fifty recent inactive connections. Hourly bounded cleanup removes expired credentials; expiry rejects requests immediately even if cleanup is delayed. See [architecture decisions](../DECISIONS.md), [file map](phase-5-files.md) and [verification](phase-5-verification.md).

## Manual compatibility QA

Automated acceptance uses the real MV3 background/controller/panel in an isolated Chromium profile against local fixtures. It covers connection, edits/reapproval, textarea/contenteditable insertion, zero submit attempts, fallback, manual publication recording and revocation. Auth/code/token traces and automatic screenshots are disabled; safe screenshots are taken only after code dismissal. Exact executed results are in the verification record.

Native Chrome toolbar/side-panel presentation and live Reddit editor changes require manual review before real-provider use. On an owner-approved personal test account and discussion, open one empty composer, look up a legitimately monitored post, insert an approved draft, and inspect the text without submitting. Repeat with nonempty, multiple, hidden, old/new and open-shadow composers; failures should offer copy. Unsupported or closed-shadow editors are intentionally unsupported. No account-safety guarantee is made.

References: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [network permissions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

## Packaging and Chrome Web Store release

`apps/extension/dist` remains the unchanged local development target. A separate explicit public profile produces `apps/extension/dist-deployment`; both outputs are ignored by Git. Prepare a repository-relative JSON file containing **only** `apiOrigin`, `extensionId` and `manifestKey`. The API origin must be a canonical public HTTPS DNS origin with no path, query, fragment, credentials or custom port. The manifest key is the extension's public RSA SPKI key in base64, never its private signing key. The build derives the Chrome ID from SHA-256 of that public key and refuses a mismatched ID. Profile paths cannot be absolute, traverse directories, name dotenv files or contain symlinks.

Build the reviewed public configuration without activating a provider or accessing an account:

```sh
./scripts/local pnpm --filter @threadsignal/extension build --deployment --profile config/extension-release.json
```

The example path is not created automatically. Use the public identity for the intended personal release. Set the separately approved backend's `EXTENSION_ALLOWED_ORIGINS` to the exact `chrome-extension://<extensionId>` and its HTTPS app URL to the same `apiOrigin`. This is configuration of an already reviewed deployment runtime, not permission to create accounts, migrate a hosted database or publish. A deployment bundle contains only that API origin in its permanent host permission and CSP `connect-src`, adds no permissions, and removes the local composer URL branch. The default profile and artifact keep their existing local identity.

For a release candidate:

1. Freeze the reviewed source/lockfile, increment the manifest version, and run `./scripts/local pnpm extension:build` and `./scripts/local pnpm test:extension`. Build the separate deployment artifact with the reviewed public profile. Repeat the source no-submit check and inspect that artifact's manifest/JavaScript for accidental permissions, loopback endpoints or secrets.
2. Load unpacked in a newly approved personal profile. Verify connect/revoke, current-tab lookup, edited-draft reapproval, supported empty composer insertion, nonempty/ambiguous fallback, expired/revoked credentials and offline error states. Confirm that no form submission, click or keyboard submit is triggered. Repeat the documented live-interface QA before claiming live Reddit compatibility.
3. Package only the generated extension directory with `manifest.json` at the archive root. Exclude source maps, tests, personal profiles, tokens, API secrets, Node dependencies and repository state. Record an artifact checksum and test it after unpacking. Do not package the entire repository.
4. Prepare original icons/screenshots, clear single-purpose description, support/privacy URLs and accurate Chrome data-use declarations. Explain storage, activeTab, scripting, sidePanel and the exact API host permission; do not request browsing history or unrelated hosts.
5. After the owner explicitly approves the new personal publisher account and external submission, follow the current [Chrome Web Store publication procedure](https://developer.chrome.com/docs/webstore/publish). A successful upload is not review approval. Record the approved artifact/version and a rollback/distribution plan without disabling server revocation checks.

No Web Store account was accessed, archive uploaded or release published during local implementation. Native Chrome presentation and live Reddit DOM tests remain unverified until the separate manual review is completed.
