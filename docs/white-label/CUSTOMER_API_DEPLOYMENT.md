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

Open `.env.local` and replace only the placeholder `DATABASE_URL`. The file is ignored by Git. Keep the supplied OAuth client ID, extension ID, extension origin, and initial administrator unless the packaged extension identity changes.

### 3. Create the schema and seed FloSports

```sh
npm install
node --env-file=.env.local server/scripts/migrate.mjs
node --env-file=.env.local server/scripts/seed_flosports.mjs
```

The seed is safe to rerun: it refreshes the versioned FloSports configuration and fixture metadata, preserves later role/status changes for non-admin users, and guarantees that the selected initial administrator remains active.

### 4. Deploy the API with Neon Functions

The project is linked to Neon project `dark-dawn-63359775`, branch `production`. The four functions and their allowed environment variables are declared in `neon.ts`. Deploy them with:

```sh
npx neon config plan --env .env.local
npx neon deploy --env .env.local
```

Neon injects `DATABASE_URL` from the linked branch. The deployment uploads only these additional runtime values from `.env.local`:

- `GOOGLE_OAUTH_CLIENT_ID`
- `ALLOWED_EXTENSION_IDS`
- `ALLOWED_EXTENSION_ORIGINS`

`INITIAL_ADMIN_EMAIL` is needed by the seed command, not by requests at runtime. After deployment, wait for every function to show a `completed` current and active deployment in `npx neon functions list --output json`, then visit the `health` URL printed by the CLI. The response must contain `"ok":true`. Do not proceed if a build is pending or failed, or if the health URL is not HTTPS or returns an error.

Current production health endpoint:

```text
https://br-cool-poetry-ael4nf8v-health.compute.c-2.us-east-2.aws.neon.tech/
```

If a deployment reports `retryable build error: mksquashfs build failed (HTTP 503)`, leave the extension endpoints blank and retry `npx neon deploy --env .env.local` later. This error occurs in Neon's remote image builder before the function starts; application logs will therefore be empty. Escalate to Neon support with the project ID, branch ID, function deployment ID, timestamp, and exact error if repeated retries fail.

### 5. Point the extension at the deployment

Copy the `bootstrap`, `memberships`, and `data` function URLs printed by the CLI into their matching fields in `config/customer_bootstrap.json`. Neon Functions have separate origins, so each endpoint uses its own URL. The current production URLs are already configured in this repository. No secret is written into the extension.

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
