# ThreadSignal phase map

Phase 0 establishes the repository and local execution boundaries. Later functionality is deliberately not represented as complete.

| Master specification                                 | Owner phase                                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0: instructions, guardrails, quality                 | All phases; foundation in 0                                                                                                             |
| 1–2: purpose, goals, non-goals                       | All phases                                                                                                                              |
| 3: roles and permissions                             | 1; platform administration in 8                                                                                                         |
| 4: complete customer journeys                        | 1–7; complete verification in 8                                                                                                         |
| 5: routes                                            | Shell in 0; auth/settings in 1; knowledge in 2; opportunities in 3; drafts in 4; analytics in 6; billing in 7; internal operations in 8 |
| 6: design system                                     | Foundation in 0; components with their owning feature phase                                                                             |
| 7.1: authentication/organizations                    | 1                                                                                                                                       |
| 7.2–7.4: brands/knowledge/keywords                   | 2                                                                                                                                       |
| 7.5–7.9: communities/ingestion/scoring/feed          | 3                                                                                                                                       |
| 7.10–7.14: generation/verification/disclosure/drafts | 4                                                                                                                                       |
| 7.15: manual-insert extension                        | Shell in 0; complete behavior and safety proof in 5                                                                                     |
| 7.16–7.18: tracking/conversions/analytics            | 6                                                                                                                                       |
| 7.19–7.20: email/billing                             | Interfaces in 0; trial/plan skeleton in 1; real adapters in 7                                                                           |
| 7.21: audit log                                      | With each feature; completeness review in 8                                                                                             |
| 8: AI                                                | Provider contract in 0; embeddings in 2; scoring in 3; drafting in 4                                                                    |
| 9: architecture                                      | Foundation in 0; deployment documentation in 8                                                                                          |
| 10: database/RLS                                     | Infrastructure in 0; business migrations with owning phases                                                                             |
| 11: APIs                                             | Health in 0; feature APIs with owning phases                                                                                            |
| 12: jobs                                             | BullMQ heartbeat foundation in 0; business queues with owning phases                                                                    |
| 13: security/privacy                                 | Isolation and safe defaults in 0; tenant isolation in 1; crawler/upload in 2; complete review in 8                                      |
| 14: public pages                                     | Honest homepage/security foundation in 0; pricing with central plan configuration; full content pass before 8 completion                |
| 15: demo data                                        | Synthetic contract fixtures in 0; complete demo across 1–7                                                                              |
| 16: tests/CI                                         | Foundations in 0; feature suites with each phase; all journeys in 8                                                                     |
| 17: accessibility/performance                        | Shell in 0; feature checks throughout; final audit in 8                                                                                 |
| 18: observability                                    | Pino/hooks/readiness in 0; full operational coverage in 8                                                                               |
| 19: environment                                      | Names-only examples and conditional validation in 0                                                                                     |
| 20–22: acceptance and delivery                       | Phase gates throughout; complete MVP delivery in 8                                                                                      |
| 23: future roadmap                                   | Outside MVP                                                                                                                             |
| 24: current platform terms                           | Review before any approved production integration                                                                                       |
| 25: product statement                                | All phases                                                                                                                              |

Phase 0 review requires installation, isolated services, reset/seed, generated types, web and worker boot, all quality gates, integration tests, browser smoke tests, extension build, and safe shutdown. It does not complete Phase 1.
