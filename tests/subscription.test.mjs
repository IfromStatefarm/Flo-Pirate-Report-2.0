import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { calendarEnd, requireEntitlement } from '../server/subscription_service.js';
import { verifyBillingMessage } from '../server/billing_service.js';
import { handleBilling } from '../server/billing_http.js';
import { createWixBillingBridge } from '../integrations/wix/billing_bridge.mjs';

test('calendar renewals clamp month ends and leap days; access uses an exclusive end', () => {
  assert.equal(calendarEnd('2026-01-31T12:30:00Z', 'month'), '2026-02-28T12:30:00.000Z');
  assert.equal(calendarEnd('2024-02-29T00:00:00Z', 'year'), '2025-02-28T00:00:00.000Z');
  const sub = { starts_at: '2026-09-01T00:00:00Z', paid_through: '2026-10-01T00:00:00Z' };
  const start = Date.parse(sub.starts_at), end = Date.parse(sub.paid_through);
  assert.throws(() => requireEntitlement(null, start), { code: 'subscription_required' });
  assert.throws(() => requireEntitlement(sub, start - 1), { code: 'subscription_not_started' });
  assert.equal(requireEntitlement(sub, start), end);
  assert.equal(requireEntitlement(sub, end - 1), end);
  assert.throws(() => requireEntitlement(sub, end), { code: 'subscription_expired' });
  assert.throws(() => requireEntitlement({ ...sub, service_status: 'revoked' }, start), { code: 'subscription_suspended' });
});

test('Wix bridge rereads the authoritative online order and signs only a verified finite paid cycle', async () => {
  const secret = 'test-only-secret-with-at-least-32-characters';
  let order = { id: 'order1', type: 'ONLINE', status: 'ACTIVE', lastPaymentStatus: 'PAID', updatedDate: '2026-09-18T00:00:00.123456Z', planId: 'plan1', subscriptionId: 'subscription1', currentCycle: { index: 1, startedDate: '2026-09-01T00:00:00Z', endedDate: '2026-10-01T00:00:00Z' } };
  let event, reads = 0;
  const bridge = createWixBillingBridge({ secret, accountId: 'site1', endpoint: 'https://api.example.test/billing', getOrder: async id => { assert.equal(id, 'order1'); reads++; return order; }, fetchImpl: async (_url, request) => {
    event = verifyBillingMessage(request.body, new Headers(request.headers), { secret, accountId: 'site1' });
    return Response.json({ accepted: true }, { status: 202 });
  } });
  await bridge.syncOrder('order1'); assert.equal(reads, 1); assert.equal(event.state, 'paid'); assert.equal(event.sequence, 1789689600123456);
  const eventId = event.eventId;
  await bridge.syncOrder('order1'); assert.equal(event.eventId, eventId);
  order = { ...order, lastPaymentStatus: 'UNPAID' };
  await bridge.syncOrder('order1'); assert.equal(event.state, 'past_due');
  order = { ...order, type: 'OFFLINE' };
  await assert.rejects(bridge.syncOrder('order1'), /online Wix orders/);
  order = { ...order, type: 'ONLINE', lastPaymentStatus: 'PAID', currentCycle: undefined };
  await assert.rejects(bridge.syncOrder('order1'), /finite/);
});
test('billing bridge rejects forged, stale, cross-account, and unexpected messages', async () => {
  const secret = 'test-only-secret-with-at-least-32-characters', now = Date.now();
  const event = { schemaVersion: 1, eventId: 'event1', accountId: 'site1', orderId: 'order1', planId: 'plan1', sequence: 1, state: 'paid', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', paymentReference: 'receipt1', cancelAtPeriodEnd: false };
  const sign = (raw, time = now) => new Headers({ 'x-billing-timestamp': String(time), 'x-billing-signature': crypto.createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex') });
  const raw = JSON.stringify(event), config = { secret, accountId: 'site1', now };
  assert.deepEqual(verifyBillingMessage(raw, sign(raw), config), event);
  assert.throws(() => verifyBillingMessage(raw.replace('receipt1', 'receipt2'), sign(raw), config), { status: 401 });
  assert.throws(() => verifyBillingMessage(raw, sign(raw, now - 301000), config), { status: 401 });
  assert.throws(() => verifyBillingMessage(raw, sign(raw), { ...config, accountId: 'other' }), { status: 400 });
  const forged = JSON.stringify({ ...event, customerId: 'other' });
  assert.throws(() => verifyBillingMessage(forged, sign(forged), config), { status: 400 });
  const result = await handleBilling(new Request('https://test.invalid/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }), { secret, accountId: 'site1', pool: { query: () => assert.fail('unauthorized write') } });
  assert.equal(result.status, 401);
});
