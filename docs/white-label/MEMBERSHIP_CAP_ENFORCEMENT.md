# Customer membership and seat-cap enforcement

## Trust boundary

The extension is an API client, not the authority for membership changes. The packaged `membershipEndpoint` receives a verified Google bearer token and derives the actor from that token. It must never accept an actor email or customer ID as proof of identity, and the mutation body intentionally has no customer field.

The extension implementation is in `services/customer_membership_service.js`. Protected background actions in `background/main.js` require the local administrator permission ceiling before invoking the endpoint. These checks improve usability and reduce accidental calls; the API transaction below remains authoritative.

## Endpoint configuration

`config/customer_bootstrap.json` contains public, credential-free endpoint URLs only:

```json
{
  "schemaVersion": 1,
  "bootstrapEndpoint": "https://api.example.com/v1/extension/bootstrap",
  "membershipEndpoint": "https://api.example.com/v1/extension/memberships",
  "dataEndpoint": "https://api.example.com/v1/extension/data"
}
```

If `membershipEndpoint` is omitted or empty, the extension replaces the final path component of `bootstrapEndpoint` with `memberships`. Both endpoints must use HTTPS. OAuth client secrets, service-account credentials, database credentials, access tokens, and refresh tokens must not be packaged in the extension or stored in a workbook.

## Fixed request contract

Both operations use `POST` and `Authorization: Bearer <Google access token>`.

List request:

```json
{
  "protocolVersion": 1,
  "operation": "list_members",
  "query": "optional name or email search"
}
```

Mutation request:

```json
{
  "protocolVersion": 1,
  "operation": "mutate_membership",
  "mutation": {
    "action": "change_role",
    "memberId": "member_123",
    "expectedVersion": 4,
    "role": "manager"
  }
}
```

Allowed actions are `approve`, `activate`, `reactivate`, `change_role`, and `disable`. The first four require an assignable `role`; `disable` does not accept one. `expectedVersion` provides optimistic concurrency protection. Unknown request fields are rejected, including `customerId`, email, seat totals, arbitrary permissions, platform grants, HTML, JavaScript, and CSS.

## Required server transaction

For every mutation, the API must run one database transaction at `SERIALIZABLE` isolation, or use equivalent customer-scoped locking that prevents write skew:

1. Validate the Google access token server-side and resolve its immutable Google subject and verified email.
2. Select the actor membership and its customer. Require it to be active, in the `admin` role, and associated with exactly one active customer.
3. Lock the customer access-policy row and all active/pending memberships needed for the counts.
4. Select the target by `memberId` **within the actor's resolved customer**. A target outside that customer is indistinguishable from not found. Never update a membership's customer ID in this endpoint.
5. Compare the target version with `expectedVersion`; reject stale writes.
6. Validate the requested state transition and ensure the target role is enabled.
7. Recompute active-user and per-role seat totals from authoritative membership rows while locks are held.
8. For an activation or reactivation, reject when the resulting active-user total exceeds `total_user_cap` or the resulting role count exceeds that role's cap.
9. For an active role change, subtract the old role seat and add the proposed role seat, then reject if the proposed role would exceed its cap.
10. Before disabling or demoting an active administrator, reject if the resulting active-administrator count would be zero.
11. Apply the membership change and increment its version.
12. Insert an immutable audit row in the same transaction.
13. Recompute utilization from the post-change rows, commit, and return the member, audit record, and refreshed totals.

Illustrative transaction shape:

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Derive actor_customer_id from the verified Google subject; never from JSON.
SELECT * FROM customer_memberships
WHERE google_subject = :verified_google_subject AND status = 'active'
FOR UPDATE;

SELECT * FROM customer_access_policies
WHERE customer_id = :actor_customer_id AND active = TRUE
FOR UPDATE;

SELECT * FROM customer_memberships
WHERE customer_id = :actor_customer_id
FOR UPDATE;

-- Verify actor, target/version, transition, both caps, and final-admin invariant.
-- Update target and increment version.
-- Insert audit row with actor subject/email, before/after state, request ID, and time.
-- Return post-change utilization.

COMMIT;
```

The API should retry serialization failures a small bounded number of times and otherwise return a conflict. Counting in a separate query or transaction is unsafe because two administrators could consume the final seat concurrently.

## Success response

List success returns exactly:

```json
{
  "protocolVersion": 1,
  "customerId": "acme-sports",
  "configVersion": 8,
  "members": [
    {
      "memberId": "member_123",
      "email": "person@acme.example",
      "name": "Example Person",
      "role": "employee",
      "status": "active",
      "version": 4
    }
  ],
  "utilization": {
    "activeUsers": { "used": 37, "limit": 50 },
    "roles": {
      "employee": { "used": 30, "limit": 42, "enabled": true },
      "manager": { "used": 5, "limit": 6, "enabled": true },
      "admin": { "used": 2, "limit": 2, "enabled": true }
    }
  }
}
```

Mutation success has the same envelope, with one `member` instead of `members`, plus:

```json
{
  "audit": {
    "auditId": "audit_456",
    "action": "change_role",
    "actorEmail": "admin@acme.example",
    "targetMemberId": "member_123",
    "occurredAt": 1788462000000
  }
}
```

Transition results are fixed: `approve`, `activate`, `reactivate`, and `change_role` produce `active`; `disable` produces `disabled`. `approve` is the pending-member transition, while `activate` applies to a previously approved but inactive member. The returned role must equal the requested role when the action accepts one. The client rejects mismatched customer, target, actor audit, role, status, unknown fields, or malformed totals.

## Error response

Mutation failures return an error and the latest utilization whenever the actor is authorized to see it:

```json
{
  "error": {
    "code": "role_seat_cap_exceeded",
    "message": "Optional server diagnostic",
    "utilization": {
      "activeUsers": { "used": 37, "limit": 50 },
      "roles": {
        "employee": { "used": 30, "limit": 42, "enabled": true },
        "manager": { "used": 5, "limit": 6, "enabled": true },
        "admin": { "used": 2, "limit": 2, "enabled": true }
      }
    }
  }
}
```

Supported codes are `total_user_cap_exceeded`, `role_seat_cap_exceeded`, `final_admin_required`, `cross_customer_forbidden`, `stale_member_version`, `not_authorized`, `member_not_found`, `role_disabled`, `invalid_request`, `identity_error`, and `conflict`. The extension maps these codes to packaged copy rather than rendering server-controlled HTML or arbitrary text.

## Audit minimum

The immutable server audit record should include customer ID, audit ID, request/correlation ID, action, actor Google subject and verified email, target member ID, before/after role and status, before/after version, post-change utilization, timestamp, and a source such as `chrome_extension`. Audit writes and membership writes must commit or roll back together.

## Workbook boundary

A spreadsheet can publish reviewed customer limits into the server's configuration ingestion process, but it is not a transactional membership database. The extension does not read or write membership passwords, OAuth credentials, current seat totals, or authoritative membership state from workbook cells.
