import fs from 'node:fs/promises';
import { getPool } from '../db.js';

const sqlDirectory = new URL('../sql/', import.meta.url);
const migrationFiles = (await fs.readdir(sqlDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
  .sort();
const pool = getPool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
});

try {
  for (const migrationFile of migrationFiles) {
    const sql = await fs.readFile(new URL(migrationFile, sqlDirectory), 'utf8');
    await pool.query(sql);
    console.log(`Applied ${migrationFile}.`);
  }
  console.log(`Customer API database migrations completed (${migrationFiles.length}).`);
} finally {
  await pool.end();
}
