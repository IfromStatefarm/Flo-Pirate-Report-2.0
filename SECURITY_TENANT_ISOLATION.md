# Rights Reporter tenant isolation

## Guarantees and trust boundary

Customer API authority comes from a Google bearer token verified on the server (audience, verified email, subject, required email scope, and expiration), followed by a fresh lookup of persisted membership, customer configuration, subscription, role, feature and platform permissions. The client cannot select a tenant using storage, headers, query parameters, URLs, role claims, or payload customer IDs.

The supported threat model is an authenticated customer member, including a customer administrator, making arbitrary HTTP requests and modifying their extension/storage. It does not grant that member seller credentials, database credentials, another user's Google token, or control over the server or Google administration.

* Customer requests use the restricted `rr_customer_runtime` database role. All 19 tables carrying `customer_id` have enabled and forced row-level security (RLS). Ordinary customer queries without a customer predicate still see only the resolved tenant. With no resolved tenant, they return no rows and cannot insert rows.
* Every repository transaction begins with an empty, transaction-local scope. Only server-side identity resolution establishes the scope. Commit, rollback and connection reuse cannot carry scope into the next request. SQL still includes explicit customer predicates and composite join keys for reviewability and defense in depth.
* Reports, observations, batch receipts, operation receipts, reviews, rewards, scanner rows, statistics, and evidence lookups use customer-scoped keys. Reusing another tenant's event/report/request ID never returns or modifies that tenant's record. Reports and evidence additionally require the appropriate member and event relationship.
* Unknown and foreign member/review/report/evidence identifiers have the same public outcome. Errors do not contain SQL, constraint details, foreign configuration or foreign customer IDs. All customer HTTP responses use `Cache-Control: no-store`.
* Customer APIs have no database DELETE, TRUNCATE, DDL, billing-queue or seller-audit privileges. An accidental unscoped UPDATE can affect only rows in the resolved customer. RLS `WITH CHECK` rejects attempts to insert or move rows into another customer.
* Customer IDs in event and statistics payloads are optional legacy consistency hints. If present, they must match the server-derived identity. Event persistence always uses server-derived customer and member IDs. Other payloads reject unsupported authority fields. URL/query/header tenant selectors are never used for authorization.

These are application and database guarantees under the deployment requirements below, not a claim that JavaScript can protect plaintext already downloaded to a machine controlled by an attacker. Responses are not constant-time; infrastructure timing and denial-of-service are outside the confidentiality claim.

## Repository audit inventory

| Surface | Files / entry points | Isolation boundary |
| --- | --- | --- |
| Bootstrap | `api/v1/extension/bootstrap.js`, `server/http.js`, `server/google_identity.js`, `server/customer_authorization.js` | Verify bearer identity; resolve one persisted active membership; no tenant selector. |
| Team / member administration | `api/v1/extension/memberships.js`, `server/team_management.js`, repository `listMembers` / `mutateMembership` | Customer-admin permission, locked customer roster, scoped target, preview, commit, pagination, history and utilization. |
| Observation ingestion | `api/v1/extension/data.js`, repository `recordEvent` | Fresh actor, server-derived IDs, scoped idempotency, event/platform policy and member FK. |
| Analytics | `queryStatistics`, `query_legacy_statistics`, `server/platform_policy.js` | Customer predicate, composite member join, bounded dates and allowed platforms; configured dashboard. Legacy Sheets pass the same connector/resource guard. |
| Report generation and lookup | `generateReport`, `finalizeReportBatch`, `projectReport`, `server/report_policy.js`, `server/report_pdf.js` | Customer/report key, author/event checks, customer rights policy, evidence ownership, PDF digest, scoped projection and completion transactions. |
| Evidence / uploads | `recordUploadedFile`, `requireUploadFolder`, `server/integrations/google_operations.js` | Upload folder must be configured or previously issued in this customer's completed operation journal; image/PDF association includes customer, member and event. |
| Event catalog and customer configuration | Google adapter `getEventData`, `fetchConfig`, `updateEventUrl`, `addNewEventToSheet`, `patchConfigSelector`, `updateConfigSections` | Only server-configured Sheets/Drive roots, command allowlist and fresh permission checks; no arbitrary spreadsheet or provider URL API. |
| Google reads and mutations | `server/integrations/google_adapter.js`, `google_resource_guard.js`, `google_credentials.js` | Customer-keyed server connector; validate resource type, full ancestry and live ownership before provider business requests, including retries and cached receipts. |
| Scanner and rewards | `recordScannerResolutions`, `reserveScannerBonus`, `completeScannerBonus`, `reported_targets`, `customer_reward_state` | Customer-scoped keys, actor/platform checks and authoritative reward facts. |
| Operation journals | `runIntegrationOperation`, `report_batches`, `report_projection_jobs` | Scope on admission, replay, failure and completion; provider results are not permanent authorization. |
| Seller administration | `server/customer_setup_web.js`, `seller_auth.js`, `customer_management.js`, `customer_provisioning.js`, `subscription_service.js` | Separate loopback-only seller login, session and CSRF boundary. Seller directory is intentionally cross-customer; individual mutations use the selected customer key and audit records. Customer admin roles and Google bearer tokens confer no seller access. |
| Billing | `api/v1/billing/*`, `server/billing_http.js`, `billing_service.js`, `integrations/wix/billing_bridge.mjs` | Separate signed webhook / worker secret. Customer derives from seller-created provider/account/order mapping, never customer-supplied tenant IDs. Queue and plan mapping scans are trusted control-plane operations, inaccessible to the customer role. |
| Operator scripts / migrations | `server/scripts/*`, `server/migrations.js`, `server/sql/*` | Separate owner credentials; intentionally trusted provisioning, audit, migration, seed and billing operations. Not extension endpoints. |
| Health | `api/health.js` | No customer data or database lookup. |
| Extension services / evidence | `services/customer_*`, `services/report_service.js`, `services/google_operation_service.js`, `utils/google_api.js`, `utils/idb_storage.js`, `utils/evidence_scope.js`, `background/*` | Scoped response validation and local namespaces. Runtime messages do not confer server authority. Ordinary cart clearing deletes only the current profile's images. Logout/scope changes purge local evidence. |
| Packaged configuration / assets | `events_config.json`, `config/*`, theme services, `scripts/build_extension.mjs` | Packaged files and public branding assets are not secrets. Neutral release strips organization-specific catalogs/allowlists; database and connector credentials are excluded. |

All executable SQL and provider fetch sites were searched, including scripts and legacy adapters. Static libraries, archived stabilization snapshots and generated screenshots are not runtime data-access paths.

## Database design

Migration `012_tenant_isolation.sql` adds the runtime role, policies and narrow private functions. It does not rewrite earlier migrations. It fails rather than repairing inconsistent existing customer IDs or cross-customer audit references silently.

The normal policy requires `customer_id = nullif(current_setting('rr.customer_id', true), '')` for both visibility and writes. The schema owner has an explicit control-plane policy for provisioning, migrations and billing. The customer role must never own tables, have `BYPASSRLS`, be a superuser, or inherit the control-plane role. It cannot create objects in the application schemas.

Two `SECURITY DEFINER` functions have fixed search paths, fully qualified tables and execution revoked from PUBLIC:

1. `rr_private.resolve_identity(subject, email)` is the only pre-tenant membership lookup. It locks matching memberships/customers and sets scope only for a unique active match to the verified identity. It is called only after token verification. A linked Google subject takes precedence over unbound email invitations, including when the original membership is disabled. Never expose this function through a public SQL/Data API or accept its identity arguments directly from a request.
2. `rr_private.google_resources_available(ids)` checks global provider reservations against the current transaction scope and returns only a boolean. It cannot enumerate resource owners. The provider guard calls it only after validating the configured ancestry.

Existing composite primary/foreign keys bind events, reports, uploads, rewards, scanner records, reviews and batches to their customer's members. Migration 012 adds composite actor/target FKs to membership audits, a composite initial-admin FK to provisioning audits, and a constraint matching `customers.config.customerId` to its row key.

Email uniqueness is per customer. The former global email unique index and customer-facing cross-customer email probe are removed. Adding an address to Customer A has the same result whether it is unknown or registered in Customer B. This does not transfer a linked identity. Multiple unbound active invitations for the same identity fail closed at first sign-in; the trusted seller must resolve ambiguous onboarding. The seller provisioning tool may still detect global conflicts because it is an explicitly authorized control-plane operation.

## Google and browser boundaries

Only configured Sheets and resources under the configured Drive root are usable. Roots/resources reserved to another customer remain unavailable even if Google nesting or sharing makes them visible to the connector. Shortcuts, trashed files, incomplete ancestry, unsupported hosts/methods and unscoped searches fail closed. Guessed upload folder IDs are rejected against the customer's server-issued folder journal before Google metadata lookup. Foreign/missing/inaccessible resource errors are normalized. Live metadata is rechecked for provider requests; there is no permanent positive ownership cache.

Google remains an external authorization system. Production connectors must be limited to their customer's resources; employees must not have direct access to other customers' Drive/Sheets, and evidence must not be publicly shared. Do not enable the transitional `LEGACY_GOOGLE_USER_TOKEN_CUSTOMERS` mode for paying-customer production. Provider-side sharing and changes between a metadata check and a provider request cannot be fixed by database RLS.

Browser caches are display hints, not server credentials. A new background-service instance must successfully bootstrap before using a stored profile for protected work. Only its own in-memory server-verified profile may be reused until expiry. Forging storage cannot authorize another tenant's server requests. Local evidence uses customer/member namespaces and expiration; logout clears it. A person with direct control of the browser profile can inspect or erase local plaintext, so shared-device security requires separate OS/browser profiles and logout.

## Deployment requirements

This change requires a database migration and a new server-only credential before deploying the customer API. It intentionally fails closed without `CUSTOMER_DATABASE_URL`; it does not fall back to the owner/billing `DATABASE_URL`.

1. Back up and validate the migration on an isolated branch, then apply `npm run db:migrate` with the schema-owner direct connection (`DATABASE_URL_UNPOOLED`). The migration role needs CREATEROLE and table ownership. Investigate any constraint violation before retrying.
2. Create a dedicated login with a generated secret using trusted database administration, grant it only `rr_customer_runtime`, and store its connection string as `CUSTOMER_DATABASE_URL` in server secrets. For example, create `rr_customer_api` with LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, then `GRANT rr_customer_runtime TO rr_customer_api`. Set the password using your secret-management process; do not commit it or put it in extension settings.
3. Retain separate schema-owner credentials for seller, billing and migrations. Do not grant the runtime login membership in the owner or other privileged roles. Do not expose database functions/credentials to a browser or public Data API. On Neon Functions, `neon.ts` forwards `CUSTOMER_DATABASE_URL`; the platform's automatically injected owner URL is not used for customer requests.
4. Run `npm run security:tenant:preflight` with the deployed customer credential. This checks the login, runtime privileges, forced RLS coverage and empty-scope behavior. Deploy backend and compatible extension together. Existing event/statistics clients with matching legacy scope hints remain supported. Previously cached upload folder IDs without a server journal receipt must be obtained again through the folder operation.
5. Run the full CI suite against an isolated database. Never run these fixture-writing tests on production.

The production branch was not migrated or deployed as part of this repository hardening task.

## Automated test strategy

`npm run test:ci` requires `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=true`, runs tests serially, and fails rather than skipping database coverage. The GitHub workflow provisions an isolated PostgreSQL service. `npm run test:tenant-isolation` is a focused local suite; its database cases skip without `TEST_DATABASE_URL`, so it is not a substitute for the CI gate.

`tests/tenant_isolation_postgres.test.mjs` creates two populated customers and exercises:

* Catalog discovery of every customer-owned table, so a new tenant table without coverage fails the test.
* Unscoped SELECT and UPDATE behavior, foreign-ID predicates, denied inserts/tenant moves, denied DELETE/TRUNCATE/DDL and seller/billing access, and cross-tenant FK rejection.
* Missing context, commits, rollbacks and alternating concurrent requests over the same pooled connection.
* An actual separate login with only runtime membership, including the production preflight command.
* The HTTP handler plus real repository with manipulated URLs, query parameters, headers, payload tenant IDs, member/review/report IDs, batch submissions and evidence URLs. Only the external identity provider is replaced with a deterministic verified identity fixture.
* Identical public outcomes for foreign and nonexistent IDs, positive controls for own data, and no foreign writes.
* Customer-local invitation behavior and protection against redirecting an already-linked identity.

`customer_authority_postgres.test.mjs`, `operations_postgres.test.mjs`, `team_postgres.test.mjs`, `google_resource_postgres.test.mjs` and `subscription_postgres.test.mjs` cover report/operation idempotency, source-of-truth permissions, suspension/revocation, stale actors, concurrency, Google nesting/ownership, subscription and billing behavior. Provider HTTP is stubbed; PostgreSQL, roles, constraints and policies are real.

`customer_bootstrap.test.mjs` covers forged storage, repeated offline bootstrap attempts, display-cache promotion, expiry and account changes. Google guard/operation tests cover guessed folders, changed ancestry, returned receipts and uniform resource errors. Seller tests cover the separate login/session/CSRF boundary. The neutral extension build checks that server code and credentials stay out of the shipped archive.

PostgreSQL references: [row security behavior and privileged bypass rules](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [safe SECURITY DEFINER functions](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Verification for this change

On 2026-09-24, the complete CI suite passed **181 tests, zero failures and zero skips** against an isolated Neon schema-only branch. After the final upload-folder restriction, 31 focused local tests and 5 Google/Postgres tests passed. The neutral extension build and JavaScript syntax/diff checks passed. The temporary test branch was removed; production was not changed.
