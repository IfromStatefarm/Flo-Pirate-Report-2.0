# Commercial licensing: setup and operation

This implementation adds seller authentication, manual subscriptions, server-enforced expiry, purchased user limits, licensed report generation, a signed billing receiver, and a Wix backend bridge. The administration application remains local-only. It is not a hosted admin portal.

The implementation was tested on an isolated Neon branch. The customer API was activated in production on September 30, 2026, but extension 3.4.0 remains on release hold pending the [current production checklist](CUSTOMER_API_DEPLOYMENT.md#current-production-release-checklist). Report PDFs require the licensed server.

On September 18, 2026, the first two additive migrations were applied to production; the readiness check then found missing subscription terms for `flosports` and `test-1`. The [September 30 rollout](../architecture/CUSTOMER_API_ROLLOUT_2026-09-29.md#production-activation--september-30-2026) subsequently applied all 14 migrations, recorded the approved September–October terms for both customers, passed licensing preflight, and deployed the four customer functions. The Wix account, bridge deployment, and external scheduler still need configuration.

## Seller credentials

The local `.env.local` holds a salted scrypt password hash, using N=131072, r=8, p=1. It does not hold the plaintext seller password. The temporary password supplied for this task was configured locally and must be replaced on first login. No default password is built into the application.

To set or recover a password, run `npm run seller:password` in an interactive terminal. The input is hidden. Restart Customer Setup afterward to invalidate existing sessions. Set `CUSTOMER_SETUP_OPERATOR_EMAIL` to the seller identity used in audit records.

The server refuses to start without credentials, binds only to `127.0.0.1`, expires idle sessions after 30 minutes and all sessions after eight hours, throttles failed sign-ins, and binds review tokens and CSRF tokens to the authenticated session. Audit identity comes from the session, regardless of submitted operator fields. Password replacement signs out every session. A loopback HTTP cookie intentionally omits Secure; a future hosted portal must use HTTPS/Secure cookies and managed MFA before removing the loopback restriction.

## Activation order

1. Test migrations `004_customer_subscriptions.sql` and `005_generated_reports.sql` in an isolated database, using the integration test below. They add tables without automatically licensing existing customers.
2. Apply migrations to the intended database with `npm run db:migrate`. Confirm `.env.local` points to that database before running it. The direct `DATABASE_URL_UNPOOLED` is required for this command.
3. Run `npm run customer:setup`, sign in at the printed loopback address, and replace the temporary password.
4. Open **View customers → Subscription** for every existing customer. Enter agreed package, start, paid-through, interval, seats, payment reference or explicit trial/complimentary grant, and reason. Save. Do not infer terms from the old `active` flag.
5. Run `npm run licensing:preflight`. Resolve missing, expired, future, or over-cap subscriptions for customers that should have current access. Inactive customers are reported separately.
6. Deploy the updated bootstrap, membership, and data Functions to the intended environment. Existing endpoint URLs can stay unchanged. The API immediately enforces subscriptions; deploying before step 4 locks customers without terms.
7. Run `npm run build:extension`. Review `output/release/rights-reporter-3.4.0.zip` and its SHA-256 file. Publish through the Chrome Web Store or your managed enterprise installation process after validating the production endpoint. Keep the prior extension/server versions for rollback.

API rollback should restore the previous server build, without dropping the additive tables or deleting subscription history. Never roll back by setting unlimited paid-through dates. Report generation is an intentional server dependency in 3.4.0; coordinate server and extension releases.

## Day-to-day customer management

**New customers:** the create form includes package and date fields alongside the existing branding, destinations, and administrator. Customer, administrator, subscription, configuration limits, and audits commit together. Invalid subscription data rolls back the entire creation.

**Manual renewals:** enter a new payment reference and a reason, choose monthly/yearly, and select **Record payment and renew selected interval**. It grants one calendar interval from the later of the existing paid-through date or now. Month ends clamp to the last valid day; yearly February 29 renewals clamp to February 28 in non-leap years. Repeated submissions with the same request ID do not extend again. No payment is collected by this button.

**Seats:** limits count named active users, including administrators, not computers. Package changes replace totals. They never add the same seats again on renewal. A zero role limit disables that role. Manual reductions require excess members to be disabled first. Scheduled provider plan changes apply when their verified paid cycle begins. A provider reduction can put the organization over its limit; its administrator can still list and disable members, but ordinary work is blocked until utilization fits. The final administrator cannot be disabled.

**Suspension:** use the dedicated seller suspension/restore form, including for provider-managed customers. Renewals never clear an administrative suspension. Cancellation of future renewal preserves the paid-through period. There is no automatic payment grace period. Paused/revoked billing snapshots block server access; a later verified paid snapshot may restore billing access but cannot clear seller suspension.

**Access refresh:** all protected API requests check current membership and subscription. Client profiles last at most ten minutes, capped at paid-through. Offline operation cannot extend this window. Missing subscriptions fail closed. Existing files in the customer's Google Drive are not removed when access expires.

## Wix connection

The implemented endpoint is a **signed backend bridge**, not a native Wix JWT webhook URL. Do not point a public checkout-success redirect or unsigned Wix automation at it.

1. Use **Connect a Wix order** to link a verified Wix order to its customer. Map each Wix plan ID to an internal package name, interval, features, and total/per-role seats. Map future upgrade/downgrade plan IDs before they are sold. Existing plan mappings are immutable; changed commercial terms require a new provider plan ID.
2. Set a random `BILLING_BRIDGE_SECRET` of at least 32 characters, the expected `BILLING_WIX_ACCOUNT_ID`, and a separate random `BILLING_WORKER_SECRET` in the backend deployment's secret store. They must never be extension configuration or browser code. The billing Functions refuse requests while unconfigured.
3. Deploy the `billing` and `billingprocess` Functions from `neon.ts`. Copy their actual returned HTTPS URLs; do not construct a URL by guessing a branch hostname.
4. Place `integrations/wix/billing_bridge.mjs` in a trusted Wix/Node backend and inject an authenticated Wix SDK `getOrder` function, the secret from the site's secret store, expected site ID, and receiver URL into `createWixBillingBridge()`.
5. Call `bridge.syncOrder(orderId)` from Wix order-purchase, cycle, update, pause, and cancellation handlers. It fetches the current order before signing; event arrival time is not the order revision. This bridge accepts online orders with finite payment cycles. Offline orders, unlimited plans, and incomplete future cycles deliberately require manual handling. Wire provider refunds/chargebacks to an explicitly reviewed revocation policy; they are not inferred from arbitrary order events.
6. Schedule an authenticated POST to the `billingprocess` Function about once per minute, using `Authorization: Bearer <BILLING_WORKER_SECRET>`. Alternatively run `npm run billing:process` on trusted infrastructure. The worker does not depend on Ivan keeping Customer Setup open.
7. Schedule `bridge.reconcile(knownOrderIds)` from the trusted Wix backend to recover missing deliveries. Supply mapped order IDs from your server-side order registry. Inspect its failed outcomes and retry. Connect this to monitoring when the site is installed; no Wix account or external scheduler was configured by this code change.

The receiver verifies an HMAC-SHA256 of `timestamp + '.' + rawBody`, using `X-Billing-Timestamp` (Unix milliseconds, within five minutes) and `X-Billing-Signature` (lowercase hex). It validates a fixed schema and expected account, then durably stores the event before returning HTTP 202. It never accepts a customer ID or seat counts from checkout/browser input.

The snapshot fields are `schemaVersion`, `eventId`, `accountId`, `orderId`, `planId`, `sequence`, `state`, `periodStart`, `periodEnd`, `paymentReference`, and `cancelAtPeriodEnd`. `sequence` is a monotonically increasing provider revision; the supplied bridge derives it from the authoritative order update time with microsecond precision when available. `state` is `paid`, `past_due`, `canceled`, `paused`, or `revoked`. Only `paid` grants time or changes purchased seats. Dates are absolute UTC periods, not increments from delivery time. The receiver is designed for trusted settlement snapshots; signing an unverified browser claim would violate its trust boundary.

The worker locks the customer and subscription, ignores older sequences, updates terms/configuration/audit atomically, and retries transient failures with backoff. Events without a known customer/plan mapping grant nothing. After 12 failed attempts an event remains `failed` for operator attention; saving its verified mapping requeues pending/failed events for that order. Duplicates cannot add months or seats. A future paid cycle stays queued until its start so it cannot activate a new package early.

Provider documentation used for the bridge: [Wix order fields and payment status](https://dev.wix.com/docs/rest/business-solutions/pricing-plans/pricing-plans/orders/order-object) and [recurring cycle events](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/order-cycle-started). A live sandbox checkout, renewal, failure, cancellation, and upgrade/downgrade exercise is still required when the Wix site is connected.

## Licensed report processing and release contents

Report PDFs are assembled through the existing customer data API's `generate_report` operation. The server derives the customer, reporter identity, branding text/colors, and legal identity from verified records. It validates bounded evidence inputs, never fetches evidence links, limits each organization to 1,000 newly generated reports per rolling day, and retains the PDF for idempotent retries. Regenerating the same report ID with different content or another user is rejected. Report output is capped at 4 MB.

The extension sends no database secret and has no local report-assembly fallback. It checks the returned customer/user/report IDs and PDF type. Customer logos are not fetched by this new server renderer; configured text, colors, and legal details are preserved. Intelligence PDF export remains client-side, while its normalized statistics source is subscription-protected. Page capture, direct Google access, and already obtained local data remain technically modifiable by someone who controls their computer; the extension is not DRM.

The release builder copies only allowlisted extension files, rejects symlinks and common credential patterns, excludes server/tools/tests/environment files, disables the development migration comparison, and removes customer-specific default event categories. The final ZIP is independently checked for forbidden paths and gets a SHA-256 digest. The manifest's OAuth client ID and public extension key are public identifiers, not secrets.

The manifest's broad browsing and Google scopes have not been removed blindly: reducing them needs a separate Google file-selection/consent workflow and platform compatibility checks. Complete Chrome Web Store/OAuth review for the release. Hosted administration/MFA, device limits, arbitrary billing proration, backup/restore operations, and automated data-retention policies remain deployment/product work; they are not silently enabled by this implementation.

## Verification

`npm test` runs the local suite, including real HTTP login/session tests. It requires loopback networking. The database test is skipped unless explicitly configured:

```sh
TEST_DATABASE_ISOLATED=true node --env-file=/path/to/isolated-test.env --test tests/subscription_postgres.test.mjs
```

The test env file must define `TEST_DATABASE_URL` for an isolated database. Tests run migrations and create synthetic customers. They cover atomic provisioning, missing/future/expired/revoked subscriptions, profile expiry boundaries, PDF generation/idempotency, branding edits, duplicate/concurrent renewals, final-admin protection, simultaneous seat approvals, tenant isolation, signed billing, retries, cancellation, and reductions below utilization. Do not point this test at production.
