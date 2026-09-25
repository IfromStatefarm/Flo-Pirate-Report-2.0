import { ApiError, assert } from './api_error.js';

const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';
const REQUIRED_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export function readBearerToken(request) {
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
  let response;
  try { response = await fetchImpl(TOKENINFO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)
  }); } catch {
    throw new ApiError(503, 'identity_unavailable', 'Identity verification is temporarily unavailable.');
  }
  if (response.status === 429 || response.status >= 500) throw new ApiError(503, 'identity_unavailable', 'Identity verification is temporarily unavailable.');
  if (!response.ok) throw new ApiError(401, 'identity_error', 'Google rejected or expired the access token.');

  let info;
  try { info = await response.json(); } catch { throw new ApiError(503, 'identity_unavailable', 'Identity verification is temporarily unavailable.'); }
  assert(info && typeof info === 'object', 401, 'identity_error', 'Invalid identity response.');
  assert((typeof info.expires_in === 'string' || typeof info.expires_in === 'number') &&
    Number.isFinite(Number(info.expires_in)) && Number(info.expires_in) > 0,
    401, 'identity_error', 'Google did not confirm an unexpired access token.');
  // Google's access-token tokeninfo response currently uses the OAuth-style
  // `aud` and `email_verified` names. Retain the older aliases as well so the
  // verifier stays compatible with both documented response shapes.
  const audience = String(info.aud || info.audience || info.issued_to || '');
  const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
  const rawSubject = info.sub ?? info.user_id;
  const subject = typeof rawSubject === 'string' ? rawSubject.trim() : '';
  const scopes = new Set(String(info.scope || '').split(/\s+/).filter(Boolean));
  const verificationClaims = [info.email_verified, info.verified_email].filter(value => value !== undefined);
  const verifiedEmail = verificationClaims.length > 0 && verificationClaims.every(value => value === true || value === 'true');

  assert(audience === expectedClientId, 401, 'identity_error', 'The Google token was issued to a different OAuth client.');
  assert(verifiedEmail && email && subject, 401, 'identity_error', 'Google did not return a verified identity.');
  assert(scopes.has(REQUIRED_EMAIL_SCOPE), 401, 'identity_error', 'The Google token is missing the required email scope.');

  return Object.freeze({ subject, email });
}
