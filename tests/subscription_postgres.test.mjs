import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { provisionCustomer } from '../server/customer_provisioning.js';
import { applySubscriptionChange, setAdministrativeStatus } from '../server/subscription_service.js';
import { updateCustomer } from '../server/customer_management.js';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { acceptBillingEvent, processBillingEvents, saveBillingMapping } from '../server/billing_service.js';
import { migrateTeamTestDatabase } from './team_fixture.mjs';

test('commercial licensing against isolated Postgres', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true', 'Explicitly confirm that TEST_DATABASE_URL points to an isolated branch.');
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 });
  t.after(() => pool.end());
  await migrateTeamTestDatabase(pool);
  // Reapplying the additive migration must be safe.
  await pool.query(await fs.readFile(new URL('../server/sql/004_customer_subscriptions.sql', import.meta.url), 'utf8'));
  const base = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url), 'utf8'));
  const repository = createPostgresRepository({ pool });
  async function fixture() {
    const id = `test-${crypto.randomUUID().slice(0, 8)}`, config = structuredClone(base);
    config.destinations=Object.fromEntries(Object.keys(config.destinations).map(k=>[k,`${id}_${k}`]));
    config.customerId = id; config.stats.dashboardId = `stats_${id.replaceAll('-', '_')}`;
    config.access.allowedEmailDomains = ['example.test'];
    const email = `${id}@example.test`, subject = `sub-${id}`;
    const initial = await provisionCustomer(pool, { config, initialAdministrator: { name: 'Test Admin', email }, operator: { email: 'seller@example.test' } });
    const identity = { email, subject };
    const input = {
      customerId: id, planKey: 'standard-v1', interval: 'month',
      startsAt: new Date(Date.now() - 86400000).toISOString(), paidThrough: new Date(Date.now() + 86400000).toISOString(),
      paymentKind: 'paid', paymentReference: 'receipt-test', cancelAtPeriodEnd: false,
      totalUserCap: 2, roleSeatCaps: { employee: 2, manager: 1, admin: 1 }, enabledFeatures: config.capabilities.enabledFeatures,
      expectedRevision: 0, expectedConfigVersion: 1, idempotencyKey: crypto.randomUUID(), reason: 'Test initial payment', active: true, operation: 'save'
    };
    return { id, identity, input, initial };
  }
  const apply = input => applySubscriptionChange(pool, input, 'seller@example.test');

  await t.test('new customer provisioning and subscription commit or roll back together', async () => {
    const f = await fixture();
    const config = structuredClone(base); config.customerId = `new-${crypto.randomUUID().slice(0,8)}`;
    config.destinations=Object.fromEntries(Object.keys(config.destinations).map(k=>[k,`${config.customerId}_${k}`]));
    config.access.allowedEmailDomains = ['example.test'];
    const candidate = { config, initialAdministrator: { name: 'New Admin', email: `${config.customerId}@example.test` }, operator: { email: 'seller@example.test' } };
    const subscription = { ...f.input, customerId: config.customerId };
    await assert.rejects(provisionCustomer(pool, candidate, { subscription: { ...subscription, paidThrough: 'invalid' } }), { code: 'invalid_subscription' });
    assert.equal((await pool.query('SELECT customer_id FROM customers WHERE customer_id=$1', [config.customerId])).rows.length, 0);
    const result = await provisionCustomer(pool, candidate, { subscription });
    assert.equal(result.configVersion, 2);
    assert.equal((await pool.query('SELECT revision FROM customer_subscriptions WHERE customer_id=$1', [config.customerId])).rows[0].revision, 1);
  });

  await t.test('licensed PDF generation is scoped, idempotent and denied after expiry; branding remains editable', async () => {
    const f = await fixture(); await apply(f.input);
    const service = createCustomerApiService({ repository, verifyIdentity: async () => f.identity, reportPolicy: async () => ({version:1,platform:'other',multiplier:1}) });
    const body = { protocol_version: 1, operation: 'generate_report', report: { reportId: 'report1', eventId: 'event1', eventName: 'Test Event', vertical: 'Sports', handle: 'test-user', items: [{ url: 'https://example.test/video', screenshotLink: '', views: '10' }] } };
    const result = await service.data({}, structuredClone(body));
    assert.equal(result.customerId, f.id);
    const bytes = Buffer.from(result.pdf, 'base64');
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(await service.data({}, structuredClone(body)), result);
    await assert.rejects(service.data({}, { ...body, report: { ...body.report, eventName: 'Changed' } }), { code: 'report_conflict' });
    await assert.rejects(service.data({}, { ...body, report: { ...body.report, customerId: 'other' } }), { code: 'invalid_request' });
    const customer = (await pool.query('SELECT config FROM customers WHERE customer_id=$1', [f.id])).rows[0];
    customer.config.configVersion = 3; customer.config.product.displayName = 'Updated Test Branding';
    await updateCustomer(pool, { config: customer.config, expectedConfigVersion: 2, operator: { email: 'seller@example.test' } });
    customer.config.configVersion = 4; customer.config.access.totalUserCap = 3;
    await assert.rejects(updateCustomer(pool, { config: customer.config, expectedConfigVersion: 3, operator: { email: 'seller@example.test' } }), { code: 'subscription_managed_fields' });
    await pool.query("UPDATE customer_subscriptions SET starts_at=now()-interval '2 days', paid_through=now()-interval '1 day' WHERE customer_id=$1", [f.id]);
    await assert.rejects(service.data({}, structuredClone(body)), { code: 'subscription_expired' });
  });

  await t.test('missing, future, expired and revoked subscriptions deny API access; cache stops at paid-through', async () => {
    const f = await fixture();
    await assert.rejects(repository.requireActiveMember(f.identity), { code: 'subscription_required' });
    const end = new Date(Date.now() + 60000).toISOString();
    await apply({ ...f.input, paidThrough: end });
    const service = createCustomerApiService({ repository, verifyIdentity: async () => f.identity, reportPolicy: async () => ({version:1,platform:'other',multiplier:1}), allowedExtensionIds: new Set(['test-extension']) });
    const result = await service.bootstrap({}, { protocolVersion: 1, identity: { email: f.identity.email }, extension: { id: 'test-extension', version: '3.3.1' } });
    assert.equal(result.profile.expiresAt, Date.parse(end));
    await pool.query("UPDATE customer_subscriptions SET starts_at=now()+interval '1 day', paid_through=now()+interval '2 days' WHERE customer_id=$1", [f.id]);
    await assert.rejects(repository.requireActiveMember(f.identity), { code: 'subscription_not_started' });
    await pool.query("UPDATE customer_subscriptions SET starts_at=now()-interval '2 days', paid_through=now()-interval '1 day' WHERE customer_id=$1", [f.id]);
    await assert.rejects(repository.requireAdministrator(f.identity), { code: 'subscription_expired' });
    await pool.query("UPDATE customer_subscriptions SET paid_through=now()+interval '1 day', service_status='revoked' WHERE customer_id=$1", [f.id]);
    await assert.rejects(repository.resolveActiveMembership(f.identity), { code: 'subscription_suspended' });
  });
  await t.test('manual renewals are idempotent and stale concurrent changes cannot both commit', async () => {
    const f = await fixture(); const first = await apply(f.input);
    assert.deepEqual(await apply(f.input), first);
    await assert.rejects(apply({ ...f.input, totalUserCap: 3 }), { code: 'idempotency_conflict' });
    const renew = { ...f.input, expectedRevision: 1, expectedConfigVersion: 2, idempotencyKey: crypto.randomUUID(), operation: 'renew' };
    const result = await apply(renew);
    assert.deepEqual(await apply(renew), result);
    assert.ok(Date.parse(result.paidThrough) > Date.parse(first.paidThrough));
    assert.equal(result.totalUserCap, 2);
    const changed = { ...renew, operation: 'save', expectedRevision: 2, expectedConfigVersion: 3 };
    const results = await Promise.allSettled([apply({ ...changed, idempotencyKey: crypto.randomUUID() }), apply({ ...changed, idempotencyKey: crypto.randomUUID() })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'stale_subscription');
  });
  await t.test('concurrent approvals cannot overfill seats; tenant scope and suspension are enforced', async () => {
    const f = await fixture(); await apply(f.input);
    for (const suffix of ['a', 'b']) await pool.query("INSERT INTO customer_memberships(member_id,customer_id,email,name,role,status) VALUES($1,$2,$3,$4,'waiting_approval','pending')", [`${f.id}-${suffix}`, f.id, `${f.id}-${suffix}@example.test`, suffix]);
    const actor = await repository.requireAdministrator(f.identity);
    const results = await Promise.allSettled(['a','b'].map(suffix => repository.mutateMembership(actor, { memberId: `${f.id}-${suffix}`, expectedVersion: 1, action: 'approve', role: 'employee' }, Date.now())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'total_user_cap_exceeded');
    await assert.rejects(repository.mutateMembership(actor, { memberId: actor.memberId, expectedVersion: 1, action: 'disable' }, Date.now()), { code: 'final_admin_required' });
    const service = createCustomerApiService({ repository, verifyIdentity: async () => f.identity, reportPolicy: async () => ({version:1,platform:'other',multiplier:1}) });
    await assert.rejects(service.data({}, { protocol_version: 1, operation: 'query_statistics', customer_id: 'other', user_id: actor.memberId, query_type: 'scoreboard', query: { dashboard_id: actor.customerConfig.stats.dashboardId, period: 'current_month' } }), { code: 'scope_mismatch' });
    await pool.query('UPDATE customers SET active=false WHERE customer_id=$1', [f.id]);
    await assert.rejects(repository.recordEvent(actor, { event_id: 'test', event_type: 'report.submitted', occurred_at: Date.now(), attributes: {} }, Date.now()), { code: 'not_a_member' });
  });
  await t.test('billing retries, duplicates, cancellation, older events and suspended customers', async () => {
    const f = await fixture(); await apply(f.input);
    const accountId = `site-${f.id}`, orderId = `order-${f.id}`, planId = `plan-${f.id}`;
    const event = { schemaVersion: 1, eventId: `event-${f.id}`, accountId, orderId, planId, sequence: 2, state: 'paid', periodStart: f.input.startsAt, periodEnd: new Date(Date.now() + 35 * 86400000).toISOString(), paymentReference: 'payment-2', cancelAtPeriodEnd: false };
    await acceptBillingEvent(pool, event); await processBillingEvents(pool);
    const pending = (await pool.query('SELECT status,error_code FROM billing_events WHERE account_id=$1', [accountId])).rows[0];
    assert.equal(pending.status, 'pending'); assert.equal(pending.error_code, 'billing_order_unmapped');
    await saveBillingMapping(pool, { customerId: f.id, accountId, orderId, planId, expectedConfigVersion: 2, planKey: 'standard-v1', interval: 'month' }, 'seller@example.test');
    await pool.query('UPDATE customers SET active=false WHERE customer_id=$1', [f.id]);
    await processBillingEvents(pool);
    const after = (await pool.query('SELECT * FROM customer_subscriptions WHERE customer_id=$1', [f.id])).rows[0];
    assert.equal(after.revision, 2); assert.equal(after.paid_through.toISOString(), event.periodEnd);
    assert.equal((await pool.query('SELECT active FROM customers WHERE customer_id=$1', [f.id])).rows[0].active, false);
    await acceptBillingEvent(pool, event); await processBillingEvents(pool);
    assert.equal((await pool.query('SELECT revision FROM customer_subscriptions WHERE customer_id=$1', [f.id])).rows[0].revision, 2);
    await assert.rejects(acceptBillingEvent(pool, { ...event, sequence: 3 }), { code: 'billing_event_conflict' });
    await acceptBillingEvent(pool, { ...event, eventId: `old-${f.id}`, sequence: 1 });
    await acceptBillingEvent(pool, { ...event, eventId: `cancel-${f.id}`, sequence: 3, state: 'canceled', cancelAtPeriodEnd: true, periodEnd: new Date(Date.now() + 90 * 86400000).toISOString() });
    await processBillingEvents(pool);
    const canceled = (await pool.query('SELECT * FROM customer_subscriptions WHERE customer_id=$1', [f.id])).rows[0];
    assert.equal(canceled.paid_through.toISOString(), event.periodEnd); assert.equal(canceled.cancel_at_period_end, true);
    assert.equal((await pool.query('SELECT status FROM billing_events WHERE event_id=$1', [`old-${f.id}`])).rows[0].status, 'ignored');
  });
  await t.test('paid package reductions restrict access but let the administrator remove excess users', async () => {
    const f = await fixture(); await apply(f.input);
    await pool.query("INSERT INTO customer_memberships(member_id,customer_id,email,name,role,status) VALUES($1,$2,$3,'Manager','manager','active')", [`manager-${f.id}`, f.id, `manager-${f.id}@example.test`]);
    const mapping = { customerId: f.id, accountId: `site-${f.id}`, orderId: `order-${f.id}`, planId: `plan-${f.id}`, expectedConfigVersion: 2, planKey: 'one-user-v1', interval: 'year', package: { totalUserCap: 1, roleSeatCaps: { employee: 0, manager: 0, admin: 1 }, enabledFeatures: ['report'] } };
    await saveBillingMapping(pool, mapping, 'seller@example.test');
    await acceptBillingEvent(pool, { schemaVersion: 1, eventId: `reduce-${f.id}`, accountId: mapping.accountId, orderId: mapping.orderId, planId: mapping.planId, sequence: 1, state: 'paid', periodStart: f.input.startsAt, periodEnd: new Date(Date.now()+365*86400000).toISOString(), paymentReference: 'paid-annual', cancelAtPeriodEnd: false });
    await processBillingEvents(pool);
    await assert.rejects(repository.requireActiveMember(f.identity), { code: 'subscription_over_cap' });
    const limited = await repository.resolveActiveMembership(f.identity); assert.equal(limited.overCap, true);
    const admin = await repository.requireAdministrator(f.identity);
    await repository.mutateMembership(admin, { memberId: `manager-${f.id}`, expectedVersion: 1, action: 'disable' }, Date.now());
    assert.equal((await repository.requireActiveMember(f.identity)).overCap, false);
    const status = { customerId: f.id, active: false, expectedConfigVersion: 3, idempotencyKey: crypto.randomUUID(), reason: 'Seller suspension' };
    assert.deepEqual(await setAdministrativeStatus(pool, status, 'seller@example.test'), await setAdministrativeStatus(pool, status, 'seller@example.test'));
    await assert.rejects(repository.requireActiveMember(f.identity), { code: 'not_a_member' });
  });
});
