BEGIN;
CREATE TABLE IF NOT EXISTS customer_reward_state (
  customer_id varchar(64) NOT NULL,
  user_id varchar(128) NOT NULL,
  last_report_date date NOT NULL,
  streak_count integer NOT NULL CHECK(streak_count>=1),
  freezes integer NOT NULL CHECK(freezes>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,user_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
CREATE TABLE IF NOT EXISTS report_batches (
  customer_id varchar(64) NOT NULL,
  batch_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,batch_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
COMMIT;
