# Future architecture modification map

Companion to [the production-readiness audit](PRODUCTION_READINESS_AUDIT.md). Paths below are repository-relative; these are future modifications, not changes performed by the audit. Priority IDs refer to that document. Use existing modules incrementally, preserving public contracts until their consumers migrate.

## Existing files requiring future modification

| Files | Future responsibility/change | Priority |
| --- | --- | --- |
| `server/customer_api_service.js` | Resource/platform policy, required command schemas, evidence/report binding, observation-vs-fact distinction, optional screenshot normalization | P0-02/03/05; P1-08 |
| `server/postgres_repository.js` | Effective member platforms, scoped commands, authoritative metrics, durable operation IDs, projections/outbox, shorter transactions, bounded queries | P0-02/03/06; P1-01/02/03/05 |
| `server/google_identity.js`, `server/http.js`, `server/api_error.js` | Timeout/error/rate controls and consistent policy errors; verified request context | P1-05 |
| `server/db.js`, `server/scripts/migrate.mjs`, new SQL migrations after `006` | Least-privilege roles, tenant context/RLS, append-only audit, resource registry, migration ledger and concurrency control. Preserve published historical migrations rather than rewriting them. | P0-07; P1-01/06 |
| `server/customer_provisioning.js`, `server/customer_management.js` | Connector/resource onboarding checks and explicit privileged caller context | P0-07; P2-03 |
| `server/team_management.js`, `utils/team_access.js` | Shared canonical team policy/contract, recovery semantics, generic support wording | P2-02; P3-01 |
| `server/subscription_service.js`, `server/billing_service.js`, `server/billing_http.js` | Entitlement integration with domain commands, worker operation controls, reconciliation and recovery | P0-01; P1-07 |
| `integrations/wix/billing_bridge.mjs`, `server/scripts/process_billing.mjs` | Tested provider contract, production scheduler integration, reconciliation and alerting | P1-07 |
| `server/report_pdf.js`, `utils/pdf_common.js`, `services/report_service.js` | Owned evidence contract, tenant branding/assets, aligned limits, renderer/job separation | P0-03; P1-05/08 |
| `api/v1/extension/bootstrap.js`, `api/v1/extension/memberships.js`, `api/v1/extension/data.js` | Keep thin handlers; route through versioned request context/domain policy; deployment compatibility | P0-02/03; P1-06 |
| `api/v1/billing/wix.js`, `api/v1/billing/process.js`, `api/health.js` | Worker identity/routing and separate safe liveness/readiness | P1-06/07 |
| `background/main.js` | Thin authenticated command router, per-action sender schemas, scoped job lifecycle, server configuration adapters | P0-01/04; P1-04 |
| `background/services/reporting_workflow.js` | Keep browser capture/group previews; move policy, scoring and durable reporting authority to API; capture tab binding; persistent IDs and optional evidence | P0-01/03/04/05/06; P1-02/08 |
| `background/services/rogue_workflow.js` | Tab/customer capture sessions, bounded/redacted network collection, API evidence commands | P0-01/04 |
| `background/services/search_workflow.js` | Source-work lookup/update commands instead of direct sheet writes | P0-01/07 |
| `background/services/macro_workflow.js` | Authorized, schema-validated selector recording/configuration workflow | P0-01; P1-04 |
| `background/services/rumble_workflow.js`, `background/services/fresh_tiktok.js` | Preserve platform observation behavior; add scoped resumability and hostile-page tests | P1-02/04 |
| `services/sheet_scanner.js` | Server-owned jobs/status/scoring; browser observations with leases; compatibility projection through API | P0-01/03/06; P1-02 |
| `utils/google_api.js` | Replace active calls with API adapters in stages; move provider-specific behavior to server; quarantine dormant helpers and fix unsafe input/query handling | P0-01/05/07; P1-02/04 |
| `services/customer_bootstrap_service.js`, `utils/auth.js` | Scoped lifecycle cleanup/cancellation, separate sign-in and connector grants, no local authority | P0-01/04 |
| `utils/idb_storage.js` | Tenant/user-owned evidence keys, expiry, deletion and pending-operation ownership | P0-04 |
| `services/customer_data_service.js`, `services/customer_membership_service.js` | Versioned thin clients; migrate schemas to neutral contracts; commands instead of trusted outcome/score events | P0-03; P2-02 |
| `services/customer_migration_service.js`, `config/customer_migration.json` | Independent parity source, server-owned cutover state and digest provenance | P0-06 |
| `services/customer_config_service.js`, `utils/customer_config.js`, `utils/access_control.js` | Separate public client schema from protected policy and server secrets; unify contracts without trusting client validation | P0-01/07; P2-02 |
| `services/theme_asset_service.js`, `utils/runtime_theme.js`, `utils/runtime_identity.js`, `utils/theme_loader.js` | Scope-safe theme lifecycle; versioned branding; bounded downloads and minimal public profile | P0-04; P1-08 |
| `sidepanel/main.js`, `popup/main.js`, `options/main.js`, `options/team.js` | Thin UI, server capabilities and operation status; remove authority from platform-session checks; neutral support copy | P0-03/05; P1-04; P3-01 |
| `content_scraper.js`, `content_autofill.js`, `content_form.js`, `clippy.js` | Preserve scraping/form help; validate origin/tab-bound messages, render untrusted text safely, separate observed vs confirmed submission | P0-04/05; P1-04 |
| `utils/platform_catalog.js`, `utils/platforms.js` | Canonical hostname matching and shared supported-platform contract | P0-02; P1-04 |
| `utils/double_xp_retention.js`, `utils/gamification_levels.js`, `utils/gamification_ui.js`, `utils/intel_aggregator.js`, `intel_math.js` | Consolidate scoring/timezone/metric rules server-side; retain UI formatting and fixtures | P0-03; P1-03; P2-02 |
| `utils/pdf_gen.js` | Intelligence export from canonical metrics; decide server rendering/export audit ownership | P1-03; P2-04 |
| `events_config.json`, `Copy of events_config.json` | Remove customer account defaults from neutral package; keep reusable selectors separate from Flo policy | P0-07; P3-02 |
| `manifest.json`, `config/customer_bootstrap.json`, `scripts/configure_customer_api.mjs` | Least-privilege browser scopes and explicit deployment/build/OAuth profiles | P0-07; P1-04/06 |
| `scripts/build_extension.mjs`, `scripts/audit_flosports_fallbacks.mjs` | Release validation for nested channel/Studio IDs, brand assets, secrets, imports, environment and provenance | P0-07; P2-05 |
| `neon.ts`, `vercel.json`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json` | One documented deployment contract, environment validation, runtime pinning, CI scripts and broader secret-file exclusions | P1-06; P2-05 |
| `server/customer_setup_web.js`, `server/subscription_web.js`, `server/seller_auth.js`, `server/local_credentials.js`, `server/scripts/customer_setup.mjs`, `server/scripts/set_seller_password.mjs` | Retain local seller boundary; later named privileged identities, hosted secure sessions and audit | P2-03 |
| `server/scripts/seed_flosports.mjs`, `server/scripts/licensing_preflight.mjs`, `migrations/flosports/*`, `migrations/validate_membership_migration.js` | Explicit terms and tenant onboarding, protected fixtures, independent import reconciliation and safe preflight | P0-06/07; P1-06 |
| `tests/*.test.mjs`, `tests/team_fixture.mjs`, `tests/team_browser_server.mjs`, `tests/seller_test_helpers.mjs` | Extend behavior/integration coverage described in the audit; require isolated Postgres jobs in CI | P0/P1 gates |
| `README.md`, `ACCESS_CONTROL_OUTLINE.md`, `docs/white-label/*.md` | Update as-built authorization, projection, migration, pricing/feature and deployment guarantees as stages land | P0-06; P3-02 |
| `sidepanel.html`, `options.html`, `options/team.html`, `popup.html`, `options/team.css`, `utils/extension_constants.js`, `utils/clippy_assets.js`, `images/*`, root legacy media | Neutral support/industry copy, optional branding and asset licensing/release inventory | P2-05; P3-01 |

## Proposed additions, not created in this audit

| Proposed area | Purpose |
| --- | --- |
| `contracts/` | Versioned browser/server wire schemas and enums without Chrome, database or network side effects |
| `server/policy/`, `server/domain/` | Request context, operation/resource authorization, reports, source works, evidence and configuration rules |
| `server/integrations/google/` | Tenant connector credentials/resource registry and explicit Flo workbook compatibility adapter |
| `server/jobs/`, new SQL migrations | Durable operation state, transactional outbox, external projection, reconciliation and cleanup |
| `server/analytics/` | Versioned metric projectors and bounded scoped queries |
| `tests/fixtures/`, additional integration/browser suites | Sanitized independent Flo baseline, unrelated tenants, failure recovery and security matrix |
| `.github/workflows/` or chosen CI equivalent | Required isolated DB, contract, build, security and deployment tests |
| Deployment/operations runbooks | Environment mapping, OAuth onboarding, backup/restore, incident response and billing job ownership |

## Repository coverage and deferred artifacts

- Root `background.js`, `options.js`, `sidepanel.js`, `popup.js` are bootstrap shims; keep stable unless entry-point wiring changes. `background/lib/blob_utils.js`, selection/UI helpers, protected input and assistant preference are supporting browser utilities; review with consumer tests, without speculative rewrites.
- Empty scraper-engine/bot/UI-overlay modules and comment-only config scaffolding do not implement the services their names suggest. Remove or repurpose only after validating references.
- `lib/jspdf.umd.min.js` is vendored third-party code: inventory/version/license and PDF smoke tests are required; this audit did not review its minified internals for vulnerabilities.
- `stabilization/snapshots/*` and `.playwright-cli/*` are historical/support material; `output/playwright/*` are generated captures. Do not edit them to simulate current behavior, distribute them with the extension, or treat them as independent current regression tests.
- `.agents/skills/*` and `skills-lock.json` are development tooling, not runtime architecture. No skill installation/update or infrastructure mutation was needed for this read-only audit.
