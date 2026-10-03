# YouTube target-account protection

Report generation resolves each supported YouTube target through the server's YouTube Data API client. Video ownership comes from `videos.list` → `snippet.channelId`; a submitted account is resolved with `channels.list`. Every item must belong to that account and must be absent from the customer's protected-account list. Successful policies store the channel IDs alongside the report. The client cannot provide these IDs as policy evidence.

Watch, youtu.be, shorts, live, and embed video URLs are supported, along with exact handle, channel-ID and legacy username account URLs. Unsupported or ambiguous routes, missing/private/deleted videos, unavailable provider access, conflicting accounts and incomplete responses block generation. Requests use fixed provider endpoints, reject redirects and time out after 20 seconds. No target URL is fetched directly.

## Deployment requirements

1. Enable YouTube Data API v3 and configure the server-only `YOUTUBE_DATA_API_KEY`, restricted to that API. If no key is configured, lookups use the customer Google connector token, which must have YouTube read access. Drive/Sheets-only credentials may be insufficient. Do not put this key in extension configuration.
2. In each customer's `Handles White List` sheet, replace nonempty YouTube entries in column F with the verified, case-sensitive `UC…` channel ID or its `https://www.youtube.com/channel/UC…` URL. Verify the intended channel before replacing an old handle; do not infer historical ownership from a possibly reassigned handle.
3. A legacy handle, custom channel URL or malformed nonempty entry blocks YouTube reports until corrected. This is intentional: resolving protected handles on every report would transfer protection when a handle is reassigned. Empty YouTube cells do not add protected accounts.

These changes require no database migration. Existing stored reports are not retroactively reverified. Other platforms retain their existing handle-based checks and still need provider-specific identity resolution. Provider calls are mocked in the regression suite; live connector access and customer sheet conversion must be verified before rollout.

Provider contracts: [videos.list](https://developers.google.com/youtube/v3/docs/videos/list) and [channels.list](https://developers.google.com/youtube/v3/docs/channels/list).

## Regression coverage

`tests/youtube_accounts.test.mjs` exercises the real policy, Google adapter and owner resolver with synthetic provider responses: opaque URLs plus invented handles, protected and renamed owners, legacy protection entries, mismatched handles, mixed-owner batches, unavailable providers, spoofed URLs, and rejection before report persistence/rendering. `tests/google_operations.test.mjs` retains catalog, whitelist failure and reward-expiry coverage.


## Enforcer authority and browser session hints

`sidepanel.enforce` is a separate server capability granted to Managers and Admins when the customer's report feature is enabled. Employees keep Scout/report access. Both batch finalization and the legacy `report.submitted` API require the enforcement capability for `mode: enforcer`. The repository rechecks the current role inside the transaction, before replaying stored receipts or writing events/rewards. Invalid or omitted submission modes are rejected. A browser-supplied permissions array cannot grant this capability.

The side panel requires that server-issued capability before inspecting a platform session. The inspection explicitly uses Chrome's `MAIN` execution world and reads only the active YouTube account header or TikTok navigation profile. Handles and account URLs normalize to exact identifiers; YouTube channel IDs preserve case, and Studio manager IDs compare as complete numeric strings. Broad candidate anchors, display labels and serialized page objects are no longer scanned. Custom session selectors no longer widen account collection. TikTok now uses the session check instead of bypassing it. Instagram retains its session-check exemption, but still requires the Enforcer capability.

Page globals and DOM observations are **advisory operator hints**, not authenticated platform-account ownership or server authorization evidence. They are never sent as proof to the API. The server authorizes the verified customer member's role and platform scope; this change does not establish a separate OAuth identity for the currently open YouTube/TikTok browser account. Target ownership remains independently verified by the server's YouTube resolver.

## Deployment and staging checks

- `neon.ts` forwards `YOUTUBE_DATA_API_KEY` only to the `data` function. Bootstrap, membership, billing and health functions do not receive it. Deploy with the staging environment file so Neon sees this variable.
- Run `npm run test:youtube-deployment` to evaluate the actual declaration with synthetic credentials, validate the data function against the installed Neon schema, and check credential forwarding/isolation and owner-lookup failure cases.
- Run `npx playwright install chromium` and `npm run test:chrome` for a real Chrome extension regression. CI runs it as well. The test uses intercepted YouTube fixture pages in a fresh Chrome profile, proves the isolated-world global is absent, and exercises approved/denied sessions with the shipped checker. It does not sign into a live account. `CHROME_TEST_EXECUTABLE` optionally points to an installed Chrome for Testing binary.
- For live read-only verification, set `YOUTUBE_DATA_API_KEY`, `YOUTUBE_SMOKE_VIDEO_URL`, `YOUTUBE_SMOKE_CHANNEL_ID`, and `YOUTUBE_WHITELIST_FILE` in a staging environment file, then run `node --env-file=.env.staging server/scripts/youtube_preflight.mjs`. The expected owner ID must be independently reviewed. The JSON whitelist manifest has the shape `[{"originalAccount":"@reviewed-handle","channelId":"UC…"}]`, with one entry for **every** nonempty converted customer YouTube cell. Export and review the actual customer list; the script does not access or modify the sheet.
- The smoke test uses the production resolver and staging key to check the video owner, existence of each pinned channel ID, and agreement with each original account. A mismatch, malformed/mutable replacement ID, provider failure or missing input fails the run. Matching a handle today does not establish historical ownership; review that evidence before conversion. Preserve case and write only the reviewed stable IDs or `/channel/` URLs into column F.

The smoke command tests provider access from the invoking environment; it does not prove that an already-deployed function received its secret. Run with the deployed staging environment as part of rollout, then exercise a staging report against that function before production promotion. No live staging credentials or reviewed whitelist manifest were available for the local implementation verification.

The customer API rollout fixes the invalid `billing-process` declaration to `billingprocess` (no deployed billing worker existed at inspection). The configuration test now validates the entire Neon declaration, including all function slugs. This does not by itself deploy any function.
