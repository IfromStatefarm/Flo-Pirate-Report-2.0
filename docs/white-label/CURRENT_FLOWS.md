# Current report and statistics flows

## System boundaries

The extension is a Manifest V3 application with a module service worker. The main runtime boundaries are:

```text
Page content scripts / side panel / popup / options
                |
                | chrome.runtime messages
                v
background/main.js authorization + action router
                |
                +-- services/customer_bootstrap_service.js --> customer membership API
                +-- services/customer_data_service.js ------> normalized event/statistics API
                +-- background/services/* -------> Chrome tabs, reporting sites
                +-- utils/google_api.js ----------> Google Drive + Sheets
                +-- utils/idb_storage.js ---------> local screenshot blobs
```

The verified access profile contains stable `customerId` and `userId` values plus a configuration version. Every normalized reporting/activity event receives those identifiers and a unique `eventId`. Scoreboard and intelligence requests and responses repeat the verified customer/user/dashboard scope.

## Authentication and authorization

1. UI surfaces request `getAccessProfile`; an explicit Settings action can call `bootstrapCustomerAccess`.
2. `background/main.js` delegates to `services/customer_bootstrap_service.js`.
3. The service obtains a Google OAuth token and current Google email, then posts them to the packaged credential-free HTTPS endpoint.
4. The server verifies the token and must resolve exactly one active customer membership.
5. `utils/access_control.js` validates the fixed profile, limits its lifetime to fifteen minutes, and intersects API permissions with the retained Employee, Manager, or Admin permission matrix.
6. Only validated profiles enter `chrome.storage.local`. An expired last-known-good profile is display-only, while authoritative membership denial immediately blocks it.
7. `background/main.js` applies an action policy before dispatching protected messages. Platform-scoped actions derive platforms from request fields, URLs, and sometimes the entire local queue.
8. UI permission checks hide/disable features, while background checks provide the authorization boundary.

Validated customer integration destinations are copied into `chrome.storage.sync` for legacy UI compatibility, while reporting, automation, event lookup, and Drive code receives destinations directly from the verified profile. A change of customer or user clears queued reporting data and active search state.

## Configuration flow

1. `utils/google_api.js::fetchConfig()` loads bundled `events_config.json` as defaults.
2. If `piracy_folder_id` exists, it searches that Drive folder for another file named `events_config.json`.
3. Remote values recursively override bundled object defaults; arrays are replaced as units.
4. Side panel, scanner, scrapers, autofill, briefing content, authorized handles, and selector repair consume that merged object.
5. Manager/admin edits update the Drive JSON directly. ETags and retry logic reduce lost updates.

This is a global/per-user-resource configuration model. It does not validate a tenant/customer schema, version, logo origin, legal completeness, or cross-customer ownership.

## Report capture and queue flow

### Acquisition

1. Content scripts run on supported social/video sites and use the platform registry plus platform scrapers to extract URL, handle, views, profile URL, content type, and related evidence.
2. `processNewItem` checks the verified customer's event sheet `Handles White List`. A match writes a normalized `report.whitelist_penalty` API event instead of adding the item normally.
3. `addToCart` or `processNewItem` captures the visible tab when possible, stores the image in IndexedDB, and saves queue metadata in `chrome.storage.local.piracy_cart`.
4. Queue uniqueness is URL-based. Each accepted addition also writes an `activity.item_added` event containing customer, user, and event IDs.

### Side-panel start

1. The user supplies reporter, vertical, event, source URL, report mode, and screenshot preference.
2. The side panel validates role, assigned platforms, and special enforcer account/session allowlists.
3. Scout mode sends `processQueue` directly to the background.
4. Enforcer mode normally opens a platform report surface so `content_autofill.js` can guide or fill the third-party form. Rumble, Kick, Facebook, and Twitch have specialized branches.
5. Reporter context is saved in local storage for content scripts.

### Background processing

1. `background/main.js` authorizes the message through `ACTION_ACCESS_POLICIES` and rejects unassigned platforms.
2. `background/services/reporting_workflow.js::handleBatchReport()` reads the local queue and refreshes missing TikTok views. Platform wrappers can first capture screenshots or refresh Rumble/Facebook/Twitch metadata.
3. The workflow obtains a Google OAuth token, uses the verified customer's Drive root to create/fetch a yearly report folder and daily screenshot folder, then groups queue items by handle. Twitch separates Live and VOD groups.
4. Screenshots are uploaded to Drive.
5. `utils/pdf_gen.js::generatePDF()` creates one evidence PDF per group, and the PDF is uploaded to the yearly report folder.
6. `report.submitted` and `platform.report_outcome` events are accepted by the customer data API. The server-side projector owns the customer statistics workbook projection.
7. Streak, Double XP, queue-size multiplier, scout points, and enforcer points are calculated locally.
8. Processed queue items and IndexedDB screenshots are cleared; YouTube batches retain items beyond ten for the next run.

## Legacy report projection contract

Existing operational report sheets still use the following positional A-V contract. New statistics are sourced from normalized API events rather than trusting this layout:

| Column | Current value |
| --- | --- |
| A | Report date |
| B | Vertical |
| C | Event |
| D | Platform |
| E | Content type |
| F | Views |
| G | Reporter name |
| H | One or more reported URLs |
| I | Action, normally `DMCA takedown request` |
| J | Status (`Open`, `Reported`, `Investigating`, `Resolved`) |
| K | Report number, channel link, PDF link |
| L | Scout identity/email list |
| M | Enforcer Google email |
| N-S | Currently blank/reserved in normal batch writes |
| T | Scout points |
| U | Enforcer points |
| V | Report ID in new batch writes |

This contract is implicit and referenced by numeric indexes throughout `utils/google_api.js`; there is no schema version or header-based mapping.

## Automation / takedown scanner flow

1. The side panel requests `scanSheetForActiveLinks` to find active links for a platform and add them to the queue, or `triggerCloser` to process report rows directly.
2. `services/sheet_scanner.js` reads column H with rich-text formatting from the report sheet.
3. It ignores configured internal/owned URLs and already-struck links, opens remaining URLs in tabs, and applies platform-specific takedown detection.
4. Every checked platform URL emits `automation.platform_outcome`. Row changes emit `automation.row_status_changed`; runs emit start/completion events. Existing operational sheet formatting/status writes use the verified customer's report-sheet destination.
5. The scanner can add up to 100 active URLs to the local queue and uses three concurrent tab workers for the queue-building scan.

## Scoreboard flow

```text
sidepanel/main.js refreshGamificationStats
  -> getGamificationStats message
  -> background/main.js handleGamificationStats
  -> customer_data_service queryStatistics(profile, scoreboard)
  -> customer-scoped normalized store/materialized metrics
  -> utils/gamification_ui.js renderGamificationStats
```

The server scoreboard query:

- Includes normalized customer events from the requested current-month period.
- Uses stable `user_id` rather than a name/email column as the identity.
- Aggregates scout/enforcer points from normalized event attributes.
- Produces the current user's totals, level labels, top-five lists, overall MVP, and a derived team total.
- Uses fixed thresholds of 501 and 1001 points and a team goal of 1,000.
- Returns a response bound to the requesting customer, user, and configured dashboard.

## Intelligence/statistics flow

```text
sidepanel date range + selected vertical
  -> generateIntelligenceReport message
  -> background permission + assigned-platform filter
  -> customer_data_service queryStatistics(profile, intelligence)
  -> API-enforced customer/platform/date scope
  -> generateIntelligencePDF
  -> verified customer Drive/Tactical Briefings
  -> open uploaded PDF
```

The aggregation produces:

- total reports, resolved reports, URL count, estimated views, and resolution rate;
- platform totals;
- top scouts, enforcers, target handles, and events;
- event views and daily timeline;
- team rows and MVP;
- weighted and unweighted burndown values.

The response customer, user, query type, and dashboard must match the verified request. The PDF and Drive file receive the generated activity event's customer/user/event metadata.

## Historical baseline inconsistencies

These describe the legacy sheet implementation retained for migration. Background statistics no longer invoke that implementation:

1. **Column V has conflicting meanings.** New report rows write `reportId` to V, while intelligence calculations read V as a resolution date for burndown.
2. **Per-user burndown accumulators are absent.** `teamStats` reads `rCount`, `wSum`, `uwCount`, and `uwSum`, but the current aggregation never initializes or updates those fields, so per-user burndown resolves to `N/A`.
3. **Selected vertical is ignored by intelligence aggregation.** It is present in the UI request only.
4. **Scoreboard identity is inconsistent.** Normal report rows put reporter name in G, but the current user's point lookup indexes scout points by normalized email. The locally saved reporter name is used for MVP matching but not for `myStats` lookup.
5. **Customer isolation is resource-based, not row-based.** Statistics read the entire selected A:V report sheet. There is no customer column, customer filter, or signed tenant context.
6. **Sheet schema is positional.** Reordering or inserting columns can silently corrupt calculations.
7. **Date handling is mixed.** Report dates use locale strings, folder dates use UTC ISO dates, leaderboard filtering uses the Chicago calendar month, and general intelligence uses local `Date` parsing.
8. **Direct client writes are authoritative.** Report, access, configuration, score, scanner, and status changes are written directly to Google APIs from the extension; atomic customer caps cannot be enforced by this model.

These issues should be covered by characterization tests before the report schema is migrated.

## State and external destinations

| State/resource | Current use |
| --- | --- |
| `chrome.storage.session` | Legacy login key cleanup only; customer bootstrap does not create a custom login session |
| `chrome.storage.sync` | Drive/report/event IDs, report mode, briefing preferences, beta flag, managed/manual resource state |
| `chrome.storage.local` | Queue, reporter context, last selections, streaks, access-profile cache, UI/onboarding state |
| IndexedDB `PirateReportDB/screenshots` | Base64 screenshot evidence before Drive upload |
| Customer API | Verified identity/profile, normalized events, scoped statistics, membership, permissions, and destinations |
| Report spreadsheet | Customer-routed operational projection/status workspace; no longer the statistics authority |
| Event spreadsheet | Event URLs, allowed handles, rogue-site notes, suggestions |
| Drive root | Verified-customer remote config, evidence folders, report PDFs, and intelligence PDFs with scope metadata |

## Characterization-test seam for the next phase

The least disruptive seam is the existing dependency injection into `createReportingWorkflow()` and `createSheetScanner()`. Tests can replace Google/Chrome dependencies while locking down:

- queue construction and URL deduplication;
- report row A-V generation;
- screenshot/PDF upload ordering;
- platform batch limits and retained queue behavior;
- scoreboard aggregation;
- intelligence filtering and aggregation;
- scanner status/point mutations;
- background permission and platform guards.

Once these behaviors are characterized, customer context and a versioned schema can be added without mixing behavior changes into the white-label extraction.
