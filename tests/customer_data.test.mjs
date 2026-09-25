import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CustomerDataApiError,
  buildCustomerEvent,
  createCustomerDataService
} from '../services/customer_data_service.js';

const PROFILE = Object.freeze({
  schemaVersion: 1,
  expiresAt: Date.now() + 600000,
  status: 'ready',
  verification: 'verified',
  customerId: 'acme-sports',
  userId: 'user_123',
  email: 'member@acme.example',
  integrations: {
    statsDashboardId: 'stats_acme'
  }
});

test('expired bootstrap cannot authorize event or statistics requests', async () => {
  const expired = { ...PROFILE, expiresAt: Date.now() };
  const service = serviceWith(() => assert.fail('Expired profile reached the network'));
  await assert.rejects(service.recordEvent(expired, 'activity.item_added', {}), { code: 'not_authorized' });
  await assert.rejects(service.queryStatistics(expired, 'scoreboard', {}), { code: 'not_authorized' });
  await assert.rejects(service.queryLegacyStatistics(expired, 'intelligence', {}), { code: 'not_authorized' });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serviceWith(fetchImpl) {
  return createCustomerDataService({
    getAuthToken: async () => 'verified-google-token',
    fetchImpl,
    loadSettings: async () => ({
      schemaVersion: 1,
      bootstrapEndpoint: 'https://api.example.com/v1/extension/bootstrap',
      membershipEndpoint: '',
      dataEndpoint: ''
    })
  });
}

test('records a fixed normalized event with customer, user, and event identifiers', async () => {
  let request;
  const eventId = 'event_123';
  const service = serviceWith(async (url, options) => {
    request = { url, options };
    return jsonResponse({
      protocol_version: 1,
      event_id: eventId,
      customer_id: PROFILE.customerId,
      user_id: PROFILE.userId,
      accepted_at: 1_800_000_000_100
    });
  });

  const result = await service.recordEvent(PROFILE, 'report.submitted', {
    platform: 'youtube',
    urls: ['https://youtube.com/watch?v=123'],
    report_id: 'RR_123',
    source_event_name: 'Championship',
    vertical: 'Football',
    mode: 'enforcer',
    url_count: 1,
    estimated_views: 1200,
    scout_points: 10,
    enforcer_points: 20,
    pdf_url: 'https://drive.google.com/file/d/report',
    channel_url: 'https://youtube.com/@example',
    content_type: 'VOD'
  }, { eventId, occurredAt: 1_800_000_000_000 });

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.example.com/v1/extension/data');
  assert.equal(request.options.headers.Authorization, 'Bearer verified-google-token');
  assert.equal(body.operation, 'record_event');
  assert.deepEqual(
    {
      customer_id: body.event.customer_id,
      user_id: body.event.user_id,
      event_id: body.event.event_id
    },
    { customer_id: 'acme-sports', user_id: 'user_123', event_id: 'event_123' }
  );
  assert.equal(result.event_id, eventId);
});

test('rejects arbitrary event attributes before making a request', () => {
  assert.throws(
    () => buildCustomerEvent(PROFILE, 'activity.item_added', {
      platform: 'youtube',
      target_url: 'https://youtube.com/watch?v=123',
      customer_override: 'other-customer'
    }, { eventId: 'event_123', occurredAt: 1_800_000_000_000 }),
    /customer_override is not supported/
  );
});

test('rejects event acknowledgements outside the verified scope', async () => {
  const service = serviceWith(async () => jsonResponse({
    protocol_version: 1,
    event_id: 'event_123',
    customer_id: 'other-customer',
    user_id: PROFILE.userId,
    accepted_at: 1_800_000_000_100
  }));

  await assert.rejects(
    () => service.recordEvent(PROFILE, 'activity.item_added', {
      platform: 'youtube',
      target_url: 'https://youtube.com/watch?v=123'
    }, { eventId: 'event_123', occurredAt: 1_800_000_000_000 }),
    (error) => error instanceof CustomerDataApiError && error.code === 'scope_mismatch'
  );
});

test('retries transient ingestion failures with the same idempotency event id', async () => {
  const bodies = [];
  const service = serviceWith(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw new Error('temporary network failure');
    return jsonResponse({
      protocol_version: 1,
      event_id: 'event_retry',
      customer_id: PROFILE.customerId,
      user_id: PROFILE.userId,
      accepted_at: 1_800_000_000_100
    });
  });

  await service.recordEvent(PROFILE, 'activity.item_added', {
    platform: 'youtube',
    target_url: 'https://youtube.com/watch?v=123'
  }, { eventId: 'event_retry', occurredAt: 1_800_000_000_000 });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].event.event_id, 'event_retry');
  assert.deepEqual(bodies[1], bodies[0]);
});

test('queries statistics with customer, user, dashboard, dates, and platforms', async () => {
  let requestBody;
  const service = serviceWith(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      protocol_version: 1,
      customer_id: PROFILE.customerId,
      user_id: PROFILE.userId,
      dashboard_id: 'stats_acme',
      query_type: 'intelligence',
      generated_at: 1_800_000_000_100,
      data: {
        totalReported: 12,
        timelineData: {
          '9/3/2026': { count: 2, resolved: 1 }
        }
      }
    });
  });

  const result = await service.queryStatistics(PROFILE, 'intelligence', {
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    platforms: ['youtube', 'tiktok']
  });

  assert.equal(requestBody.customer_id, PROFILE.customerId);
  assert.equal(requestBody.user_id, PROFILE.userId);
  assert.equal(requestBody.query.dashboard_id, 'stats_acme');
  assert.deepEqual(requestBody.query.platforms, ['youtube', 'tiktok']);
  assert.equal(result.data.timelineData['9/3/2026'].resolved, 1);
});

test('comparison mode requests the customer-scoped legacy statistics adapter', async () => {
  let requestBody;
  const service = serviceWith(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      protocol_version: 1,
      customer_id: PROFILE.customerId,
      user_id: PROFILE.userId,
      dashboard_id: 'stats_acme',
      query_type: 'scoreboard',
      generated_at: 1_800_000_000_100,
      data: { teamTotal: 4 }
    });
  });

  const result = await service.queryLegacyStatistics(PROFILE, 'scoreboard', { period: 'current_month' });
  assert.equal(requestBody.operation, 'query_legacy_statistics');
  assert.equal(requestBody.customer_id, PROFILE.customerId);
  assert.equal(requestBody.user_id, PROFILE.userId);
  assert.equal(result.data.teamTotal, 4);
});

test('rejects statistics returned for another customer, user, or dashboard', async () => {
  const service = serviceWith(async () => jsonResponse({
    protocol_version: 1,
    customer_id: PROFILE.customerId,
    user_id: 'another_user',
    dashboard_id: 'stats_acme',
    query_type: 'scoreboard',
    generated_at: 1_800_000_000_100,
    data: {}
  }));

  await assert.rejects(
    () => service.queryStatistics(PROFILE, 'scoreboard', { period: 'current_month' }),
    (error) => error instanceof CustomerDataApiError && error.code === 'scope_mismatch'
  );
});

test('fails closed for stale or unverified customer profiles', async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls += 1;
    throw new Error('should not be called');
  });

  await assert.rejects(
    () => service.queryStatistics({ ...PROFILE, status: 'stale', verification: 'stale' }, 'scoreboard', { period: 'current_month' }),
    (error) => error instanceof CustomerDataApiError && error.code === 'not_authorized'
  );
  assert.equal(calls, 0);
});
