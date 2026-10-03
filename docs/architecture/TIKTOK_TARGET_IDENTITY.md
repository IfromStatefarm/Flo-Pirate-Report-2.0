# TikTok target identity

TikTok report targets use SHA-256 of `tiktok:<video ID>`. IDs are positive decimal uint64 strings, with no leading zeroes or numeric coercion. Handles, supported hosts, tracking queries, fragments and trailing slashes do not change the identity. This is syntactic content identity, not proof that the video exists or that the declared account owns it. TikTok documents the post ID in the video path in its [Embed Player reference](https://developers.tiktok.com/docs/en/embed-player).

Supported hosts are `tiktok.com`, `www.tiktok.com`, `m.tiktok.com`, `vm.tiktok.com` and `vt.tiktok.com`. Recognized paths are `/@handle/video/<ID>`, `/share/video/<ID>`, `/embed/v2/<ID>` and `/player/v1/<ID>`. TikTok profiles, live-account routes and other unsupported targets now return `target_identity_unverified` rather than receiving a mutable URL identity.

HTTPS short links on `vm`/`vt` and `/t/<code>` links resolve through at most three manually checked redirects within an eight-second timeout. Each fetched URL must be an approved share route on those exact hosts. Redirects may terminate only at a supported HTTPS video URL. No Google authorization, cookies, arbitrary destinations, HTML canonical hints or query-supplied IDs are used. Provider blocking, timeouts and unknown routes fail closed.

The server policy stores source/resolved URL pairs, preserving submitted evidence URLs and PDF/idempotency behavior. The report ledger consumes that stored policy without resolving the short link again. The request contract does not allow callers to submit this policy. Both declared and resolved URL handles receive the existing authorized-handle check; authoritative TikTok ownership verification remains separate work.

## Rollout and release gates

Pause report writes, apply `014_tiktok_target_identity.sql`, deploy the updated server, then resume writes. The migration adds stable reservations for previously accepted videos and retains existing reservations; it does not alter historical rewards. Running old writers after the backfill would reopen the historical gap. Test on an isolated copy first.

If accepted historical TikTok evidence cannot be normalized offline, the migration aborts. Inspect those stored reports, safely resolve supported shares and persist reviewed source/resolved pairs in their policy, or reconcile unsupported records before retrying. Never delete reservations or skip the backfill to make deployment pass. Previously generated unresolved-share reports need regeneration with a new report ID before acceptance.

Run `node --test tests/report_target_keys.test.mjs tests/tiktok_targets.test.mjs tests/tiktok_targets_postgres.test.mjs`. The last suite requires `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=true`; it checks ledger rejection, different video IDs, and historical-key backfill. The full required-database CI suite must pass before release.

Broader provider canonicalization and non-YouTube ownership remain release gates wherever complete duplicate/reward integrity or verified account ownership is promised.
