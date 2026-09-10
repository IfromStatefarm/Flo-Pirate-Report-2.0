BEGIN;

-- An email identity may belong to only one customer. This keeps bootstrap
-- resolution deterministic before the Google subject is linked on first use.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_email_global_unique
  ON customer_memberships (lower(email));

CREATE TABLE IF NOT EXISTS customer_provisioning_audit (
  audit_id varchar(128) PRIMARY KEY,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL CHECK (action = 'customer_created'),
  operator_email varchar(254) NOT NULL,
  database_role text NOT NULL DEFAULT current_user,
  initial_admin_member_id varchar(128) NOT NULL,
  initial_admin_email varchar(254) NOT NULL,
  config_version integer NOT NULL CHECK (config_version > 0),
  request_hash char(64) NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_provisioning_audit_customer_time
  ON customer_provisioning_audit (customer_id, occurred_at DESC);

COMMIT;
