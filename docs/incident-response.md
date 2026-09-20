# Incident response

Use this for suspected credential exposure, cross-tenant access, content deletion failure, unexpected provider activity or a severe outage. Keep investigation within the authorized ThreadSignal repository/services. Do not inspect another account, browser session, cloud profile or machine-wide credential store.

## Contain and preserve

1. Record UTC time, affected component, safe request/job/organization identifiers and observed impact. Store a restricted incident note without tokens, request bodies, email recipients, document content or full URLs.
2. Pause the affected organization or provider through the administrative workflow. For widespread compromise, stop the owned worker and restrict new application traffic at the authorized deployment boundary. Keep privacy cleanup enabled where safe. Never use a pause as a substitute for erasure.
3. Revoke affected extension sessions, conversion keys and tracking links through their scoped controls. Log out/revoke Auth sessions when a verified compromise requires it. Any provider credential replacement, hosted configuration change or external notification requires explicit owner authorization and a new personal configuration.
4. Preserve safe event counts, failure codes and deployment/configuration identities before restarting. Do not dump environment variables, Auth tables or customer records into logs for convenience. Local raw provider exceptions remain suppressed.

## Specific failure modes

| Incident                   | Immediate investigation                                                                                     | Recovery condition                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Suspected tenant leak      | Disable affected reads/actions; identify route/RPC and authorization predicate using synthetic reproduction | Regression tests prove API and SQL isolation; impacted data scope established without further disclosure                     |
| Unexpected Reddit action   | Disable extension/provider distribution and inspect reviewed artifact permissions/code                      | Zero submit/vote/DM paths; explicit human action preserved; no anti-detection workaround                                     |
| Deletion stuck             | Inspect safe privacy job/error/lease and Storage health; retain disabled organization                       | Originals/exports removed, database completion recorded, access remains denied throughout                                    |
| Provider auth/rate failure | Respect persisted pause/reset; verify approved configuration without printing it                            | Correct credential/approval and bounded health check; no identity rotation or scraping fallback                              |
| Billing webhook failures   | Distinguish invalid signature/input 4xx from dependency/snapshot 5xx                                        | Exact configured signature/version and idempotent event reconciliation restore correct plan without resetting consumed usage |
| Email retry uncertainty    | Inspect outcome, attempt, context fingerprint and first-attempt age                                         | Reuse stable idempotency only inside 23-hour boundary; do not force resend after uncertainty                                 |
| Data loss/corruption       | Stop writes; select a verified matching database/object recovery point                                      | Execute [restore procedure](backup-restore.md), reapply deletion/revocation ledger, verify isolation and artifacts           |

## Communication and closure

The owner decides customer/regulator/provider communication with appropriate advice for the actual incident. Do not send messages, file external reports or perform account operations without explicit authorization. Do not claim legal notification deadlines from this engineering runbook.

Before reopening, run focused regression tests and the relevant release gates, verify readiness and current permissions, and record remaining uncertainty. The review should identify the trigger, affected boundaries, root cause supported by evidence, corrective changes and a concrete prevention check. Preserve the original failure in verification history; a later passing command must not erase it.
