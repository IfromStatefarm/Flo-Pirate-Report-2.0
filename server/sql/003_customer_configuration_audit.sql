BEGIN;

CREATE TABLE IF NOT EXISTS customer_configuration_audit (
  audit_id varchar(128) PRIMARY KEY,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL CHECK (action = 'customer_updated'),
  operator_email varchar(254) NOT NULL,
  database_role text NOT NULL DEFAULT current_user,
  before_config_version integer NOT NULL CHECK (before_config_version > 0),
  after_config_version integer NOT NULL CHECK (after_config_version = before_config_version + 1),
  changed_fields text[] NOT NULL,
  request_hash char(64) NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_configuration_audit_customer_time
  ON customer_configuration_audit (customer_id, occurred_at DESC);

COMMIT;
