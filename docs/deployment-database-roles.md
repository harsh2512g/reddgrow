# Restricted deployment database identities

`supabase/operations/deployment-runtime-roles.sql` is an optional, reviewed operation after **all** application migrations. It is not applied by the local migration runner and does not activate a hosted deployment. It creates two `NOLOGIN` identities, no passwords, and refuses existing identity names rather than overwriting their grants.

| Identity                      | Authorized scope                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadsignal_runtime_web`    | `SET ROLE` into the existing extension, tracking and billing bridges; no inherited or direct customer-table authority.                                          |
| `threadsignal_runtime_worker` | Worker processing rows, explicit columns needed for safe organization export, two private-storage bucket metadata views, and a finite list of worker functions. |

Both roles prohibit superuser, role/database creation, replication and RLS bypass. The worker has no role memberships and cannot access Auth identities, profiles, connection codes, credential hashes, tracking receipt proofs or provider customer IDs. Organization/brand lock privileges permit `FOR UPDATE` locks, with RLS blocking actual parent-row changes. Worker draft writes permit error handling only; human approval functions are not granted. Invitation cleanup uses one bounded function, never direct invitation deletion.

`verifyDeploymentDatabaseAuthority(sql, 'web' | 'worker')` in `packages/database/src/runtime-authority.ts` checks identity, attributes, role membership, object ownership, creation rights, accessible tables, RLS flags, write columns, sensitive reads and the exact function signature/owner/search-path boundary. Deployment startup fails with a neutral error if authority drifts. It does not log connection strings or secrets.

A future, separately authorized operator must review the complete SQL transaction against the intended new personal project, provision a new password outside source control, explicitly enable `LOGIN`, configure the matching TLS-verified runtime URL, and complete deployment validation. Credentials must never be put in chat, examples, migration files or browser configuration. This audit does not perform those activation steps.

Integration tests apply the operation inside disposable local transactions, exercise real SQL worker paths, test denied privileges and privilege-drift rejection, then roll back roles, grants and fixtures. These tests establish the local authority boundary; they do not establish hosted connectivity, live-provider behavior or hosted migration success.
