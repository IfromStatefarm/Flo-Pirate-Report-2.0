import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export async function applyMigrations(pool, {directory=new URL('./sql/',import.meta.url), onApplied=()=>{}}={}) {
  const client=await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('rights-reporter-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const files=(await fs.readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
    for(const name of files) {
      const sql=await fs.readFile(new URL(name,directory),'utf8');
      const hash=crypto.createHash('sha256').update(sql).digest('hex');
      const prior=(await client.query('SELECT sha256 FROM schema_migrations WHERE name=$1',[name])).rows[0];
      if(prior) {
        if(prior.sha256!==hash) throw new Error(`Applied migration changed: ${name}. Add a new migration instead.`);
        continue;
      }
      // Each existing file contains one outer transaction. Keep the ledger write
      // in that same transaction so interruption cannot leave an unrecorded success.
      if(!/^\s*BEGIN;/i.test(sql)||!/COMMIT;\s*$/i.test(sql)) throw new Error(`Migration requires one outer transaction: ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(sql.replace(/^\s*BEGIN;/i,'').replace(/COMMIT;\s*$/i,''));
        await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);
        await client.query('COMMIT');
        onApplied(name);
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    }
    return files.length;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('rights-reporter-migrations'))").catch(()=>{});
    client.release();
  }
}
