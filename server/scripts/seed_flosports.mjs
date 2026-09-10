import fs from 'node:fs/promises';
import { getPool } from '../db.js';
import { validateCustomerConfig } from '../../utils/customer_config.js';

const customer = JSON.parse(await fs.readFile(new URL('../../migrations/flosports/customer.json', import.meta.url), 'utf8'));
const membershipFixture = JSON.parse(await fs.readFile(new URL('../../migrations/flosports/memberships.json', import.meta.url), 'utf8'));
const validation = validateCustomerConfig(customer);
if (!validation.valid) throw new Error(`FloSports config is invalid: ${JSON.stringify(validation.errors)}`);

const initialAdmin = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
if (!initialAdmin) throw new Error('INITIAL_ADMIN_EMAIL is required. Choose an existing FloSports member who should be the first administrator.');
const adminCandidate = membershipFixture.memberships.find((entry) => entry.email.toLowerCase() === initialAdmin);
if (!adminCandidate) throw new Error('INITIAL_ADMIN_EMAIL must match a member in migrations/flosports/memberships.json.');

const pool = getPool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`
    INSERT INTO customers (customer_id, active, config_version, config)
    VALUES ($1, TRUE, $2, $3)
    ON CONFLICT (customer_id) DO UPDATE
      SET active = EXCLUDED.active, config_version = EXCLUDED.config_version,
          config = EXCLUDED.config, updated_at = now()
  `, [customer.customerId, customer.configVersion, customer]);

  for (const entry of membershipFixture.memberships) {
    const role = entry.email.toLowerCase() === initialAdmin ? 'admin' : entry.role;
    const status = entry.email.toLowerCase() === initialAdmin ? 'active' : entry.status;
    const platforms = entry.platformAssignment === 'all_current' ? customer.capabilities.enabledPlatforms : [];
    await client.query(`
      INSERT INTO customer_memberships (member_id, customer_id, email, name, role, status, platforms, version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1)
      ON CONFLICT (member_id) DO UPDATE
        SET email = EXCLUDED.email, name = EXCLUDED.name,
            role = CASE WHEN lower(EXCLUDED.email) = $8 THEN 'admin' ELSE customer_memberships.role END,
            status = CASE WHEN lower(EXCLUDED.email) = $8 THEN 'active' ELSE customer_memberships.status END,
            platforms = EXCLUDED.platforms, updated_at = now()
    `, [entry.memberId, customer.customerId, entry.email.toLowerCase(), entry.name, role, status, platforms, initialAdmin]);
  }

  await client.query('COMMIT');
  console.log(`FloSports seeded. Initial administrator: ${initialAdmin}`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
