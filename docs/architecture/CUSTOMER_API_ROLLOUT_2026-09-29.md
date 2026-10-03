# Customer API command compatibility rollout

## Verified production diagnosis

The URLs in `config/customer_bootstrap.json` match the deployed Neon functions
on project `dark-dawn-63359775`, production branch `br-cool-poetry-ael4nf8v`.
`bootstrap`, `memberships`, and `data` were still serving deployment 6, created
September 16, 2026, when inspected. Their configured environment names were
only `GOOGLE_OAUTH_CLIENT_ID`, `ALLOWED_EXTENSION_IDS`, and
`ALLOWED_EXTENSION_ORIGINS`. The local server accepts the required
`google_operation` envelope with `command`; the hosted deployment predates it.

Before the rollout, the deployed routes also failed the new `npm run verify:api` compatibility check.
This command probes each configured route with OPTIONS; an updated standalone
health function cannot hide an older data function. The marker is not an
authorization or database-readiness check.

## Completed

- Fixed the invalid, not-yet-deployed `billing-process` declaration to
  `billingprocess`. The test now validates the entire Neon declaration.
- Added a compatibility header to all customer HTTP responses and a read-only
  endpoint verification command. Unknown request fields remain rejected.
- Applied the user's approved subscription dates in production through the
  audited subscription service: September 1 through October 31, 2026 in
  America/Chicago (`2026-09-01T05:00:00Z` through exclusive
  `2026-11-01T05:00:00Z`). FloSports keeps its existing package/payment settings;
  `test-1` receives complimentary test access with its existing seats/features.
  Both pass licensing preflight.
- Created expiring test branch `api-command-rollout-20260928`
  (`br-still-resonance-aeyuhoiz`, expires September 30 at 23:00 UTC).
- Tested all 14 migrations on that branch. A synthetic separate root was
  substituted for `test-1` on the test branch only to allow isolation validation.
- Verified a separate restricted test login with the tenant-isolation preflight.
- Corrected obsolete database test fixtures: unique nonzero TikTok video IDs,
  stale-actor rejection followed by fresh-role permission denial, and explicit
  server-derived scope for direct repository event calls.

## Validation

Validation: the initial isolated `test:ci` run executed 411 tests with zero
skips (408 passed; the batch subtest and its parent plus the TikTok fixture
failed). After correcting the fixtures, the complete operations suite passed
11/11 and the TikTok database suite passed 1/1. The focused deployment/protocol
tests passed 7/7. A second full CI run was not performed at that point; see
the subsequent release verification below. `git diff --check`
also passed. These checks use synthetic provider responses and do not certify
live Google consent or resource access.

## Production activation — September 30, 2026

- Google consent completed for the managed web OAuth client in project
  `piracy-report-483620`. Credentials are stored only in private, Git-ignored
  `.env.google-client.json`, `.env.local`, and the deployed function environment.
  The extension's existing OAuth client remains the identity verifier's audience.
- With explicit user approval, created a private `Rights Reporter - test-1`
  Drive folder, copied its existing report workbook, created an empty event
  workbook and neutral configuration, and updated its destinations through the
  audited customer service (config version 4). Its connector uses the approved
  managed account; provider resource reservations enforce customer separation.
- With explicit user approval, copied the FloSports report workbook into its
  managed root and switched the report destination through the audited customer
  service (config version 5). The old workbook's containing folder was inaccessible
  to the connector. Both customers' original files remain unchanged.
- Applied all 14 migrations to production successfully. Provisioned a separate
  unprivileged `rr_customer_api` login with the `rr_customer_runtime` role and
  configured `CUSTOMER_DATABASE_URL`. Tenant-isolation preflight passed: forced
  row-level security, no unscoped data, and no control-plane privileges.
- Licensing preflight passed for both customers with the approved September–October
  terms. No active customers require attention.
- Live local service checks against production using the restricted database
  login and managed Google connector succeeded for FloSports `fetchConfig` and
  `getRecommendedStartRow` (2552). These exercised provider ancestry verification
  and membership authorization, but not hosted Google identity verification.
  Test-1 has no linked Google subject yet, so its authenticated smoke check was
  not performed.
- Deployed the four customer functions to their existing production URLs at
  approximately 20:29 UTC. Bootstrap, memberships, and data have completed active
  deployment **7**; health has completed active deployment **9**. Unrelated billing
  functions were excluded using the private filtered deployment policy.
- All three configured customer endpoints passed `verify:api`, including the
  capability marker and the installed extension's allowed origin.
- Follow-up hosted checks confirmed that all three active deployments include
  `CUSTOMER_DATABASE_URL`, `GOOGLE_CONNECTORS_JSON`, the extension OAuth audience,
  and the extension ID/origin settings. Requests without a bearer token returned
  HTTP 401 with `identity_error` on every route, confirming authentication remains
  enforced. This does not substitute for an authenticated extension check.

## Team & Access marker repair — September 30, 2026

The later release audit found that active membership deployment **7** advertised
`google-operations-v1` but omitted `X-Rights-Reporter-Team` and
`Access-Control-Expose-Headers` on both OPTIONS and POST. The focused membership
and deployment tests passed, and the current local Neon bundle contained both
headers. A targeted deployment of `api/v1/extension/memberships.js` created
membership deployment **8** at 2026-10-01 01:27:18 UTC; it is completed and active
on production branch `br-cool-poetry-ael4nf8v`, with the same five environment
variable names as deployment 7. The first probes immediately after activation
still saw the old headers; a subsequent probe passed after propagation.

The strengthened `verify:api` passes all three configured routes with the installed
extension origin. It now also sends a credential-free `team_list` POST and checks
for HTTP 401 plus the browser-readable Team marker. A separate production probe
observed `team-access-v1` and exposed headers on both a 401 `identity_error`
response and a 400 `invalid_request` response. These checks sent no token or
personal data. Authenticated team listing, preview, controlled commit, and
role-denial checks through the installed extension remain open. Browser automation
policy blocked access to the `chrome-extension://` page; the earlier screenshot's
`teamAccess` invalid-request error still needs a sanitized hosted capture.

## Subsequent release verification — October 1, 2026 UTC

- The complete `npm run test:ci` run passed on expiring isolated Neon branch
  `ci-audit-20261001` (`br-autumn-dream-ae93y1ch`, expires October 3 at
  00:00 UTC): **453 tests, 453 passed, 0 failed, 0 skipped**. The first attempt
  was stopped by the local runner's ten-minute timeout during Team & Access;
  the second attempt completed in 730,073 ms. The full passing log is
  `output/release/test-ci-20261001.log` (SHA-256
  `9854671ebd11e66721e195179f69452f02c6078a53f44c4f6630e4482b1c75a1`).
- Tested source HEAD was `915a0b50cbf456715028f63d30278c1f7bdfa1b4` with
  uncommitted changes. The pre-record source snapshot fingerprint (303 tracked
  and non-ignored untracked files, sorted path plus each file's SHA-256) was
  `6186fc1e40457e629dabeeac511f452c274a9fc26ac1f734671beb91d5e4fd62`.
  This is a working-tree result, not a passing result for HEAD alone. The only
  later source edit was this verification record.
- `npm run build:extension` produced `output/release/rights-reporter-3.4.0.zip`
  with 108 archive entries and SHA-256
  `d1821a52d3d005d16f2276f755b7717524b9b07374f382a64be423ac60c531d6`.
  Its manifest key derives extension ID `akgajganockbkkegachkcamnfnbpccnh`,
  matching the installed Chrome settings tab's extension ID. `git diff --check`
  passed. The credential-free `npm run verify:api` probe passed all three hosted
  routes and the unauthenticated Team & Access denial check.
- Installed extension UI and authenticated hosted actions remain **unverified**.
  Browser automation rejected the `chrome-extension://` settings tab under its
  URL policy and explicitly prohibited alternate browser-control routes. No
  approved or denied user was signed in for this audit, and no takedown was
  submitted. Configuration/editor/community/statistics screens, worker restart,
  queue/evidence recovery, account switching, autofill, and safe simulated
  reporting still require an authorized installed-extension run across both
  customers before this release gate can be closed.

For the remaining installed run, record the extension version/ID and a
sanitized outcome for each of these cases. Use a disposable browser profile and
non-live reporting fixtures. Keep every takedown submit action disabled.

| Customer and identity | Required observations |
| --- | --- |
| FloSports approved member | Settings sign-in; hosted configuration and recommended row; Team & Access list; briefing content, selector editor, community highlight, and statistics screens; safe queue/evidence and autofill preview. |
| FloSports denied identity | Sign-in denial, no cached FloSports content or hosted action, and no report or autofill authorization. |
| `test-1` approved member | Account switch and sign-in; its own configuration, initially empty event content, statistics and editor states; its own hosted Team & Access response and safe queue/evidence preview. |
| `test-1` denied identity | Sign-in denial and no retained `test-1` or FloSports data after switching accounts. |

Restart the extension worker between queue/evidence capture and recovery, then
repeat an authorized read and a denied read. Record sanitized network outcomes
for bootstrap, membership, and data routes without retaining OAuth tokens.

## Remaining user verification

Reopen the installed extension and retry briefing content, selectors, community
highlights, configuration loading, and recommended start row. Browser automation
blocked navigation to `chrome-extension://` pages, so the installed UI and hosted
authenticated requests have not been verified in this rollout. Test-1 will also
need its invited user to sign in and its initially empty event workbook configured
before event reporting is useful.

New managed destinations:

- [FloSports report workbook](https://docs.google.com/spreadsheets/d/1qc9Vaab30CSgOtRzURXaMdntI6oPEPDRW0WYC_bAmrU/edit)
- [Test-1 root folder](https://drive.google.com/drive/folders/1xKU25m8uTHHVAQmjNAnR-fr5Co7Hl7-z)
- [Test-1 report workbook](https://docs.google.com/spreadsheets/d/1shpSZ_JYOqyaIbF0YuekWWLe579Ef0CFYFLwtEuFwBI/edit)
- [Test-1 event workbook](https://docs.google.com/spreadsheets/d/1rvoBfiWtI5taz0hdxWhtGxNAxLwRGRwwcKdZ93hGcO4/edit)

No request field was removed and no validation, membership, subscription, or
tenant-isolation enforcement was weakened.
