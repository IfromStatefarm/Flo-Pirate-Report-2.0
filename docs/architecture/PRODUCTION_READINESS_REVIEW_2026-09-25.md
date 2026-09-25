# Production readiness review — September 25, 2026

**Verdict: not ready for production distribution.** The current candidate has reproducible queue/evidence loss and incomplete enforcement safeguards. It is suitable for isolated staging validation after the priority-one findings below are fixed.

Reviewed the working tree, including existing modified and untracked security files, against HEAD `14b5830570ee59a64389600146779d1df10d10bc`. This is a source/build/test audit, not a certification of the deployed service. No application code, credentials, database, Google resources, or deployment was changed by this review. Earlier audit documents describe older states; in particular, migration 012 now implements forced RLS and a restricted customer role.

## Findings

### 1. [P1] A failed batch permanently drops the remaining queue

Source: `background/services/reporting_workflow.js:429–435,478,622–625`.

The workflow moves items beyond the platform batch limit into the local variable `remainingCart`, then overwrites persistent `piracy_cart` with only the current batch before authentication or uploads. The remainder is restored only after complete success. Any later failure or service-worker termination loses the queued remainder.

**Reproduced against the actual workflow with mocked browser/storage/provider dependencies:** queue 11 YouTube items; make `getAuthToken` reject. The workflow reports failure, but persisted queue length is now 10 and item 11 is absent. YouTube's batch limit is 10, so this affects normal usage without a large queue.

Fix: retain the entire queue durably until an accepted batch is acknowledged, then remove only the accepted item IDs. Persist batch membership separately and preserve concurrent additions. Add failure/restart tests before authentication, upload, finalization and queue cleanup.

### 2. [P1] Screenshot upload failure silently discards evidence

Source: `background/services/reporting_workflow.js:539–577,621–629`; `server/customer_api_service.js:294–298`.

When screenshot upload fails, the exception is logged and the workflow continues with an empty `screenshotLink`. Those empty links are persisted in `operation.evidenceLinks`, so a retry does not retry the failed image. The server permits empty screenshot links. After successful PDF/finalization, the workflow deletes the queue and clears local images.

**Reproduced against the actual workflow:** with `uploadScreenshots: true`, a stored screenshot, and an image upload rejection, PDF generation receives an empty screenshot link; the workflow returns `success: true`, removes the queue and calls `clearImages`.

Fix: retain failed evidence and stop completion, or present an explicit, reviewable choice to submit without particular screenshots. Track per-image upload state and retry failed images. Never erase the only local evidence while its upload remains incomplete.

### 3. [P1] Reporting permission bypasses the enforcer account check

Source: `sidepanel/main.js:368–387`; `utils/permission_policy.js:40–45`; `server/customer_api_service.js:259–280`.

`canUseEnforcerMode()` immediately returns true for anyone with `sidepanel.report`, before inspecting an approved platform session. Employees receive that permission. The API accepts `mode: 'enforcer'` and checks the same reporting permission; it has no separate enforcement capability or platform-account assignment check. Thus the UI's apparent approved-account restriction does not enforce that restriction for ordinary reporting users.

Fix: define the intended scout/enforcer capability explicitly, enforce it at the server boundary, and bind approved enforcement accounts to trusted customer configuration. Test an employee with report-only permission using both the UI and a direct API request. If all reporting users are intentionally allowed to enforce, remove the misleading restriction and document that product decision before release.

### 4. [P1] Opaque video URLs bypass target-account allowlist protection

Source: `server/report_policy.js:18–24`.

The policy trusts the caller's `report.handle`. It supplements that handle only when a URL path starts with `/@...`; it does not resolve the owner of a YouTube `watch?v=...` target. A wrong or invented non-allowlisted handle therefore passes even if the actual video's owner is protected.

**Reproduced with the actual policy function and a synthetic catalog/allowlist:** an opaque YouTube video URL plus `handle: 'invented-not-whitelisted'` returns an accepted policy. The only account checked is the invented handle. This reproduction proves the missing binding, not ownership of a real video.

Fix: resolve and compare a stable provider account ID for every target before enforcing the authorized-account exclusion. Fail closed or require a separate review path when owner identity cannot be established. Add opaque-ID, renamed-account and conflicting-handle tests.

### 5. [P1] Projection recovery can strand already-accepted reports

Source: `server/customer_api_service.js:275–281`; `server/postgres_repository.js:334–351`; `server/integrations/google_adapter.js:1217–1227`.

Batch acceptance commits before the synchronous Google projection. `projectReport` sets the job to `uncertain` before calling the adapter, including before its first metadata/read request. If that read fails before any append, retrying finds no report ID in column W and refuses the append because the job is uncertain. The API returns an error even though the report/rewards already committed. No automated projection worker or operator reconciliation interface is present in the reviewed paths.

This is a source-traced failure path; it was not exercised against live Sheets. Refusing to blindly repeat an uncertain append is correct, but ordinary pre-write failures should not require database intervention.

Fix: separate failures known to precede a write from uncertain write outcomes, return a durable accepted receipt with projection status, and supply a scoped recovery worker/operator path. Test failure before metadata lookup, before append, after append and after provider success but before database receipt.

### 6. [P2] Tracking parameters defeat duplicate-target protection

Source: `server/report_policy.js:49–56`; `server/postgres_repository.js:166–168`.

Only YouTube URLs are normalized to a provider video ID. Other URLs retain their query strings in the target hash. The same TikTok video with and without `?is_from_webapp=1` receives different target keys, so the database uniqueness guard does not identify it as the same work/target combination. This can inflate report counts and rewards and duplicate operational rows.

**Reproduced:** the actual `reportTargetKeys` function produces unequal hashes for those two TikTok URL forms.

Fix: use stable platform/content IDs, normalize share/mobile/short-link variants through a controlled resolver, and strip only non-identifying query parameters. Add positive alias tests and negative tests for distinct content. Treat this as a release blocker if duplicate prevention and reward integrity are production promises.

## Checks performed

| Check | Result |
| --- | --- |
| `npm test` with local HTTP binding allowed | 152 tests reported: **145 passed, 0 failed, 7 skipped** |
| Initial sandboxed test run | Local HTTP tests hit `listen EPERM`; rerun above resolved those environment failures |
| Database-dependent suites | Not run: no explicitly isolated test database supplied; no production credentials used |
| `node scripts/build_extension.mjs --out-dir /tmp/rights-reporter-audit-build` | Passed; 104 archive entries and build exclusion checks passed |
| Packaged JavaScript syntax and relative import existence | 72 files checked; no failures |
| `git diff --check` | Passed before adding this report |
| Local adversarial probes | Confirmed findings 1, 2, 4 and 6 with synthetic data; no external writes |
| `npm audit --json` with registry access | 3 affected dependency entries: 2 moderate, 1 low; 0 high/critical in npm's dependency graph |

The seven skipped suites cover customer authority, Google resource ownership, architecture operations, persisted RBAC/revocation, licensing, team administration and tenant isolation. These are major production gates. The passing non-database tests do not certify them. CI does correctly require an explicitly isolated PostgreSQL database through `test:ci`.

Build SHA-256: `1f083a45e8afe7ce624e5266c17dcde29ea02de21efed3f78fdab35913b96f15`. This archive is a local audit artifact, not an approved release.

## Additional release risks and unverified gates

- **Vendored dependency coverage:** `lib/jspdf.umd.min.js:4` is jsPDF 4.0.0, imported by `utils/pdf_common.js:1`. It is outside the npm dependency graph. Upstream lists affected releases including this version for [GIF dimension denial of service](https://github.com/parallax/jsPDF/security/advisories/GHSA-67pg-wm7f-q7fj) and [HTML injection in selected output methods](https://github.com/parallax/jsPDF/security/advisories/GHSA-wfv2-pwc8-crg5). Reachability of those exploits in this application was not established. Inventory/update the vendored library and validate PDF output; do not treat npm's zero high/critical count as covering it. npm findings are in the Neon development CLI dependency chain, not the packaged extension; avoid blindly applying its suggested major downgrade.
- **Database deployment:** current source requires `CUSTOMER_DATABASE_URL`, `rr_customer_runtime`, and migration 012. Run the required-DB suites and `security:tenant:preflight` against staging using the actual restricted login. Verify the deployment uses that login and has applied the expected migration ledger. Their presence in source does not prove deployment.
- **Google authority:** confirm per-customer connectors and resource ACLs with two unrelated staging customers. The optional legacy delegated-token path cannot revoke a user's independent Google access. Do not promise SaaS-controlled revocation while employees retain that access.
- **Real-browser behavior:** no real Chrome account switch, two-tab capture, embedded-frame, service-worker restart, or supported-platform form regression was run. The scanner retains execution flags in memory (`services/sheet_scanner.js:18–20`), and startup does not restore report jobs (`background/main.js:339–375`). Chrome documents worker termination and the need for persistent state in its [service-worker guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers).
- **Operational protection:** request parsing has an 8 MB cap but no application-level body-read deadline; it precedes identity verification (`server/http.js:39–57,76–80`). No general edge/per-actor rate limit is demonstrated by the repository. Verify ingress timeouts, rate limits, monitoring, error alerting, billing-worker scheduling, backup restoration and rollback in the deployed environment.
- **Distribution/privacy:** justify broad host access and Drive/Sheets OAuth scopes, verify consent/distribution approval for external customers, and reconcile disclosures with evidence retention. No store approval, legal compliance, full Git-history secret scan, or complete asset-license audit was performed.
- **Compatibility:** verify a sanitized copied workbook, W-column reservation, formulas, reward migration, report PDFs and customer branding. Current report rendering supplies product/colors/legal but no logo data (`server/postgres_repository.js:382`), despite the renderer supporting a logo.

## Release acceptance

Fix findings 1–5 and resolve finding 6 for the promised product behavior. Add regression coverage for the reproduced failures, pass the full required-DB suite with no skips, then exercise Chrome and Google workflows against two isolated staging customers. Require evidence for restricted runtime credentials, connector isolation, recovery, copied-workbook/PDF compatibility, billing processing and restore/rollback before production sign-off.
