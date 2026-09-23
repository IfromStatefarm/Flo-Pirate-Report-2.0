BEGIN;
ALTER TABLE customer_events ADD COLUMN IF NOT EXISTS observed_at timestamptz;
CREATE TABLE IF NOT EXISTS reported_targets (
  customer_id varchar(64) NOT NULL,
  work_key char(64) NOT NULL,
  target_key char(64) NOT NULL,
  report_id varchar(128) NOT NULL,
  PRIMARY KEY(customer_id,work_key,target_key),
  FOREIGN KEY(customer_id,report_id) REFERENCES generated_reports(customer_id,report_id)
);
COMMIT;
