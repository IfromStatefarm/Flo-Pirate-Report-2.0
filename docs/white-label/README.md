# White-label baseline

This directory records the pre-refactor state of the extension. It is the completion artifact for white-label step 1: stabilize the current work, inventory customer-specific behavior, select a neutral fallback identity, and document the current report/statistics flows.

## Documents

- [`STABILIZATION_BASELINE.md`](STABILIZATION_BASELINE.md) — source revision, dirty-worktree snapshot, recovery instructions, and baseline checks.
- [`BRANDING_INVENTORY.md`](BRANDING_INVENTORY.md) — customer-specific values, assets, copy, identifiers, and resource names that must become configuration or remain platform constants.
- [`CURRENT_FLOWS.md`](CURRENT_FLOWS.md) — current authentication, configuration, report, automation, scoreboard, and intelligence data paths.
- [`CUSTOMER_CONFIG_CONTRACT.md`](CUSTOMER_CONFIG_CONTRACT.md) — strict runtime shape, validation rules, spreadsheet headers, and fallback behavior.
- [`neutral-fallback.theme.json`](neutral-fallback.theme.json) — the approved neutral identity for the future generic shell. It is documentation only and is not loaded by the extension yet.

## Decision

The generic fallback product name is **Rights Reporter**. The unauthenticated and invalid-configuration experience will use a neutral slate-and-blue skin, a generic document/shield mark, and the assistant name **Reporting Assistant**.

FloSports becomes a customer configuration rather than a code default. Platform-owned colors and third-party report endpoints remain platform constants; customer branding, legal identity, contacts, managed resource IDs, and customer copy become tenant configuration.

## Scope boundary

No runtime behavior was changed in this step. The snapshot intentionally predates the files in this directory so it represents the exact application state before white-label documentation or refactoring was added.
