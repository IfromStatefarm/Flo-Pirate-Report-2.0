# White-label baseline

This directory records the pre-refactor state of the extension. It is the completion artifact for white-label step 1: stabilize the current work, inventory customer-specific behavior, select a neutral fallback identity, and document the current report/statistics flows.

## Documents

- [`STABILIZATION_BASELINE.md`](STABILIZATION_BASELINE.md) — source revision, dirty-worktree snapshot, recovery instructions, and baseline checks.
- [`BRANDING_INVENTORY.md`](BRANDING_INVENTORY.md) — customer-specific values, assets, copy, identifiers, and resource names that must become configuration or remain platform constants.
- [`CURRENT_FLOWS.md`](CURRENT_FLOWS.md) — current authentication, configuration, report, automation, scoreboard, and intelligence data paths.
- [`CUSTOMER_CONFIG_CONTRACT.md`](CUSTOMER_CONFIG_CONTRACT.md) — strict runtime shape, validation rules, spreadsheet headers, and fallback behavior.
- [`../../ACCESS_CONTROL_OUTLINE.md`](../../ACCESS_CONTROL_OUTLINE.md) — Google identity bootstrap, API request/response contract, permission ceiling, caching, and fail-closed rules.
- [`THEME_SHELL.md`](THEME_SHELL.md) — runtime theme loading, semantic tokens, safe text replacement, local logo caching, and PDF propagation.
- [`MEMBERSHIP_CAP_ENFORCEMENT.md`](MEMBERSHIP_CAP_ENFORCEMENT.md) — fixed membership API contract, transactional cap/final-admin rules, response totals, audit requirements, and workbook boundary.
- [`CUSTOMER_SETUP_TOOL.md`](CUSTOMER_SETUP_TOOL.md) — secure local customer provisioning, first-administrator creation, and audit workflow.
- [`CUSTOMER_DATA_ISOLATION.md`](CUSTOMER_DATA_ISOLATION.md) — normalized customer events, scoped statistics queries/caches, Drive/PDF metadata, and `Stats - <Customer>` projection rules.
- [`FLOSPORTS_MIGRATION.md`](FLOSPORTS_MIGRATION.md) — the staged FloSports customer/user import, server-side dual-read contract, parity gate, and cutover runbook.
- [`neutral-fallback.theme.json`](neutral-fallback.theme.json) — the approved neutral identity mirrored by the runtime fallback.

## Decision

The generic fallback product name is **Rights Reporter**. The unauthenticated and invalid-configuration experience uses a neutral slate-and-blue skin, a generic document/shield mark, and the assistant name **Reporting Assistant**.

FloSports becomes a customer configuration rather than a code default. Platform-owned colors and third-party report endpoints remain platform constants; customer branding, legal identity, contacts, managed resource IDs, and customer copy become tenant configuration.

## Scope boundary

The stabilization snapshot still represents the exact application state before the white-label work. Subsequent steps added the customer configuration contract and replaced workbook credentials with the API-backed Google identity bootstrap documented above.
