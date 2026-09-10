BEGIN;

CREATE TABLE IF NOT EXISTS customers (
  customer_id varchar(64) PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  config_version integer NOT NULL CHECK (config_version > 0),
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_memberships (
  member_id varchar(128) PRIMARY KEY,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  google_subject varchar(255),
  email varchar(254) NOT NULL,
  name varchar(120) NOT NULL,
  role varchar(32) NOT NULL CHECK (role IN ('waiting_approval', 'employee', 'manager', 'admin')),
  status varchar(32) NOT NULL CHECK (status IN ('pending', 'approved', 'active', 'disabled')),
  platforms text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, member_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_customer_email_unique
  ON customer_memberships (customer_id, lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS memberships_google_subject_unique
  ON customer_memberships (google_subject)
  WHERE google_subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS memberships_customer_status_role
  ON customer_memberships (customer_id, status, role);

CREATE TABLE IF NOT EXISTS membership_audit (
  audit_id varchar(128) PRIMARY KEY,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  actor_member_id varchar(128) NOT NULL,
  actor_email varchar(254) NOT NULL,
  target_member_id varchar(128) NOT NULL,
  action varchar(32) NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS membership_audit_customer_time
  ON membership_audit (customer_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS customer_events (
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  event_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  event_type varchar(80) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  attributes jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  source varchar(40) NOT NULL DEFAULT 'chrome_extension',
  PRIMARY KEY (customer_id, event_id),
  FOREIGN KEY (customer_id, user_id)
    REFERENCES customer_memberships(customer_id, member_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_events_scope_time
  ON customer_events (customer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS customer_events_scope_type_time
  ON customer_events (customer_id, event_type, occurred_at DESC);

COMMIT;
