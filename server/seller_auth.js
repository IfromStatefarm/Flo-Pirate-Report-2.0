import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, assert } from './api_error.js';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const HASH = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export async function hashPassword(password) {
  assert(typeof password === 'string' && password.length >= 8 && password.length <= 256, 400, 'invalid_password', 'Use a password between 8 and 256 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$131072$8$1$${salt}$${digest.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const match = HASH.exec(hash || '');
  if (!match || typeof password !== 'string' || password.length > 256) return false;
  const digest = await scrypt(password, match[1], 32, PARAMS);
  return crypto.timingSafeEqual(digest, Buffer.from(match[2], 'hex'));
}
function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map(s => {
    const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1)];
  }));
}
const random = () => crypto.randomBytes(32).toString('hex');
const digestToken = token => crypto.createHash('sha256').update(token || '').digest('hex');

// This operator application is deliberately loopback-only. No reverse-proxy trust.
export function createSellerAuth({ passwordHash, operatorEmail, mustChangePassword = false, persistPassword,
  now = Date.now, idleMs = 30 * 60_000, absoluteMs = 8 * 60 * 60_000 } = {}) {
  if (!HASH.test(passwordHash || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operatorEmail || '')) {
    throw new Error('Configure CUSTOMER_SETUP_PASSWORD_HASH and CUSTOMER_SETUP_OPERATOR_EMAIL before starting Customer Setup.');
  }
  if (mustChangePassword && !persistPassword) throw new Error('Password replacement storage is required.');
  const sessions = new Map(), challenges = new Map();
  let failures = 0, failureUntil = 0, verifying = false;
  const cookie = (key, value, age) => `${key}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
  const redirect = (response, location, setCookies = []) => {
    response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': setCookies }); response.end();
  };
  function checkPost(request, parameters, csrf) {
    assert(request.headers.origin === `http://${request.headers.host}`, 403, 'invalid_origin', 'Reload this local page before submitting.');
    assert(csrf && parameters.get('csrf') === csrf, 403, 'invalid_csrf', 'This page expired. Reload and try again.');
  }
  function form(csrf, title, body, action) {
    return `<h2>${title}</h2><form method="post" action="${action}"><input type="hidden" name="csrf" value="${csrf}">${body}<button type="submit">${title}</button></form>`;
  }
  return {
    async gate(request, response, url, { send, page, readParameters }) {
      const time = now();
      if (time >= failureUntil) failures = 0;
      for (const [key, value] of sessions) if (time >= value.expires || time >= value.absolute) sessions.delete(key);
      for (const [key, value] of challenges) if (time >= value.expires) challenges.delete(key);
      const token = cookies(request).customer_setup_session;
      const session = sessions.get(digestToken(token));
      if (url.pathname === '/login') {
        if (request.method === 'GET') {
          if (challenges.size >= 100) challenges.delete(challenges.keys().next().value);
          const challenge = random(), csrf = random();
          challenges.set(challenge, { csrf, expires: time + 10 * 60_000 });
          send(response, 200, page('Seller sign in', form(csrf, 'Sign in', '<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>', '/login')), 'text/html; charset=utf-8', { 'Set-Cookie': cookie('customer_setup_login', challenge, 600) });
          return null;
        }
        assert(request.method === 'POST', 405, 'method_not_allowed', 'Use the sign-in form.');
        const parameters = await readParameters(request);
        const challengeKey = cookies(request).customer_setup_login;
        checkPost(request, parameters, challenges.get(challengeKey)?.csrf);
        challenges.delete(challengeKey);
        if (time >= failureUntil) failures = 0;
        assert(!verifying && failures < 5, 429, 'login_throttled', 'Too many sign-in attempts. Try again in 15 minutes.');
        failures++; failureUntil = time + 15 * 60_000; verifying = true;
        let valid;
        try { valid = await verifyPassword(parameters.get('password'), passwordHash); } finally { verifying = false; }
        assert(valid, 401, 'invalid_credentials', 'The password was not accepted.');
        failures = 0;
        if (token) sessions.delete(digestToken(token));
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        const newToken = random();
        sessions.set(digestToken(newToken), { id: random(), csrf: random(), email: operatorEmail.toLowerCase(), expires: time + idleMs, absolute: time + absoluteMs });
        redirect(response, mustChangePassword ? '/password' : '/customers', [cookie('customer_setup_session', newToken, absoluteMs / 1000), cookie('customer_setup_login', '', 0)]);
        return null;
      }
      if (!session) {
        if (request.method === 'GET') redirect(response, '/login');
        else throw new ApiError(401, 'sign_in_required', 'Sign in before using Customer Setup.');
        return null;
      }
      session.expires = time + idleMs;
      if (url.pathname === '/logout') {
        if (request.method === 'GET') send(response, 200, page('Sign out', form(session.csrf, 'Sign out', '', '/logout')));
        else {
          assert(request.method === 'POST', 405, 'method_not_allowed', 'Use POST.');
          checkPost(request, await readParameters(request), session.csrf);
          sessions.delete(digestToken(token));
          redirect(response, '/login', [cookie('customer_setup_session', '', 0), cookie('customer_setup_csrf', '', 0)]);
        }
        return null;
      }
      if (url.pathname === '/password') {
        assert(persistPassword, 503, 'password_storage_unavailable', 'Use the local password reset command.');
        if (request.method === 'GET') send(response, 200, page('Replace password', form(session.csrf, 'Replace password', '<p>Choose a new password with at least 14 characters. All sessions will be signed out.</p><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="14" maxlength="256" required></label>', '/password')));
        else {
          assert(request.method === 'POST', 405, 'method_not_allowed', 'Use POST.');
          const parameters = await readParameters(request); checkPost(request, parameters, session.csrf);
          assert(!verifying && failures < 5, 429, 'login_throttled', 'Restart sign-in after the cooldown.');
          verifying = true;
          try {
            failures++; failureUntil = time + 15 * 60_000;
            assert(await verifyPassword(parameters.get('current'), passwordHash), 401, 'invalid_credentials', 'The current password was not accepted.');
            const next = parameters.get('password');
            assert(next?.length >= 14 && next !== parameters.get('current'), 400, 'invalid_password', 'Choose a different password with at least 14 characters.');
            const hash = await hashPassword(next);
            await persistPassword(hash);
            passwordHash = hash; mustChangePassword = false; failures = 0; sessions.clear();
            redirect(response, '/login', [cookie('customer_setup_session', '', 0)]);
          } finally { verifying = false; }
        }
        return null;
      }
      if (mustChangePassword) { redirect(response, '/password'); return null; }
      return session;
    }
  };
}
