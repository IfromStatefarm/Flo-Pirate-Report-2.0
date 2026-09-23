import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { detectPlatformDetails } from '../utils/platforms.js';
import { effectivePlatforms, requireUrlPlatforms, statisticsPlatforms, authorizeEventPlatforms } from '../server/platform_policy.js';
import { captureForTab, imageStorageKey, belongsToScope, redactObservationUrl } from '../utils/evidence_scope.js';
import { neutralEventConfig } from '../scripts/release_policy.mjs';
import { createCustomerApiService } from '../server/customer_api_service.js';
const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));

test('platform detection uses host boundaries, never URL substrings or credentials', () => {
  for (const url of ['https://youtube.com.evil.test/watch', 'https://evil.test/?next=youtube.com', 'https://youtube.com@evil.test', 'javascript:youtube.com']) assert.equal(detectPlatformDetails(url).key, 'other');
  assert.equal(detectPlatformDetails('https://studio.youtube.com/video').key, 'youtube');
  assert.equal(detectPlatformDetails('https://www.youtube.com./watch').key, 'youtube');
});

test('server platform policy rejects mixed batches, claims, empty-context actors and unrestricted queries', () => {
  const actor = { platforms: ['youtube'] };
  assert.deepEqual(effectivePlatforms(config, ['youtube', 'not_enabled']), ['youtube']);
  assert.deepEqual(statisticsPlatforms(actor, []), ['youtube']);
  for (const urls of [['https://tiktok.com/@a/video/1'], ['https://youtube.com/watch?v=1', 'https://tiktok.com/@a']]) assert.throws(() => requireUrlPlatforms(actor, urls), { code: 'scope_mismatch' });
  assert.throws(() => requireUrlPlatforms(actor, ['https://youtube.com/watch?v=1'], 'tiktok'), { code: 'invalid_event' });
  assert.throws(() => statisticsPlatforms({}, []), { code: 'scope_mismatch' });
  assert.throws(() => authorizeEventPlatforms(actor, { event_type: 'report.submitted', attributes: { scout_points: 999999 } }), { code: 'invalid_event' });
});

test('raw API cannot bypass per-member platforms by omitting query filters', async () => {
  const actor = { customerId: config.customerId, memberId: 'a', role: 'manager', customerConfig: config, platforms: ['youtube'] };
  const queries = [];
  const service = createCustomerApiService({ verifyIdentity: async () => ({}), repository: { requireActiveMember: async () => actor, queryStatistics: async (...args) => { queries.push(args); return {}; } } });
  const body = { protocol_version: 1, operation: 'query_statistics', customer_id: config.customerId, user_id: 'a', query_type: 'intelligence', query: { dashboard_id: config.stats.dashboardId, start_date: '2026-09-01', end_date: '2026-09-30', platforms: [] } };
  await service.data({}, structuredClone(body));
  assert.deepEqual(queries[0][2].platforms, ['youtube']);
  await assert.rejects(service.data({}, { ...body, query: { ...body.query, platforms: ['tiktok'] } }), { code: 'scope_mismatch' });
  await assert.rejects(service.data({}, { ...body, query: { ...body.query, start_date: '2026-02-30' } }), { code: 'invalid_query' });
  assert.equal(queries.length, 1);
});

test('capture cannot substitute another tab or return an image after navigation', async () => {
  const tab = { id: 1, windowId: 2, url: 'https://example.test/', active: true };
  let calls = 0, active = { ...tab };
  const tabs = { get: async () => tab, query: async () => [active], captureVisibleTab: async windowId => { assert.equal(windowId, 2); calls++; return 'image'; } };
  active = { ...tab, id: 3 };
  assert.equal(await captureForTab(tab, { tabs }), null); assert.equal(calls, 0);
  active = tab;
  assert.equal(await captureForTab(tab, { tabs }), 'image');
  tabs.captureVisibleTab = async () => { active = { ...tab, url: 'https://private.test' }; return 'private-image'; };
  assert.equal(await captureForTab(tab, { tabs }), null);
  assert.equal(imageStorageKey('same-image', { customerId: 'a', userId: 'u' }) === imageStorageKey('same-image', { customerId: 'b', userId: 'u' }), false);
  assert.equal(belongsToScope({ customerId: 'a', userId: 'u' }, { customerId: 'b', userId: 'u' }), false);
  assert.equal(redactObservationUrl('https://user:password@media.test/a.m3u8?token=secret#private'), 'https://media.test/a.m3u8');
});

test('neutral release removes nested organization account IDs without changing Flo source', () => {
  const source = { verticals: ['Flo'], platform_selectors: { youtube: { session: { authorized_handles: ['@flo'], authorized_channel_ids: ['private-customer-id'], authorized_studio_manager_ids: ['id'], channel_handle: ['#account'] } } } };
  const release = neutralEventConfig(source);
  assert.deepEqual(release.verticals, []);
  assert.deepEqual(release.platform_selectors.youtube.session.authorized_channel_ids, []);
  assert.deepEqual(release.platform_selectors.youtube.session.channel_handle, ['#account']);
  assert.equal(source.platform_selectors.youtube.session.authorized_channel_ids[0], 'private-customer-id');
});
