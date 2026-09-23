import { getPool } from '../db.js';
import { applyMigrations } from '../migrations.js';
if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required for migrations.');
const pool=getPool({connectionString:process.env.DATABASE_URL_UNPOOLED});
try {
  const count=await applyMigrations(pool,{onApplied:name=>console.log(`Applied ${name}.`)});
  console.log(`Customer API schema verified (${count} migrations).`);
} finally { await pool.end(); }
