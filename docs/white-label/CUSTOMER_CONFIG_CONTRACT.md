# Customer configuration contract

## Runtime API

The canonical contract is implemented in `utils/customer_config.js`. All customer configuration must pass through `validateCustomerConfig()`, `resolveCustomerConfig()`, or `resolveCustomerConfigFromSheetRow()` before storage or use.

`services/customer_config_service.js` stores only validated canonical objects under `validated_customer_config_v1`. The background action `getCustomerConfig` returns the stored canonical configuration or the neutral fallback. There is intentionally no runtime message that allows a page or content script to set configuration.

The result shape is:

```js
{
  config: { /* canonical fixed-field object */ },
  source: 'validated-cache' | 'customer' | 'customer-sheet' | 'neutral-fallback',
  usedFallback: true | false,
  errors: [{ path, code, message }]
}
```

## Fixed object shape

```js
{
  schemaVersion: 1,
  customerId: 'customer-slug',
  configVersion: 1,
  product: {
    productName, displayName, shortName, assistantName, tagline
  },
  theme: {
    logoUrl,
    logoAltText,
    colors: {
      primary, primaryHover, accent, onPrimary, background, surface,
      text, muted, border, success, warning, danger
    }
  },
  legal: {
    ownerName, companyName, reportingEmail, secondaryEmail, phone,
    originalWorkUrl
  },
  access: {
    allowedEmailDomains,
    totalUserCap,
    enabledRoles,
    roleSeatCaps: { employee, manager, admin }
  },
  capabilities: {
    enabledPlatforms,
    enabledFeatures
  },
  destinations: {
    driveRootFolderId, reportSpreadsheetId, eventSpreadsheetId
  },
  stats: {
    dashboardId
  }
}
```

Unknown fields at any level invalidate the entire candidate. The runtime receives a newly constructed canonical object rather than the source object, so inherited properties and unsupported values cannot pass through.

## Validation rules

- `schemaVersion` must equal `1`; `configVersion` is a positive integer controlled by the customer configuration publisher.
- `customerId` is a lowercase 1-64 character slug using letters, numbers, `_`, or `-`.
- Product, legal, logo-alt, and phone values are length-limited plain text. HTML delimiters, control characters, and formula-like prefixes are rejected.
- Logo and original-work URLs must be credential-free HTTPS URLs. `javascript:`, `data:`, inline SVG/HTML, and insecure HTTP are rejected.
- Theme colors are limited to the twelve named tokens and six-digit hex values. Raw CSS and arbitrary CSS properties are unsupported.
- Reporting contacts must be valid email addresses. Allowed domains are normalized to lowercase without a leading `@`.
- Enabled platforms must exist in `utils/platform_catalog.js`. `all` is intentionally unsupported so newly added platforms are not enabled automatically.
- Enabled features must be one of `report`, `scoreboard`, `automate`, `intel`, `repair`, `feedback`, `gamification`, `briefing`, or `selector_editor`.
- Enabled roles must be `employee`, `manager`, or `admin`. Admin must be enabled with at least one seat. Disabled roles must have a zero cap, and no role cap may exceed the total user cap.
- Google resource IDs accept only letters, numbers, `_`, and `-`, with a 10-256 character length.
- The statistics dashboard identifier accepts only letters, numbers, `_`, and `-`.

The neutral fallback deliberately enables no users, roles, platforms, features, or external destinations. It supplies safe product names and colors without accidentally granting access or asserting a legal owner.

## Spreadsheet header contract

The customer configuration sheet must use exactly these columns. Matching is case-insensitive and trims repeated whitespace, but unknown, duplicate, or missing headers invalidate the row.

```text
Schema Version
Customer ID
Configuration Version
Product Name
Display Name
Short Name
Assistant Name
Tagline
Logo URL
Logo Alt Text
Theme Primary
Theme Primary Hover
Theme Accent
Theme On Primary
Theme Background
Theme Surface
Theme Text
Theme Muted
Theme Border
Theme Success
Theme Warning
Theme Danger
Legal Owner Name
Legal Company Name
Reporting Email
Secondary Email
Reporting Phone
Original Work URL
Allowed Email Domains
Enabled Platforms
Enabled Features
Total User Cap
Enabled Roles
Employee Seat Cap
Manager Seat Cap
Admin Seat Cap
Drive Root Folder ID
Report Spreadsheet ID
Event Spreadsheet ID
Stats Dashboard ID
```

List cells use comma, semicolon, or newline separators. Spreadsheet rows are converted to a candidate object and then passed through the same strict runtime validator; the sheet adapter cannot bypass validation.

## Neutral fallback

The trusted fallback is exported as `NEUTRAL_CUSTOMER_CONFIG` and mirrored in `docs/white-label/neutral-fallback.theme.json`. It uses **Rights Reporter**, **Reporting Assistant**, and the approved slate/blue semantic color set. It has no legal identity or operational capability until a valid customer configuration is resolved.
