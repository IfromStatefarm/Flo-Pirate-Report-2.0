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
                +-- services/access_registry.js --> Google Sheets access registry
                +-- background/services/* -------> Chrome tabs, reporting sites
                +-- utils/google_api.js ----------> Google Drive + Sheets
                +-- utils/idb_storage.js ---------> local screenshot blobs
```

There is no `customer_id` in the current queue, report rows, statistics calculations, or storage keys. Isolation is indirect: a user profile may replace their configured Drive/report/event IDs, but the application has no first-class customer boundary.

## Authentication and authorization

1. UI surfaces request `getAccessProfile`, commonly with `forceRefresh: true` when opening settings or the side panel.
2. `background/main.js` delegates to `services/access_registry.js`.
3. The registry compares the active Google identity with an extension session stored in `chrome.storage.session`.
4. It reads columns A-M from worksheet `gid=0` of one hardcoded access spreadsheet.
5. `utils/access_control.js` converts the row to a profile and assigns cumulative Waiting Approval, Employee, Manager, or Admin permissions plus platform access.
6. `background/main.js` applies an action policy before dispatching protected messages. Platform-scoped actions derive platforms from request fields, URLs, and sometimes the entire local queue.
7. UI permission checks hide/disable features, while background checks provide the stronger in-extension guard.

The current registry also stores per-user managed Drive root, report sheet, and event sheet IDs. When present, those values are copied into `chrome.storage.sync` and replace manual values.

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
2. `processNewItem` may check the event sheet's `Handles White List` first. A match writes a negative-points penalty row instead of adding the item normally.
3. `addToCart` or `processNewItem` captures the visible tab when possible, stores the image in IndexedDB, and saves queue metadata in `chrome.storage.local.piracy_cart`.
4. Queue uniqueness is URL-based. Items currently contain user/platform/report metadata but no customer identifier or configuration version.

### Side-panel start

1. The user supplies reporter, vertical, event, source URL, report mode, and screenshot preference.
2. The side panel validates role, assigned platforms, and special enforcer account/session allowlists.
3. Scout mode sends `processQueue` directly to the background.
4. Enforcer mode normally opens a platform report surface so `content_autofill.js` can guide or fill the third-party form. Rumble, Kick, Facebook, and Twitch have specialized branches.
5. Reporter context is saved in local storage for content scripts.

### Background processing

1. `background/main.js` authorizes the message through `ACTION_ACCESS_POLICIES` and rejects unassigned platforms.
2. `background/services/reporting_workflow.js::handleBatchReport()` reads the local queue and refreshes missing TikTok views. Platform wrappers can first capture screenshots or refresh Rumble/Facebook/Twitch metadata.
3. The workflow obtains a Google OAuth token, creates/fetches a yearly report folder and daily screenshot folder, then groups queue items by handle. Twitch separates Live and VOD groups.
4. Screenshots are uploaded to Drive.
5. `utils/pdf_gen.js::generatePDF()` creates one evidence PDF per group, and the PDF is uploaded to the yearly report folder.
6. A report row is appended to the report spreadsheet. URL text in column H and the report/channel/PDF text in column K are converted to rich links.
7. Streak, Double XP, queue-size multiplier, scout points, and enforcer points are calculated locally.
8. Processed queue items and IndexedDB screenshots are cleared; YouTube batches retain items beyond ten for the next run.

## Current report row contract

The batch workflow writes the following positional A-V contract:

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
4. Dead links are struck through in column H. If every link is dead, column J is changed to `Resolved` and bonus points are added to column U. Rows with active links are changed to `Investigating`.
5. The scanner can add up to 100 active URLs to the local queue and uses three concurrent tab workers for the queue-building scan.

## Scoreboard flow

```text
sidepanel/main.js refreshGamificationStats
  -> getGamificationStats message
  -> background/main.js handleGamificationStats
  -> utils/google_api.js fetchLeaderboardData
  -> report sheet A:V
  -> utils/gamification_ui.js renderGamificationStats
```

`fetchLeaderboardData()`:

- Includes rows from the current Chicago calendar month.
- Treats column G as the scout identity and column M as the enforcer identity.
- Sums scout points from T and enforcer points from U.
- Produces the current user's totals, level labels, top-five lists, overall MVP, and a derived team total.
- Uses fixed thresholds of 501 and 1001 points and a team goal of 1,000.
- Uses three fixed Drive-hosted celebration videos.

## Intelligence/statistics flow

```text
sidepanel date range + selected vertical
  -> generateIntelligenceReport message
  -> background permission + assigned-platform filter
  -> fetchIntelligenceData(startDate, endDate, allowedPlatforms)
  -> report sheet A:V aggregation
  -> generateIntelligencePDF
  -> Drive/Tactical Briefings
  -> open uploaded PDF
```

The aggregation produces:

- total reports, resolved reports, URL count, estimated views, and resolution rate;
- platform totals;
- top scouts, enforcers, target handles, and events;
- event views and daily timeline;
- team rows and MVP;
- weighted and unweighted burndown values.

The intelligence handler receives the selected vertical but does not pass it to `fetchIntelligenceData()`. The current PDF is therefore date- and platform-filtered, not vertical-filtered.

## Important baseline inconsistencies

These are documented before refactoring so customer work does not accidentally preserve or obscure them:

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
| `chrome.storage.session` | Extension login session |
| `chrome.storage.sync` | Drive/report/event IDs, report mode, briefing preferences, beta flag, managed/manual resource state |
| `chrome.storage.local` | Queue, reporter context, last selections, streaks, access-profile cache, UI/onboarding state |
| IndexedDB `PirateReportDB/screenshots` | Base64 screenshot evidence before Drive upload |
| Access spreadsheet | Users, roles, platforms, password hashes, managed Google resource IDs |
| Report spreadsheet | Operational log, status, evidence links, points, scoreboard, intelligence source |
| Event spreadsheet | Event URLs, allowed handles, rogue-site notes, suggestions |
| Drive root | Remote `events_config.json`, evidence folders, report PDFs, intelligence PDFs |

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
