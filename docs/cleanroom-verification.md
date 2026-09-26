# Disposable clean-room verification

The final audit can rebuild the current working tree in `.audit/`, with fresh dependencies, browser binaries, generated output, Supabase data and a separate repository-local Colima VM. It does not reset the original database or copy hosted configuration. No Git commit is created.

Run after source changes are frozen and the original web/worker processes are stopped:

```bash
./scripts/local pnpm cleanroom:verify
```

The runner first records a SHA-256 source manifest and creates an isolated Git index for the secret scanner. Only allowed source paths are copied, including current uncommitted files. Dotenv files other than `.env.example`, symlinks, private configuration, dependencies, caches, generated bundles and build output are excluded. Both Git operations and subprocesses use the existing project isolation environment.

Dependency and Chromium installation finish before the original services are interrupted. The runner then stops the original Supabase/Redis stack while retaining its volumes, starts the snapshot's own Colima-backed stack, resets and seeds only the snapshot database, and checks:

- Service health and database lint.
- Lint, formatting, TypeScript, unit tests, production build, extension build and secret scanning.
- The full database/worker integration suite.
- Development homepage, web readiness and worker readiness.
- A production rebuild, the complete Playwright E2E suite including demo journeys, and the MV3 browser suite.

Every attempted service transition has a compensating action. Success and failure both stop the snapshot stack, restore the original stack and check its health. SIGINT/SIGTERM signal only processes started by this harness; process-group termination is not used on unrelated services. A forcibly killed host process cannot guarantee restoration, so the evidence log must always be checked after an interrupted session.

Evidence stays under `.threadsignal/cleanroom/`: source manifest, numbered command logs, exact exit status/duration, and `results.json`. The snapshot remains ignored for inspection. The runner refuses to overwrite an existing `.audit` directory by default. It also fails if Colima reports creating a host temporary path outside the repository; such a result is an isolation blocker, not a passing clean-room check.

After correcting a failed rehearsal, `./scripts/local pnpm cleanroom:verify --resume` accepts only the owned snapshot: its two source manifests must match, every previous source hash must match, and unknown source paths are rejected. It refreshes reviewed source, retains only the snapshot's generated dependencies/browser/cache/state, and reruns installation and all verification steps. New evidence is written to `attempt-02/` (then the next unused number), including a copy of the previous manifest; prior command logs/results remain intact. The refreshed source manifest binds the new attempt to the reviewed working tree. This is a resumed rehearsal, not a claim that retained packages were freshly downloaded again.

`./scripts/local pnpm exec node scripts/cleanroom.mjs prepare` creates only the snapshot and manifest. It does not install packages, switch services or verify acceptance. Do not run preparation separately immediately before `cleanroom:verify`, which intentionally refuses to reuse an existing snapshot.

The final resumed rehearsal passed on 2026-09-20; exact results and prior failures are in [audit verification](audit-verification.md). The first attempt performed cold public dependency/browser downloads. Later attempts reused those caches, refreshed verified source and reran every gate. Attempt five passed reset/seed, the full automated suite, builds, development checks and original-service restoration. Preparation or harness unit tests alone are not evidence of a passing full rehearsal.
