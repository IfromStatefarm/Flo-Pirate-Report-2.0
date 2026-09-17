import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../server/api_error.js';
import { verifyGoogleIdentity } from '../server/google_identity.js';

const CLIENT_ID = 'client-id.apps.googleusercontent.com';

function request(token = 'test-access-token') {
  return new Request('https://api.example.test/bootstrap', {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function tokenInfo(overrides = {}) {
  return {
    aud: CLIENT_ID,
    email: 'ivan.mcclay@flosports.tv',
    email_verified: 'true',
    user_id: '108503226143975152667',
    scope: 'https://www.googleapis.com/auth/userinfo.email',
    ...overrides
  };
}

function fetchTokenInfo(value, status = 200) {
  return async () => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('accepts the current Google access-token tokeninfo field names', async () => {
  const identity = await verifyGoogleIdentity(request(), {
    expectedClientId: CLIENT_ID,
    fetchImpl: fetchTokenInfo(tokenInfo())
  });

  assert.deepEqual(identity, {
    subject: '108503226143975152667',
    email: 'ivan.mcclay@flosports.tv'
  });
});

test('retains compatibility with legacy Google tokeninfo field names', async () => {
  const info = tokenInfo({
    aud: undefined,
    email_verified: undefined,
    audience: CLIENT_ID,
    verified_email: true
  });
  const identity = await verifyGoogleIdentity(request(), {
    expectedClientId: CLIENT_ID,
    fetchImpl: fetchTokenInfo(info)
  });

  assert.equal(identity.email, 'ivan.mcclay@flosports.tv');
});

test('rejects a token issued to another OAuth client', async () => {
  await assert.rejects(
    verifyGoogleIdentity(request(), {
      expectedClientId: CLIENT_ID,
      fetchImpl: fetchTokenInfo(tokenInfo({ aud: 'another-client.apps.googleusercontent.com' }))
    }),
    (error) => error instanceof ApiError && error.code === 'identity_error' && error.status === 401
  );
});
