import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { reportTargetKeys, verifyReportPolicy } from '../server/report_policy.js';
import { createTiktokTargetResolver } from '../server/integrations/tiktok_targets.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

test('TikTok persisted duplicate protection and historical backfill', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  t.after(() => pool.end());
  await migrateTeamTestDatabase(pool);
  const fixture = await teamFixture(pool);
  const repo = createPostgresRepository({ pool });
  const actor = await repo.requireActiveMember(fixture.identity);
  const video = 'https://www.tiktok.com/@pirate/video/7420000000000000001';
  const nextVideo = video.replace(/1$/, '2');
  const api = {
    fetchConfig: async () => ({ verticals: [{ name: 'Sports' }] }),
    getEventData: async () => ({ eventMap: { final: { name: 'Final' } } }),
    checkIfAuthorized: async () => false,
    resolveTiktokVideoUrl: createTiktokTargetResolver({ fetchImpl: async url => new Response(null, { status: 302, headers: { location: url.includes('NextCode') ? nextVideo : video } }) })
  };
  let serial = 0;
  async function prepare(url) {
    const id = `tiktok-${++serial}`;
    const report = { reportId: id, eventId: id, vertical: 'Sports', eventName: 'Final', handle: 'pirate', items: [{ url, views: '123', screenshotLink: '' }] };
    const policy = await verifyReportPolicy(actor, report, api);
    const pdf = await repo.generateReport(actor, report, async () => new Blob(['%PDF-test'], { type: 'application/pdf' }), policy);
    const pdfUrl = `https://drive.google.com/file/d/${id}/view`;
    await repo.recordUploadedFile(actor, id, 'application/pdf', { id, webViewLink: pdfUrl }, crypto.createHash('sha256').update(Buffer.from(pdf.pdf, 'base64')).digest('hex'));
    return { report, event: { customer_id: actor.customerId, user_id: actor.memberId, event_id: id, event_type: 'report.submitted', occurred_at: Date.now(), attributes: { mode: 'enforcer', platform: 'tiktok', report_id: id, urls: [url], pdf_url: pdfUrl } } };
  }
  const first = await prepare(video);
  await repo.recordEvent(actor, first.event, Date.now());
  for (const url of [video.replace('@pirate', '@renamed'), video.replace('www.', 'm.'), 'https://vm.tiktok.com/ShortCode/']) {
    const attempt = await prepare(url);
    await assert.rejects(repo.recordEvent(actor, attempt.event, Date.now()), { code: 'duplicate_report_target' });
    assert.equal((await pool.query('SELECT 1 FROM customer_events WHERE customer_id=$1 AND event_id=$2', [fixture.id, attempt.event.event_id])).rowCount, 0);
  }
  const distinct = await prepare('https://vt.tiktok.com/NextCode/');
  await repo.recordEvent(actor, distinct.event, Date.now());
  const distinctPolicy = await verifyReportPolicy(actor, distinct.report, api);
  const sameResolved = await prepare(nextVideo);
  await assert.rejects(repo.recordEvent(actor, sameResolved.event, Date.now()), { code: 'duplicate_report_target' });

  // Recreate a pre-upgrade reservation, then run the additive migration again.
  const key = reportTargetKeys(first.report)[0];
  await pool.query('DELETE FROM reported_targets WHERE customer_id=$1 AND target_key=$2', [fixture.id, key.targetKey]);
  const legacyKey = crypto.createHash('sha256').update(video.replace('www.', '')).digest('hex');
  await pool.query('INSERT INTO reported_targets(customer_id,work_key,target_key,report_id) VALUES($1,$2,$3,$4)', [fixture.id, key.workKey, legacyKey, first.report.reportId]);
  const migration = await fs.readFile(new URL('../server/sql/014_tiktok_target_identity.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(migration);
    await client.query(migration); // idempotent when reservations already exist
  } finally { client.release(); }
  const reservations = (await pool.query('SELECT target_key FROM reported_targets WHERE customer_id=$1', [fixture.id])).rows.map(row => row.target_key);
  assert.ok(reservations.includes(legacyKey));
  assert.ok(reservations.includes(key.targetKey));
  assert.ok(reservations.includes(reportTargetKeys(distinct.report, distinctPolicy)[0].targetKey));
  const afterUpgrade = await prepare(video.replace('@pirate', '@after_upgrade'));
  await assert.rejects(repo.recordEvent(actor, afterUpgrade.event, Date.now()), { code: 'duplicate_report_target' });

  // An old accepted short link without a verified snapshot must halt rollout.
  await pool.query("UPDATE generated_reports SET report_data=report_data #- '{policy,tiktokTargets}' WHERE customer_id=$1 AND report_id=$2", [fixture.id, distinct.report.reportId]);
  const blocked = await pool.connect();
  try {
    await assert.rejects(blocked.query(migration), /Historical TikTok targets require identity reconciliation/);
    await blocked.query('ROLLBACK');
    assert.equal((await blocked.query('SELECT count(*)::int AS count FROM reported_targets WHERE customer_id=$1', [fixture.id])).rows[0].count, reservations.length);
  } finally {
    await blocked.query('ROLLBACK');
    blocked.release();
    await pool.query("UPDATE generated_reports SET report_data=jsonb_set(report_data,'{policy}',$3::jsonb) WHERE customer_id=$1 AND report_id=$2", [fixture.id, distinct.report.reportId, distinctPolicy]);
  }
});
