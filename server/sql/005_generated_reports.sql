BEGIN;
CREATE TABLE IF NOT EXISTS generated_reports (
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id),
  report_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  pdf bytea NOT NULL CHECK(octet_length(pdf) <= 4194304),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,report_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
CREATE INDEX IF NOT EXISTS generated_reports_customer_time ON generated_reports(customer_id,created_at);
COMMIT;
