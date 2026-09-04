# Customer access bootstrap

## Trust boundary

The extension authenticates with Google OAuth and sends the resulting access token to the packaged HTTPS bootstrap endpoint. The server—not the extension and not a spreadsheet—validates the token, finds active memberships, enforces customer/user/role caps, and returns exactly one short-lived customer profile.

The endpoints are configured in `config/customer_bootstrap.json`. That file may contain only the schema version and public bootstrap, membership, and customer-data endpoint URLs. OAuth secrets, access tokens, service-account material, and other credentials must remain in the server-side secret store and must never be placed in a workbook or extension configuration file.

## Permission matrix

The extension retains the local ceiling in `utils/access_control.js`. A server response may narrow a role by returning fewer permissions, but it cannot grant a permission outside this matrix.

| Area | Employee | Manager | Admin |
| --- | --- | --- | --- |
| Side panel: Report | Yes | Yes | Yes |
| Side panel: Scoreboard | Yes | Yes | Yes |
| Side panel: Automate | No | Yes | Yes |
| Side panel: Intel | No | Yes | Yes |
| Side panel: Repair | No | No | Yes |
| Settings: Core Connectivity | Yes | Yes | Yes |
| Settings: Open Locker | No | Yes | Yes |
| Settings: Feedback Comms | Yes | Yes | Yes |
| Settings: Intelligence & Config Tools | No | Yes | Yes |
| Settings: Configure Briefing Stats | No | Yes | Yes |
| Settings: Edit Briefing Content | No | Yes | Yes |
| Settings: Edit Selector Paths | No | No | Yes |
| Settings: Admin Access Management | No | No | Yes |

## Bootstrap request

The extension performs `POST <bootstrapEndpoint>` with the Google access token in the `Authorization: Bearer` header. The body contains only fixed metadata:

```json
{
  "protocolVersion": 1,
  "identity": { "email": "user@example.com" },
  "extension": { "id": "extension-id", "version": "3.3.1" }
}
```

The email is a matching hint. The server must derive and verify the actual subject and email from the bearer token instead of trusting the request body.

## Bootstrap response

Success returns an envelope with exactly one `profile` object:

```json
{
  "profile": {
    "schemaVersion": 1,
    "customerId": "customer-slug",
    "userId": "user_123",
    "configVersion": 4,
    "email": "user@example.com",
    "name": "Example User",
    "role": "manager",
    "permissions": ["sidepanel.report", "sidepanel.automate"],
    "platforms": ["youtube", "tiktok"],
    "theme": {
      "productName": "Rights Reporter",
      "displayName": "Example Rights Center",
      "shortName": "Reporter",
      "assistantName": "Reporting Assistant",
      "tagline": "Capture evidence, manage reports, and track outcomes.",
      "logoUrl": "https://cdn.example.com/logo.png",
      "logoAltText": "Example",
      "colors": {
        "primary": "#334155",
        "primaryHover": "#1F2937",
        "accent": "#2563EB",
        "onPrimary": "#FFFFFF",
        "background": "#F8FAFC",
        "surface": "#FFFFFF",
        "text": "#111827",
        "muted": "#64748B",
        "border": "#E5E7EB",
        "success": "#166534",
        "warning": "#B45309",
        "danger": "#B91C1C"
      }
    },
    "legal": {
      "ownerName": "Example Sports",
      "companyName": "Example Sports, Inc.",
      "reportingEmail": "rights@example.com",
      "secondaryEmail": "legal@example.com",
      "phone": "555-010-1000",
      "addressLine1": "100 Main Street",
      "city": "Austin",
      "region": "Texas",
      "postalCode": "78701",
      "country": "United States",
      "originalWorkUrl": "https://www.example.com/"
    },
    "integrations": {
      "driveRootFolderId": "driveRoot_12345",
      "reportSpreadsheetId": "reportSheet_12345",
      "eventSpreadsheetId": "eventSheet_12345",
      "statsDashboardId": "stats_customer"
    },
    "issuedAt": 1788462000000,
    "expiresAt": 1788462600000
  }
}
```

The lifetime may not exceed fifteen minutes. All object keys, permission names, platform identifiers, color tokens, URLs, and destination identifiers are allowlisted. Unknown fields or an email mismatch invalidate the response.

## Customer resolution

- No active membership: return HTTP `403` or `404`.
- More than one active customer: return HTTP `409`.
- Invalid or expired Google token: return HTTP `401`.
- Exactly one active membership: return HTTP `200` with one profile.

The server must make membership and seat-cap checks atomically. The client cannot safely enforce organization-wide caps from workbook rows.

## Membership administration

Admins with `settings.adminAccess` can list and mutate members through the customer membership endpoint. The extension accepts only `approve`, `activate`, `reactivate`, `change_role`, and `disable`; it includes the target member's current version and never sends a client-selected customer ID. Every successful response must contain refreshed active-user/per-role utilization and a matching audit record. Cap violations and final-administrator protection return refreshed totals with a stable error code.

The complete endpoint schema and required server transaction are documented in [`docs/white-label/MEMBERSHIP_CAP_ENFORCEMENT.md`](docs/white-label/MEMBERSHIP_CAP_ENFORCEMENT.md).

## Customer data scope

The bootstrap profile includes a stable opaque `userId` in addition to `customerId`. Reporting/activity events and statistics requests repeat both identifiers, but the API derives and verifies the authoritative scope from the Google token. Statistics responses repeat customer, user, and dashboard identifiers and are rejected on any mismatch. See [`docs/white-label/CUSTOMER_DATA_ISOLATION.md`](docs/white-label/CUSTOMER_DATA_ISOLATION.md).

## Cache and fail-closed behavior

Only a validated profile is stored under `customer_access_profile_v1`. An unexpired cached profile remains verified until its server-issued expiry, including during a transient network failure. An authoritative `401`, `403`, `404`, or `409` response records a denial and immediately blocks the cached profile. After expiry, a last-known-good profile may supply display data as `stale`, but `hasPermission()`, `hasPlatformAccess()`, and all protected background handlers reject it. Refresh failures do not erase the last-known-good profile; clearing cached access does.
