# Runtime theme shell

The extension now presents a neutral **Rights Reporter** identity until a short-lived, verified customer profile is available. Customer branding is projected from that fixed profile into a small runtime theme; spreadsheet or API values are never treated as HTML, JavaScript, or CSS.

## Runtime flow

1. `utils/theme_loader.js` immediately applies the packaged neutral theme.
2. It requests `getRuntimeTheme` from the background service without opening an OAuth prompt.
3. The background reads only an unexpired, verified last-known-good customer profile.
4. `utils/runtime_theme.js` projects the approved product, color, logo, and legal fields. Any unavailable, stale, or denied profile produces the neutral theme.
5. The loader updates semantic CSS variables. Only documents belonging to this extension receive automatic text/image rendering and customer identity attributes. It reloads when the access profile, denial state, or image caches change.

The loader is shared by the side panel, options page, popup, manifest content scripts, manually injected content scripts, assistant, and overlays.

## Semantic CSS contract

- `--brand-primary`, `--brand-primary-hover`, `--brand-accent`, `--brand-on-primary`
- `--page-background`, `--surface`, `--surface-subtle`
- `--text-primary`, `--text-muted`
- `--border`, `--border-strong`
- `--status-success`, `--status-warning`, `--status-danger`

Only validated six-digit hexadecimal values from the fixed customer profile can populate these variables.

## Safe text and legal copy

Within extension documents, elements opt into branding text with a fixed `data-theme-text` key. The loader assigns `textContent`; it never injects configured markup. Legal/contact fields are not text tokens. On target websites, the loader never scans page-owned theme attributes or writes customer identity attributes. Overlay code reads branding directly from the isolated content-script API; only the validated color tokens are applied to the host document.

Theme updates use `RightsReporterTheme.subscribe(listener)`, which returns an unsubscribe function, instead of DOM events. The full theme stays in extension JavaScript (the isolated world for content scripts), where reporting consumers can read legal fields explicitly. Legal notices and PDF copy interpolate validated `legal` fields as plain text. Missing customer legal data falls back to generic rights-owner language rather than another customer's details.

## Logos

Remote customer logos must already be approved by configuration validation. The background downloads only PNG, JPEG, WebP, or GIF content up to 1 MB with credentials and referrers omitted. It stores a data URL keyed by customer ID, configuration version, and source URL in `chrome.storage.local`. SVG is intentionally rejected for remote logos. A packaged neutral SVG/PNG mark is always available.

## Reports

Batch PDFs receive the verified customer profile and intelligence PDFs receive the projected runtime theme. Headings, brand color, rights owner, company, and reporting contacts are customer-specific. Report destinations remain customer-scoped through the verified integration IDs established by the bootstrap flow.

## Packaged Chrome identity

The manifest name, toolbar title, and toolbar PNGs are neutral. Runtime customer branding applies inside extension pages and overlays. Separate Chrome Web Store identities would require a later per-customer packaging process.
