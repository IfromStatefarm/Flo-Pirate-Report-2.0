# Second production-readiness audit — September 27, 2026

**Verdict: not ready for production distribution.** The earlier fixes address several reproduced failures, and the expanded regression suite passes. This broader review found additional privacy, tenant-session, evidence-loss, scanner, deployment and reporting defects.

Scope: current working tree at HEAD `5af76533e46196b0360c58baa8bdcce78c5b95cb`, including all existing uncommitted fixes and new tests. Reviewed the manifest and release package; background/reporting/capture/scanner workflows; content scripts, side panel and settings; API identity, authorization and tenant boundaries; Google integration, billing/deployment configuration; and PDF generation. Findings below distinguish local reproductions from source-traced risks. This audit does not certify deployed infrastructure or third-party behavior.

No application code, credentials, production data, provider resources or deployment was changed. The only repository addition from this audit is this report. Synthetic probes and build/PDF artifacts are under `/tmp`.

## Status of the previous six findings

| September 25 finding | Current assessment |
| --- | --- |
| Failed batch drops the queue remainder | **Original reproduction fixed.** New regression tests cover failure after batch slicing. Concurrent captures can still be deleted on success; see finding 3. |
| Screenshot upload failure silently drops evidence | **Original reproduction fixed.** The workflow now stops, preserves failed evidence and tracks successful uploads. Real server upload retries can still become permanently uncertain; see finding 7. |
| Reporting permission bypasses enforcer account checks | **Partially fixed.** The UI shortcut and URL-only approval are removed. The real Chrome execution context breaks YouTube checks; substring approval and the missing server enforcement capability remain; see finding 5. |
| Opaque YouTube URL trusts caller-supplied owner | **Policy implementation fixed for supported YouTube routes.** Provider owner IDs and protected channel IDs are checked, with fail-closed tests. Deployment omits the new API key; see finding 6. Other providers remain handle-based. |
| Pre-append failure strands projection | **Original failure path fixed in source and local adapter tests.** A durable claim is now made at the append boundary. New database concurrency coverage exists but was skipped here. Truly uncertain provider outcomes still require reconciliation. |
| TikTok tracking query bypasses duplicate checks | **Exact reproduction fixed.** Tracking queries are removed for canonical video paths and intra-report duplicate checks use target keys. Stable video-ID normalization across handles/hosts remains incomplete; see finding 12. |

## Priority-one findings

### 1. Reporter contact details are written into untrusted page DOM

Source: `utils/theme_loader.js:84–116,133`; manifest content-script registrations.

The theme loader runs automatically on supported target sites and scans the entire page for `[data-theme-text]`. A page can supply elements requesting `reportingEmail`, `secondaryEmail` or `reportingPhone`, and the extension writes the verified customer values into those page-owned nodes. It also writes `customerId` onto the document element and dispatches the full theme, including legal fields, through a global DOM event.

**Locally reproduced with the actual loader in a synthetic page:** page-owned nodes received `private-reporter@example.invalid` and `+1-555-1234`, without the user beginning a report. The DOM-write finding does not depend on cross-world CustomEvent behavior. This exposes customer/reporting identity to the very sites being investigated; it is distinct from intentionally filling a selected reporting form.

Fix: send content surfaces only the minimum branding data, scope rendering to extension-created elements, and keep legal/contact fields and tenant identifiers out of host-page theme events and attributes. Add a hostile-page DOM fixture to the browser suite.

### 2. Rumble reporting sessions survive logout and cross account boundaries

Source: `background/services/rumble_workflow.js:30–38,82–83`; `services/customer_bootstrap_service.js:17–23,388–403`; `background/main.js:71–76`; `content_autofill.js:118–151,223–226,1507–1511`.

`rumble_report_session` has no customer/user scope, is absent from the logout-cleared keys, and is not cancelled by `onScopeChange`. The content script recognizes a session using only its active flag and target URL. The final advance calls the reporting workflow with the old session's `formData`, while that workflow reads the current account's queue.

**Locally reproduced with the real bootstrap and Rumble workflow:** start a session for customer A, call logout, populate customer B's queue, then advance the old URL. The stored session survives and passes A's event/vertical together with B's queue to the reporting callback. The actual platform automation was not submitted, but its automatic restart path is present in the content script.

Fix: persist customer/user/session-generation identifiers; validate them on every resume/advance; cancel and remove the session on logout/scope change; prevent already-loaded content automation from continuing after revocation.

### 3. Successful reporting deletes captures added while the batch is running

Source: `background/services/reporting_workflow.js:637–650`; `utils/idb_storage.js:69–80`.

Completion still replaces the whole queue with the original `remainingCart` snapshot, or removes it completely. It does not merge with captures added during uploads/finalization. For the final batch it also deletes every screenshot belonging to that customer/user.

**Locally reproduced with the real reporting workflow and mocked providers:** begin with one item; append a second capture during finalization; return successful acceptance of only the first item. The workflow returns success, removes the queue, and calls scope-wide `clearImages`. The unsubmitted second capture is lost. This is separate from the now-fixed failure/remainder bug.

Fix: atomically remove only accepted queue item IDs and their screenshot IDs from the latest queue. Serialize queue writes or use an IndexedDB transaction/versioned queue so capture and completion cannot overwrite each other.

### 4. Scanner marks playable videos resolved from description/comment text

Source: `services/sheet_scanner.js:114,133–164`.

The YouTube scanner treats `copyright claim` anywhere in `document.body.innerText` as proof the video is down. It does this before checking playable-video metadata. Other broad phrases have the same ambiguity. A description or comment can therefore produce a false removal outcome, strikethrough and resolution/reward writes.

**Locally reproduced with the actual injected scanner function:** a page with video metadata and a description mentioning a copyright claim produces `resolvedCount: 1`, `activeCount: 0`, and an `updateRowStatus(0, 'Resolved')` call.

Fix: inspect a narrowly identified player error state/provider result, distinguish private/blocked/unavailable from confirmed removal as appropriate, and require evidence before mutating resolution/reward state. Test ordinary descriptions/comments containing every error phrase.

### 5. Enforcer checks fail in Chrome and still do not establish account authority

Source: `sidepanel/main.js:220–224,287–290,322–330,343–363`; `server/customer_api_service.js:259–280`; `utils/permission_policy.js:41–45`.

The injected YouTube check reads `window.ytcfg` but omits an execution world. Chrome defaults injected code to the isolated world, where page JavaScript globals are unavailable. The new check therefore denies a normal approved YouTube session before it reads account details. The VM tests provide `ytcfg` directly, masking that integration problem. Chrome's [scripting reference](https://developer.chrome.com/docs/extensions/reference/api/scripting) documents the execution-world distinction.

There is also an independent matching defect: `candidate.includes(handle)` approves an account whose name merely contains an allowed handle. **Local probes:** an isolated-window fixture denies access; a fixture exposing `ytcfg` with `@approved-impostor` is accepted for the allowlist entry `@approved`. TikTok also uses the substring test.

Finally, the server still accepts `mode: 'enforcer'` under ordinary `sidepanel.report`; the UI check is not an authoritative separate enforcement capability. Fix the execution-context issue without trusting arbitrary page strings as account authority, normalize and compare exact account IDs, and enforce the product's intended capability server-side. Add a real Chrome test for an approved session and a direct API denial test for report-only users.

### 6. Standard deployment omits the new YouTube API credential

Source: `neon.ts:3–10`; `.env.example:22–26`; `server/integrations/youtube_accounts.js:29–40`; `docs/architecture/YOUTUBE_TARGET_PROTECTION.md`.

The new resolver expects `YOUTUBE_DATA_API_KEY`, but the customer-function environment allowlist forwards only the existing Google connector variables. Setting the new key in the deployment env file does not include it in the declared function environment. The resolver falls back to the connector token, which can have only the existing Drive/Sheets permissions. In that deployment, YouTube ownership lookup fails closed and reports stop working despite following the new API-key setup instructions.

This is a source/configuration finding; deployed secret values and live OAuth permissions were not inspected. Fix: forward the server-only key to the relevant function and add a deployment configuration check plus a staging owner-lookup smoke test. Verify stable channel-ID whitelist conversion before rollout.

### 7. A failed upload can become permanently unretryable before any write

Source: `server/postgres_repository.js:222–250`; `server/integrations/google_operations.js:51–73,111`; `utils/google_api.js:21–27`.

The general integration journal records `started` before the callback and converts every callback failure to `uncertain`. The next attempt with the same ID is rejected unless the prior operation is completed. Upload IDs are intentionally deterministic. A callback-side guard/read failure before the provider write, or a definitive provider rejection, can therefore lock that evidence upload instead of allowing a safe retry. The new screenshot workflow correctly stops, but cannot itself recover this journal state.

The repository logic was exercised with mocked SQL persistence during the review; no live provider upload or database was used. Fix: model pre-write/definitively rejected failures separately from unknown write outcomes, mark uncertainty at the external-write boundary, and expose a tenant-scoped reconciliation path for genuinely uncertain receipts. Preserve idempotency; do not fix this by blindly choosing a fresh upload ID.

## Priority-two findings

### 8. Report PDFs omit the full target URL

Source: `server/report_pdf.js:116–125`.

URLs longer than 55 characters are shortened to 52 characters plus an ellipsis and drawn as plain text. Only the screenshot receives a link annotation. The full target is not available elsewhere in the generated PDF.

**Generated, extracted and visually inspected a real sample PDF:** the 74-character TikTok target printed as `https://www.tiktok.com/@fixture_reported_channel/vid...`; its video ID was absent. PDF text and link annotations contained no complete target URL. A recipient cannot identify the exact target from that report alone.

Fix: embed a link with the full target and preserve complete URLs in a wrapped table or appendix. Test long handles, URL lengths, large batches and page breaks. The sample was a QA fixture, not a submitted report.

### 9. Side-panel rogue capture reports success when capture fails

Source: `sidepanel/main.js:1498–1503`; `background/main.js:943–944`; `background/services/rogue_workflow.js:39–41`.

The side panel sends `initRogueTakedown` without a selected tab reference. Background passes `sender.tab`, which is not the inspected web tab for an extension side-panel sender. Capture rejects the absent tab ID. The UI callback ignores the response and displays “Data captured!” regardless.

Fix: use a dedicated trusted extension-page capture action that resolves/validates the selected tab in the worker and checks the response before announcing success. Preserve the strict content-script sender checks.

### 10. Scout logging is blocked on platforms without a report-form URL

Source: `sidepanel/main.js:1607–1611,1629–1635`; `utils/platform_catalog.js`.

The Start handler requires a platform report URL before entering the Scout branch, although Scout saves to the log without opening a report form. Discord and other supported catalog platforms with a null report URL cannot use this Scout action. Rumble is specially exempted, leaving other platforms blocked.

Fix: apply the report-form requirement only to enforcement paths that actually need it. Test Scout logging on Discord and an enabled generic platform.

### 11. Concurrent event creation can overwrite another event

Source: `server/integrations/google_adapter.js:397–426`.

`addNewEventToSheet` reads column A, computes the next row, then PUTs to that fixed row. Different request IDs do not serialize this allocation. Two users can read the same last row and both return success after writing the same destination; the later write replaces the first event.

The real adapter was exercised with synthetic responses during review: two concurrent calls selected the same `Sports!A3:I3` range. Fix: serialize customer/workbook allocation through authoritative storage or use an append/reconciliation design that preserves both events under retries and concurrency.

### 12. Duplicate prevention still keys TikTok videos by mutable URL parts

Source: `server/report_policy.js:66–78`.

The tracking-query fix retains the handle and host in the target hash. URLs containing the same numeric video ID with another handle or accepted mobile host can receive different identities. The policy does not verify non-YouTube owners, so a caller can submit those variants and pass the duplicate guard.

The policy/target-key probe admitted three differently written URLs with the same video ID as distinct targets. Fix: key recognized TikTok videos by validated stable video ID; resolve supported share aliases safely; distinguish different IDs in regression tests. Broader provider canonicalization remains a release gate where duplicate/reward integrity is promised.

## Verification results

| Check | Result |
| --- | --- |
| Current `npm test`, with local HTTP binding allowed | **206 reported: 199 passed, 0 failed, 7 skipped** |
| New regression coverage | Reporting failure/evidence handling, enforcer UI logic, projection adapter, target keys and YouTube ownership tests pass |
| Required database tests | Not executed: no explicitly isolated test database was supplied; no local PostgreSQL service was found; production credentials were not used |
| Extension build | Pass; **104 archive entries**; build exclusion checks pass |
| Packaged JavaScript and manifest references | **72 JavaScript files**, syntax and relative imports pass; **19 manifest file references** exist |
| `git diff --check` | Pass |
| npm vulnerability audit | **3 dependency entries: 2 moderate, 1 low; 0 high/critical in npm graph**; findings are in the Neon CLI development chain |
| PDF QA | Real server-generated PDF inspected via text, link annotations and rendered page; incomplete-target finding confirmed |
| Adversarial local checks | Synthetic Chrome/storage/page/provider tests confirmed privacy DOM writes, surviving Rumble session, concurrent capture loss, scanner false positive, and enforcer context/matching defects |

Build SHA-256: `fc124e15b3f48137c4dc8da85551142d0c72acbc82982d947f47862e39692d41`.

The seven skipped suites cover persisted customer authority, Google resource ownership, architecture operations, RBAC/revocation, subscriptions, team administration and tenant isolation. The existing CI runner correctly refuses to run without an explicitly isolated test database. Historical test logs and prior audit claims are not substituted for a current run.

## Remaining production gates

- Run `npm run test:ci` with a disposable, explicitly isolated PostgreSQL database and no skipped suites; test the actual restricted customer login with the tenant-isolation preflight. Forced RLS and fresh authorization are implemented in source; deployment effectiveness was not verified.
- Exercise real Chrome lifecycle, account changes, frames, queues and all advertised platform actions. The new enforcer regression demonstrates why VM/unit tests alone cannot establish browser readiness.
- Validate dedicated customer Google connectors, least-privilege ACLs, YouTube credential forwarding/channel-ID whitelist conversion, and two unrelated customers against isolated staging resources. Rehearse provider timeout-after-commit recovery and give operators a reconciliation path.
- The vendored `lib/jspdf.umd.min.js:4` remains **4.0.0**, outside npm audit coverage. The upstream [GIF decoder advisory](https://github.com/parallax/jsPDF/security/advisories/GHSA-67pg-wm7f-q7fj) includes that version. Theme loading accepts GIF data, and intelligence PDF rendering passes logo data to `addImage`; no decompression/dimension cap is evident. No malicious resource-exhaustion payload was executed. Upgrade/inventory the vendored library and test output; npm's zero high/critical result does not cover it.
- Verify ingress limits/timeouts, rate limits, monitoring/alerts, billing-worker scheduling, backup restoration, deployment rollback and migration compatibility in staging. These controls are not proven by the health endpoint or a successful ZIP build.
- Complete copied-workbook/formula/reward/PDF compatibility checks, evidence retention/deletion verification, permission/OAuth/distribution review, and a full secret-history/license audit. The packaged file checks are useful but do not replace those checks.

Production sign-off requires fixing the priority-one findings, resolving the relevant priority-two behavior for advertised features, and collecting the missing database/browser/provider/operational evidence. The passing suite demonstrates progress; it does not yet establish production readiness.
