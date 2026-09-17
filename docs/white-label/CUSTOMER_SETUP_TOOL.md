# Customer Setup tool

## Decision and security boundary

Customer provisioning is a local operator application backed directly by Lakebase Postgres. It is intentionally not part of the Chrome extension and is not a public Neon Function.

```text
Local browser (127.0.0.1 only)
        |
        | form data, CSRF protected
        v
Local Node setup process -- DATABASE_URL_UNPOOLED --> Lakebase Postgres
                                                        |
Chrome extension -- verified Google token --> Neon customer API --> same tables
```

This design keeps the database credential in the ignored `.env.local` file. It never enters browser storage, a spreadsheet, extension storage, the extension package, or a public API request. The local server binds only to `127.0.0.1`, requires a same-origin request and CSRF token, sends a restrictive Content Security Policy, and stores pending review data only in process memory for ten minutes.

The form accepts only the fixed customer configuration contract. `validateCustomerConfig()` rejects unknown fields, arbitrary HTML, JavaScript, CSS, unsupported roles/features/platforms, unsafe URLs, invalid colors, bad resource IDs, and invalid caps.

## One-time database migration

Run this after pulling the Customer Setup changes and before creating a customer:

```sh
npm run db:migrate
```

Migration `002_customer_provisioning.sql` adds:

- A global normalized-email uniqueness rule, so a Google email cannot resolve to multiple customers.
- `customer_provisioning_audit`, a dedicated audit table for customer creation records.

Migration `003_customer_configuration_audit.sql` adds an immutable audit table for later customer-configuration changes. Each record stores the operator, before/after configuration versions, changed fixed-field paths, request hash, and before/after validated configuration. Apply migrations before using the edit workflow.

Use `DATABASE_URL_UNPOOLED` for this migration and the setup tool. The live bootstrap, membership, and data Functions continue using the pooled `DATABASE_URL` injected by Neon.

## Start the tool

1. Optionally set `CUSTOMER_SETUP_OPERATOR_EMAIL` in `.env.local` to prefill the operator field.
2. From the repository directory, run:

   ```sh
   npm run customer:setup
   ```

3. Open the printed local URL, normally `http://127.0.0.1:4174/`.
4. Choose **View customers** to see existing profiles, their versions, status, active users, administrator utilization, and last update time, or complete the new-customer form.
5. To create a customer, complete the form and choose **Validate and review**.
6. Correct any validation errors.
7. Review the customer, administrator, domains, caps, roles, platforms, destinations, and statistics ID.
8. Choose **Create customer and administrator** once.
9. Save the returned customer ID and audit ID.
10. Stop the local process with Control-C.

Reusing a customer ID or administrator email during creation is rejected. Existing customers are changed only through **View customers → Edit customer**. Customer IDs are permanent, and the edit form automatically advances the configuration version by exactly one.

## Editing an existing customer

1. Choose **View customers**.
2. Select **Edit customer** for a profile with a valid stored configuration.
3. Enter the operator email and change the approved fixed fields.
4. Choose **Validate changes** and review the proposed configuration.
5. Choose **Save customer changes**.

The final save uses a serializable transaction and an optimistic version check. It locks the customer and membership rows, rejects stale browser sessions, prevents caps from falling below current utilization, prevents disabling roles with active users, prevents removing the domain of an active member, updates the validated configuration and version, and writes `customer_configuration_audit`. The configuration update and audit either both commit or both roll back. Customer activation/deactivation and membership edits remain outside this screen.

## Transaction guarantees

Confirmation runs a serializable transaction that:

1. Confirms the customer ID does not exist.
2. Confirms the administrator email is not assigned to another customer.
3. Inserts the validated customer configuration.
4. Inserts one active administrator with all customer-enabled platforms.
5. Inserts a provisioning audit record containing the operator, initial administrator, configuration version, a SHA-256 request hash, and a safe summary.
6. Commits all three records together.

If any operation fails, the transaction rolls back. No partial customer is retained.

## How the extension finds the new customer

No extension configuration, rebuild, or per-customer endpoint is required. The existing extension sends the verified Google identity to the shared bootstrap Function. That Function finds the new active membership, validates the stored customer configuration, links the Google subject on first successful sign-in, and returns a short-lived customer-scoped profile.

The new administrator should:

1. Install or reload the same Rights Reporter extension.
2. Use the exact Google email entered in Customer Setup.
3. Complete the Google authorization prompt.
4. Retry access verification.

The administrator cannot access another customer's membership or event data because every API lookup and write is scoped by the resolved `customer_id`.

## Spreadsheets

A Google Sheet may be used later as an import or authoring surface, but it is not the access authority. Customer Setup writes the validated canonical configuration to Postgres. Passwords, OAuth credentials, database connection strings, API keys, and other secrets must never be placed in workbook cells.
