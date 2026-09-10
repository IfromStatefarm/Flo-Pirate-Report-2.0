import pg from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { ApiError } from './api_error.js';

const { Pool } = pg;
let pool;

export function getPool({ connectionString = process.env.DATABASE_URL } = {}) {
  if (pool) return pool;
  if (!connectionString) throw new ApiError(500, 'configuration_error', 'DATABASE_URL is not configured.');
  pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 20_000 });
  attachDatabasePool(pool, {
    onUnexpectedError(error) {
      console.error('Unexpected PostgreSQL pool error:', error.message);
    }
  });
  return pool;
}

export async function withTransaction(work, { isolation = 'READ COMMITTED', retries = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '40001' && attempt < retries) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}
