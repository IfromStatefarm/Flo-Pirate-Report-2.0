# Customer API deployment and extension activation

The extension is intentionally fail-closed until `config/customer_bootstrap.json` points to a deployed API. The server implementation in this repository provides Google-token verification, one-customer membership resolution, role and total-seat enforcement, audit records, customer-scoped event storage, and customer-scoped statistics queries.

## Values already fixed in the repository

- Extension ID: `akgajganockbkkegachkcamnfnbpccnh`
- Google OAuth client ID: `1077684119158-g9a5ov4qpb40nbnc5rec0i9l8dp2i9us.apps.googleusercontent.com`
- Initial FloSports administrator: `ivan.mcclay@flosports.tv`
- FloSports customer and member seed files: `migrations/flosports/customer.json` and `migrations/flosports/memberships.json`

The initial administrator choice is required because the imported workbook did not contain an active administrator. Do not seed `ivan.mcclay@flosports.com`: that address is outside the approved `flosports.tv` domain and remains pending for migration fidelity.

## Account-owner steps

### 1. Create a PostgreSQL database

Create a managed PostgreSQL 15-or-newer database with TLS enabled. Copy its private connection string. It normally begins with `postgresql://` and ends with `sslmode=require`.

Never put this value in the extension, a spreadsheet, source control, or a screenshot.

### 2. Create a private local environment file

From the repository folder:

```sh
cp .env.example .env.local
```

For a new installation, populate the database and runtime settings described below. Do not overwrite an existing `.env.local`. The file is ignored by Git. Keep the supplied OAuth client ID, extension ID, extension origin, and initial administrator unless the packaged extension identity changes.

### 3. Create the schema and seed FloSports

```sh
npm install
node --env-file=.env.local server/scripts/migrate.mjs
node --env-file=.env.local server/scripts/seed_flosports.mjs
```

Seed only a new installation. An existing deployment should retain its customer configuration and membership records. Test migrations against an isolated copy of the intended database first. Migration 007 rejects Google destinations shared by different customers; resolve those collisions instead of bypassing the constraint. Migration 014 requires report writes paused and historical TikTok identities reconciled. The runner records checksums in `schema_migrations`; a missing ledger alone does not establish which older tables already exist.

Assign explicit subscription dates before activation. Run `npm run licensing:preflight`; an expired or missing subscription prevents access with the current API. After migration 012, provision a separate unprivileged login granted `rr_customer_runtime` and configure its connection as `CUSTOMER_DATABASE_URL`. Run `npm run security:tenant:preflight` with that credential. Do not reuse the schema-owner connection.

### 4. Deploy the API with Neon Functions

The project is linked to Neon project `dark-dawn-63359775`, branch `production`. The customer functions (`bootstrap`, `memberships`, `data`, `health`) and separate billing functions (`billing`, `billingprocess`) are declared in `neon.ts`. Complete the migration, subscription, database-login and Google connector checks before deploying:

```sh
npx neon config plan --env .env.local
npx neon deploy --env .env.local
```

Neon injects `DATABASE_URL` from the linked branch for control-plane use. Customer routes require these additional runtime values from `.env.local`:

- `CUSTOMER_DATABASE_URL` (restricted customer login)
- `GOOGLE_OAUTH_CLIENT_ID`
- `ALLOWED_EXTENSION_IDS`
- `ALLOWED_EXTENSION_ORIGINS`
- `GOOGLE_CONNECTORS_JSON` (server-only OAuth credentials keyed by customer ID, with `clientId`, `clientSecret`, and `refreshToken`)

`YOUTUBE_DATA_API_KEY`, when configured, is forwarded only to `data`; otherwise the connector must have YouTube read access. `LEGACY_GOOGLE_USER_TOKEN_CUSTOMERS` is an explicit transitional setting, not a fallback for missing managed connectors. The selected managed-connector rollout leaves it unset. Billing variables are separate; see [commercial setup](COMMERCIAL_LICENSING_SETUP.md).

`INITIAL_ADMIN_EMAIL` is needed by the seed command, not by requests at runtime. After deployment, wait for every function to show a `completed` current and active deployment in `npx neon functions list --output json`, then visit the `health` URL printed by the CLI. The response must contain `"ok":true`. Do not proceed if a build is pending or failed, or if the health URL is not HTTPS or returns an error.

Current production health endpoint:

```text
https://br-cool-poetry-ael4nf8v-health.compute.c-2.us-east-2.aws.neon.tech/
```

If a deployment reports `retryable build error: mksquashfs build failed (HTTP 503)`, leave the extension endpoints blank and retry `npx neon deploy --env .env.local` later. This error occurs in Neon's remote image builder before the function starts; application logs will therefore be empty. Escalate to Neon support with the project ID, branch ID, function deployment ID, timestamp, and exact error if repeated retries fail.

### 5. Point the extension at the deployment

Copy the `bootstrap`, `memberships`, and `data` function URLs printed by the CLI into their matching fields in `config/customer_bootstrap.json`. Neon Functions have separate origins, so each endpoint uses its own URL. The current production URLs are already configured in this repository. No secret is written into the extension.

### Current production release checklist

As of October 2, 2026, the customer API is active, but extension distribution and new-customer onboarding remain on hold. See the [rollout record](../architecture/CUSTOMER_API_ROLLOUT_2026-09-29.md) and [release review](../architecture/PRODUCTION_READINESS_REVIEW_2026-09-30.md) for evidence and limits.

- [x] September 30: apply 14 production migrations; provision the restricted customer runtime login and managed Google connectors; deploy the four customer functions.
- [x] September 30: repair the membership route's missing Team & Access marker with active deployment 8.
- [x] October 1: complete the isolated-database `test:ci` run (453 passed, 0 failed, 0 skipped) and build the 3.4.0 release ZIP; see the rollout record for the tested working-tree fingerprint and archive digest.
- [x] October 2: rerun `verify:api` against all three configured production routes with the installed extension origin. OPTIONS markers, browser-readable membership headers, and credential-free `team_list` POST denial passed.
- [ ] Diagnose the earlier installed-extension `teamAccess` / `invalid_request` response with sanitized request and response details. Run authenticated Team & Access list, preview, controlled commit, and role-denial checks through the installed extension.
- [ ] Complete the packaged-extension checks for approved and denied users across FloSports and `test-1`, including account switching, queue recovery, and safe reporting previews.
- [ ] Close the other release-review gates for scanner false resolutions, PDF dependency hardening, provider/operational recovery, and permissions before distribution or new-customer onboarding.

The completed marker checks show route compatibility and unauthenticated denial only. They do not establish authorization, tenant isolation, or Google access for signed-in users.

Run `node --env-file=.env.local server/scripts/verify_customer_api.mjs` (or `npm run verify:api` without the optional origin check). It makes unauthenticated OPTIONS requests to all three configured routes and checks `X-Rights-Reporter-API: google-operations-v1`. It also sends a credential-free `team_list` POST to memberships, requiring HTTP 401 and browser-readable Team & Access headers. A separately updated health function cannot satisfy this check for stale customer routes. These probes establish response-contract compatibility and unauthenticated denial only; complete authenticated feature checks for role permissions, database access, and Google access.

The membership route must also advertise `X-Rights-Reporter-Team: team-access-v1`.
An absent marker means Team & Access compatibility is **unverified**, not that
administrator permission was lost or that the handler definitely lacks support.
Deploy the matching membership handler to publish this marker; the client still
accepts successful responses from older deployments without it.

For `teamAccess` / `invalid_request`, expand the `MembershipApiError` in the
extension service worker console. Its `diagnostics` preserves HTTP status,
operation, protocol version, a recognized validation detail, and whether the
team marker was supported, mismatched, or unadvertised. It excludes tokens,
identities, URLs, payloads, raw bodies, and unrecognized server text. The UI keeps
the verified profile on a validation failure; explicit identity/authorization
failures still lock the page.

Inspect the failed POST response and compare the payload with
`validateTeamRequest` in `utils/team_access.js` and the **active** membership
deployment before changing fields. Directory requests require `protocolVersion`,
`operation: team_list`, `query`, `role`, `status`, and `cursor` (empty strings are
valid filters). History requires `operation: team_history` and `cursor`; preview
requires `operation: team_preview`, `requestId`, and `changes`; commit requires
`operation: team_commit` and `requestId`. All include `protocolVersion: 1`.
Do not drop filters, send customer/actor authority, retry mutations automatically,
or weaken exact-field validation to accommodate a stale deployment.

`request.command is not supported` on a `google_operation` means the responding API does not accept the extension's command envelope. Compare the configured URLs with `neon functions list --output json` and inspect each active deployment. Do not remove `command` or relax field validation; deploy the matching API after its prerequisites pass.

### 6. Reload and verify the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Confirm the Rights Reporter ID is `akgajganockbkkegachkcamnfnbpccnh`.
4. Click **Reload** on Rights Reporter.
5. Open its service worker inspector and confirm there is no registration or syntax error.
6. Reopen the side panel and click **Retry access check** if shown.
7. Sign in as `ivan.mcclay@flosports.tv` when Google prompts.

The panel should change from **Verifying access** to manager/admin-capable application tabs. In Settings, the Access section should show `1 / 50` active users and `1 / 2` administrators immediately after the seed.

## If verification still fails

- **configuration_error**: `config/customer_bootstrap.json` is blank, malformed, non-HTTPS, or the deployment is missing an environment variable.
- **extension_not_allowed**: the Chrome extension ID differs from `ALLOWED_EXTENSION_IDS`; update both extension environment variables to the ID shown by `chrome://extensions`, redeploy, and retry.
- **identity_error**: the Google OAuth client is not registered for this exact extension ID, or the token audience/scopes do not match `manifest.json`.
- **not_a_member/domain_not_allowed**: sign in with `ivan.mcclay@flosports.tv`; the imported `.com` account is intentionally not active.
- **CORS error**: `ALLOWED_EXTENSION_ORIGINS` must be exactly `chrome-extension://` followed by the installed extension ID, with no trailing slash.

Do not weaken these checks to get past the screen. They are what prevent one customer or an unapproved extension build from receiving another customer's profile or data.
