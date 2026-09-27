import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createYoutubeAccountResolver, protectedYoutubeChannelId } from '../server/integrations/youtube_accounts.js';
import { createGoogleAdapter } from '../server/integrations/google_adapter.js';
import { verifyReportPolicy } from '../server/report_policy.js';
import { createCustomerApiService } from '../server/customer_api_service.js';

const OWNER = `UC${'a'.repeat(22)}`;
const PROTECTED = `UC${'b'.repeat(22)}`;
const VIDEO = 'abcdefghijk';
const OTHER_VIDEO = 'lmnopqrstuv';
const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const actor = { customerId: config.customerId, memberId: 'operator', role: 'manager', customerConfig: config, platforms: ['youtube'] };
const report = (urls = [`https://youtube.com/watch?v=${VIDEO}`], handle = 'pirate') => ({
  reportId: 'r1', eventId: 'e1', vertical: 'Sports', eventName: 'Final', handle,
  items: urls.map(url => ({ url, views: '0', screenshotLink: '' }))
});

function harness({ owner = OWNER, whitelist = [PROTECTED], channels = { pirate: OWNER }, provider } = {}) {
  const calls = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    if (url.hostname === 'sheets.googleapis.com') return Response.json({ values: whitelist.map(id => ['', '', '', '', id]) });
    assert.equal(url.origin, 'https://www.googleapis.com');
    if (provider) return provider(url, options);
    if (url.pathname.endsWith('/videos')) {
      return Response.json({ items: [{ id: url.searchParams.get('id'), snippet: { channelId: url.searchParams.get('id') === OTHER_VIDEO ? PROTECTED : owner } }] });
    }
    const id = url.searchParams.get('id') || channels[url.searchParams.get('forHandle')];
    return Response.json({ items: id ? [{ id }] : [] });
  };
  const adapter = createGoogleAdapter({ token: 'server-token', integrations: { eventSpreadsheetId: 'customer-sheet' },
    resourceGuard: { authorizeRequest: async url => assert.equal(new URL(url).hostname, 'sheets.googleapis.com') }, fetchImpl });
  adapter.fetchConfig = async () => ({ verticals: [{ name: 'Sports' }] });
  adapter.getEventData = async () => ({ eventMap: { final: { name: 'Final' } } });
  return { adapter, calls, fetchImpl };
}

test('invented handle cannot bypass a protected opaque YouTube owner', async () => {
  const { adapter } = harness({ owner: PROTECTED });
  await assert.rejects(verifyReportPolicy(actor, report(undefined, 'invented-not-whitelisted'), adapter), { code: 'authorized_target' });
});

test('every opaque URL form resolves its actual channel before checking exclusions', async () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${VIDEO}&feature=share`, `https://youtu.be/${VIDEO}?t=3`,
    `https://m.youtube.com/shorts/${VIDEO}`, `https://youtube.com/live/${VIDEO}`, `https://youtube.com/embed/${VIDEO}`
  ]) {
    const { adapter } = harness({ owner: PROTECTED });
    await assert.rejects(verifyReportPolicy(actor, report([url]), adapter), { code: 'authorized_target' });
  }
});

test('verified unprotected owner succeeds and persists resolved channel IDs', async () => {
  const { adapter } = harness();
  const result = await verifyReportPolicy(actor, report(), adapter);
  assert.deepEqual(result.targetAccountIds, [OWNER]);
  assert.equal(await adapter.checkIfAuthorized('youtube', 'pirate'), false);
});

test('account URLs resolve through the provider, including protected renamed handles', async () => {
  for (const url of [`https://youtube.com/@pirate`, `https://youtube.com/channel/${OWNER}`]) {
    const policy = await verifyReportPolicy(actor, report([url], OWNER), harness().adapter);
    assert.deepEqual(policy.targetAccountIds, [OWNER]);
  }
  const { adapter } = harness({ channels: { renamed: PROTECTED } });
  await assert.rejects(verifyReportPolicy(actor, report(['https://youtube.com/@renamed'], 'invented'), adapter), { code: 'authorized_target' });
});

test('invented or conflicting declared accounts and mixed-owner batches fail closed', async () => {
  await assert.rejects(verifyReportPolicy(actor, report(undefined, 'invented'), harness().adapter), { code: 'target_account_unverified' });
  await assert.rejects(verifyReportPolicy(actor, report(undefined, 'other'), harness({ channels: { other: PROTECTED } }).adapter), { code: 'target_account_mismatch' });
  const batch = report([`https://youtube.com/watch?v=${VIDEO}`, `https://youtu.be/${OTHER_VIDEO}`]);
  await assert.rejects(verifyReportPolicy(actor, batch, harness().adapter), { code: 'authorized_target' });
  await assert.rejects(verifyReportPolicy(actor, batch, harness({ whitelist: [] }).adapter), { code: 'target_account_mismatch' });
});

test('renamed protected accounts remain excluded by stable ID; legacy handles require migration', async () => {
  const { adapter } = harness({ owner: PROTECTED, channels: { renamed: PROTECTED }, whitelist: [`https://youtube.com/channel/${PROTECTED}`] });
  await assert.rejects(verifyReportPolicy(actor, report(undefined, 'renamed'), adapter), { code: 'authorized_target' });
  assert.equal(await adapter.checkIfAuthorized('youtube', '@renamed'), true);
  // Even a reassigned old handle cannot silently drop the former owner's protection.
  for (const whitelist of [['@old-handle'], [OWNER, '@old-handle']]) {
    await assert.rejects(verifyReportPolicy(actor, report(), harness({ whitelist }).adapter), { code: 'authorized_accounts_unverified' });
  }
});

test('missing resolver, unavailable/deleted/private targets and malformed provider responses deny', async () => {
  const { adapter } = harness();
  delete adapter.resolveYoutubeTargetAccount;
  await assert.rejects(verifyReportPolicy(actor, report(), adapter), { code: 'target_account_unverified' });
  for (const provider of [
    async () => { throw Error('network failure'); },
    async () => new Response('', { status: 403 }),
    async () => new Response('not JSON'),
    async () => Response.json({ items: [] }),
    async () => Response.json({ items: [null] }),
    async () => Response.json({ items: [{ id: VIDEO }] }),
    async () => Response.json({ items: [{ id: OTHER_VIDEO, snippet: { channelId: OWNER } }] })
  ]) await assert.rejects(verifyReportPolicy(actor, report(), harness({ provider }).adapter), { code: 'target_account_unverified' });
});

test('unrecognized and spoofed target URLs never trigger an arbitrary fetch', async () => {
  let requests = 0;
  const resolver = createYoutubeAccountResolver({ token: 'secret', apiKey: '', fetchImpl: async () => { requests++; throw Error('unexpected fetch'); } });
  for (const url of [
    `https://youtube.com.evil.test/watch?v=${VIDEO}`, `https://youtube.com@evil.test/watch?v=${VIDEO}`,
    `https://evil.youtube.com/watch?v=${VIDEO}`, `https://youtube.com:8443/watch?v=${VIDEO}`,
    `https://youtube.com/watch?v=${VIDEO}&v=${OTHER_VIDEO}`, `https://youtube.com/@pirate?v=${VIDEO}`,
    'https://youtube.com/@bad%2Fhandle', `https://youtu.be/@invented/${VIDEO}`, 'https://youtube.com/watch?v=invalid'
  ]) await assert.rejects(resolver.resolveTargetAccount(url), { code: 'target_account_unverified' });
  assert.equal(requests, 0);
});

test('protected account configuration preserves ID case and rejects mutable or foreign references', () => {
  assert.equal(protectedYoutubeChannelId(OWNER), OWNER);
  assert.equal(protectedYoutubeChannelId(`https://www.youtube.com/channel/${OWNER}`), OWNER);
  for (const value of ['@pirate', `https://evil.test/channel/${OWNER}`, `https://youtu.be/channel/${OWNER}`, `https://youtube.com/@pirate`, '']) {
    assert.throws(() => protectedYoutubeChannelId(value), { code: 'authorized_accounts_unverified' });
  }
});

test('server API never renders or persists a report rejected by target-account policy', async () => {
  const { adapter } = harness({ owner: PROTECTED });
  let generated = 0;
  const service = createCustomerApiService({ verifyIdentity: async () => ({}),
    reportPolicy: (currentActor, candidate) => verifyReportPolicy(currentActor, candidate, adapter),
    repository: { requireActiveMember: async () => actor, generateReport: async () => { generated++; } } });
  await assert.rejects(service.data({}, { protocol_version: 1, operation: 'generate_report', report: report(undefined, 'invented') }), { code: 'authorized_target' });
  assert.equal(generated, 0);
});

test('YouTube API requests use server credentials and fixed read endpoints', async () => {
  for (const apiKey of ['', 'server-api-key']) {
    const resolver = createYoutubeAccountResolver({ token: 'server-token', apiKey, fetchImpl: async (value, options) => {
      const url = new URL(value);
      assert.equal(url.origin, 'https://www.googleapis.com');
      assert.equal(url.pathname, '/youtube/v3/videos');
      assert.equal(url.searchParams.get('id'), VIDEO);
      assert.equal(url.searchParams.get('key'), apiKey || null);
      assert.deepEqual(options.headers, apiKey ? {} : { Authorization: 'Bearer server-token' });
      assert.equal(options.redirect, 'error');
      return Response.json({ items: [{ id: VIDEO, snippet: { channelId: OWNER } }] });
    } });
    assert.equal(await resolver.resolveTargetAccount(`https://youtu.be/${VIDEO}`), OWNER);
  }
});
