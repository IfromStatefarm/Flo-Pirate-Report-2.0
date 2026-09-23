import pg from 'pg';
import { startCustomerSetupServer } from '../customer_setup_web.js';
import { saveLocalSettings } from '../local_credentials.js';

const connectionString = String(process.env.DATABASE_URL_UNPOOLED || '').trim();
if (!connectionString) {
  throw new Error('DATABASE_URL_UNPOOLED is required in .env.local. The setup tool never uses a database credential from the extension.');
}

const { Pool } = pg;
const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 20_000 });
pool.on('error', (error) => console.error('Customer setup database connection error:', error.message));

await pool.query('SELECT 1');
const setup = await startCustomerSetupServer({
  pool,
  persistPassword: hash => saveLocalSettings({ CUSTOMER_SETUP_PASSWORD_HASH: hash, CUSTOMER_SETUP_PASSWORD_MUST_CHANGE: 'false' }),
  operatorEmail: String(process.env.CUSTOMER_SETUP_OPERATOR_EMAIL || '').trim().toLowerCase()
});

console.log(`Customer Setup is ready at ${setup.url}`);
console.log('Keep this terminal open while using the form. Press Control-C when finished.');

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await setup.close().catch(() => {});
  await pool.end().catch(() => {});
}

process.once('SIGINT', async () => {
  await close();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await close();
  process.exit(0);
});
