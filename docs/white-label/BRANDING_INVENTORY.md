# FloSports and product-specific inventory

## Audit coverage

This inventory covers the non-vendor application files present in the pre-white-label snapshot. `lib/jspdf.umd.min.js`, snapshot artifacts, and this documentation directory were excluded from literal-value scans. Internal `flo-*` DOM IDs and `__flo*` JavaScript globals are recorded as a namespace dependency rather than listing hundreds of individual occurrences.

The distinction used for the refactor is:

- **Customer configuration:** branding, legal identity, contact information, owned domains/handles, help content, and customer resource destinations.
- **Generic product default:** neutral copy and UI tokens used before a customer is resolved.
- **Platform constant:** third-party brand color, reporting endpoint, form selector, or platform batch limit that should not change with the customer skin.
- **Internal compatibility:** implementation names that may remain temporarily because users do not see them.

## Extension package identity

| Value | Current location | Destination |
| --- | --- | --- |
| `FloSports Pirate Reporter` | `manifest.json:3` | Generic packaged name `Rights Reporter`, or build-time override for separate store listings |
| `FloReporter_logo.png` | `manifest.json:50-52`, `sidepanel.html:633` | Replace packaged icon with a neutral mark; customer logo becomes runtime configuration |
| `FloSports Reporter` | `sidepanel.html:633-635` | `productName` / `logo.alt` |
| `Piracy Report Options \| FloSports` | `options.html:6` | Generic document title, then runtime title where supported |
| `Enforcement Center` | `options.html:522`, `clippy.js:83` | Generic settings copy or configurable feature label |
| OAuth client ID `1077684119158-g9a5ov4qpb40nbnc5rec0i9l8dp2i9us.apps.googleusercontent.com` | `manifest.json:33` | Deployment configuration; not a theme value |
| Manifest public key | `manifest.json:5` | Preserve for the existing published-extension identity; separate customer packages require an explicit release strategy |

The manifest icon/name are packaged metadata and cannot be fully reskinned at runtime. The single-extension plan therefore uses a neutral manifest identity.

## Product names and visible voice

| Current value | Locations | Destination |
| --- | --- | --- |
| `FloSports Helper ✥`, `FloSports Wizard ✥` | `content_form.js:107`; `content_autofill.js:1844,1901,2994,3041` | `assistantName` plus generic feature label |
| `PIRATE AI ✥` / `Pirate AI` | `content_scraper.js`, `sidepanel/main.js`, `clippy.js` | Customer-configurable assistant name; neutral fallback `Reporting Assistant` |
| `FloSports Piracy Assistant` | `clippy.js:75` | Customer-configurable onboarding copy |
| `FloSports Event`, `FloSports event`, `FloSports URL` | `sidepanel.html:765,780`; multiple `content_autofill.js` fallbacks | Generic event/source labels, populated from customer legal/source configuration |
| `Flo pirates extension` / repository title | `README.md:1-2` | Development documentation; rename after runtime migration |
| `Pirate Websites`, `Evidence Locker`, `Captain's Log`, `Tactical Briefings` | UI and Google resource code | Product vocabulary configuration; neutral fallbacks should be `Investigations`, `Evidence`, `Activity Log`, and `Intelligence Reports` |

## Visual tokens

The literal scan found 85 occurrences of `#ce0e2d`, plus `#a80b24` and `#b00c26`. These are the Flo red family and must become semantic theme tokens.

| Current token | Locations | Meaning / destination |
| --- | --- | --- |
| `#ce0e2d` | `sidepanel.html`, `options.html`, `popup.html`, `content_autofill.js`, `content_scraper.js`, `popup/main.js`, `options/main.js`, `sidepanel/main.js`, `clippy.js`, `utils/gamification_ui.js` | `colors.primary` or `colors.danger`, depending on use |
| `#a80b24`, `#b00c26` | page CSS | `colors.primaryHover` |
| `--flo-red`, `--flo-red-dark` | `sidepanel.html:8-9`, `options.html` | Rename to `--brand-primary` and `--brand-primary-hover` |
| RGB `(206, 14, 45)` | `utils/pdf_gen.js:79,331,493` | PDF theme primary |
| RGB `(30, 41, 59)` described as FloSports dark | `utils/pdf_gen.js:328` | Neutral PDF/header token, not a named Flo constant |

Colors such as X `#1d9bf0`, Instagram `#c13584`, Facebook `#1877f2`, Twitch `#9146ff`, and TikTok `#fe2c55` are platform identity colors and should remain platform constants. Slate, success, warning, and validation colors should become semantic UI tokens rather than customer data.

## Images and audio

| Asset | Current use | Classification |
| --- | --- | --- |
| `FloReporter_logo.png` | Manifest and side-panel lockup | FloSports-specific; replace with neutral packaged icon and customer logo slot |
| `images/Flopirate hunter.gif` | Options-page decorative animation | Product-theme-specific; optional customer asset or remove from neutral fallback |
| `images/clippy.gif` | Assistant animation | Product-theme-specific |
| `images/clippy smrik.gif` | Success/error assistant states | Product-theme-specific; filename also needs normalization |
| `images/clippy looking.gif` | Loading assistant state | Product-theme-specific |
| `images/clippy starting postion.png` | Default assistant state | Product-theme-specific; filename also needs normalization |
| `jingle.mp3` | Success sound in popup and reporting overlays | Product-theme-specific, optional configured/bundled sound |
| `Piratemusic.mp3` | Options-page music | Product-theme-specific, optional configured/bundled sound |

`utils/clippy_assets.js` also references missing `images/clippy talking.gif`. The future theme loader must validate asset existence and fall back safely.

## Legal identity, contacts, and owned-work copy

These values are customer data and must never remain generic defaults:

| Value | Locations |
| --- | --- |
| Rights owner/company `FloSports` and `FloSports, Inc.` | `content_autofill.js`, `events_config.json`, `utils/pdf_gen.js`, `sidepanel/main.js` |
| Primary email `copyright@flosports.tv` | 12 source occurrences, primarily `content_autofill.js`, `sidepanel/main.js`, and `utils/pdf_gen.js` |
| Secondary/contact email `social@flosports.tv` | 10 source occurrences, primarily `content_autofill.js`, `events_config.json`, `sidepanel/main.js`, and `utils/pdf_gen.js` |
| Alternate email `copyrights@flosports.tv` | `sidepanel/main.js:26,88` |
| Named operator email `ivan.mcclay@flosports.tv` | `sidepanel/main.js:25,88` |
| YouTube owner phone `5122702356` | `content_autofill.js:3365` |
| Original-work URL `https://www.flosports.tv/` | `content_autofill.js:3730`, `events_config.json:364` |
| Signature `Authorized Representative of FloSports` | `utils/pdf_gen.js:235,273` |
| Sign-off `FloSports Anti-Piracy Team` | `sidepanel/main.js:2092` |

Customer-specific legal statements occur in these groups:

- General unauthorized paywalled-broadcast explanation and FloSports ownership/watermark assertion: `content_autofill.js:604-646`, `events_config.json:220,489`.
- Kick email subject, owner representation, infringing-material description, ownership evidence, and source URL label: `content_autofill.js:632-647,2050-2061`; `events_config.json:614,626-630`.
- X/other notice language: `content_autofill.js:4220-4222`; `sidepanel/main.js:2092,2191`.
- Cease-and-desist PDF title, body, demands, representative, and contacts: `utils/pdf_gen.js:192-275`.
- Platform-form default owner/company/contact fields: `content_autofill.js:63-72,159,960,1284,2420,3365-3366,3452,3721-3730,3801` and parallel defaults in `events_config.json`.

Third-party destinations such as `dmca@kick.com` are platform constants, not customer contacts.

## Customer domains, accounts, and protected-source rules

| Value group | Locations | Destination |
| --- | --- | --- |
| Allowed login domain `@flosports.tv` | `utils/extension_constants.js:1` | Customer authentication policy |
| Enforcer emails `social@flosports.tv`, `copyright@flosports.tv`, `copyrights@flosports.tv`, named operator | `sidepanel/main.js:25-26,88` | Customer/platform account policy; remove named-person code default |
| Approved handle `@flosports` | `events_config.json:43`, `sidepanel/main.js:46` | Customer account configuration |
| Approved YouTube channel ID `UCI1KHGC-GuvaOej1qPY7sBA` | `events_config.json:46`, `sidepanel/main.js:49` | Customer account configuration |
| `flosports.tv`, `floracing.tv`, `flosports.net`, `floracing.com`, `flocollege.com`, `flowrestling.org`, `flograppling`, `flocycling`, `flodogs.com` | `content_scraper.js:17-25` | Customer-owned/protected domain list |
| `varsity.com`, `milesplit.com` and Varsity/MileSplit brand references | `content_scraper.js`, `background/main.js`, `background/services/rogue_workflow.js`, legal copy | Customer affiliate/owned-brand configuration |
| Internal/service hosts such as FloSports Okta, KazooHR, HiBob, Lattice, Airbase, Ashby, Zip, and `lom.flosports.net` | `content_scraper.js:17-25`, `background/services/rogue_workflow.js:13-29` | Customer-specific exclusion policy; should not ship as neutral defaults |

`services/sheet_scanner.js:142` recognizes the literal phrase `copyright claim by flosports`; this must be generated from configured rights-owner names or a customer-configured takedown-pattern list.

## Customer links and external resources

| Current resource | Location | Destination |
| --- | --- | --- |
| FloSports Atlassian setup guide | `clippy.js:10,75-83`, `options/main.js:1439` | Customer help URL or generic documentation URL |
| Access workbook `1kp5n1F0cO57P3mbUsgmssXTRIQ3UPdkO6vOKUjV_XvY` | `utils/access_control.js:3`, `ACCESS_CONTROL_OUTLINE.md` | Control-plane configuration, never a hardcoded customer registry |
| Three Drive-hosted celebration videos | `utils/gamification_ui.js:13-15` | Generic/product configuration or customer media configuration |
| Customer source pages detected by `flosports`, `varsity`, `milesplit` substring | `background/main.js:206-213` | Configured owned-source patterns |

## Google Drive and Sheets contract

These names and storage keys currently act as implicit configuration:

| Value | Location / use | Future owner |
| --- | --- | --- |
| `piracy_folder_id` | `chrome.storage.sync`; root for evidence, reports, and configuration | Customer integration profile |
| `piracy_sheet_id` | `chrome.storage.sync`; report log and all statistics | Customer integration profile |
| `event_sheet_id` | `chrome.storage.sync`; events, handles, rogue sites, suggestions | Customer integration profile |
| `Report Submissions and status` | `utils/google_api.js:6`; preferred report tab, with first-tab fallback | Versioned report schema |
| `Handles White List` | `utils/google_api.js:5,325` | Customer authorization/owned-handle dataset |
| `Pirate Websites` | `utils/google_api.js:173`; rogue investigation log | Configured resource name or schema key |
| `Suggestions` | `utils/google_api.js:1445` | Generic feedback dataset |
| `Tactical Briefings` | `background/main.js:317,335` | Configured/generated intelligence folder name |
| `events_config.json` | Bundled fallback and Drive-root override | Versioned customer configuration payload |
| `Foundation Log Sheet`, `Event Config Sheet`, `Google Drive Root Folder` | Options/access UI and access columns H-M | Generic integration labels |

The current access row stores Drive/report/event IDs per user. The white-label model should resolve these once per customer and return them through a customer profile; per-user overrides should be explicit exceptions.

## PDF-specific branding

`utils/pdf_gen.js` has two separately branded outputs:

1. Evidence/report PDFs use Flo red drawing/text constants and customer-specific legal wording.
2. Intelligence briefing PDFs use a dark/red Flo palette and the fixed title `EXECUTIVE INTELLIGENCE BRIEFING`.

Both generators need an explicit theme/legal payload. PDF generation must never silently fall back to FloSports ownership or contact language.

## Internal compatibility namespace

The code uses `flo-*` element IDs, `data-flo-*` attributes, `__floPlatformRegistry`, and `__floLegacyScrapers` extensively. These are not visible customer branding. Renaming them during the first theme refactor would create risk without customer benefit, so they should remain temporarily and be treated as internal compatibility identifiers. Console prefixes such as `PIRATE AI` are visible to developers and should eventually use a generic logger namespace.

## Files requiring a customer-data extraction pass

```text
manifest.json
README.md
ACCESS_CONTROL_OUTLINE.md
sidepanel.html
options.html
popup.html
content_form.js
content_autofill.js
content_scraper.js
clippy.js
events_config.json
background/main.js
background/services/rogue_workflow.js
background/services/search_workflow.js
services/sheet_scanner.js
sidepanel/main.js
options/main.js
popup/main.js
utils/access_control.js
utils/config_manager.js
utils/extension_constants.js
utils/gamification_ui.js
utils/google_api.js
utils/pdf_gen.js
utils/platforms.js
```

Completion of the later extraction can be checked by scanning these files for `FloSports`, `Flo`, `flosports`, `varsity`, `milesplit`, the listed emails, Flo red literals, fixed Google IDs, and Flo-owned URLs. Expected remaining matches should be limited to an explicit FloSports customer fixture/configuration and temporary internal `flo-*` compatibility identifiers.
