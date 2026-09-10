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
node --env-file=.env.local server/scripts/migrate.mjs
```

Migration `002_customer_provisioning.sql` adds:

- A global normalized-email uniqueness rule, so a Google email cannot resolve to multiple customers.
- `customer_provisioning_audit`, a dedicated audit table for customer creation records.

Use `DATABASE_URL_UNPOOLED` for this migration and the setup tool. The live bootstrap, membership, and data Functions continue using the pooled `DATABASE_URL` injected by Neon.

## Start the tool

1. Optionally set `CUSTOMER_SETUP_OPERATOR_EMAIL` in `.env.local` to prefill the operator field.
2. From the repository directory, run:

   ```sh
   npm run customer:setup
   ```

3. Open the printed local URL, normally `http://127.0.0.1:4174/`.
4. Complete the form and choose **Validate and review**.
5. Correct any validation errors.
6. Review the customer, administrator, domains, caps, roles, platforms, destinations, and statistics ID.
7. Choose **Create customer and administrator** once.
8. Save the returned customer ID and audit ID.
9. Stop the local process with Control-C.

The tool never updates an existing customer. Reusing a customer ID or administrator email is rejected. This makes an accidental second submission safe and keeps configuration-version updates as a separate future workflow.

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
