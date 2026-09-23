import { getPool } from '../db.js';
import { processBillingEvents } from '../billing_service.js';
const pool = getPool();
try { console.log(await processBillingEvents(pool, { limit: 100 })); }
finally { await pool.end(); }
