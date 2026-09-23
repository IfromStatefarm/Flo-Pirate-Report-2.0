# Team & Access

Customer admins open **Settings → Manage Team & Access** in the extension. This is a full extension page, not the local seller Customer Setup server. Employees and managers cannot administer users, including by calling the API directly. Ivan continues to control the purchased package, approved domains, subscription dates, and seat limits.

## Everyday use

- **Add people:** paste up to 50 addresses, optionally as `Jamie Lee <jamie@company.com>`, and choose Employee, Manager, or Admin. Review the seat changes and confirm. This reserves active seats immediately. Copy the installation/sign-in instructions and share them with those people; the application does not send email automatically.
- **First sign-in:** each person uses their exact approved Google email. The server verifies the token and binds its Google subject. Until then, the directory shows “Awaiting first sign-in.” An allowed domain alone grants no access.
- **Change roles:** choose new roles in the directory, select the affected people, and review. Use “Set selected role” for a common role. Pending people are approved; deactivated people are reactivated. Active people receive the new role. Role swaps are checked against final seat totals.
- **Deactivate:** select people, choose Deactivate selected, review, and confirm. Their next protected server request is denied. Their seats become available and reporting history stays intact. Already downloaded reports and separate Google Drive permissions are not removed.
- **History:** the Change history view shows the actor, affected person, before/after access, and timestamp. All entries are scoped to the signed-in customer's organization.

The directory has server-side search, role/status filters, and 50-person pages. Selection applies to the current page. Changes are never saved merely by changing a dropdown. Every mutation uses an explicit review with projected total and per-role seat use.

Keep at least one active admin. Self-demotion is allowed only when another active admin remains; it closes access to Team & Access immediately after saving. Admin grants and self-changes are highlighted in the review. Lost-account recovery remains an Ivan support process requiring identity verification; customer admins cannot bypass verified Google sign-in.

## Subscription recovery

- Active accounts can allocate seats within their purchased package.
- An over-cap account can make changes that reduce an existing overage without increasing another. Ordinary work remains blocked until all limits fit.
- An expired or future subscription gives a verified active admin only Team & Access permissions: view the roster/history and deactivate users. Adding, approving, reactivating, and changing roles are denied. This permission is checked again at commit time.
- Missing terms, seller suspension, and paused/revoked subscriptions do not grant recovery access. Contact Ivan.

The restricted bootstrap profile lasts no more than ten minutes. All protected server operations still recheck the current membership and subscription. A restricted profile does not authorize reports, statistics, or shared configuration edits.

## Server behavior

The existing membership endpoint accepts four new operations with `protocolVersion: 1`:

| Operation | Required fields beyond protocol/operation | Result |
| --- | --- | --- |
| `team_list` | `query`, `role`, `status`, `cursor` (empty strings allowed) | Members, seat use, subscription state, approved domains, next cursor |
| `team_history` | `cursor` | Scoped audit summaries and next cursor |
| `team_preview` | `requestId`, `changes` (1–50) | Reviewed changes, projected seat totals, self/admin warnings |
| `team_commit` | `requestId` | Saved count, current seat use, whether the actor retains admin access |

The server derives actor and customer from the verified Google identity. No operation accepts caller-selected customer or actor authority. The extension background service accepts membership messages only from its own Settings and Team & Access pages; content scripts cannot invoke those controls. Add-user changes contain `action: 'add'`, `email`, `name`, and `role`. Existing-user changes contain an action, `memberId`, `expectedVersion`, and a role except for deactivation. Supported actions are `approve`, `reactivate`, `change_role`, and `disable`.

Reviews are bound to one admin, expire after ten minutes, and store a payload hash plus the reviewed roster/configuration versions. A stale review applies nothing. Commit runs at serializable isolation and rechecks subscription, actor, domains, member versions, final seat totals, and final-admin protection. Memberships, audit entries, and the retry result commit together. A retry with the same request ID cannot repeat changes. After self-demotion, another request still requires current admin authority even if it uses an old request ID.

Each admin may create up to 100 successful reviews per hour. Request schemas, batches, pages, and HTTP bodies are bounded. Audit responses omit Google subject identifiers. The existing global email-uniqueness constraint keeps preapprovals consistent with the current one-customer-per-Google-identity model; existing addresses must be resolved rather than copied into another customer.

## Activation

Current status: migration `006_team_management.sql` has been applied to the configured database. Customer and membership records were verified unchanged. The updated APIs and extension have not been deployed. The latest readiness check still reports missing terms for `flosports` and `test-1`; complete those terms before activating enforcement.

1. Apply `server/sql/006_team_management.sql` using the direct database connection (`npm run db:migrate` also runs the existing additive migrations).
2. Confirm customer subscription terms with `npm run licensing:preflight`, following the commercial licensing activation guide. Do not activate subscription enforcement for customers lacking agreed terms.
3. Deploy the updated bootstrap and membership APIs together with the existing licensing/data changes. Keep the existing endpoint URLs.
4. Build and distribute the updated extension using `npm run build:extension` after verifying the APIs. Admins then use Settings → Manage Team & Access.

The hosted customer portal, email delivery, team/department scoping, and manager delegation are not part of this release. The browser harness described below is only a test environment and must not be used as a production portal.

## Verification

`npm test` includes protocol validation, final-state seat projection, malformed request rejection, and client response/error checks. Database checks are deliberately skipped unless an explicitly isolated connection is supplied:

```sh
TEST_DATABASE_ISOLATED=true node --env-file=/path/to/isolated-test.env --test --test-concurrency=1 tests/team_postgres.test.mjs tests/subscription_postgres.test.mjs
```

The file must define `TEST_DATABASE_URL` pointing at a direct connection to an isolated branch. Tests cover onboarding, identity binding, reserved seats, deactivation/reactivation, role swaps, stale/expired reviews, retries, concurrent batches, tenant isolation, last-admin rules, self-demotion, subscription recovery, audit pagination, and throttling. Serialize whole suites when they share a branch to avoid unrelated fixture/mapping contention; each suite still runs its explicit concurrent-user tests. Test migration runners also share an advisory lock.

For browser verification, `node --env-file=/path/to/isolated-test.env tests/team_browser_server.mjs` starts a loopback-only page at `http://127.0.0.1:4187/options/team.html` using synthetic identities and real isolated database operations. It exercises the shipped page and server logic without bypasses in production code. Google OAuth itself still requires a smoke check in the installed extension when the updated APIs are deployed.
