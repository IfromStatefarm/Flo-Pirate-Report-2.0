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
