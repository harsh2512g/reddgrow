# Step 14: source release preparation

Date: 2026-09-26. The owner explicitly requested completing remaining repository work, committing and pushing to GitHub. Target: existing personal repository `harsh2512g/reddgrow`, branch `main`. Baseline: `eaf24a7`.

## Scope and acceptance

- Add an honest `0.1.0` changelog and consistent version metadata for the unpublished workspace/extension.
- Preserve the reviewed Step 12/13 source, migrations, generated types and tests.
- Keep release documentation in future clean-room snapshots.
- Pass lint, formatting, TypeScript, unit tests, builds, relevant extension verification and staged-source hygiene checks.
- Create one release commit with `feat: complete ThreadSignal MVP`, including the remaining limitations in its body.
- Publish only a fast-forward to the existing personal GitHub repository, with no force push, unrelated credentials or hosted activation.
- Do not create a release tag while full release acceptance remains open.

## Changes

Added `CHANGELOG.md` and this release record, and linked both from `README.md`. Aligned 14 existing manifests to `0.1.0`; all 20 root/application/package/extension manifests now agree. The extension was never published to the Web Store; its previous `0.5.0` was development metadata. Added the changelog to `scripts/cleanroom-source.mjs` and its existing source-policy test. Recorded ADR-040 and updated implementation status. Application runtime code and database migrations are unchanged from the verified Step 13 tree.

## Verification

All local package commands use `./scripts/local`. Release checks passed; logs remain ignored under `.threadsignal/step14-*.log`.

| Command/check                                             | Exact result                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                               | Exit 0; root and web ESLint passed.                                                                 |
| `pnpm format:check`                                       | Exit 0; all matched files formatted.                                                                |
| `pnpm typecheck`                                          | Exit 0; 33/33 tasks plus tooling TypeScript (10.264 seconds for Turbo).                             |
| `pnpm test`                                               | Exit 0; 1,491/1,491 tests across 104 files (36.28 seconds).                                         |
| `pnpm build`                                              | Exit 0; 18/18 tasks, zero cached (26.784 seconds).                                                  |
| `pnpm extension:build`                                    | Exit 0; version 0.1.0 MV3 artifact built.                                                           |
| `pnpm test:extension`                                     | Exit 0; 1/1 test (1.2 minutes), zero submit attempts.                                               |
| `pnpm secrets:check`                                      | Exit 0; 754 repository text files checked.                                                          |
| Exact staged blob/path/size scan and Git whitespace check | Exit 0; 215 staged files; no supported secret patterns, private/generated paths or files over 1 MB. |
| Version consistency                                       | All 20 package/extension manifests use 0.1.0.                                                       |
| `pnpm dev` and final loopback probes                      | Web/worker remain running; homepage and both readiness endpoints returned HTTP 200.                 |

The initial formatting invocation caused pnpm to refresh 12 cached package links after version metadata changed: 12 reused, zero downloaded, lockfile already up to date, repository preinstall check passed. No global install or registry change occurred.

Step 13's current runtime evidence remains applicable: 268 integration tests, 38 web browser tests with two intentional duplicate mobile skips, database migration/lint and local service checks passed on the unchanged runtime code and schema. Those full suites are not represented as rerun by this metadata/tooling step. The extension's changed manifest will receive a fresh build/browser test. Historical evidence and resolved failures are preserved in [the Step 13 review](step-13-review.md).

The existing development process was intentionally interrupted before building to avoid concurrent Next output writes; it returned exit 1. An initial listener-inspection command used a duplicate `lsof` filter and exited 1; the corrected command found no listeners on ports 3000/3001. These are setup results, not failed acceptance tests. The first development-readiness probe exited 1 because the worker had not yet bound port 3001; web/homepage were already HTTP 200. After its startup event, the repeated three probes all returned HTTP 200 with exit 0. Unit tests also emitted the existing Node 25 local-storage warning; it did not fail a test.

## Publication and open items

The GitHub connector confirmed the exact personal repository and that `main` matches `eaf24a721e1520850518be5474e4ddd9dde50ab8`. It reports `pull: true`, `push: false`. No repository-local Git credential is configured, and machine-wide credential helpers, Keychain, SSH and inherited tokens are prohibited. The release is prepared without accessing them; publication requires authorized write access. Local source release gates pass, but GitHub publication is not claimed by this document.

No tag, hosted migration, deployment, external provider activation, real Reddit action or Web Store upload is part of this release. The two Next render-stream diagnostics, historical isolation exception, remote Node 24/CI and live-provider/deployment/manual-acceptance checks remain open. [Release checklist](release-checklist.md), [deployment](deployment.md) and [specification matrix](../SPEC_COMPLIANCE_MATRIX.md) retain the details.
