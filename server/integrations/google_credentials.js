import { assert, ApiError } from '../api_error.js';

// Secret material is keyed by server-resolved customer ID, never a client hint.
export async function googleConnectorToken(customerId, { delegatedToken, fetchImpl = fetch,
  connectors = process.env.GOOGLE_CONNECTORS_JSON || '{}',
  legacyCustomers = process.env.LEGACY_GOOGLE_USER_TOKEN_CUSTOMERS || '' } = {}) {
  let config;
  try { config = JSON.parse(connectors)[customerId]; } catch { throw new ApiError(503, 'connector_unavailable', 'Google connector configuration is invalid.'); }
  if (!config) {
    assert(legacyCustomers.split(',').map(s => s.trim()).includes(customerId) && delegatedToken,
      503, 'connector_unavailable', 'A server Google connector has not been configured for this customer.');
    return delegatedToken;
  }
  assert(['clientId','clientSecret','refreshToken'].every(k => typeof config[k] === 'string' && config[k]), 503, 'connector_unavailable', 'Google connector credentials are incomplete.');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken }),
    redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  assert(response.ok, 503, 'connector_unavailable', 'Reconnect the customer Google connector.');
  const body = await response.json();
  assert(typeof body.access_token === 'string' && body.access_token.length > 0, 503, 'connector_unavailable', 'Google did not return a connector token.');
  return body.access_token;
}
