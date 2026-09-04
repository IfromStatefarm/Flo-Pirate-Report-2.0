# Customer-safe events and statistics

## Runtime boundary

Reporting and activity data now crosses one customer data API boundary implemented by `services/customer_data_service.js`. The extension no longer uses report-workbook rows as the source for scoreboard or intelligence queries.

Every normalized event contains:

```json
{
  "event_id": "event_opaque_id",
  "customer_id": "acme-sports",
  "user_id": "user_123",
  "event_type": "report.submitted",
  "occurred_at": 1788462000000,
  "attributes": {}
}
```

The extension obtains `customer_id` and `user_id` only from a current, verified bootstrap profile. The API must validate the Google bearer token again, derive its own actor and customer scope, and require the supplied identifiers to match. Client identifiers are correlation fields—not authorization evidence.

`config/customer_bootstrap.json` may specify a public, credential-free HTTPS `dataEndpoint`. When empty, the extension replaces the final component of `bootstrapEndpoint` with `data`.

## Normalized event types

Only allowlisted event types and attributes are accepted:

- `activity.item_added`
- `event.source_url_updated`
- `report.whitelist_penalty`
- `report.submitted`
- `report.intelligence_generated`
- `rogue.evidence_logged`
- `automation.scan_started`
- `automation.platform_outcome`
- `automation.row_status_changed`
- `automation.scan_completed`
- `platform.report_outcome`

Unknown attributes, markup, control characters, credential-bearing URLs, malformed IDs, oversized arrays, and unsupported event types are rejected before transmission. Each `event_id` is generated before related PDFs or evidence files are uploaded and is reused in PDF and Drive metadata.

## Event ingestion request

The extension sends `POST <dataEndpoint>` with the Google token in the bearer header:

```json
{
  "protocol_version": 1,
  "operation": "record_event",
  "event": {
    "event_id": "event_123",
    "customer_id": "acme-sports",
    "user_id": "user_123",
    "event_type": "platform.report_outcome",
    "occurred_at": 1788462000000,
    "attributes": {
      "platform": "youtube",
      "outcome": "reported",
      "report_id": "RR_123",
      "source_event_name": "Championship",
      "vertical": "Football",
      "url_count": 3
    }
  }
}
```

The acknowledgement must repeat the exact event/customer/user scope:

```json
{
  "protocol_version": 1,
  "event_id": "event_123",
  "customer_id": "acme-sports",
  "user_id": "user_123",
  "accepted_at": 1788462000100
}
```

Scope mismatches fail closed. The extension retries transient network, rate-limit, and server failures with the same event envelope. The server should make `(customer_id, event_id)` unique and treat a repeated identical event as an idempotent success. A repeated ID with different contents is a conflict.

## Required normalized store

An illustrative relational shape is:

```sql
CREATE TABLE customer_events (
  customer_id text NOT NULL,
  event_id text NOT NULL,
  user_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  attributes jsonb NOT NULL,
  source text NOT NULL DEFAULT 'chrome_extension',
  PRIMARY KEY (customer_id, event_id)
);

CREATE INDEX customer_events_scope_time
  ON customer_events (customer_id, occurred_at DESC);
```

The authenticated customer predicate must be applied by the repository layer or database row-level security, not appended conditionally by a controller. Reads without an authenticated customer scope must be impossible. Foreign keys should bind `user_id` to a membership in the same `customer_id`.

## Statistics queries

Scoreboard and intelligence requests use the same endpoint and include `customer_id`, `user_id`, `dashboard_id`, and a fixed query:

```json
{
  "protocol_version": 1,
  "operation": "query_statistics",
  "customer_id": "acme-sports",
  "user_id": "user_123",
  "query_type": "intelligence",
  "query": {
    "dashboard_id": "stats_acme",
    "start_date": "2026-09-01",
    "end_date": "2026-09-30",
    "platforms": ["youtube", "tiktok"]
  }
}
```

The API derives customer, user permissions, allowed platforms, and dashboard destination from server-side membership/configuration. It intersects requested platforms with the verified assignment and queries only `customer_events.customer_id = authenticated_customer_id`. The response repeats customer, user, dashboard, and query type; the extension rejects any mismatch.

Leaderboard fallback caches are keyed by both customer and user. A bootstrap into a different customer or user clears the cart, rogue evidence state, reporter state, legacy leaderboard cache, and active search session.

## `Stats - <Customer>` workbook projection

The normalized event store is authoritative. A server-side projector updates or periodically regenerates the configured customer statistics workbook:

1. Resolve the customer configuration and destination on the server. Never accept a spreadsheet ID or tab name from an event request.
2. Select events with an unconditional authenticated `customer_id` predicate and a stable watermark.
3. Aggregate the scoreboard and intelligence materialized views.
4. Write only the customer's configured `Stats - <Customer>` tab, using a service identity restricted to that workbook.
5. Store the last projected event/time and make regeneration idempotent.
6. Replace the complete projected range or use atomic staging/swap semantics so users never see a partially mixed refresh.
7. Emit projector audit/health metrics that include customer ID but no cross-customer payload data.

Workbook tabs are read-only projections, not membership registries or sources of truth. A workbook failure can make the projection stale but cannot allow the extension to fall back to another customer's workbook.

## Drive and spreadsheet routing

Report PDFs, evidence images, rogue-site screenshots, intelligence briefings, operational report-sheet scans, event configuration reads/writes, and whitelist reads receive destination IDs from `profile.integrations`. They no longer select these destinations from request payloads. Google Drive files include private `appProperties` for `customer_id`, `user_id`, and `event_id`; generated PDFs carry the same identifiers in document metadata.

The API—not the extension—chooses the statistics workbook projection destination. Direct legacy sheet aggregation functions remain only as migration code and are no longer called by the background statistics handlers.
