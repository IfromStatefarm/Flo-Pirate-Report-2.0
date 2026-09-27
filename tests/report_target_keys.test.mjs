import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { reportTargetKeys, verifyReportPolicy } from '../server/report_policy.js';

const video = 'https://www.tiktok.com/@pirate/video/7420000000000000001';
const report = urls => ({
  vertical: 'Sports', eventName: 'Final', handle: 'pirate',
  items: urls.map(url => ({ url }))
});
const targetKey = url => reportTargetKeys(report([url]))[0].targetKey;

test('TikTok tracking and share parameters use the existing clean video key', () => {
  const expected = crypto.createHash('sha256')
    .update('https://tiktok.com/@pirate/video/7420000000000000001').digest('hex');
  for (const suffix of [
    '', '?utm_source=copy&utm_medium=share', '?utm_source=other',
    '?_t=abc&_r=1', '?is_from_webapp=1&sender_device=pc&web_id=123',
    '?share_item_id=7420000000000000001&lang=en',
    '?_r=1&_t=abc&_t=def#comments', '/?utm_campaign=event'
  ]) {
    assert.equal(targetKey(video + suffix), expected, suffix);
  }
});

test('different TikTok videos and different works remain distinct', () => {
  // Adjacent large IDs must remain strings rather than lose numeric precision.
  assert.notEqual(targetKey(video + '?_r=1'), targetKey(video.replace(/1$/, '2') + '?_r=1'));
  const original = reportTargetKeys(report([video]))[0];
  const otherWork = reportTargetKeys({ ...report([video]), eventName: 'Other final' })[0];
  assert.notEqual(original.workKey, otherWork.workKey);
  assert.equal(original.targetKey, otherWork.targetKey);
});

test('query identity is preserved outside TikTok video paths and domains', () => {
  for (const base of [
    'https://tiktok.com/search',
    'https://tiktok.com/@pirate',
    'https://tiktok.com/@pirate/video/not-an-id',
    'https://tiktok.com/@pirate/video/7420000000000000001/other',
    'https://tiktok.com.example.org/@pirate/video/7420000000000000001',
    'https://nottiktok.com/@pirate/video/7420000000000000001',
    'https://example.org/watch'
  ]) {
    assert.notEqual(targetKey(base + '?id=1'), targetKey(base + '?id=2'), base);
  }
  assert.equal(targetKey('https://youtube.com/watch?v=one&utm_source=share'), targetKey('https://youtu.be/one'));
  assert.notEqual(targetKey('https://youtube.com/watch?v=one'), targetKey('https://youtube.com/watch?v=two'));
});

test('report policy rejects tracked copies before provider calls', async () => {
  const actor = { platforms: ['tiktok'] };
  for (const urls of [[video, video], [video, video + '?_t=abc'], [video + '?_r=1', video + '?_r=2']]) {
    await assert.rejects(verifyReportPolicy(actor, report(urls), {}), { code: 'invalid_report' });
  }
});

test('report policy accepts distinct TikTok videos with tracking parameters', async () => {
  const adapter = {
    fetchConfig: async () => ({ verticals: [{ name: 'Sports' }] }),
    getEventData: async () => ({ eventMap: { final: { name: 'Final' } } }),
    checkIfAuthorized: async () => false
  };
  const result = await verifyReportPolicy({ platforms: ['tiktok'] }, report([
    video + '?_r=1', video.replace(/1$/, '2') + '?_r=1'
  ]), adapter);
  assert.equal(result.platform, 'tiktok');
});
