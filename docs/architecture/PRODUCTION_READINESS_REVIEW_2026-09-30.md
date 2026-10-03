# Rights Reporter production-readiness audit — September 30, 2026

**Decision: hold production distribution and new customer onboarding.** The extension builds, its local tests pass, and the documented production customer API rollout has materially improved authorization and isolation. Today's read-only probe nevertheless found a live Team & Access protocol mismatch. A separate, locally reproduced scanner error can mark a playable TikTok video resolved. The installed extension and authenticated hosted workflows have not been exercised end to end against this exact release.

## Scope and evidence standard

This review covers the current working tree at HEAD `915a0b5`, **including existing uncommitted and untracked changes**. It examines the manifest/release archive, content scripts and extension pages, background workflows, Google command boundary, membership/report/data API, SQL isolation design, production rollout notes, tests, dependencies, and selected operational controls. Findings distinguish reproduced behavior, source-traced exposure, documented prior deployment checks, and checks still missing. This is a release audit of the present checkout, not a claim that every platform form, external account, or production control has been independently certified.

No application source, customer data, provider resource, database, or deployment was changed during this audit. The only repository addition is this report. The synthetic TikTok probe performed no live platform or Google write. The production API probes used unauthenticated `OPTIONS` only.

## Findings, in release order

### P0 — Deployed membership endpoint does not advertise the current Team & Access protocol

`npm run verify:api` failed twice today. The bootstrap and data endpoints returned compatible markers. The configured membership endpoint returned the general `X-Rights-Reporter-API` marker but **not** the current `X-Rights-Reporter-Team: team-access-v1` marker required by `server/scripts/verify_customer_api.mjs:27`. A probe with the installed extension's public origin produced the same result, without an origin rejection. Current source adds the team marker to every response in `server/http.js:31`; the deployed route therefore does not match the current response contract or an intermediary is removing that header. The September 30 rollout note at `CUSTOMER_API_ROLLOUT_2026-09-29.md:76–86` reports a successful earlier probe, but its checks did not establish today's Team & Access marker. **This does not prove Team & Access operations fail**; it means the current client/server combination lacks positive compatibility evidence.

Fix/acceptance: identify the active membership function revision and its response headers; deploy the matching handler or correct header handling; rerun `verify:api` with the extension origin; then perform authenticated, least-privilege `team_list`, preview, and carefully controlled commit/denial checks through the installed extension. Do not infer authorization from an OPTIONS marker alone. The previous screenshot's `teamAccess` invalid-request error remains unresolved until the exact hosted request/response is captured without tokens or personal data.

**September 30 follow-up:** The header mismatch was repaired by targeted
membership deployment 8 (active at 2026-10-01 01:27:18 UTC). After propagation,
the origin-aware `verify:api` passed. Credential-free production POST responses
also carried `team-access-v1`: a valid `team_list` request returned 401
`identity_error`, and malformed JSON returned 400 `invalid_request`. The probe
now tests this POST contract as well as OPTIONS. Authenticated installed-extension
checks and the screenshot's exact failed request/response remain unresolved;
the P0 finding is only partially closed until those checks pass.

### P1 — Non-YouTube scanner can falsely record removal and award credit

`services/sheet_scanner.js:130–215` checks broad page text and title for removal phrases **before** checking whether a playable video/post exists. YouTube was narrowed to player-error elements and has description/comment regression tests, but TikTok, X/Twitter, Instagram, Facebook, Rumble, and Discord still use broad phrases. With the actual scanner callback and a synthetic playable TikTok page containing a comment about “video not found,” the scan returned `resolvedCount: 1`, `activeCount: 0`, and wrote row status `Resolved`. The later workflow can format the URL as struck through and award scanner credit (`services/sheet_scanner.js:506–509`). This is a confirmed integrity defect, not only a theoretical wording concern.

Fix/acceptance: use platform-specific error components, response signals, or verified unavailable states; check playable/post elements first; distinguish inaccessible/private from confirmed removal; never write resolution or reward on ambiguous body text. Add hostile description/comment/title fixtures for every supported scanner platform and test the resulting sheet and reward writes.

### P1 — Vendored PDF dependency remains vulnerable in a reachable local path

`lib/jspdf.umd.min.js` identifies itself as jsPDF **4.0.0**. The maintainer's [GIF dimension denial-of-service advisory](https://github.com/parallax/jsPDF/security/advisories/GHSA-67pg-wm7f-q7fj) covers versions through 4.1.0. The extension accepts GIF customer logo assets up to 1 MB but does not check decoded dimensions (`services/theme_asset_service.js:5–6,45–60`); the local intelligence/briefing PDF passes `pdfTheme.logoDataUrl` to `addImage` (`utils/pdf_gen.js:317–318`). Exploitation requires a harmful configured/cached logo or control of its source. The ordinary server evidence-report path currently receives product/colors/legal without `logoDataUrl` (`server/postgres_repository.js:368`), so its logo path is not established as reachable through this route. No malicious GIF was executed.

Fix/acceptance: upgrade the vendored library to a patched release, inventory both PDF paths, constrain image dimensions and decoded size before `addImage`, and rerun PDF layout and hostile-image tests. `npm audit` cannot see vendored files.

### P1 — This exact tree lacks a complete isolated-database and installed-extension release run

Local `npm test` reported **378 tests: 370 passed, 0 failed, 8 skipped**. The eight skipped suites require an explicitly isolated PostgreSQL URL and cover the most important persisted boundaries, including tenant isolation, RBAC, customer authority, team administration, subscriptions, operations, Google resources, and TikTok identity. `scripts/test_ci.mjs` correctly refuses to skip these, and `.github/workflows/test.yml` provisions PostgreSQL; however, the September 30 rollout note records an initial full isolated run with failures, followed by focused fixes and **no second full CI run** (`CUSTOMER_API_ROLLOUT_2026-09-29.md:41–46`). Today's local environment has no isolated database, so the corrected exact tree has not received a passing full run in this audit.

The new real-Chromium check passed, but `tests/browser/enforcer.chrome.test.mjs:8–20` creates a tiny test extension containing the enforcer helper, not the actual packaged extension. It does not verify settings sign-in, worker restart, queue/evidence recovery, account switching, autofill, the installed extension ID, or authenticated hosted actions. The rollout note itself leaves those installed checks open (`CUSTOMER_API_ROLLOUT_2026-09-29.md:88–95`).

Fix/acceptance: run `npm run test:ci` on a disposable isolated database with zero skips and publish the exact commit/build result. Exercise the built extension in Chrome with approved and denied users across the two customer tenants, including the screenshot's configuration/editor/community/statistics paths and safe simulated reporting flows. Keep takedown submission disabled in automation.

### P1 — Operational and provider recovery is documented but not yet demonstrated end to end

The source now journals Google writes and has an upload reconciliation command (`server/integration_journal.js`, `docs/architecture/UPLOAD_RECONCILIATION.md`). Mock tests pass. No live timeout-after-commit recovery, provider ACL/ancestry drift, worker termination at every reporting boundary, or operator reconciliation drill was run on this exact release. `CUSTOMER_API_ROLLOUT_2026-09-29.md:64–85` documents 14 production migrations, a restricted runtime login, a tenant-isolation preflight, connector checks for FloSports, and deployment; those are valuable prior checks, but this audit has independently confirmed only endpoint preflight behavior, not production database grants, hosted identity verification, two-tenant provider separation, backup restore, billing scheduler, monitoring, or rollback.

Fix/acceptance: complete a staging recovery drill using isolated provider resources; demonstrate one logical report under retries, worker restart, and ambiguous upload; verify two unrelated customers and current restricted runtime grants; record backup restore, alerting, billing-worker, and rollback evidence before general release.

**September 30 follow-up:** [The operational recovery drill record](OPERATIONAL_RECOVERY_DRILL_2026-09-30.md) contains a fresh restricted-login preflight, 26 passing isolated-database recovery/isolation tests, local worker restart regression, and a readable unfinalized snapshot restore preview. Current production inventory showed no Neon trigger or automatic snapshot schedule and only the four customer API functions active; billing scheduling and alert delivery were not demonstrated. Live isolated-Google timeout-after-commit, provider ACL/ancestry drift, authenticated two-customer staging, installed-worker termination, and a function rollback rehearsal remain open. Keep this P1 and the general-release hold open.

### P2 — Target authority is uneven outside YouTube

`server/report_policy.js:34–61` resolves YouTube target ownership to stable channel IDs and compares the supplied account. For other platforms it checks a claimed handle and some URL path handles against the authorized-handle list, without proving the target's actual owner. TikTok now has stable video-ID deduplication and restricted share-link resolution, but that does not establish owner identity. This is a stated source limitation, relevant whenever the product presents non-YouTube enforcer checks as authoritative.

Fix/acceptance: define which providers can supply trustworthy owner IDs; use them where available. For providers without them, describe the check as a guard against known approved handles and require operator confirmation or review rather than claiming verified ownership. Test handle changes and aliases.

### P2 — Extension permissions and distribution need a recorded least-privilege review

`manifest.json:12–44` requests `<all_urls>`, `webRequest`, `identity.email`, `activeTab`, and broad Google Drive and Sheets scopes. The package has a neutral manifest identity and the server now executes operational Google commands, so the release should re-evaluate each remaining host/API permission and the OAuth consent/distribution configuration. Broad permissions increase the scope of compromise and user consent. This audit did not determine whether every grant can be safely narrowed without breaking supported workflows; treat this as a review gate rather than a claim that a particular permission is unused.

### P3 — Status documentation disagrees with the production rollout

`docs/architecture/IMPLEMENTATION_STATUS.md` still describes the customer API as not deployed, whereas `CUSTOMER_API_ROLLOUT_2026-09-29.md:49–86` records its September 30 activation. Update the status page and release checklist after resolving the live marker mismatch so an operator does not make decisions from obsolete deployment state.

**October 2 follow-up:** The [implementation status](IMPLEMENTATION_STATUS.md) and [current production release checklist](../white-label/CUSTOMER_API_DEPLOYMENT.md#current-production-release-checklist) now distinguish the deployed API from the unreleased extension. A fresh credential-free `verify:api` run with the installed extension origin passed all three production routes, including the membership Team & Access marker and POST denial. This P3 documentation finding is closed; authenticated release checks remain open.

## Verification completed today

| Check | Result and limit |
| --- | --- |
| `npm test` | 378 reported; 370 passed, 0 failed, 8 database suites skipped. |
| `npm run test:chrome` | 1/1 passed in real Chromium, using a small helper-only test extension. |
| `npm run build:extension` | Passed; version 3.4.0 ZIP, 107 archive entries; SHA-256 `f420f5a502a0be82a1a916ea61b55fb99739c7f31a63c3fe5ea5a468082eb4d8`. |
| ZIP inspection | No server/test/environment paths or tested private-key/database/token patterns found; this is not a full secret-history audit. |
| `npm audit --omit=dev` | 0 advisories in the npm production dependency graph. Full npm graph: one high, two moderate, one low affected entries, all in the Neon CLI development chain; vendored jsPDF is outside npm's graph. |
| `npm run verify:api` | Bootstrap/data compatible; memberships missing Team & Access marker on repeated unauthenticated OPTIONS probes. Public installed-extension origin was accepted by all three responses. |
| `git diff --check` | Passed. |
| Synthetic scanner probe | Reproduced false `Resolved` on a playable TikTok page quoting “video not found”; no external writes. |

## Confirmed improvements since September 27

The previous host-DOM theme leak is removed (`utils/theme_loader.js`); Rumble sessions now have account scope, random generation IDs, cancellation, and page revalidation (`background/services/rumble_workflow.js`); reporting completion mutates the latest queue and deletes only submitted screenshots (`background/services/reporting_workflow.js`, `utils/cart_mutation.js`); enforcer page inspection runs in Chrome's main world with exact normalized IDs and server-side `sidepanel.enforce` policy (`utils/enforcer_session.js`, `server/access_policy.js`); YouTube's scanner checks player-error elements; event rows use Sheets `appendCells`; long PDF target URLs wrap; TikTok video IDs use stable keys; and evidence uploads have a reconciliation path. These are source and test findings, not a substitute for installed and hosted release checks.

Release sign-off still requires resolution of false scanner outcomes, replacement/hardening of jsPDF, and authenticated packaged-extension/provider/operational acceptance evidence. The membership marker mismatch was repaired and the origin-aware production probe passed again October 2; the [rollout record](CUSTOMER_API_ROLLOUT_2026-09-29.md#subsequent-release-verification--october-1-2026-utc) also records a passing full isolated-database CI run on October 1. These completed checks support continued staging work, not a production-ready verdict.
