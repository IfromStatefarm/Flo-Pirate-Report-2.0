import { getCustomerPool } from '../db.js';
import { withCustomerTransaction } from '../tenant_transaction.js';

// Run with the deployed customer credential, not the migration credential.
const pool=getCustomerPool();
try {
  const login=(await pool.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','rr_private') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_data
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  if(!login || Object.values(login).some(Boolean)) throw Error('Customer login must not be privileged or inherit a schema owner role.');
  await withCustomerTransaction(async client=>{
    const tables=(await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='customer_id')`)).rows;
    if(tables.length!==19 || tables.some(r=>!r.relrowsecurity || !r.relforcerowsecurity)) throw Error('Tenant table policies are missing or disabled.');
    const role=(await client.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user")).rows[0];
    if(Object.values(role).some(Boolean)) throw Error('Customer runtime must not be privileged.');
    if((await client.query('SELECT 1 FROM customer_events LIMIT 1')).rowCount) throw Error('Missing tenant scope must return no rows.');
    const privileges=(await client.query(`SELECT has_table_privilege(current_user,'billing_events','SELECT') AS billing,
      has_table_privilege(current_user,'customers','DELETE') AS deleting,
      has_table_privilege(current_user,'customer_events','TRUNCATE') AS truncating`)).rows[0];
    if(Object.values(privileges).some(Boolean)) throw Error('Customer runtime has forbidden control-plane or destructive privileges.');
  },{pool});
  console.log('Tenant isolation preflight passed: restricted login, forced RLS, no unscoped data or control-plane privileges.');
} finally { await pool.end(); }
