import { startCustomerSetupServer as start } from '../server/customer_setup_web.js';
import { hashPassword } from '../server/seller_auth.js';
export const password = 'test-seller-password-123';
export const passwordHash = await hashPassword(password);
const sessions = new Map();
export const sessionCookie = url => sessions.get(new URL(url).origin) || '';
export async function startCustomerSetupServer(options = {}) {
  const server = await start({ passwordHash, operatorEmail: 'ivan.mcclay@flosports.tv', ...options });
  const page = await fetch(new URL('/login', server.url));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const login = await fetch(new URL('/login', server.url), {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(server.url).origin, Cookie: page.headers.getSetCookie()[0].split(';')[0] },
    body: new URLSearchParams({ csrf, password })
  });
  if (login.status !== 303) throw new Error('Test seller login failed.');
  sessions.set(new URL(server.url).origin, login.headers.getSetCookie()[0].split(';')[0]);
  return server;
}
export function sellerFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('cookie', `${sessionCookie(url)}; ${headers.get('cookie') || ''}`);
  return fetch(url, { ...options, headers });
}
