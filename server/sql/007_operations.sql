BEGIN;
CREATE TABLE IF NOT EXISTS customer_integration_resources (
  provider text NOT NULL CHECK (provider='google'),
  resource_id varchar(256) NOT NULL,
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id),
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,resource_id),
  UNIQUE(customer_id,purpose,resource_id)
);
CREATE TABLE IF NOT EXISTS integration_operations (
  customer_id varchar(64) NOT NULL REFERENCES customers(customer_id),
  operation_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  name varchar(80) NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL CHECK(status IN ('started','completed','uncertain')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(customer_id,operation_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
ALTER TABLE generated_reports ADD COLUMN IF NOT EXISTS report_data jsonb;
ALTER TABLE generated_reports ADD COLUMN IF NOT EXISTS config_version integer;
CREATE UNIQUE INDEX IF NOT EXISTS generated_reports_event_unique ON generated_reports(customer_id,(report_data->>'eventId')) WHERE report_data IS NOT NULL;
CREATE TABLE IF NOT EXISTS report_projection_jobs (
  customer_id varchar(64) NOT NULL,
  report_id varchar(128) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,report_id),
  FOREIGN KEY(customer_id,report_id) REFERENCES generated_reports(customer_id,report_id)
);
CREATE TABLE IF NOT EXISTS integration_uploaded_files (
  customer_id varchar(64) NOT NULL,
  file_id text NOT NULL,
  user_id varchar(128) NOT NULL,
  event_id varchar(128) NOT NULL,
  mime_type text NOT NULL,
  web_url text NOT NULL,
  content_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,file_id),
  FOREIGN KEY(customer_id,user_id) REFERENCES customer_memberships(customer_id,member_id)
);
CREATE INDEX IF NOT EXISTS uploaded_files_event ON integration_uploaded_files(customer_id,user_id,event_id);
-- Reserve configured resources at provisioning/update time, including existing tenants.
-- An existing cross-tenant collision aborts migration; never choose an owner silently.
CREATE OR REPLACE FUNCTION reserve_customer_google_resources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource record; owner_id text;
BEGIN
  FOR resource IN SELECT key, value FROM jsonb_each_text(NEW.config->'destinations') LOOP
    IF resource.value IS NULL OR resource.value = '' THEN CONTINUE; END IF;
    INSERT INTO customer_integration_resources(provider,resource_id,customer_id,purpose)
      VALUES ('google',resource.value,NEW.customer_id,resource.key) ON CONFLICT DO NOTHING;
    SELECT customer_id INTO owner_id FROM customer_integration_resources WHERE provider='google' AND resource_id=resource.value;
    IF owner_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Google resource is already reserved by another customer' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reserve_customer_resources ON customers;
CREATE TRIGGER reserve_customer_resources AFTER INSERT OR UPDATE OF config ON customers
  FOR EACH ROW EXECUTE FUNCTION reserve_customer_google_resources();
UPDATE customers SET config=config;
COMMIT;
