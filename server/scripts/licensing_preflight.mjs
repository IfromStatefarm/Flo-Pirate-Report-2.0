import { getPool } from '../db.js';
const pool = getPool();
try {
  const tables = await pool.query("SELECT to_regclass('customer_subscriptions') AS subscriptions, to_regclass('generated_reports') AS reports");
  if (!tables.rows[0].subscriptions || !tables.rows[0].reports) throw new Error('Commercial licensing migrations are missing. Apply them to the intended database first.');
  const result = await pool.query(`SELECT c.customer_id,c.active,c.config,s.starts_at,s.paid_through,s.service_status,
    (SELECT count(*)::int FROM customer_memberships m WHERE m.customer_id=c.customer_id AND m.status='active') AS users,
    (SELECT jsonb_object_agg(role,used) FROM (SELECT role,count(*)::int AS used FROM customer_memberships m WHERE m.customer_id=c.customer_id AND m.status='active' GROUP BY role) u) AS roles
    FROM customers c LEFT JOIN customer_subscriptions s ON s.customer_id=c.customer_id ORDER BY c.customer_id`);
  let blocked = 0;
  for (const row of result.rows) {
    let status = !row.active ? 'inactive' : !row.starts_at ? 'MISSING TERMS' : row.service_status !== 'active' ? row.service_status.toUpperCase() : row.starts_at > new Date() ? 'FUTURE START' : row.paid_through <= new Date() ? 'EXPIRED' : row.users > row.config.access.totalUserCap || Object.entries(row.roles || {}).some(([role, used]) => used > row.config.access.roleSeatCaps[role]) ? 'OVER CAP' : 'ready';
    if (row.active && status !== 'ready') blocked++;
    console.log(`${row.customer_id}: ${status}`);
  }
  console.log(`${result.rows.length} customers checked; ${blocked} active customers need attention before enforcement.`);
  if (blocked) process.exitCode = 1;
} finally { await pool.end(); }
