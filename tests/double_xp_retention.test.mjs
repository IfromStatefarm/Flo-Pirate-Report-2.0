import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DOUBLE_XP_RETENTION_DAYS,
  activateDoubleXpEvent,
  applyDoubleXpRetention,
  isValidDoubleXpRetentionDays,
  reconcileDoubleXpVerticals
} from '../utils/double_xp_retention.js';

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);

function config(event, retentionDays = DEFAULT_DOUBLE_XP_RETENTION_DAYS) {
  return {
    double_xp_settings: { retention_days: retentionDays },
    verticals: [{ name: 'FloTrack', events: [event] }]
  };
}

test('Double XP defaults to ten days and stamps legacy active events', () => {
  const result = applyDoubleXpRetention({
    verticals: [{ name: 'FloTrack', events: [{ eventName: 'Championship', double_xp: true }] }]
  }, { now: NOW });
  const event = result.config.verticals[0].events[0];

  assert.equal(result.retentionDays, 10);
  assert.equal(event.double_xp_started_at, '2026-09-16T12:00:00.000Z');
  assert.equal(event.double_xp_expires_at, '2026-09-26T12:00:00.000Z');
  assert.equal(result.changed, true);
});

test('expired Double XP is removed without deleting the underlying event', () => {
  const event = activateDoubleXpEvent({ eventName: 'Championship', sourceUrl: 'https://example.test/event' }, 10, {
    now: Date.UTC(2026, 8, 1, 12, 0, 0)
  });
  const result = applyDoubleXpRetention(config(event), { now: NOW });
  const expired = result.config.verticals[0].events[0];

  assert.equal(expired.eventName, 'Championship');
  assert.equal(expired.sourceUrl, 'https://example.test/event');
  assert.equal(expired.double_xp, false);
  assert.equal('double_xp_started_at' in expired, false);
  assert.equal('double_xp_expires_at' in expired, false);
  assert.equal(result.expiredCount, 1);
});

test('manager updates cannot replace the authoritative Double XP window', () => {
  const current = [{
    name: 'FloTrack',
    events: [activateDoubleXpEvent({ eventName: 'Championship' }, 10, { now: NOW })]
  }];
  const submitted = [{
    name: 'FloTrack',
    events: [{
      eventName: 'Championship',
      double_xp: true,
      double_xp_started_at: '2099-01-01T00:00:00.000Z',
      double_xp_expires_at: '2099-12-31T00:00:00.000Z'
    }]
  }];
  const reconciled = reconcileDoubleXpVerticals(submitted, current, { retentionDays: 10, now: NOW });

  assert.equal(reconciled[0].events[0].double_xp_started_at, '2026-09-16T12:00:00.000Z');
  assert.equal(reconciled[0].events[0].double_xp_expires_at, '2026-09-26T12:00:00.000Z');
});

test('an administrator retention change recalculates existing end dates', () => {
  const current = [{
    name: 'FloTrack',
    events: [activateDoubleXpEvent({ eventName: 'Championship' }, 10, { now: NOW })]
  }];
  const reconciled = reconcileDoubleXpVerticals(current, current, {
    retentionDays: 20,
    now: NOW,
    recalculateExisting: true
  });

  assert.equal(reconciled[0].events[0].double_xp_expires_at, '2026-10-06T12:00:00.000Z');
});

test('retention accepts only whole days from one through 365', () => {
  assert.equal(isValidDoubleXpRetentionDays(1), true);
  assert.equal(isValidDoubleXpRetentionDays('10'), true);
  assert.equal(isValidDoubleXpRetentionDays(365), true);
  assert.equal(isValidDoubleXpRetentionDays(0), false);
  assert.equal(isValidDoubleXpRetentionDays(10.5), false);
  assert.equal(isValidDoubleXpRetentionDays(366), false);
});
