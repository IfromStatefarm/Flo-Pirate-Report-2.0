import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiktokTargetResolver } from '../server/integrations/tiktok_targets.js';
import { reportTargetKeys, verifyReportPolicy } from '../server/report_policy.js';
import { createGoogleAdapter } from '../server/integrations/google_adapter.js';

const video = 'https://www.tiktok.com/@pirate/video/7420000000000000001';
const share = 'https://vm.tiktok.com/ShortCode/';
const report = urls => ({ vertical: 'Sports', eventName: 'Final', handle: 'pirate', items: urls.map(url => ({ url })) });
const adapter = fetchImpl => ({
  fetchConfig: async () => ({ verticals: [{ name: 'Sports' }] }),
  getEventData: async () => ({ eventMap: { final: { name: 'Final' } } }),
  checkIfAuthorized: async () => false,
  resolveTiktokVideoUrl: createTiktokTargetResolver({ fetchImpl })
});
const redirect = location => new Response(null, { status: 302, headers: { location } });

test('supported share aliases resolve without credentials or automatic redirects', async () => {
  const calls = [];
  const provider = createGoogleAdapter({ token: 'secret-google-token', fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return redirect(calls.length === 1 ? 'https://www.tiktok.com/t/AnotherCode/' : video);
  } });
  assert.equal(await provider.resolveTiktokVideoUrl(share), video);
  assert.deepEqual(calls, [share, 'https://www.tiktok.com/t/AnotherCode/']);
  assert.equal(await provider.resolveTiktokVideoUrl(video), video);
  assert.equal(calls.length, 2);
});

test('resolved aliases are rejected as duplicates and distinct IDs remain distinct after serialization', async () => {
  const api = adapter(async url => redirect(url.includes('OtherCode') ? video.replace(/1$/, '2') : video));
  for (const urls of [[video, share], [share, 'https://vt.tiktok.com/SameCode/'], [share, 'https://www.tiktok.com/t/SameCode/']]) {
    await assert.rejects(verifyReportPolicy({ platforms: ['tiktok'] }, report(urls), api), { code: 'invalid_report' });
  }
  const candidate = report([share, 'https://vt.tiktok.com/OtherCode/']);
  const policy = await verifyReportPolicy({ platforms: ['tiktok'] }, candidate, api);
  const stored = JSON.parse(JSON.stringify({ ...candidate, policy }));
  assert.deepEqual(reportTargetKeys(stored), reportTargetKeys(report([video, video.replace(/1$/, '2')])));
  assert.deepEqual(candidate.items.map(item => item.url), [share, 'https://vt.tiktok.com/OtherCode/']);
  assert.throws(() => reportTargetKeys({ ...stored, items: [{ url: 'https://vt.tiktok.com/Tampered/' }] }), { code: 'target_identity_unverified' });
});

test('client-supplied policy cannot bypass resolution; resolved handle is checked', async () => {
  const candidate = { ...report([share]), policy: { tiktokTargets: [{ sourceUrl: share, resolvedUrl: video }] } };
  await assert.rejects(verifyReportPolicy({ platforms: ['tiktok'] }, candidate, {}), { code: 'target_identity_unverified' });
  const api = adapter(async () => redirect(video.replace('@pirate', '@protected')));
  api.checkIfAuthorized = async (_platform, handle) => handle === 'protected';
  await assert.rejects(verifyReportPolicy({ platforms: ['tiktok'] }, candidate, api), { code: 'authorized_target' });
});

test('unsafe redirect destinations are never fetched', async () => {
  for (const location of [
    'https://127.0.0.1/video/1', 'https://169.254.169.254/latest/meta-data',
    'https://tiktok.com.evil.test/@pirate/video/7420000000000000001',
    'https://evil.test/?next=' + video, 'https://unknown.tiktok.com/ShortCode/',
    'http://www.tiktok.com/t/Code/', 'http://www.tiktok.com/@pirate/video/7420000000000000001',
    'https://user:password@www.tiktok.com/t/Code/', 'https://www.tiktok.com:8443/t/Code/',
    'https://www.tiktok.com/login?share_item_id=7420000000000000001',
    'https://www.tiktok.com/@pirate/video/not-an-id', 'file:///etc/passwd'
  ]) {
    let calls = 0;
    const resolve = createTiktokTargetResolver({ fetchImpl: async () => { calls++; return redirect(location); } });
    await assert.rejects(resolve(share), { code: 'target_identity_unverified' }, location);
    assert.equal(calls, 1, location);
  }
});

test('loops, excessive redirects, missing locations, blocked pages and failures deny identity', async () => {
  for (const mode of ['loop', 'limit', 'missing', 'html', 'error', 'timeout']) {
    let calls = 0;
    const resolve = createTiktokTargetResolver({ fetchImpl: async () => {
      calls++;
      if (mode === 'error' || mode === 'timeout') throw new Error(mode);
      if (mode === 'html') return new Response(`<link rel="canonical" href="${video}">`);
      if (mode === 'missing') return new Response(null, { status: 302 });
      return redirect(mode === 'loop' ? share : `/Next${calls}/`);
    } });
    await assert.rejects(resolve(share), { code: 'target_identity_unverified' });
    assert.equal(calls, mode === 'limit' ? 3 : 1);
  }
});

test('unsupported initial routes and unsafe aliases cause no request', async () => {
  const resolve = createTiktokTargetResolver({ fetchImpl: async () => assert.fail('Unexpected fetch') });
  for (const url of ['http://vm.tiktok.com/Code/', 'https://tiktok.com/login', 'https://evil.test/t/Code/',
    'https://tiktok.com/?share_item_id=7420000000000000001']) {
    await assert.rejects(resolve(url), { code: 'target_identity_unverified' });
  }
});
