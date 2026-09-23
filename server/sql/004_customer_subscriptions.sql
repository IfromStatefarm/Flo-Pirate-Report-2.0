BEGIN;

-- No automatic entitlements for existing customers. Assign explicit paid terms
-- in Customer Setup before deploying the new API authorization code.
CREATE TABLE IF NOT EXISTS customer_subscriptions (
  customer_id varchar(64) PRIMARY KEY REFERENCES customers(customer_id) ON DELETE RESTRICT,
  plan_key varchar(80) NOT NULL,
  billing_interval varchar(8) NOT NULL CHECK (billing_interval IN ('month', 'year')),
  starts_at timestamptz NOT NULL,
  paid_through timestamptz NOT NULL CHECK (paid_through > starts_at),
  payment_kind varchar(20) NOT NULL CHECK (payment_kind IN ('paid', 'trial', 'complimentary')),
  service_status varchar(10) NOT NULL DEFAULT 'active' CHECK (service_status IN ('active','paused','revoked')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_audit (
  audit_id varchar(128) PRIMARY KEY,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id),
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  actor varchar(254) NOT NULL,
  reason varchar(500) NOT NULL,
  before_state jsonb,
  after_state jsonb NOT NULL,
  result jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, idempotency_key)
);

-- Trusted order mapping is configured by Ivan, never selected by the webhook.
CREATE TABLE IF NOT EXISTS billing_order_links (
  provider varchar(30) NOT NULL CHECK (provider = 'wix'),
  account_id varchar(128) NOT NULL,
  order_id varchar(128) NOT NULL,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id),
  last_sequence bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(provider, account_id, order_id),
  UNIQUE(customer_id)
);

CREATE TABLE IF NOT EXISTS billing_plan_mappings (
  account_id varchar(128) NOT NULL,
  provider_plan_id varchar(128) NOT NULL,
  package jsonb NOT NULL,
  PRIMARY KEY(account_id, provider_plan_id)
);

CREATE TABLE IF NOT EXISTS billing_events (
  provider varchar(30) NOT NULL,
  account_id varchar(128) NOT NULL,
  event_id varchar(128) NOT NULL,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'ignored', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code varchar(80),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY(provider, account_id, event_id)
);
CREATE INDEX IF NOT EXISTS billing_events_pending ON billing_events(next_attempt_at) WHERE status = 'pending';
COMMIT;
