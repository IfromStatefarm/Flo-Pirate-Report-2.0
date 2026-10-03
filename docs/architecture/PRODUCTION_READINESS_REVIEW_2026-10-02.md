# Rights Reporter production-readiness audit — October 2, 2026

**Decision: hold general production distribution and new customer onboarding.** The complete isolated-database suite now passes, the live API protocol probes pass, and several September 30 findings are closed. This audit nevertheless reproduced two account-lifecycle defects and confirmed an unsafe configuration-rendering path. Dependency updates and authenticated release/recovery evidence also remain necessary.

## Scope and evidence

Reviewed the current working tree at HEAD `915a0b50cbf456715028f63d30278c1f7bdfa1b4`, including existing uncommitted and untracked changes. This is not a test result for HEAD alone. Scope included extension manifest/package, popup/options/side panel, content scripts, background and evidence workflows, identity and permission boundaries, customer/team/report APIs, Google command and resource guards, SQL isolation, subscriptions/seller controls, PDF generation, scanner/rewards, dependencies, tests, and rollout/recovery records.

Evidence is distinguished below as a local reproduction, source trace, live credential-free probe, isolated-database test, or previously recorded operational check. No application source or production deployment was changed. No live provider write or takedown submission was performed. The full CI run wrote test fixtures only to the existing disposable Neon branch `ci-audit-20261001` (`br-autumn-dream-ae93y1ch`), after checking that it was ready, non-primary, non-default and unprotected. Its expiration was October 3 at 00:00 UTC. Its hosted functions and inherited provider credentials were not exercised.

## New actionable findings

### F1 — P1: Google mutations can use the next account before detecting the switch

**Locally reproduced dispatch; resulting provider mutation is source-traced.** `services/google_operation_service.js:5–16` captures customer/member A, awaits settings and OAuth, then immediately sends a command with the token it receives. It compares the current customer and response only after the request finishes (`:25–26`). If the active account changes to B during those awaits, an operation prepared for A can be dispatched with B's token.

The server correctly derives the actor from that token (`server/customer_api_service.js:251–260`), but the Google operation envelope has no assertion of the customer/member for whom the command was prepared. A command such as `updateEventUrl('Sports', 3, url, 'youtube')` can therefore update B's corresponding sheet row before the client raises “The customer changed during this operation.” This is a wrong-account operation race, not an anonymous authorization or RLS bypass. It requires a switch to another account authorized for the command and compatible resources.

A synthetic probe called the real `googleOperation` with expected scope A and changed the mocked profile to B inside `getAuthToken`. It recorded `requestDispatchedUnderChangedAccount: true`, followed by the client-side error. No real API/provider mutation occurred.

**Required fix:** pin an account/session generation, recheck after token acquisition and immediately before dispatch, and have the server compare an intended-scope assertion with its independently verified actor before any side effect. Client-supplied scope must never grant authority. Add switch/logout tests at each asynchronous boundary and assert **zero provider writes**, rather than merely a rejected response.

### F2 — P1: Non-Rumble autofill remains usable with stale customer data after logout or revocation

**Locally reproduced lifecycle defect; form-write path source-traced.** `content_autofill.js:39–50` revokes only Rumble reporting sessions. Other wizards retain `data` and cached overlays. YouTube button handlers at `:1939–1961` invoke their captured data without a fresh access or customer check. The copyright-owner step begins at `:2373`. TikTok's SPA timer at `:2642–2656` can recreate its launcher from `lastReportData` without reauthorization.

A VM probe loaded the real content script, created a YouTube overlay with customer A's synthetic reporter data, delivered storage changes clearing the access profile, reporter information and cart, then invoked Step 2. The overlay remained, its handler received A's data, and it made **zero fresh access checks**. The actual form writer was replaced with a recorder, so no live site or legal form was changed. An open page can retain previous-customer information and continue preparing a complaint after logout, switching or permission removal. Rumble has stronger session checks and is not the reproduced path.

There is also a permission mismatch: `hasAutofillAccess` at `:77–89` asks for `sidepanel.report`, although the wizard prepares enforcement forms. Employees have this permission but lack `sidepanel.enforce` (`utils/permission_policy.js:41–55`). A manually opened supported form can receive the wizard when reporting data is present. Server enforcement finalization still checks its permission; this finding does not establish a bypass of server ledger authorization.

**Required fix:** scope every wizard to a verified customer/member/session, clear its retained data and remove its overlay on account or access changes, require the appropriate enforcement permission, and revalidate before each form-write action and SPA restoration. Test all non-Rumble platforms for logout, switch, suspension and demotion. Require explicit human review before any platform submission.

### F3 — P2: Stored configuration names are interpreted as side-panel HTML

**Validator acceptance reproduced; rendering sink source-traced.** `sidepanel/main.js:1575` interpolates `v.name` and `e.eventName || e.name` into `bountyList.innerHTML`. The configuration command validates section permissions, size and the presence of a verticals array, but does not constrain nested names to a safe rendering boundary (`server/integrations/google_command_policy.js:63–72`). The adapter persists those names.

A probe passed a vertical name containing a harmless synthetic link and an event name containing form markup through the real command validation and Double XP normalization; both survived. A permitted manager/configuration writer, or a compromised configuration source, can place interactive markup in the trusted extension panel. This is a stored markup/UI-spoofing finding. Arbitrary JavaScript execution was not demonstrated, and the extension's CSP limits script execution.

**Required fix:** build the list with DOM nodes and `textContent`, validate nested configuration shapes and lengths, and add a rendering regression that checks hostile names remain text. Check other configuration-derived HTML sinks while implementing the fix.

### F4 — P2: Dependency remediation is incomplete

**Current versions and advisories confirmed; no vulnerable application call path established for these new advisories.**

The vendored jsPDF is now **4.2.0**, which closes the prior GIF advisory, but it remains covered by the maintainer's [HTML output injection advisory](https://github.com/parallax/jsPDF/security/advisories/GHSA-wfv2-pwc8-crg5) and [free-text annotation injection advisory](https://github.com/parallax/jsPDF/security/advisories/GHSA-7x6v-j9x4-qf24). Both identify 4.2.1 as patched. Their upstream severities are critical and high respectively; those are not the assessed exposure of this application. Both current renderers use `doc.output('blob')` (`server/report_pdf.js:233`, `utils/pdf_gen.js:664`), and no application use of the affected new-window output overloads or free-text annotation API was found. Upgrade the vendored asset, update its hash/inventory, and rerun both PDF paths and logo checks. npm audit does not inventory this file.

The production npm graph now reports **one moderate affected package**, `hono@4.13.5`, through `@neon/functions`. The [Hono boundary-rendering advisory](https://github.com/honojs/hono/security/advisories/GHSA-hxh3-vqpv-xpqv) is patched in 4.13.7. No application use of the affected JSX server-rendering features was found. Update the dependency resolution and validate the deployed function bundle before closing this item.

The complete npm graph reports **five affected package entries**: one high (`brace-expansion`), three moderate (`hono`, `@hono/node-server`, `neon`) and one low (`diff`). Apart from shared Hono, these are in the Neon CLI development chain. They are not shipped in the extension ZIP. Update the tooling chain and rerun audits; do not describe the current production dependency audit as clean.

**Remediation update (2026-10-02):** The local asset is now jsPDF 4.2.1, with its npm package integrity and bundle SHA-256 recorded in `PDF_DEPENDENCY_INVENTORY.md`. The lockfile resolves patched versions of all five affected npm entries. Both full and production npm audits now report zero affected packages. The two PDF renderers and logo checks passed, all six declared Neon functions produced bundles, and the built extension ZIP contains the inventoried jsPDF asset without the Neon tooling chain. This verifies the local release inputs; the hosted Neon functions were not redeployed as part of this remediation.

## Remaining release gates and carried findings

| Priority | Gate | Evidence and acceptance required |
| --- | --- | --- |
| P1 | Actual packaged extension with authenticated hosted services | The Chromium check loads a small helper extension, not the full release. Installed settings, Team & Access, editors, community, statistics, approved/denied users, two customers, account switching and worker/evidence recovery remain unverified end to end. The previously recorded browser-policy denial of the installed extension UI was respected; no alternate route was used. Complete an authorized release run with the built package. |
| P1 | Live provider and operational recovery | Existing records demonstrate useful SQL and mocked-provider recovery, restricted-runtime preflight and a readable isolated snapshot-restore preview. They do not demonstrate live Google timeout-after-commit reconciliation, ACL/ancestry drift, authenticated two-customer provider separation, installed-worker termination, alert delivery, billing scheduling or deployed-function rollback. Complete staging drills with isolated provider resources and record exact build/deployment identifiers. |
| P2 | Non-YouTube target authority | YouTube resolves stable owner IDs. Other providers rely on claimed/URL handles to varying degrees; TikTok stable target deduplication does not prove ownership. Verify owners where supported and clearly identify operator-reviewed checks elsewhere. Do not market these checks as equivalent owner verification. |
| P2 | Least privilege and distribution | `<all_urls>`, broad Drive/Sheets OAuth scopes and remaining extension API grants need a recorded justification/narrowing review, plus OAuth and store/distribution approval evidence. This is a release-control gap, not proof that any particular permission is unused. |

The recovery evidence above comes from `docs/architecture/OPERATIONAL_RECOVERY_DRILL_2026-09-30.md` and the rollout record; this audit did not independently repeat production grants, backup restoration, billing delivery or rollback. No absence-of-vulnerabilities certification is implied by the passing tests.

## Recheck of previous findings and screenshot errors

| Previous issue | Current assessment |
| --- | --- |
| Missing Team & Access capability marker | **Closed for protocol advertisement.** Today's live verifier passed bootstrap, data and membership, including a valid credential-free Team POST receiving 401 with the exposed `team-access-v1` marker. This does not prove authenticated team operations succeed. |
| Playable TikTok content marked removed from ordinary text | **Prior reproduction addressed.** Scanner now uses platform error components/exact states and live-content checks; regression suite passes. Real-provider selector drift still needs staging coverage. |
| Reachable jsPDF GIF dimension denial of service | **Prior issue addressed.** Library upgraded and both PDF paths use bounded logo validation. New, currently unestablished-call-path advisories are tracked separately in F4. |
| No full passing isolated-database run for the revised tree | **Closed for this audited tree:** 461/461 pass, zero skips. The October 1 record already showed an earlier full 453-test pass; it is not being treated as absent. |
| Documentation says API is undeployed | **Closed.** Current implementation status distinguishes deployed services from the unreleased extension. |

The screenshot's repeated **`request.command is not supported`** means an API validator rejected the request shape; it is not a Chrome permission error. Current source accepts `command` for the Google operation protocol, and today's markers match, but authenticated editor/configuration/community calls were not exercised. Verify those exact actions against the selected deployment and capture safe response codes before declaring the screenshot resolved.

**“Membership request rejected as invalid”** is a membership request-contract failure, not enough information to conclude that a user's subscription is invalid. The capability mismatch is repaired; authenticated payload compatibility still needs a run. **`Auth Error: [object Object]`** hid Chrome's useful diagnostic; current `utils/auth.js` logs `runtime.lastError.message`, with a passing regression test. The original OAuth cause cannot be recovered from that screenshot. **Cached customer access could not be verified** is a deliberate fail-closed decision: repair sign-in/bootstrap/access verification, not the cache authorization rule. The **`allow`/`allowfullscreen`** message is an iframe permissions warning; it does not explain the failed API/authentication actions.

## Verification performed today

| Check | Result | Limit |
| --- | --- | --- |
| `npm test` | 405 passed, 0 failed, 8 database suites skipped; 413 reported | Superseded for database coverage by the full run below. |
| Full `scripts/test_ci.mjs` / `npm run test:ci` runner with isolated database | **461 passed, 0 failed, 0 skipped**, exit 0; 357,469 ms | Direct isolated DB tests with provider doubles; not a hosted production transaction test. |
| `npm run test:chrome` | **1/1 passed** | Real Chromium, helper extension only. |
| `verify:api` with origin `chrome-extension://akgajganockbkkegachkcamnfnbpccnh` | **Passed** all three routes and credential-free membership POST denial | Protocol and unauthenticated behavior only. |
| Release build | **Passed**, version 3.4.0, 108 archive entries / 96 files | Does not imply full UI behavior works. |
| Independent package checks | **76 JavaScript syntax checks**, 92 relative imports, manifest resource references; no missing checked references or forbidden server/env/dependency paths | Pattern/reference checks, not exhaustive dynamic module execution. |
| `git diff --check` | **Passed** | Existing working changes preserved. |
| Account-switch / stale-autofill probes | **Both reproduced** | Synthetic OAuth/DOM/provider boundaries; no live forms or provider writes. |
| Config-name probe | **Markup accepted and preserved** | Source-traced HTML sink; no script execution claim. |
| npm dependency audit | **Not clean:** production 1 moderate; full graph 5 affected entries | Vendored jsPDF assessed separately. |

SQL coverage includes forced RLS, unscoped tenant reads/writes, pool scope reset, restricted login, identity-derived HTTP scope, resource ownership, membership capacity/concurrency, subscriptions, operation idempotency and persisted TikTok duplicate protection. Passing authorization tests do not cover the newly reproduced browser account-generation races.

## Reproducibility

- Code/config snapshot fingerprint: `ae42fd33ce53a2cba270129422f6b1118d80a5b495344bc2b417fcabdeafc063` across 231 files. Method: `git ls-files --cached --others --exclude-standard`, extensions js/mjs/ts/json/sql/html/css/yml/yaml, excluding stabilization/.agents/.codex; sorted relative path + NUL + file bytes + NUL, SHA-256. This differs from the October 1 fingerprint method and is not directly comparable.
- ZIP: `/tmp/rights-reporter-audit-2026-10-02/rights-reporter-3.4.0.zip`; SHA-256 `0568fcbc9dedde0172bf11523c518bfe1c0d343444f31892dc24385f509ca563`.
- Full CI log: `/tmp/rights-reporter-2026-10-02-ci.log`; SHA-256 `49737f038eb201bbd7439fa18ce2bcf272423f5ca068c645611ba648b6d7b690`.
- Local test log: `/tmp/rights-reporter-2026-10-02-tests.log`; SHA-256 `3053cd5502d790564a056b18be885f13400815e092e0bbfd513f94b9dd905b01`.
- Chromium log: `/tmp/rights-reporter-2026-10-02-chrome.log`; SHA-256 `74cb927ff4835ff20fd950ec72044abd3bd8cd2adcb5271f1d67a0c8e04c7ff5`.
- Dependency evidence: `/tmp/rights-reporter-2026-10-02-npm-audit.json` and `/tmp/rights-reporter-2026-10-02-npm-production-audit.json`. Temporary artifacts should be retained with the eventual release record.

## Required next work

Fix F1 and F2 first, including negative side-effect tests. Fix configuration text rendering, update dependencies and their inventories, then rerun affected tests and the full isolated release suite. Complete the authenticated packaged-extension and staging-provider/recovery gates against the resulting exact artifact. Only then reassess general production approval. This audit created this report; it did not apply those fixes.
