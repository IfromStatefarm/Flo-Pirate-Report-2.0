import { getAuthToken } from '../utils/auth.js';
import { CUSTOMER_ACCESS_PROFILE_CACHE_KEY } from '../utils/access_control.js';

export async function googleOperation(name, args, { requestId = crypto.randomUUID(), fetchImpl = fetch, expectedScope } = {}) {
  const profile = (await chrome.storage.local.get(CUSTOMER_ACCESS_PROFILE_CACHE_KEY))[CUSTOMER_ACCESS_PROFILE_CACHE_KEY];
  if (expectedScope && (expectedScope.customerId !== profile?.customerId || expectedScope.userId !== profile?.userId)) throw new Error('Account changed before upload.');
  if (!profile?.customerId || !profile?.userId) throw new Error('Sign in before accessing customer resources.');
  const settingsResponse = await fetchImpl(chrome.runtime.getURL('config/customer_bootstrap.json'), {cache:'no-store'});
  if (!settingsResponse.ok) throw new Error('Customer API settings are unavailable.');
  const settings = await settingsResponse.json();
  const endpoint = new URL(settings.dataEndpoint || new URL('data',settings.bootstrapEndpoint));
  if (endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid customer API endpoint.');
  const token = await getAuthToken();
  const response = await fetchImpl(endpoint.href,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({protocol_version:1,operation:'google_operation',command:{name,args,requestId}}),
    cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000)});
  const payload = await response.text();
  if(payload.length>8*1024*1024) throw new Error('Customer API response is oversized.');
  const envelope = JSON.parse(payload);
  if(!response.ok) throw new Error(envelope?.error?.message || 'Customer operation failed.');
  const current = (await chrome.storage.local.get(CUSTOMER_ACCESS_PROFILE_CACHE_KEY))[CUSTOMER_ACCESS_PROFILE_CACHE_KEY];
  if(envelope.customerId!==profile.customerId || envelope.userId!==profile.userId || envelope.requestId!==requestId || current?.customerId!==profile.customerId || current?.userId!==profile.userId) throw new Error('The customer changed during this operation.');
  return envelope.result;
}

export async function stableOperationId(...parts) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
