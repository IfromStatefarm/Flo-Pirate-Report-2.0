import { ApiError } from './api_error.js';
import { verifyGoogleIdentity } from './google_identity.js';
import { createCustomerApiService } from './customer_api_service.js';
import { createPostgresRepository } from './postgres_repository.js';
import { CUSTOMER_API_CAPABILITY } from './protocol.js';
import { TEAM_API_CAPABILITY } from '../utils/team_access.js';

let service;

function getService() {
  service ||= createCustomerApiService({
    repository: createPostgresRepository(),
    verifyIdentity: (request) => verifyGoogleIdentity(request)
  });
  return service;
}

function responseHeaders(request) {
  const configuredOrigins = String(process.env.ALLOWED_EXTENSION_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = request.headers.get('origin');
  const allowedOrigin = origin && configuredOrigins.includes(origin) ? origin : '';
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Rights-Reporter-API': CUSTOMER_API_CAPABILITY,
    'X-Rights-Reporter-Team': TEAM_API_CAPABILITY,
    'Access-Control-Expose-Headers': 'X-Rights-Reporter-API, X-Rights-Reporter-Team',
    ...(allowedOrigin ? {
      'Access-Control-Allow-Origin': allowedOrigin,
      Vary: 'Origin'
    } : {})
  };
}

function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(request) });
}

async function parseBody(request) {
  const type = String(request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new ApiError(415, 'invalid_request', 'Content-Type must be application/json.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_request', 'The request body is empty.');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ApiError(413, 'invalid_request', 'The request body is oversized.'); }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new ApiError(400, 'invalid_request', 'The request body is empty.');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_request', 'The request body is not valid JSON.');
  }
}

export async function handleCustomerApi(kind, request, { service: suppliedService } = {}) {
  const headers = responseHeaders(request);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '600'
      }
    });
  }
  if (request.method !== 'POST') return json(request, { error: { code: 'method_not_allowed', message: 'Use POST.', utilization: null } }, 405);

  try {
    const body = await parseBody(request);
    const handler = (suppliedService || getService())[kind];
    if (!handler) throw new ApiError(404, 'not_found', 'API route not found.');
    return json(request, await handler(request, body));
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : 'internal_error';
    if (!(error instanceof ApiError)) console.error('Customer API error:', { code: error?.code || 'internal_error' });
    return json(request, {
      error: {
        code,
        message: status >= 500 ? 'The customer API could not complete the request.' : error.message,
        utilization: error.details?.utilization || null
      }
    }, status);
  }
}
