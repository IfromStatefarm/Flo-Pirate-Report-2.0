import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { requireReportMode, permissionsFor } from '../server/access_policy.js';

const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const submission = mode => ({ reportId: 'report-one', eventId: 'event-one', pdfUrl: 'https://drive.google.com/file/d/file-one/view', mode, contentType: 'VOD' });
const request = new Request('https://api.example.test/data', { headers: { Authorization: 'Bearer fixture' } });

for (const role of ['employee', 'manager', 'admin']) {
  test(`${role} direct API enforcement capability cannot be supplied by the client`, async () => {
    const actor = { role, customerConfig: config, customerId: config.customerId, memberId: 'member-one', platforms: ['youtube'], permissions: ['sidepanel.enforce'] };
    let finalized = 0;
    const service = createCustomerApiService({ verifyIdentity: async () => ({}), repository: {
      requireActiveMember: async () => actor,
      finalizeReportBatch: async () => { finalized++; throw Error('accepted by authorization'); },
      recordEvent: async () => { finalized++; throw Error('accepted by authorization'); }
    } });
    for (const mode of ['scout', 'enforcer']) {
      const permitted = mode === 'scout' || role !== 'employee';
      const expected = permitted ? /accepted by authorization/ : { status: 403, code: 'not_authorized' };
      await assert.rejects(service.data(request, { protocol_version: 1, operation: 'finalize_report_batch', batch: { batchId: 'batch-one', reports: [submission(mode)] } }), expected);
      await assert.rejects(service.data(request, { protocol_version: 1, operation: 'record_event', event: {
        event_id: 'event-one', event_type: 'report.submitted', occurred_at: Date.now(),
        attributes: { report_id: 'report-one', urls: ['https://youtube.com/watch?v=abcdefghijk'], pdf_url: submission(mode).pdfUrl, mode, content_type: 'VOD' }
      } }), expected);
    }
    assert.equal(finalized, role === 'employee' ? 2 : 4);
  });
}

test('mixed batches fail before persistence for report-only actors', async () => {
  const service = createCustomerApiService({ verifyIdentity: async () => ({}), repository: {
    requireActiveMember: async () => ({ role: 'employee', customerConfig: config }),
    finalizeReportBatch: async () => assert.fail('unauthorized batch must not persist')
  } });
  await assert.rejects(service.data(request, { protocol_version: 1, operation: 'finalize_report_batch', batch: { batchId: 'mixed', reports: [submission('scout'), { ...submission('enforcer'), reportId: 'second', eventId: 'second' }] } }), { code: 'not_authorized' });
});

test('report entitlement removal disables enforcement and unknown modes fail closed', () => {
  const restricted = structuredClone(config);
  restricted.capabilities.enabledFeatures = restricted.capabilities.enabledFeatures.filter(feature => feature !== 'report');
  assert.equal(permissionsFor(restricted, 'admin').includes('sidepanel.enforce'), false);
  assert.throws(() => requireReportMode({ role: 'admin', customerConfig: restricted }, 'enforcer'), { code: 'not_authorized' });
  assert.throws(() => requireReportMode({ role: 'admin', customerConfig: config }, undefined), { code: 'invalid_report' });
});
