import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CUSTOMER_API_CAPABILITY } from '../protocol.js';
import { TEAM_API_CAPABILITY } from '../../utils/team_access.js';

export async function verifyCustomerApi(settings, { fetchImpl = fetch, origin } = {}) {
  const results = [];
  for (const key of ['bootstrapEndpoint', 'membershipEndpoint', 'dataEndpoint']) {
    try {
      const url = new URL(settings[key]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Expected a credential-free HTTPS endpoint without query or fragment.');
      }
      const response = await fetchImpl(url.href, {
        method: 'OPTIONS', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: origin ? { Origin: origin, 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type' } : {},
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 204) throw new Error(`Expected HTTP 204; received ${response.status}.`);
      if (response.headers.get('X-Rights-Reporter-API') !== CUSTOMER_API_CAPABILITY) {
        throw new Error('Deployment does not advertise google_operation command support. Deploy the matching customer API.');
      }
      if (origin && response.headers.get('Access-Control-Allow-Origin') !== origin) {
        throw new Error('Deployment does not allow the configured extension origin.');
      }
      if (key === 'membershipEndpoint' && response.headers.get('X-Rights-Reporter-Team') !== TEAM_API_CAPABILITY) {
        throw new Error('Team & Access support is unverified: deploy the matching membership handler with the team-access-v1 marker.');
      }
      if (key === 'membershipEndpoint') {
        // OPTIONS can be handled by a different layer. Check the actual POST
        // response contract without sending a bearer token or customer data.
        const denied = await fetchImpl(url.href, {
          method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
          body: JSON.stringify({ protocolVersion: 1, operation: 'team_list', query: '', role: '', status: '', cursor: '' }),
          signal: AbortSignal.timeout(15000),
        });
        if (denied.status !== 401) throw new Error(`Unauthenticated membership POST must return HTTP 401; received ${denied.status}.`);
        if (denied.headers.get('X-Rights-Reporter-Team') !== TEAM_API_CAPABILITY ||
            !denied.headers.get('Access-Control-Expose-Headers')?.toLowerCase().split(',').map(value => value.trim()).includes('x-rights-reporter-team')) {
          throw new Error('Membership POST does not advertise browser-readable Team & Access support.');
        }
        if (origin && denied.headers.get('Access-Control-Allow-Origin') !== origin) {
          throw new Error('Membership POST does not allow the configured extension origin.');
        }
      }
      results.push({ endpoint: key, ok: true });
    } catch (error) {
      // Do not echo URLs or provider bodies: malformed settings may hold secrets.
      results.push({ endpoint: key, ok: false, message: error instanceof TypeError ? 'Invalid endpoint or network request failed.' : error.message });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = JSON.parse(await fs.readFile(new URL('../../config/customer_bootstrap.json', import.meta.url), 'utf8'));
  const origin = process.env.ALLOWED_EXTENSION_ORIGINS?.split(',')[0]?.trim();
  const results = await verifyCustomerApi(settings, { origin });
  for (const result of results) console.log(`${result.endpoint}: ${result.ok ? 'compatible' : result.message}`);
  if (results.some(result => !result.ok)) process.exitCode = 1;
  else console.log('All configured customer routes advertise command support. Membership POST advertises Team & Access and rejects an unauthenticated request. Run authenticated feature checks to verify permissions and data access.');
}
