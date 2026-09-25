BEGIN;

-- Run as the schema owner, with CREATEROLE. Customer requests always SET LOCAL
-- ROLE to this restricted role; seller/migration/billing connections stay separate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rr_customer_runtime') THEN
    CREATE ROLE rr_customer_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rr_customer_runtime'
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='rr_customer_runtime'::regrole) THEN
    RAISE EXCEPTION 'rr_customer_runtime must be an unprivileged role without memberships';
  END IF;
  EXECUTE format('GRANT rr_customer_runtime TO %I', current_user);
END $$;

CREATE SCHEMA IF NOT EXISTS rr_private;
REVOKE ALL ON SCHEMA rr_private FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, rr_private TO rr_customer_runtime;

-- A global email uniqueness error is an existence oracle for customer admins.
-- Local duplicate protection remains. A linked Google subject still has exactly
-- one owner; unbound ambiguous invitations fail closed during identity resolution.
DROP INDEX IF EXISTS memberships_email_global_unique;

ALTER TABLE customers ADD CONSTRAINT customers_config_identity
  CHECK (config->>'customerId' IS NOT NULL AND config->>'customerId'=customer_id);
ALTER TABLE membership_audit ADD CONSTRAINT membership_audit_actor_scope
  FOREIGN KEY(customer_id,actor_member_id) REFERENCES customer_memberships(customer_id,member_id);
ALTER TABLE membership_audit ADD CONSTRAINT membership_audit_target_scope
  FOREIGN KEY(customer_id,target_member_id) REFERENCES customer_memberships(customer_id,member_id);
ALTER TABLE customer_provisioning_audit ADD CONSTRAINT provisioning_admin_scope
  FOREIGN KEY(customer_id,initial_admin_member_id) REFERENCES customer_memberships(customer_id,member_id);

DO $$
DECLARE table_name text; owner_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers','customer_memberships','membership_audit','customer_events',
    'customer_provisioning_audit','customer_configuration_audit',
    'customer_subscriptions','subscription_audit','billing_order_links',
    'generated_reports','team_change_requests','customer_integration_resources',
    'integration_operations','report_projection_jobs','integration_uploaded_files',
    'reported_targets','customer_reward_state','report_batches','scanner_resolutions'
  ] LOOP
    SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class
      WHERE oid=format('public.%I',table_name)::regclass;
    IF owner_name='rr_customer_runtime' THEN
      RAISE EXCEPTION 'Customer runtime must not own tables';
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON public.%I TO rr_customer_runtime
      USING (customer_id = nullif(current_setting(''rr.customer_id'', true), ''''))
      WITH CHECK (customer_id = nullif(current_setting(''rr.customer_id'', true), ''''))', table_name);
    -- Explicit trusted control-plane exception. Runtime has no membership in it.
    EXECUTE format('CREATE POLICY owner_control_plane ON public.%I TO %I USING (true) WITH CHECK (true)', table_name, owner_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, rr_customer_runtime', table_name);
  END LOOP;
END $$;

GRANT SELECT ON customers, customer_subscriptions, customer_integration_resources TO rr_customer_runtime;
-- SELECT ... FOR UPDATE requires UPDATE privilege on at least one column.
GRANT UPDATE(customer_id) ON customers TO rr_customer_runtime;
GRANT SELECT, INSERT, UPDATE ON customer_memberships, customer_events,
  generated_reports, team_change_requests, integration_operations,
  report_projection_jobs, integration_uploaded_files, reported_targets,
  customer_reward_state, report_batches, scanner_resolutions TO rr_customer_runtime;
GRANT SELECT, INSERT ON membership_audit TO rr_customer_runtime;
-- Customer traffic has no access to billing queues, seller audits, DDL or DELETE.
REVOKE ALL ON billing_events, billing_plan_mappings, schema_migrations FROM PUBLIC, rr_customer_runtime;

CREATE FUNCTION rr_private.resolve_identity(subject text, email_address text)
RETURNS TABLE(membership jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE matches jsonb[] := '{}'; item record;
BEGIN
  PERFORM set_config('rr.customer_id', '', true);
  IF subject IS NULL OR subject='' OR email_address IS NULL OR email_address='' THEN RETURN; END IF;
  FOR item IN
    SELECT to_jsonb(m) || jsonb_build_object('config',c.config,'config_version',c.config_version) AS value
    FROM public.customer_memberships m JOIN public.customers c USING(customer_id)
    WHERE c.active AND m.status='active'
      AND (m.google_subject=subject OR (
        m.google_subject IS NULL AND lower(m.email)=lower(email_address)
        -- Once linked, a Google identity cannot be redirected by another
        -- customer's invitation, even when the original membership is disabled.
        AND NOT EXISTS (SELECT 1 FROM public.customer_memberships linked
          WHERE linked.google_subject=subject OR
            (lower(linked.email)=lower(email_address) AND linked.google_subject IS NOT NULL))
      ))
    ORDER BY m.customer_id, m.member_id
    FOR UPDATE OF m,c
  LOOP
    matches := array_append(matches,item.value);
  END LOOP;
  IF cardinality(matches)=1 AND lower(matches[1]->>'email')=lower(email_address) THEN
    PERFORM set_config('rr.customer_id', matches[1]->>'customer_id', true);
  END IF;
  RETURN QUERY SELECT unnest(matches);
END $$;

-- An ancestry overlap check must see reservations outside the current tenant.
-- Return only a boolean, never resource owners/configuration or provider data.
CREATE FUNCTION rr_private.google_resources_available(resource_ids text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT nullif(current_setting('rr.customer_id',true),'') IS NOT NULL
    AND cardinality(resource_ids) BETWEEN 1 AND 32
    AND NOT EXISTS (SELECT 1 FROM public.customer_integration_resources
      WHERE provider='google' AND resource_id=ANY(resource_ids)
        AND customer_id<>current_setting('rr.customer_id',true));
$$;

REVOKE ALL ON FUNCTION rr_private.resolve_identity(text,text), rr_private.google_resources_available(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rr_private.resolve_identity(text,text), rr_private.google_resources_available(text[]) TO rr_customer_runtime;
ALTER FUNCTION reserve_customer_google_resources() SET search_path = pg_catalog, public;

COMMIT;
