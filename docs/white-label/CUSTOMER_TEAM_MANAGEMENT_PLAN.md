# Customer Team & Access plan

Design recorded September 18, 2026.

Implementation follow-up: the extension page, email preapproval, atomic batches, scoped history, and subscription recovery are now implemented. See [Team & Access operation and activation](CUSTOMER_TEAM_MANAGEMENT.md). The original proposal below is retained as the design record; hosted portal and automatic email delivery remain future work.

## Recommended first release

Add a full-page **Team & Access** screen to the extension's existing Settings tab. An administrator opens it from the extension menu and signs in with their own Google account. Reuse the customer membership API and its existing server enforcement. This avoids a separate website, second password system, and duplicated authorization logic during the first release.

Ivan controls the purchased package, subscription dates, customer domains, and total/per-role limits in seller Customer Setup. Customer admins allocate the seats they purchased. They cannot change the subscription or grant features outside their package. The localhost seller page is never a customer administration URL.

Confirmed policy: only customer admins manage users. Managers keep their operational tools and cannot add users, change roles, or deactivate employees.

## Current implementation and gaps

- `utils/access_control.js` defines employee, manager, and admin permission sets. Customer features further restrict those permissions.
- `services/customer_membership_service.js` and `background/main.js` already support member search, approval, reactivation, role changes, and disabling users.
- `server/postgres_repository.js` verifies the acting admin, scopes changes to their customer, checks member versions, enforces limits inside transactions, and protects the last active admin. Membership audits already exist.
- The current Settings UI does not expose those membership actions. There is no customer-admin add-user or invitation endpoint, bulk operation, or audit-history reader.
- Membership resolution currently supports exactly one customer per Google identity. Keep that restriction explicit in this release; multi-organization accounts require a separate identity and organization-selection change.

## Roles

| Capability | Employee | Manager | Admin |
| --- | --- | --- | --- |
| Capture evidence and create reports | Yes | Yes | Yes |
| View scoreboard and basic connection settings | Yes | Yes | Yes |
| Use purchased automation, intelligence, and briefing tools | No | Yes | Yes |
| Add users, assign roles, deactivate and reactivate users | No | No | Yes |
| View customer membership history | No | No | Yes |
| Change purchased limits, renewal dates, or billing mappings | No | No | No — Ivan/billing service |

Every capability remains subject to purchased features and server authorization. Show short, plain-language role descriptions beside the role selector. Use the same capability definitions for UI labels and authorization tests so they cannot drift.

Do not introduce custom roles or a fourth owner role in the first release. Preserve at least one active admin. An additional admin improves continuity when the purchased package has capacity.

## Screen and daily workflow

The top of the screen shows the company name, subscription state, and used/available total, employee, manager, and admin seats. A role change consumes the destination role seat and frees the old role seat; it does not increase the total active-user count.

Provide search and filters for role and status, an **Add people** button, and a table with name, email, role, access state, and actions. Keep Active, Pending, and Deactivated views. Display “Awaiting first sign-in” for an active, preapproved email with no bound Google identity; this is an onboarding label, not an additional authorization status. Do not expose raw identity-provider identifiers to the client.

Use a detail panel for role changes and deactivation, with a preview such as “Employee → Manager; manager seats become 3 of 5.” Never save a role change simply because someone navigates through a dropdown. If there is no capacity, explain which limit is full and how to free a seat or contact Ivan. Show updated authoritative totals after every save.

For a stale change made by another admin, refresh the affected record and require a new review. Never silently overwrite a more recent role decision.

## Adding users efficiently

1. The customer admin selects **Add people**, enters or pastes email addresses, and chooses a role. Employee is the default; admin grants require an explicit review.
2. The server validates and normalizes addresses, checks approved domains and existing memberships, and previews the resulting seat counts. Existing users are identified rather than overwritten.
3. On confirmation, the server atomically creates preapproved active memberships. These reserve and consume seats immediately, even before first sign-in. Recheck authorization, current limits, and duplicates at commit time.
4. Show a copyable installation/sign-in instruction for the admin to share. Automatic email delivery can be added later; the initial workflow does not require an email provider or invite tokens.
5. The person installs the common extension and signs in with the exact preapproved Google email. The server verifies the identity, binds its provider subject, and supplies the customer's configuration and role.

Revoke unused preapprovals with **Deactivate** to free their seats. Mere possession of installation instructions, an email-domain match, or a client-supplied customer ID never grants access. Pending records from existing migrations remain in the approval queue and consume no active seat until approved. Unknown users receive a clear contact-your-admin message.

A later email invitation system should introduce expiring, single-use, email-bound invitations only if its onboarding benefits justify the extra lifecycle and delivery infrastructure. Never send the seller password or create shared employee credentials.

## Bulk changes and offboarding

Support bounded batches (up to 50 people) for adding, approving, changing roles, and deactivating users. Use a preview showing exactly who changes, projected role totals, and errors. Default to all-or-nothing transactions within a customer: if any member version or limit changes before commit, apply nothing and refresh the preview. Do not loop independent per-user requests and silently leave a partially updated team.

Evaluate limits against the final projected membership set. This allows an atomic role swap or seat replacement without requiring temporary spare capacity. When already over a limit, allow a batch only if it reduces an existing overage without increasing another or violating the final-admin rule; normal use stays restricted until all limits fit.

Deactivation retains reporting history and attribution, frees a seat, and rejects subsequent protected server requests. Refresh client access when the extension regains focus and after admin actions; server enforcement must not depend on a cached screen. Already downloaded files and separately authorized Google resources are not revoked by extension membership changes. Reactivation rechecks the current package and limits.

Require explicit review for self-demotion, admin promotion, and bulk deactivation. If an admin demotes themselves while another active admin remains, save atomically, refresh their permissions immediately, and close Team & Access. Block removal of the final active admin. Ivan handles verified recovery of a lost administrator through a separate audited seller flow.

## Server and client changes

Extend the current membership service instead of building a second authority:

- Add paginated listing with server-side search, role/status filters, and a minimal derived first-sign-in indicator. The existing bounded list is not sufficient for large customer directories.
- Add bounded preview/commit operations for user creation and bulk membership changes. Derive customer and actor from verified identity; reject arbitrary submitted actor/customer identities.
- Include request IDs and expected target versions. Store a request payload hash and result in the same transaction so a retried submission returns its result and cannot create extra users or repeat changes.
- Lock customer, subscription, and memberships consistently with the subscription service. Revalidate entitlement and admin authority inside the write transaction, and calculate the final total and per-role utilization before commit.
- Add a paginated, customer-scoped audit reader. Display who changed whom, the before/after role or state, and when. Audit entries are written with each committed mutation, never by a client assertion.
- Separate membership-administration eligibility from report-generation eligibility. Proposed policy: during an expired or future subscription, an existing verified admin may view Team & Access and deactivate users, but cannot add, activate, or promote them. A seller security suspension or revoked customer denies access and directs the customer to Ivan. This is a deliberate new policy; current code blocks expired subscriptions entirely.
- Keep per-person authentication and tenant isolation in every route, including previews, histories, and retries. Apply bounded payloads and mutation rate limits.

Manager delegation and department-specific administration are outside this plan. A future “my team only” policy would additionally require team membership and server-side team scoping; the present data model has no teams.

## Delivery order

1. Ship Team & Access using existing list/change/disable operations, seat counters, role explanations, and a readable history endpoint.
2. Add email preapproval, first-sign-in binding feedback, and bounded atomic bulk actions. This completes practical onboarding and offboarding without involving Ivan in ordinary staffing changes.
3. Exercise the flow with two admins and real role-limited accounts on an isolated customer before releasing the updated extension and API together.
4. Add an optional hosted portal later if admins need to work without installing the extension. Reuse the same domain services with appropriate web sign-in/session protection; do not expose the local seller server. Wix continues to manage billing events, not user authorization.

## Acceptance checks

- An admin adds several employees within purchased capacity; only the approved emails can enter their customer.
- Adding the same email twice, retrying a request, or approving concurrently cannot duplicate identities or exceed caps.
- Wrong Google identity, unapproved domain, or membership in another organization grants no access and does not disclose another customer's roster.
- An employee or manager calling protected routes directly cannot administer users under the default policy.
- Role swaps use final projected counts; invalid or stale bulk updates apply nothing.
- Admin self-demotion behaves predictably; the last active admin cannot be disabled or demoted, including through a batch.
- Deactivation blocks subsequent protected work, preserves history, and permits a seat replacement.
- Over-cap and expired accounts expose only the explicitly allowed recovery operations. Revoked/suspended accounts fail closed.
- Audit history and error messages remain scoped to the acting customer's organization.
- Keyboard navigation, narrow layouts, empty states, loading failures, and accessible role descriptions work in the extension Settings tab.
