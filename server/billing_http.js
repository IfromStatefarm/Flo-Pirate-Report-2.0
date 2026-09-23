import { getPool } from './db.js';
import { ApiError, assert } from './api_error.js';
import { verifyBillingMessage, acceptBillingEvent, processBillingEvents } from './billing_service.js';
import crypto from 'node:crypto';

async function readBody(request) {
  const reader = request.body?.getReader();
  assert(reader, 400, 'invalid_billing_event', 'A body is required.');
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new ApiError(413, 'body_too_large', 'Billing payload is too large.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function handleBilling(request, { pool, secret = process.env.BILLING_BRIDGE_SECRET, accountId = process.env.BILLING_WIX_ACCOUNT_ID, workerSecret = process.env.BILLING_WORKER_SECRET, worker = false } = {}) {
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  try {
    assert(request.method === 'POST', 405, 'method_not_allowed', 'Use POST.');
    if (worker) {
      assert(workerSecret?.length >= 32, 503, 'billing_not_configured', 'Billing worker is not configured.');
      const token = String(request.headers.get('authorization') || '').replace(/^Bearer /, '');
      const digest = value => crypto.createHash('sha256').update(value).digest();
      assert(crypto.timingSafeEqual(digest(token), digest(workerSecret)), 401, 'unauthorized', 'Worker authentication required.');
      return json(await processBillingEvents(pool || getPool()));
    }
    assert(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415, 'invalid_content_type', 'Use application/json.');
    const raw = await readBody(request);
    const event = verifyBillingMessage(raw, request.headers, { secret, accountId });
    const result = await acceptBillingEvent(pool || getPool(), event);
    return json(result, 202);
  } catch (error) {
    return json({ error: { code: error instanceof ApiError ? error.code : 'internal_error', message: error instanceof ApiError ? error.message : 'Billing could not complete the request.' } }, error instanceof ApiError ? error.status : 500);
  }
}
