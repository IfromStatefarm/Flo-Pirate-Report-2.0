BEGIN;
CREATE TABLE IF NOT EXISTS team_change_requests (
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  request_id varchar(128) NOT NULL,
  actor_member_id varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  changes jsonb NOT NULL,
  roster_hash char(64) NOT NULL,
  config_version integer NOT NULL,
  preview jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  PRIMARY KEY (customer_id, request_id),
  FOREIGN KEY (customer_id, actor_member_id) REFERENCES customer_memberships(customer_id, member_id)
);
CREATE INDEX IF NOT EXISTS team_requests_actor_time ON team_change_requests(customer_id, actor_member_id, created_at);
CREATE INDEX IF NOT EXISTS membership_audit_page ON membership_audit(customer_id, occurred_at DESC, audit_id DESC);
COMMIT;
