# Rights Reporter Extension

Customer-configurable copyright evidence and reporting extension.

Production-readiness review: [architecture audit and prioritized roadmap](docs/architecture/PRODUCTION_READINESS_AUDIT.md), including current/target diagrams, trust boundaries, migration gates and required tests. See the [future file modification map](docs/architecture/FUTURE_FILE_MAP.md) for implementation scope. The audit distinguishes implemented controls from intended behavior in older design documents; its P0 gates remain open.

## Commercial subscriptions

Version 3.4.0 adds seller sign-in, subscription dates, monthly/yearly manual renewals, purchased seats, a signed Wix billing bridge, and server-generated report PDFs. Follow [Commercial licensing setup](docs/white-label/COMMERCIAL_LICENSING_SETUP.md) before deploying the API or distributing the new extension. Existing customers need explicit subscription terms; missing terms lock paid API access.

## Customer access setup

The extension now uses verified Google identity and an API-backed customer bootstrap. It does not read membership from a fixed access workbook or maintain separate extension credentials.

Set the deployment's credential-free HTTPS bootstrap URL in `config/customer_bootstrap.json`. The API must validate the bearer Google OAuth token, resolve the identity to exactly one active customer, and return the fixed short-lived profile described in [ACCESS_CONTROL_OUTLINE.md](ACCESS_CONTROL_OUTLINE.md).

Membership, roles, seat enforcement, and OAuth secrets belong in the server-side control plane. Do not put authentication secrets, OAuth client secrets, tokens, or login data in Google Sheets. An unconfigured endpoint, ambiguous membership, invalid response, or expired profile locks all protected background actions.

## Membership administration

Set the public HTTPS `membershipEndpoint` in `config/customer_bootstrap.json` (or leave it empty to derive the sibling `/memberships` endpoint from the bootstrap URL). The settings page lets verified customer administrators approve, activate, reactivate, disable, and change member roles. It displays the API's refreshed total-user and per-role utilization after list and mutation requests.

The client never supplies a customer ID for a mutation. The API must derive the actor and customer from the verified Google token, enforce both caps and the final-administrator rule in one transaction, and write the audit record in that transaction. See [docs/white-label/MEMBERSHIP_CAP_ENFORCEMENT.md](docs/white-label/MEMBERSHIP_CAP_ENFORCEMENT.md) for the fixed request/response and server transaction contract.

## Customer-safe statistics

Set the public HTTPS `dataEndpoint` in `config/customer_bootstrap.json`, or leave it empty to derive `/data` from the bootstrap URL. Reports, scanner outcomes, platform outcomes, source-event changes, rogue evidence, and intelligence exports are recorded as normalized events containing `customer_id`, `user_id`, and `event_id`. Scoreboard and intelligence queries now use that scoped API instead of directly aggregating report workbook rows.

Customer report/evidence destinations come from the verified profile. PDF and Drive metadata carry the same scope identifiers, statistics caches are customer-and-user keyed, and session data is cleared when the verified scope changes. The server storage and `Stats - <Customer>` projection contract is documented in [docs/white-label/CUSTOMER_DATA_ISOLATION.md](docs/white-label/CUSTOMER_DATA_ISOLATION.md).

## Customer theming

All extension surfaces use the shared runtime theme in `utils/theme_loader.js`. The packaged manifest and signed-out state use the neutral **Rights Reporter** identity. Verified customer profiles can supply only the fixed product, color, logo, legal, platform, permission, and integration fields documented in `docs/white-label/CUSTOMER_CONFIG_CONTRACT.md` and `ACCESS_CONTROL_OUTLINE.md`.

Customer logos are downloaded by the background service, restricted to approved raster image types under 1 MB, and cached locally by customer and configuration version. PDF reports use the same verified customer theme and legal identity. See `docs/white-label/THEME_SHELL.md` for the runtime contract.

The existing FloSports deployment is staged under `migrations/flosports/`. Comparison mode keeps normalized API reads authoritative while recording digest-only parity against a server-side legacy adapter. The cutover is intentionally blocked until an active administrator is assigned, the API endpoints and approved logo URL are configured, and both required statistics reads meet the parity threshold. See `docs/white-label/FLOSPORTS_MIGRATION.md`.
# Customer team administration

Customer admins use **Settings → Manage Team & Access** to add people, assign Employee/Manager/Admin roles, review bulk changes, deactivate access, and inspect audit history within purchased limits. See [Team & Access](docs/white-label/CUSTOMER_TEAM_MANAGEMENT.md) for activation, subscription recovery, and isolated tests.

Implementation progress, remaining production gates, migration order and validation: [Production-readiness implementation status](docs/architecture/IMPLEMENTATION_STATUS.md).
