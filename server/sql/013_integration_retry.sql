BEGIN;
-- Keep legacy started receipts ambiguous: the old implementation did not record
-- whether a provider write had begun. They may only be reconciled with evidence.
ALTER TABLE integration_operations DROP CONSTRAINT integration_operations_status_check;
ALTER TABLE integration_operations ADD CONSTRAINT integration_operations_status_check
  CHECK(status IN ('started','preparing','retryable','uncertain','completed'));
ALTER TABLE integration_operations ADD COLUMN attempt_id uuid;
ALTER TABLE integration_operations ADD COLUMN lease_expires_at timestamptz;
COMMIT;
