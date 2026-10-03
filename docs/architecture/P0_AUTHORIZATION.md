# P0 server authority: incremental implementation

Updated 2026-09-23. This is a source-level security contract and operation inventory, not a certification of a production deployment. Builds on the existing uncommitted report/reward and audit remediation work. No production data, environment files, deployment, or existing migration was changed.

## Authority and admission

`server/customer_authorization.js` is the shared database resolver. Every extension API request first verifies its Google access token server-side through `verifyGoogleIdentity`. Google supplies the subject and verified email; neither a request email nor a cached profile establishes identity. The resolver then:

1. Finds exactly one active membership in an active customer using that verified subject (or the preapproved email on first binding).
2. Requires the verified email to match, binds a previously unbound subject with **both customer and member predicates**, and rejects ambiguous memberships.
3. Loads the customer's subscription, checks service status and time bounds, validates stored configuration and its customer ID/version, checks enabled role and email domain, and calculates actual seat utilization.
4. Derives the application user ID from `member_id`, customer ID from the membership, role from its persisted row, permissions from the server role matrix intersected with purchased configuration features, and platforms from persisted assignment intersected with customer platforms.
5. Checks the operation permission and resource/platform policy before the operation. SQL reads and writes use the resolved customer ID. `reauthorizeActor` repeats resolution at repository admission and rejects a changed customer/member or stale role/config version. Permission checks use the freshly loaded configuration even when a writer failed to increment the configuration version.

`server/access_policy.js` also denies operational permissions to management-only/over-cap snapshots and disabled roles. The permission map for Google commands now lives in `server/integrations/google_command_policy.js`; the operation journal always applies it. A caller can no longer omit an authorization callback to run or replay a provider command.

`customer_id` and `user_id` in the legacy event/statistics protocol remain **required consistency hints** for compatibility. A mismatch returns `scope_mismatch`; they never select a tenant or actor. Accepted event IDs for the customer/user are explicitly replaced with the resolved values. Resource IDs select only within that resolved scope. Unknown fields, including extra authority claims, are rejected by exact request schemas. Role fields in membership mutations are requested changes, evaluated using the caller's actual administrator membership; role/status fields in team searches are filters.

## Changed extension API routes

All are `POST`, retain protocol version 1 and existing response envelopes, and require a verified Google bearer token on **each request**, including retries. `OPTIONS` returns only CORS metadata; health checks return no customer data. CORS, extension ID, profile expiry, local storage, UI visibility and JavaScript flags are not authorization boundaries.

| Route / operation | Permission and additional policy | Data scope / change in this increment |
| --- | --- | --- |
| `/api/v1/extension/bootstrap` | Active eligible membership; enabled role; subscription/seat checks. Configured extension ID is an additional compatibility check. | Derived customer/member profile only. Over-cap admins now receive only `settings.adminAccess`, matching the existing expired/future-subscription recovery profile. No operational connectivity permission is advertised. |
| `/api/v1/extension/memberships`: `list_members` | `settings.adminAccess`; live admin. Over-cap listing allowed. | Customer predicate on directory and utilization; now preserves the original actor's customer/member through refresh and checks permission explicitly. |
| Same: `mutate_membership` | `settings.adminAccess`; active admin; role/domain/capacity/final-admin and expected-version checks. | Target selected within actor customer; update now includes `customer_id` as well as `member_id`; audit actor and tenant are server-derived. Over-cap recovery permits disable. |
| Same: `team_list`, `team_history` | `settings.adminAccess`; live admin, including permitted recovery state. | Customer-scoped roster, counts, audit and pagination. Shared resolver now explicitly requires the permission. |
| Same: `team_preview`, `team_commit` | `settings.adminAccess`; live admin; fresh roster/config/version/capacity checks. | Reviews and results require customer + request ID + original actor. Commits use the stored reviewed changes. Expired/future subscriptions allow deactivation only; over-cap changes must fit or improve overage. |
| `/api/v1/extension/data`: `record_event` | Event-specific permission below; effective platform/URL policy. | Customer/member hints must match; actor IDs are assigned by server. Transaction now rechecks the event permission. Report acceptance still requires this operator's generated report and matching owned uploaded PDF/digest. |
| Same: `query_statistics` | `sidepanel.scoreboard` or `sidepanel.intel`. | Dashboard must match resolved config. SQL requires customer, time range and effective platforms. Transaction now rechecks permission and uses fresh configuration. Empty platform filter means assigned platforms. |
| Same: `query_legacy_statistics` | Same statistics permission; verified configured connector/resources. | Independent Sheets adapter for resolved customer. Refresh now carries forward fresh actor, permission and platform restriction before reading provider data. |
| Same: `generate_report` | `sidepanel.report`; target platforms, catalog/whitelist policy, owned evidence. | Customer + report ID; screenshot manifest requires customer + member + event. Repository now rechecks permission before render/replay. |
| Same: `finalize_report_batch` | `sidepanel.report`, plus `sidepanel.enforce` for Enforcer submissions; owned prepared reports/PDFs and current platforms. | Customer + batch/report/event IDs; replay also requires original member and request hash. Transaction rechecks mode permissions before writes and replay; projection admission checks reporting permission. |
| Same: `google_operation` | Exact named command policy below; no arbitrary provider method/URL. | Customer connector and configured destinations, never client-selected customer credentials. Journal now mandates permission/command validation for execution and replay. Scanner receipts, bonus reservation/completion and uploaded manifests now re-resolve authority and permission. |

The identity verifier now requires a finite positive `expires_in`, string subject/email, and consistent verified-email claims. It continues to support current and legacy Google response field names. Provider network/JSON failures and rate limits fail closed with retryable `identity_unavailable`; invalid/expired/wrong-audience/missing-scope tokens fail with `identity_error`. See [Google access-token introspection](https://cloud.google.com/docs/authentication/token-types) and [Google Tokeninfo fields](https://developers.google.com/resources/api-libraries/documentation/oauth2/v2/java/latest/com/google/api/services/oauth2/model/Tokeninfo.html). No token or connector credential is returned in an API response.

### Event permission inventory

| Events | Permission |
| --- | --- |
| `activity.item_added`, `event.source_url_updated`, `report.whitelist_penalty`, `report.submitted`, `rogue.evidence_logged`, `platform.report_outcome` | `sidepanel.report` |
| `report.intelligence_generated` | `sidepanel.intel` |
| `automation.scan_started`, `automation.platform_outcome`, `automation.row_status_changed`, `automation.scan_completed` | `sidepanel.automate` |

Client point totals never confer authority. Existing server report/reward rules continue to control accepted facts. Aggregate observation events are customer scoped; they do not grant platform access. Observations of external outcomes are not independently verified confirmations.

### Google command inventory

All commands require active operational entitlement and the resolved member's permission. Read results and mutation receipts are bounded by the same customer resource configuration. All writes use a customer-scoped idempotency journal.

| Commands | Permission | Additional resource restriction |
| --- | --- | --- |
| `fetchConfig`, `getEventData` | `sidepanel.report` | Customer configuration/catalog; selector/event URL results filtered to effective platforms; configured vertical for event data. |
| `checkIfAuthorized` | `sidepanel.report` | Effective platform and bounded handle; customer's whitelist. |
| `updateEventUrl`, `addNewEventToSheet` | `sidepanel.report` | Customer event workbook and configured vertical; URL-derived allowed platform. |
| `ensureRogueScreenshotFolder`, `ensureYearlyReportFolder`, `ensureDailyScreenshotFolder` | `sidepanel.report` | Server-configured customer root; bounded date/year/name. |
| `ensureBriefingFolder` | `sidepanel.intel` | Server-configured customer root. |
| `uploadToDrive` | `sidepanel.report` | Folder ancestry must reach customer root; bounded validated file type/content; manifest actor and tenant derived server-side. |
| `patchConfigSelector` | `sidepanel.repair` | Allowed platform and scraper/autofill fields; no arbitrary JSON paths. |
| `updateConfigSections` | `settings.intelligenceTools` | Allowed section schema; `platform_selectors`, `double_xp_settings`, `gamification_levels` additionally require `settings.adminAccess`; selector platforms must be assigned. |
| `getColumnHDataWithFormatting`, `getRecommendedStartRow` | `sidepanel.automate` | Customer report workbook; target row content filtered to assigned platforms. Start-row recommendation is customer-level workflow metadata. |
| `updateRowStatus`, `updateCellWithRichText` | `sidepanel.automate` | Existing row in customer workbook; all target URLs must be authorized; formatting cannot replace row text. |
| `addEnforcerBonusPoints` | `sidepanel.automate` | Resolved customer row, authorized target platforms and server-reserved unrewarded observations. Receipt completion rechecks platforms. |
| `submitSuggestionToSheet` | `settings.feedbackComms` | Customer event workbook; author email is resolved server-side. |

## Other protected surfaces audited

These are distinct control-plane identities, not extension impersonation paths. They are unchanged by this increment and do not accept an extension role/profile as authorization.

| Surface | Identity / scope |
| --- | --- |
| `POST /api/v1/billing/wix` | Trusted bridge HMAC, configured account, freshness/deduplication/sequence validation. Provider order-to-customer mapping is stored server-side. Extension Google tokens cannot authorize it. |
| `POST /api/v1/billing/process` | Separate server worker secret. Processes already verified, mapped billing events. Not a customer endpoint. |
| Loopback seller `GET /customers`, `GET /customers/:id/edit`, `GET /customers/:id/subscription`; `POST /review`, `/provision`, `/customers/:id/review`, `/customers/:id/update`, `/customers/:id/subscription`, `/customers/:id/status`, `/customers/:id/billing-link` | Seller password/session, loopback Host, mutation Origin + CSRF, review/version/idempotency guards. Seller intentionally chooses the target customer as a privileged administrative action. Customer OAuth membership is not sufficient. Keep loopback-only; hosting this requires a separate seller identity design. |
| Seller `/login`, `/password`, `/logout`; static pages/assets; `/api/health` | Session lifecycle or non-customer data; no unguarded customer repository route. |
| Migration/provisioning/billing CLI and database administration | Trusted operator/process credentials, outside extension API. Must not be shipped in the extension or exposed as public arbitrary SQL/configuration endpoints. |
| Provider receipt completion/uncertainty markers | Internal continuation of an admitted operation, with captured customer + operation/report ID. These markers can finish recording an already dispatched external effect after revocation; they do not admit a new customer command. A new attempt/replay must pass current authorization. |

The only intentionally global customer-repository lookups are identity-to-membership discovery, an existence-only email conflict check for preapproval, and Google resource ownership uniqueness. They do not return another customer's roster or resource contents. All business data, audit, review, report, event, reward and journal queries carry customer scope. RLS and least-privilege DB roles remain a separate defense-in-depth gate.

## Security assumptions and remaining gates

- Server code, role matrix, database contents/credentials, connector secrets and seller/billing identities are trusted. Extension code, payloads, storage and profiles are untrusted. The server factory's injected repository/identity verifier/report-policy callbacks are internal test seams, never request fields.
- One Google subject currently maps to one active customer membership; multiple matches deny. First sign-in binds only a seller/admin-preapproved verified email. There is no client-selectable tenant switching. Application user ID is the membership ID, not a claimed Google ID.
- An empty **persisted** member platform assignment retains the existing meaning “all customer-enabled platforms.” A nonempty assignment is intersected with enabled platforms. Missing actor platform context denies. Changing a browser platform list cannot change either value.
- Active customer + active membership + enabled role + eligible subscription + available seats are all necessary for operational admission. Expired/future subscriptions retain the intentional admin-only roster/history/deactivation recovery path. Suspended subscriptions or inactive customers do not. Cancellation-at-period-end preserves paid-through access until the stored end time.
- Revocation prevents subsequent admissions/replays. An external request already dispatched cannot be recalled atomically by a PostgreSQL transaction. Writes with uncertain provider outcomes require reconciliation; receipt markers must never be treated as new authorization.
- Google connector destinations are reserved by customer; arbitrary target folder IDs are checked against the customer root. **Live ancestry checks now reject registered cross-customer overlap; inherited Google ACLs and connector ownership remain deployment/onboarding gates.** See the resource-isolation continuation below.
- Customer-owned Google workbooks/folders must not be broadly writable by extension users if SaaS-revocable access is required. A modified browser with an independently valid Google credential and Google ACL can still access Google directly. No backend refactor can revoke those independent ACLs. `LEGACY_GOOGLE_USER_TOKEN_CUSTOMERS` must remain empty for managed paying-customer access; its explicitly scoped Flo transition is not a revocation guarantee.
- Rights/catalog/selector/reward compatibility data still includes Drive JSON and Sheets. Trusted workbook editors can affect those sources. Versioned normalized server policy, explicit scout/enforce permissions, and verified platform-account assignment remain open P0 work in the original audit.
- This increment does not add RLS, alter deployed grants, migrate production, rotate credentials, publish a release, or claim the remaining capture, reconciliation, onboarding and rollout gates are complete.

## Automated proof

`tests/customer_authority.test.mjs` enumerates all 13 extension operations and verifies that absent/invalid bearer tokens reach no repository method. It rejects forged customer/user/role/permission/capability/subscription/seat fields, foreign scope hints, and operational permissions on recovery snapshots.

`tests/customer_authority_postgres.test.mjs` uses the real service, resolver and SQL against an explicitly isolated database. Only Google's remote identity response is stubbed. Two independently provisioned tenants exercise cross-customer events/statistics/dashboard IDs, directory and audit reads, membership changes, preview/commit replay, identical report and operation IDs, scanner awards, tampered internal snapshots, permission removal without a version bump, and membership/customer/subscription revocation.

Existing `operations_postgres`, `team_postgres`, `subscription_postgres`, Google-operation and architecture-security tests continue to cover foreign evidence/PDF digests, foreign report batches/projections, destination collisions, URL/platform spoofing, assigned-platform revocation, seat races and last-admin protection. Run `npm run test:ci` with `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=true`; CI refuses skipped DB coverage. `npm test` alone allows DB skips and is not sufficient proof.

### Validation result (2026-09-23)

Full required-DB suite: **152 passed, 0 failed, 0 skipped** (`npm run test:ci`). This includes all new tests and existing regression suites. `git diff --check` passed. Execution used schema-only Neon branch `p0-authority-20260923` (`br-dark-frog-aet6elgq`), with no production rows or Google API requests; external provider behavior was stubbed. The branch was scheduled to expire 2026-09-24 23:00 UTC and removed after validation. The saved `.neon` production context and `.env.local` were not modified; temporary connection material was removed. Deployment, Google ACLs and non-owner runtime-role isolation remain unverified.

## Continuation: live Google resource isolation (2026-09-23)

`server/integrations/google_resource_guard.js` now guards every Drive/Sheets request issued by the compatibility adapter. There is no unguarded fallback when a guard or refreshed actor is missing. This increment changes the existing `/api/v1/extension/data` route; protocol version and request/response shapes remain unchanged. Bootstrap, membership and control-plane routes retain the behavior described above. No schema migration is required.

| Affected operation | Additional enforced boundary |
| --- | --- |
| All `google_operation` commands | Before adapter use, verify the configured root and both workbook types/ancestry using the server-selected connector. Every subsequent provider request rechecks its target and current server authorization. |
| Drive file/config reads and config patches | Target must be a direct file, remain beneath the configured root and have no ancestor reserved by another customer. Reads require download capability; patches require edit capability. Recheck before the patch even when the preceding read succeeded. |
| Folder searches and creation | Require one scoped parent, a real folder, appropriate list/add-children capability, and no foreign registered ancestor. Validate discovered/created folders before returning IDs. Broad searches, alternate hosts, unsupported methods, shortcuts, trashed objects, cycles and unverifiable ancestry deny. |
| Evidence uploads | Validate the requested folder before journal admission, then recheck the actual multipart parent before upload. Browser IDs cannot redirect writes outside the tenant root or into a different registered tenant's nested folder. |
| Completed upload/folder replay | A completed journal entry remains an idempotency receipt, not a permanent access grant. Revalidate returned file/folder ownership before returning its ID/link. A moved resource can block replay without rerunning the original mutation. |
| Spreadsheet reads/writes, scanner operations, feedback, report projection | Only the two server-configured workbook IDs are admitted. Validate their actual Google type/ancestry and connector edit capability for writes. A workbook moved beneath another registered tenant's root is denied. |
| `generate_report`, `query_legacy_statistics`, report projection from `record_event` / `finalize_report_batch` | Their internal adapters use the same guard. Legacy statistics pass the actual scoreboard/intelligence permission into resource verification; report preparation/projection requires report permission. |

`verifyGoogleResourceScope` performs an existence-only registry conflict query using the live customer scope, including reservations of inactive customers. It rechecks active membership, subscription, required permission, unchanged destinations and platform narrowing. This also rejects resource/configuration changes made without a version bump. It returns no foreign customer metadata. Existing reservation triggers still enforce exact-ID uniqueness at provisioning/update time; runtime ancestry verification complements them.

The root/workbooks and all ancestors must be readable to the connector. Traversal continues **above** the configured root to a provider-confirmed My Drive root (resolved through the server-only `root` alias) or shared-drive root (`id === driveId`), bounded to 32 resources. An omitted parent on any other object is incomplete ancestry and denies. Shared neutral parents are allowed; a registered foreign customer resource anywhere in the path is not. Separately configured customer workbooks may remain outside the evidence root for Flo compatibility, but must pass their own ancestry check. These checks rely on Google's requested `id`, `driveId`, `mimeType`, `parents`, `trashed` and capability fields; see the [Drive file resource reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) and [shortcut semantics](https://developers.google.com/workspace/drive/api/guides/shortcuts).

Compatibility and failure behavior:

- Missing metadata, missing connector capabilities, inaccessible parents, deleted resources, wrong types and scope conflicts deny before content access. HTTP 429/5xx, network errors and malformed metadata JSON return retryable `503 resource_verification_unavailable`. Scope errors remain `403 scope_mismatch`; insufficient connector access is `403 resource_unavailable`; changed assignment/configuration is `409 access_changed`.
- There is no positive scope cache. This intentionally adds metadata/DB calls and can expose incomplete connector access in staging. Measure latency/quota usage with the copied Flo workbook before rollout. Grant the connector required ancestor visibility; do not work around failures with direct browser access.
- Live metadata is not a complete ACL audit. Google editors may move resources after a check, and Google and Postgres do not share a transaction. Dedicated connector access, restricted human ACLs and verified onboarding remain required. This increment blocks observed registered-tenant overlap and stale receipt reuse; it does not claim to freeze external hierarchy/sharing.
- Journal callback failures before a provider write are retryable under the original ID. Uncertainty is committed immediately before dispatch; explicit rejections can clear only their own write boundary. Unknown outcomes remain blocked and evidence uploads have a tenant/member-scoped, read-only provider [reconciliation path](UPLOAD_RECONCILIATION.md). A replay blocked solely by current ownership does not erase or rerun the completed original operation.

New tests in `google_resource_guard.test.mjs` cover scoped success, multipart receipts, foreign/nested roots, shortcuts, moves between read and patch, missing capabilities, metadata outages, invalid searches/hosts/methods and cached receipt ownership. `google_resource_postgres.test.mjs` runs the real registry/resolver/journal with two provisioned tenants, including inactive-owner reservations, real replay denial, and immediate permission/platform/destination/membership changes. Google responses remain synthetic; no production Google resources are touched.

### Continuation validation result

Final required-database regression run: **169 passed, 0 failed, 0 skipped** on 2026-09-23, including the root-verification and replay checks. JavaScript syntax and `git diff --check` passed. Tested on schema-only Neon branch `p0-google-scope-20260923` (`br-purple-sun-aeutiytu`), with synthetic Google metadata/provider responses and two independent customer fixtures. The temporary branch and connection file were removed after validation; production data, `.neon` context, `.env.local`, migrations and deployments were unchanged. An earlier repeat-run fixture collision was corrected by making its replacement resource ID unique. Overlapping test runs also produced a serialization failure; the final complete run passed, but this does not certify production contention/latency.

Enforcer `report.submitted` events require `sidepanel.enforce` in addition to the table's base reporting permission, including legacy event requests and transaction replay. Page account hints never grant this capability.
