# FloSports migration

## Migration inventory

The migration was prepared from the live legacy access workbook on 2026-09-03. The supplied `Customer Skins` workbook currently contains only the `Customer` header, so the canonical row is staged locally in `migrations/flosports/customer-sheet-row.json` rather than being treated as an authoritative live configuration.

The legacy registry contained two unique memberships and one shared integration set:

- one active manager with the legacy `all` platform assignment;
- one pending `Waiting_Approval` member with the legacy `all` platform assignment;
- no active administrator;
- one Drive root folder ID, one report spreadsheet ID, and one event spreadsheet ID shared by both rows;
- a legacy password-hash column, which is explicitly excluded from the import.

The pending membership uses a `flosports.com` address while the established customer login policy is `flosports.tv`. It remains in the migration file for fidelity but is a review warning and cannot become active until the server-side customer domain policy is deliberately changed or the email is corrected.

## Migration artifacts

- `migrations/flosports/customer.json` is the validated customer record, theme, legal identity, access policy, full current platform allowlist, managed destinations, and `stats_flosports` dashboard route.
- `migrations/flosports/customer-sheet-row.json` contains the exact fixed headers and one row accepted by `resolveCustomerConfigFromSheetRow()`.
- `migrations/flosports/memberships.json` contains the two legacy memberships. It contains no password, token, OAuth credential, or secret value.
- `migrations/flosports/asset-manifest.json` pins the existing PNG logo by SHA-256. The configuration keeps `logoUrl` empty until that image is published to an approved HTTPS location; this makes the neutral packaged logo the safe interim behavior.
- `migrations/flosports/import-manifest.json` records the source, new write mode, comparison mode, and outstanding cutover requirements.

`validateMembershipMigration()` converts `all_current` to an explicit snapshot of every platform enabled by the customer configuration. Newly added platforms will therefore not become available to migrated members automatically. It validates roles, states, domains, duplicate identities, seat caps, unsafe fields, and the initial administrator requirement.

## API import

The server-side importer must apply the customer record, access policy, integration routes, and memberships in one migration transaction keyed by `migrationId`. Repeating an identical migration is an idempotent success; reusing the ID with different content is a conflict. The importer must:

1. Validate `customer.json` using the fixed customer configuration contract.
2. Validate and normalize `memberships.json` with `validateMembershipMigration()` or an equivalent server implementation.
3. Upsert `customers(customer_id = 'flosports')`, its versioned configuration, access policy, platform grants, and integration destinations.
4. Upsert memberships by immutable Google identity/email and stable `memberId`; do not import the old password column.
5. Require an explicitly selected, verified FloSports administrator before activation of the customer.
6. Write an immutable migration audit containing counts, source workbook/gid, file digests, actor, and timestamp, but never password material.

The current source has no administrator. The importer may stage the customer and memberships, but production bootstrap remains disabled until an administrator is deliberately assigned. It must not infer an administrator from name, row order, or the existing manager role.

## Comparison mode

`config/customer_migration.json` enables `compare` reads for `flosports`. Scoreboard and intelligence handlers return the normalized customer API result and separately request `query_legacy_statistics` from the same authenticated data endpoint. The legacy adapter is server-side and must:

- derive the authenticated customer and user from the Google token;
- run only when that customer is `flosports` and comparison mode is enabled;
- select the legacy workbook ID from the server migration record, never from request JSON;
- apply the verified user's platform assignment;
- return the same fixed statistics response contract as `query_statistics`;
- perform no writes.

The extension compares canonicalized results, excluding only generated/fetched timestamps. It stores digests, a bounded list of mismatch paths, read kind, time, and error code in local extension storage. It never stores the compared names, report rows, URLs, or other raw customer data in the parity history.

Both `scoreboard` and `intelligence` require ten consecutive matches. Administrators can request the packaged `getMigrationStatus` action to inspect the counts. A legacy read failure is a mismatch and does not replace or downgrade a successful normalized read.

## Write cutover

Membership mutations already use the membership API. Report submissions, activity, scanner outcomes, platform outcomes, and intelligence events already use the normalized customer data API with `customer_id`, `user_id`, and `event_id`. Customer integration IDs are taken only from the verified FloSports profile. Legacy statistics reads are comparison-only and cannot write.

Event-configuration and operational worksheet mutations that still use Google APIs are routed to the IDs in the verified customer profile; they do not use the legacy access workbook or a request-selected customer destination. Moving those mutable datasets behind a server endpoint is a separate control-plane change and is not required for normalized event/statistics cutover.

## Cutover and fallback removal

Do not remove the remaining FloSports-specific compatibility fallbacks yet. Complete these gates in order:

1. Configure the public HTTPS bootstrap, membership, and data endpoints.
2. Publish the pinned logo to an approved HTTPS URL, set it in the FloSports configuration, and increment `configVersion`.
3. Assign and verify at least one active FloSports administrator, then apply the idempotent migration transaction.
4. Confirm bootstrap, roles, platform grants, Drive destinations, report/event ingestion, PDFs, scoreboard, and intelligence outputs in production.
5. Accumulate at least ten consecutive matching comparisons for both required read kinds.
6. Change `readMode` from `compare` to `off`. `legacyFallbackRemovalAllowed` becomes true only when stored parity is complete and comparison is off.
7. Run `npm run audit:flosports-fallbacks`, classify intentional internal `flo-*` compatibility names separately, and remove customer-specific runtime fallbacks in a dedicated reviewed change.

The repository intentionally remains before gate 1 because its API endpoint settings are blank, the source has no administrator, the logo is not at an approved HTTPS URL, and no live parity history exists. This is a safe staged migration, not a claimed production cutover.
