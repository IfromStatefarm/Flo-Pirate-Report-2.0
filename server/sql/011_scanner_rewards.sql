BEGIN;
CREATE TABLE IF NOT EXISTS scanner_resolutions (
  customer_id varchar(64) NOT NULL,
  row_key char(64) NOT NULL,
  target_key char(64) NOT NULL,
  platform varchar(64) NOT NULL,
  user_id varchar(128) NOT NULL,
  award_id varchar(128),
  observed_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz,
  PRIMARY KEY(customer_id,row_key,target_key),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
CREATE INDEX IF NOT EXISTS scanner_pending_awards ON scanner_resolutions(customer_id,row_key,award_id) WHERE rewarded_at IS NULL;
COMMIT;
