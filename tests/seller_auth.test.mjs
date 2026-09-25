import test from 'node:test';
import assert from 'node:assert/strict';
import { startCustomerSetupServer } from '../server/customer_setup_web.js';
import { password, passwordHash } from './seller_test_helpers.mjs';
import { verifyPassword, hashPassword } from '../server/seller_auth.js';

async function login(server, pwd = password) {
  const response = await fetch(new URL('/login', server.url));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await response.text())[1];
  const icon = await fetch(new URL('/favicon.ico', server.url));
  assert.equal(icon.status, 204);
  assert.equal(icon.headers.get('set-cookie'), null);
  const result = await fetch(new URL('/login', server.url), { method: 'POST', redirect: 'manual', headers: { Origin: new URL(server.url).origin, Cookie: response.headers.getSetCookie()[0].split(';')[0], 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, password: pwd }) });
  return { result, cookie: result.headers.getSetCookie()[0]?.split(';')[0] };
}
test('seller fails closed without credentials and uses salted, bounded password hashes', async () => {
  await assert.rejects(startCustomerSetupServer({ passwordHash: '', operatorEmail: 'seller@example.com' }), /Configure/);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('incorrect', passwordHash), false);
  assert.equal(await verifyPassword('x'.repeat(300), passwordHash), false);
  assert.notEqual(await hashPassword(password), passwordHash);
});
test('seller login gates every customer route, rotates sessions, expires and logs out', async t => {
  let now = Date.now();
  const server = await startCustomerSetupServer({ port: 0, passwordHash, operatorEmail: 'seller@example.com', now: () => now });
  t.after(() => server.close());
  for (const path of ['/', '/customers', '/customers/acme/edit', '/customers/acme/subscription', '/colors.js']) {
    const res = await fetch(new URL(path, server.url), { redirect: 'manual' });
    assert.equal(res.status, 303); assert.equal(res.headers.get('location'), '/login');
  }
  assert.equal((await fetch(new URL('/review', server.url), { method: 'POST' })).status, 401);
  for (const role of ['employee', 'manager', 'admin']) {
    const denied = await fetch(new URL('/review', server.url), { method: 'POST',
      headers: { Authorization: 'Bearer customer-google-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, permissions: ['settings.adminAccess', 'seller.admin'], customerId: 'acme' }) });
    assert.equal(denied.status, 401, `${role} cannot use customer credentials on the seller control plane`);
  }
  assert.equal((await login(server, 'wrong')).result.status, 401);
  const { cookie } = await login(server);
  const res = await fetch(server.url, { headers: { Cookie: cookie } });
  const html = await res.text(); assert.equal(res.status, 200);
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  const foreign = await fetch(new URL('/logout', server.url), { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf }) });
  assert.equal(foreign.status, 403);
  const logout = await fetch(new URL('/logout', server.url), { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: new URL(server.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf }) });
  assert.equal(logout.status, 303);
  assert.equal((await fetch(server.url, { redirect: 'manual', headers: { Cookie: cookie } })).status, 303);
  const other = await login(server); assert.notEqual(other.cookie, cookie);
  now += 31 * 60_000;
  assert.equal((await fetch(server.url, { redirect: 'manual', headers: { Cookie: other.cookie } })).status, 303);
});
test('temporary password forces replacement and throttles unsuccessful sign-ins', async t => {
  let saved;
  const server = await startCustomerSetupServer({ port: 0, passwordHash, operatorEmail: 'seller@example.com', mustChangePassword: true, persistPassword: async hash => { saved = hash; } });
  t.after(() => server.close());
  const { cookie, result } = await login(server);
  assert.equal(result.headers.get('location'), '/password');
  assert.equal((await fetch(new URL('/customers', server.url), { redirect: 'manual', headers: { Cookie: cookie } })).headers.get('location'), '/password');
  const page = await fetch(new URL('/password', server.url), { headers: { Cookie: cookie } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const next = 'replacement-seller-password-123';
  const changed = await fetch(new URL('/password', server.url), { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: new URL(server.url).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, current: password, password: next }) });
  assert.equal(changed.status, 303); assert.ok(await verifyPassword(next, saved));
  for (let i = 0; i < 5; i++) assert.equal((await login(server, password)).result.status, 401);
  assert.equal((await login(server, next)).result.status, 429);
});
