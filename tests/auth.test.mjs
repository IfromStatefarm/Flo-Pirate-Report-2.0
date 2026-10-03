import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { getAuthToken } from '../utils/auth.js';

function mockChrome(t, callback) {
  const original = globalThis.chrome;
  const runtime = {};
  globalThis.chrome = { runtime, identity: { getAuthToken: callback } };
  t.after(() => {
    if (original === undefined) delete globalThis.chrome;
    else globalThis.chrome = original;
  });
  return runtime;
}

test('tokens default to noninteractive; only explicit sign-in enables consent', async t => {
  const calls = [];
  mockChrome(t, (options, callback) => { calls.push(options); callback('fixture-token'); });
  assert.equal(await getAuthToken(), 'fixture-token');
  assert.equal(await getAuthToken({ interactive: false }), 'fixture-token');
  assert.equal(await getAuthToken({ interactive: true }), 'fixture-token');
  assert.deepEqual(calls, [{ interactive: false }, { interactive: false }, { interactive: true }]);
});

test('Chrome errors keep their exact message in logs and Error rejections', async t => {
  const logger = t.mock.method(console, 'error', () => {});
  const runtime = mockChrome(t, (_options, callback) => {
    runtime.lastError = { message: 'OAuth2 request failed: fixture provider detail' };
    callback();
    delete runtime.lastError; // Chrome exposes this only during the callback.
  });
  await assert.rejects(getAuthToken(), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'OAuth2 request failed: fixture provider detail');
    return true;
  });
  assert.deepEqual(logger.mock.calls[0].arguments, ['Auth Error:', 'OAuth2 request failed: fixture provider detail']);
});

test('missing token fails before any API can use an undefined bearer token', async t => {
  t.mock.method(console, 'error', () => {});
  mockChrome(t, (_options, callback) => callback());
  await assert.rejects(getAuthToken(), /Chrome did not return a Google OAuth token/);
});

const signInSource = (await readFile(new URL('../options/sign_in.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');

function signInPage({ tokenError, response = { success: true } } = {}) {
  let click;
  const calls = [];
  const button = { disabled: false, addEventListener: (event, handler) => {
    assert.equal(event, 'click');
    click = handler;
  } };
  const status = { textContent: '' };
  vm.runInNewContext(signInSource, {
    document: { getElementById: id => id === 'google-sign-in' ? button : status },
    getAuthToken: async options => {
      calls.push(['token', options.interactive]);
      if (tokenError) throw new Error(tokenError);
      return 'fixture-token';
    },
    chrome: { runtime: { sendMessage: async message => { calls.push([message.action]); return response; } } },
    window: { location: { reload: () => calls.push(['reload']) } }
  });
  return { calls, click, button, status };
}

test('Settings does not prompt on load; a click signs in then reloads verified access', async () => {
  const h = signInPage();
  assert.deepEqual(h.calls, []);
  const pending = h.click();
  assert.equal(h.button.disabled, true);
  await h.click(); // Ignore duplicate clicks while consent is pending.
  await pending;
  assert.deepEqual(h.calls, [['token', true], ['bootstrapCustomerAccess'], ['reload']]);
  assert.equal(h.button.disabled, false);
});

test('cancelled consent displays the provider message and allows retry without bootstrapping', async () => {
  const h = signInPage({ tokenError: 'The user did not approve access.' });
  await h.click();
  assert.equal(h.status.textContent, 'Sign-in failed: The user did not approve access.');
  assert.equal(h.button.disabled, false);
  assert.deepEqual(h.calls, [['token', true]]);
});

test('successful OAuth does not hide a customer access denial', async () => {
  const h = signInPage({ response: { success: false, error: 'Membership is inactive.' } });
  await h.click();
  assert.equal(h.status.textContent, 'Sign-in failed: Membership is inactive.');
  assert.equal(h.button.disabled, false);
  assert.deepEqual(h.calls, [['token', true], ['bootstrapCustomerAccess']]);
});
