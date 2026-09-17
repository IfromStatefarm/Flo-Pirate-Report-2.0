import { ApiError, assert } from './api_error.js';

const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';
const REQUIRED_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

function readBearerToken(request) {
  const header = String(request.headers.get('authorization') || '');
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  assert(match, 401, 'identity_error', 'A Google bearer token is required.');
  assert(match[1].length <= 4096, 401, 'identity_error', 'The Google bearer token is invalid.');
  return match[1];
}

export async function verifyGoogleIdentity(request, {
  fetchImpl = fetch,
  expectedClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
} = {}) {
  assert(expectedClientId, 500, 'configuration_error', 'GOOGLE_OAUTH_CLIENT_ID is not configured.');
  const token = readBearerToken(request);
  const response = await fetchImpl(TOKENINFO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
    cache: 'no-store'
  });
  if (!response.ok) throw new ApiError(401, 'identity_error', 'Google rejected or expired the access token.');

  const info = await response.json();
  // Google's access-token tokeninfo response currently uses the OAuth-style
  // `aud` and `email_verified` names. Retain the older aliases as well so the
  // verifier stays compatible with both documented response shapes.
  const audience = String(info.aud || info.audience || info.issued_to || '');
  const email = String(info.email || '').trim().toLowerCase();
  const subject = String(info.user_id || info.sub || '').trim();
  const scopes = new Set(String(info.scope || '').split(/\s+/).filter(Boolean));
  const verifiedEmail = info.email_verified === true || info.email_verified === 'true' ||
    info.verified_email === true || info.verified_email === 'true';

  assert(audience === expectedClientId, 401, 'identity_error', 'The Google token was issued to a different OAuth client.');
  assert(verifiedEmail && email && subject, 401, 'identity_error', 'Google did not return a verified identity.');
  assert(scopes.has(REQUIRED_EMAIL_SCOPE), 401, 'identity_error', 'The Google token is missing the required email scope.');

  return Object.freeze({ subject, email });
}
