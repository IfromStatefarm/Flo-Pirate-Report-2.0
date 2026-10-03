# Integration retries and evidence reconciliation

Apply `server/sql/013_integration_retry.sql` through the existing migration runner before deploying this code. No live database or Google mutation is needed to run the mocked regression tests in `tests/integration_journal.test.mjs`.

For the staged operator exercise and its evidence status, see [the operational recovery drill](OPERATIONAL_RECOVERY_DRILL_2026-09-30.md).

The journal retains the original customer, member, request ID and request hash on every retry. It uses these states:

| State | Meaning | Retry behavior |
| --- | --- | --- |
| `preparing` | Callback is validating or reading; no provider write is outstanding. | Reject concurrent attempts with `operation_in_progress`. After a two-minute lease, a new attempt may reclaim it. |
| `retryable` | Callback failed before any possible write, or every dispatched write was definitively rejected. | Retry the exact command and original ID. |
| `uncertain` | At least one write may have taken effect. | Do not dispatch the command again. Verify provider evidence. |
| `completed` | Result is durably recorded. | Replay the result after current authorization/resource checks. |
| `started` | Legacy receipt without a recorded write boundary. | Treat as uncertain; never infer that nothing was written. |

Every admitted attempt has a UUID. Before each mutating Google request, the adapter finishes its resource guard and the journal commits `uncertain` using that UUID. A reclaimed attempt cannot pass this boundary or overwrite the new receipt. Only `preparing` expires: elapsed time never makes an uncertain write safe to repeat.

Explicit HTTP 400, 401, 403, 404, 405, 412, 413, 415, 422 and 429 responses clear uncertainty for that request only. A preceding successful or ambiguous write keeps the operation uncertain. Transport failures, 408/409, 5xx, unreadable successful responses, post-write reads and receipt persistence failures retain uncertainty. See Google's [Drive error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors).

## Reconcile an upload

Send the following to the existing authenticated customer data endpoint, using the **entire original upload command**, including its deterministic request ID:

```json
{
  "protocol_version": 1,
  "operation": "reconcile_google_upload",
  "command": {
    "name": "uploadToDrive",
    "requestId": "original-upload-request-id",
    "args": ["original-folder-id", "original-name.pdf", "original-base64-content", "application/pdf", "original-event-id"]
  }
}
```

There are no caller-supplied customer/member IDs, replacement IDs, receipt URLs, or status overrides. The server resolves current membership and reporting permission, checks the stored owner and request hash in the tenant transaction, then performs read-only Drive verification with that customer's connector.

The search stays within the original issued folder and requires matching customer/member/event properties. New uploads also carry an operation key derived from tenant, member, request ID and request hash. Exactly one file must match the name, MIME type, size and provider SHA-256 checksum. The server rechecks its ancestry and metadata, then records the evidence manifest and completed receipt in one transaction. The checksum and private properties are provided by the [Drive file resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

Legacy receipts can recover an untagged file only when its original customer/member/event properties and all content checks match. An empty search, missing checksum, multiple matches, changed scope or unavailable provider leaves the receipt uncertain. Absence from a search is not proof that a write never occurred. Such cases require provider investigation; this endpoint does not authorize a replacement upload or reset the receipt.

The extension's `uploadToDrive` wrapper preserves its existing deterministic ID. If a retry receives `operation_uncertain`, it calls reconciliation once with the same command. Verified receipts continue the screenshot/report workflow; unresolved receipts still stop it. Other failures are returned normally so the next workflow attempt can retry safely.

Run `node --test tests/integration_journal.test.mjs tests/google_upload_retry.test.mjs` for the mocked end-to-end cases. `tests/operations_postgres.test.mjs` additionally exercises SQL transitions, concurrent reconciliation and stale-attempt fencing when `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=true` point to an isolated test database.
