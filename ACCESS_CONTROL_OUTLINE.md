# Authentication and customer access control

## Authority and identity

The server is authoritative. Every extension API request verifies its Google bearer token with Google, checks the configured OAuth audience, a verified email and subject, the required email scope, and a finite positive remaining lifetime. Invalid, expired or revoked tokens return `401 identity_error`; verification outages fail closed with `503 identity_unavailable`. There is no positive token-verification cache.

The server resolves the verified subject/email to exactly one active membership in an active customer. No match denies access; multiple matches return `409 ambiguous_customer`. The request email is only a consistency hint. Browser profiles, roles, permissions, tenant IDs and UI visibility never grant server authority. Unsupported authority fields are rejected; supported legacy customer/user hints must match server-derived scope.

`server/customer_authorization.js` resolves current membership, enabled roles, approved email domains, subscription entitlement, seat limits, configuration and platform assignments. Repository admissions re-resolve that authority within their transactions, including replay of completed operations. Disabling a member blocks subsequent requests and repository admissions immediately, even if the caller retains an unexpired bootstrap or an old internal actor snapshot. Role/configuration changes invalidate stale actors; permission changes are checked even without a configuration-version bump.

A provider request already dispatched cannot be recalled atomically. Internal receipt completion may record an already admitted effect after revocation; it cannot authorize a new operation. Independent Google ACL access is separate from application access: customer workbooks/folders must use restricted sharing and a server-owned connector for SaaS revocation to be effective.

## Central permission policy

`utils/permission_policy.js` owns the permission vocabulary, explicit built-in role grants, feature mappings and configuration-section mappings. `server/access_policy.js` applies that policy to trusted server actors through `requirePermission()`. `utils/access_control.js` re-exports the shared vocabulary and implements expiring client profile checks for the UI and background worker.

Effective permissions are the intersection of the role grants and customer feature entitlements. Unknown roles/permissions deny by default. Customer membership administration is independent of feature purchases so an eligible administrator can recover access. Customer permissions never include seller or platform authority.

| Permission | Employee | Manager | Admin | Feature |
| --- | --- | --- | --- | --- |
| `sidepanel.report` | Yes | Yes | Yes | report |
| `sidepanel.enforce` | No | Yes | Yes | report |
| `sidepanel.scoreboard` | Yes | Yes | Yes | scoreboard or gamification |
| `sidepanel.automate` | No | Yes | Yes | automate |
| `sidepanel.intel` | No | Yes | Yes | intel |
| `sidepanel.repair` | No | No | Yes | repair |
| `settings.coreConnectivity` | Yes | Yes | Yes | report |
| `settings.openLocker` | No | Yes | Yes | automate |
| `settings.feedbackComms` | Yes | Yes | Yes | feedback |
| `settings.intelligenceTools` | No | Yes | Yes | intel |
| `settings.briefingStats` | No | Yes | Yes | briefing |
| `settings.briefingContent` | No | Yes | Yes | briefing |
| `settings.selectorPaths` | No | No | Yes | selector_editor |
| `settings.gamification` | No | No | Yes | gamification |
| `settings.adminAccess` | No | No | Yes | Independent of feature purchases |

`waiting_approval` grants nothing. Disabled users are excluded from identity resolution, regardless of their stored role. Expired/future subscriptions allow only membership viewing/history and deactivation through Team & Access for members with `settings.adminAccess`. Over-cap recovery similarly grants no operational permissions. Suspended/revoked subscriptions and inactive customers deny access entirely. The older membership endpoint still requires a current subscription.

Custom role creation is not implemented. The shared role resolver is the extension point for future server-owned role definitions; endpoints depend on permission names, not role names. Adding custom roles will also require membership/configuration schemas, seat policy and profile validation to support those definitions. Client-submitted permission arrays must never become a role-definition source. The remaining role comparisons enforce roster counts, assignable roles, final-admin retention or descriptive UI metadata, rather than endpoint authorization.

## Server operation enforcement

| Surface / operation | Required permission |
| --- | --- |
| Bootstrap | Verified identity and eligible unique active membership; returns effective grants |
| Membership list/mutation; Team & Access list/history/preview/commit | `settings.adminAccess`, plus subscription/recovery rules |
| Generate/finalize/project reports | `sidepanel.report`; finalizing Enforcer reports also requires `sidepanel.enforce` |
| Scoreboard statistics (database or legacy) | `sidepanel.scoreboard` |
| Intelligence statistics (database or legacy) | `sidepanel.intel` |
| Reporting/activity/evidence/outcome events | `sidepanel.report`; Enforcer `report.submitted` events also require `sidepanel.enforce` |
| Intelligence-generated events | `sidepanel.intel` |
| Automation scan/outcome/row-status events | `sidepanel.automate` |
| Google config/catalog/whitelist reads; event edits; evidence folders/uploads | `sidepanel.report` |
| Google briefing folder | `sidepanel.intel` |
| Google scanner reads/status/formatting/bonus writes | `sidepanel.automate` |
| Google selector repair | `sidepanel.repair` |
| Google feedback submission | `settings.feedbackComms` |
| Google configuration-section updates | `settings.intelligenceTools` plus every submitted section's permission below |

`EVENT_PERMISSIONS` and `GOOGLE_OPERATION_PERMISSIONS` enumerate the admitted events and commands. Arbitrary provider commands are rejected. Google operations also enforce customer-owned destinations, file ancestry, assigned platforms, bounded arguments and idempotency/replay rules. Statistics enforce the resolved dashboard and platform scope. Report and reward permissions do not bypass evidence ownership or server reward policy.

Configuration section permissions are checked on the server even for an Admin:

| Section | Additional permission |
| --- | --- |
| `verticals` | `settings.intelligenceTools` |
| `platform_selectors` | `settings.selectorPaths` |
| `double_xp_settings`, `gamification_levels` | `settings.gamification` |
| `community_highlights`, `briefing_content` | `settings.briefingContent` |

Membership writes use version checks, seat-cap enforcement, final-administrator protection and customer-scoped audit records. Team & Access reviews expire after ten minutes and bind the reviewed change to the original actor and roster. See [membership protocol](docs/white-label/MEMBERSHIP_CAP_ENFORCEMENT.md) and [tenant isolation](SECURITY_TENANT_ISOLATION.md).

## Bootstrap protocol and expiration

`config/customer_bootstrap.json` contains public endpoint URLs and a schema version only. Credentials belong in the server secret store, never workbooks or extension configuration.

The extension sends `POST <bootstrapEndpoint>` with `Authorization: Bearer <Google access token>` and:

```json
{
  "protocolVersion": 1,
  "identity": { "email": "user@example.com" },
  "extension": { "id": "extension-id", "version": "3.3.1" }
}
```

Success returns exactly one `profile`. Its fixed fields are `schemaVersion`, `customerId`, `userId`, `configVersion`, `email`, `name`, `role`, `permissions`, `platforms`, `theme`, `legal`, `integrations`, `issuedAt` and `expiresAt`. Timestamps are milliseconds since the Unix epoch. Theme/legal/integration fields use the allowlisted schema in `validateCustomerAccessProfile()`; unknown fields, unsupported permissions, grants exceeding the built-in role or identity mismatches invalidate the response.

The server issues ten-minute profiles, shortened to the operational entitlement expiry when applicable. Client validation rejects lifetimes over fifteen minutes, invalid timestamps and expired profiles. `hasPermission()` and `hasPlatformAccess()` deny at the expiry boundary. Membership client calls and Team & Access use the same permission/expiry guard; the data client also rejects expired profiles before sending events or statistics requests.

The profile is a UI snapshot, not a server credential. Server requests always reverify Google identity and persisted membership; submitting an old profile cannot extend access.

## Cache and protected background work

`customer_access_profile_v1` stores a validated display snapshot. Persisted browser storage is untrusted and cannot supply background authority after a service restart. Only a profile obtained by the current running bootstrap service may be reused in memory for display; a transient display refresh failure can retain it until expiry.

Each protected `requirePermission()` call and content-script `checkAccess` request forces an online bootstrap refresh and disallows cached fallback. Disabling a member, revoking authentication, or losing verification connectivity therefore denies new protected background work. Authoritative `401`, `403`, `404` and `409` bootstrap denials clear in-memory authority and record a denial; a subsequent outage cannot revive the old grant. Stale profiles may still supply display data but never authorize work. Logout clears access and customer-scoped caches and invalidates in-flight sign-in results. Online verification adds a bootstrap round trip to protected actions.

## Customer versus seller administration

Employee, Manager and Admin are customer roles only. Customer membership APIs accept only those assignable roles; a customer Admin cannot assign seller/platform roles or choose another customer. The seller setup application uses its own password/session authentication, loopback host checks, mutation Origin and CSRF checks, idle/absolute session expiry and session revocation on logout/password change. A customer Google bearer token or forged Admin profile cannot authenticate there. Billing bridge and worker endpoints use separate server credentials.

## Verification and rollout

- `tests/rbac.test.mjs`: explicit allow/deny matrix for all three roles, Google commands, feature-gated configuration edits, platform-role escalation rejection and profile expiration.
- `tests/rbac_postgres.test.mjs`: real HTTP/service/repository paths for each role, allowed reporting/statistics, prohibited operations, team review/commit, demotion, feature removal, immediate disable and revoked credentials.
- `tests/customer_bootstrap.test.mjs`, `tests/customer_membership.test.mjs`: strict protected refresh, expiry, untrusted cache, denial persistence and outage regression tests.
- `tests/google_identity.test.mjs`, `tests/customer_authority.test.mjs`, `tests/seller_auth.test.mjs`: invalid/expired identity behavior, operation-wide authentication admission and seller/customer separation.

Run `npm run test:ci` with `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=true` pointing to an isolated test database. This runner requires database coverage; `npm test` alone may skip it.

Validation on 2026-09-25: the complete required-database suite passed **198 tests, zero failures, zero skips** on a temporary schema-only Neon branch using synthetic customer fixtures and stubbed Google responses. The extension release build, JavaScript syntax checks and `git diff --check` also passed. Production data and local production credentials were unchanged.

Ship the extension's shared permission vocabulary before enabling the updated server bootstrap grants: older extensions reject the new `settings.gamification` permission as unknown. Production configuration, Google sharing and live provider behavior require separate operational verification. This change does not deploy the application or modify production data.
