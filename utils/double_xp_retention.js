export const DEFAULT_DOUBLE_XP_RETENTION_DAYS = 10;
export const MIN_DOUBLE_XP_RETENTION_DAYS = 1;
export const MAX_DOUBLE_XP_RETENTION_DAYS = 365;

function asTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim()) return Date.parse(value);
  return NaN;
}

function currentTime(now) {
  const parsed = asTime(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function addDays(timestamp, days) {
  return timestamp + (days * 24 * 60 * 60 * 1000);
}

function eventName(event) {
  return String(event?.eventName || event?.name || '').trim().toLowerCase();
}

function eventKey(verticalName, event) {
  return `${String(verticalName || '').trim().toLowerCase()}::${eventName(event)}`;
}

function withoutDoubleXpWindow(event, { markInactive = event?.double_xp === true } = {}) {
  const nextEvent = { ...event };
  if (markInactive || event?.double_xp === false) nextEvent.double_xp = false;
  else delete nextEvent.double_xp;
  delete nextEvent.double_xp_started_at;
  delete nextEvent.double_xp_expires_at;
  return nextEvent;
}

export function isValidDoubleXpRetentionDays(value) {
  const days = Number(value);
  return Number.isSafeInteger(days)
    && days >= MIN_DOUBLE_XP_RETENTION_DAYS
    && days <= MAX_DOUBLE_XP_RETENTION_DAYS;
}

export function normalizeDoubleXpRetentionDays(value) {
  return isValidDoubleXpRetentionDays(value)
    ? Number(value)
    : DEFAULT_DOUBLE_XP_RETENTION_DAYS;
}

export function getDoubleXpRetentionDays(config) {
  return normalizeDoubleXpRetentionDays(config?.double_xp_settings?.retention_days);
}

export function activateDoubleXpEvent(event, retentionDays, { now = Date.now() } = {}) {
  const startedAt = currentTime(now);
  const days = normalizeDoubleXpRetentionDays(retentionDays);
  return {
    ...event,
    double_xp: true,
    double_xp_started_at: new Date(startedAt).toISOString(),
    double_xp_expires_at: new Date(addDays(startedAt, days)).toISOString()
  };
}

export function applyDoubleXpRetention(config, { now = Date.now() } = {}) {
  const source = config && typeof config === 'object' ? config : {};
  const retentionDays = getDoubleXpRetentionDays(source);
  const nowMs = currentTime(now);
  let changed = false;
  let expiredCount = 0;
  let stampedCount = 0;

  const verticals = (Array.isArray(source.verticals) ? source.verticals : []).map((vertical) => ({
    ...vertical,
    events: (Array.isArray(vertical?.events) ? vertical.events : []).map((event) => {
      if (event?.double_xp !== true) return { ...event };

      let startedAt = asTime(event.double_xp_started_at);
      let expiresAt = asTime(event.double_xp_expires_at);
      if (!Number.isFinite(startedAt)) {
        startedAt = nowMs;
        changed = true;
      }
      if (!Number.isFinite(expiresAt)) {
        expiresAt = addDays(startedAt, retentionDays);
        changed = true;
      }

      if (expiresAt <= nowMs) {
        changed = true;
        expiredCount += 1;
        return withoutDoubleXpWindow(event);
      }

      const startedIso = new Date(startedAt).toISOString();
      const expiresIso = new Date(expiresAt).toISOString();
      if (event.double_xp_started_at !== startedIso || event.double_xp_expires_at !== expiresIso) {
        changed = true;
        stampedCount += 1;
      } else if (!event.double_xp_started_at || !event.double_xp_expires_at) {
        stampedCount += 1;
      }

      return {
        ...event,
        double_xp: true,
        double_xp_started_at: startedIso,
        double_xp_expires_at: expiresIso
      };
    })
  }));

  return {
    config: {
      ...source,
      double_xp_settings: {
        ...(source.double_xp_settings || {}),
        retention_days: retentionDays
      },
      verticals
    },
    changed,
    expiredCount,
    stampedCount,
    retentionDays
  };
}

export function reconcileDoubleXpVerticals(nextVerticals, currentVerticals, {
  retentionDays = DEFAULT_DOUBLE_XP_RETENTION_DAYS,
  now = Date.now(),
  recalculateExisting = false
} = {}) {
  const days = normalizeDoubleXpRetentionDays(retentionDays);
  const nowMs = currentTime(now);
  const currentEvents = new Map();

  (Array.isArray(currentVerticals) ? currentVerticals : []).forEach((vertical) => {
    (Array.isArray(vertical?.events) ? vertical.events : []).forEach((event) => {
      currentEvents.set(eventKey(vertical?.name, event), event);
    });
  });

  return (Array.isArray(nextVerticals) ? nextVerticals : []).map((vertical) => ({
    ...vertical,
    events: (Array.isArray(vertical?.events) ? vertical.events : []).map((event) => {
      if (event?.double_xp !== true) return withoutDoubleXpWindow(event);

      const currentEvent = currentEvents.get(eventKey(vertical?.name, event));
      const currentStartedAt = asTime(currentEvent?.double_xp_started_at);
      const currentExpiresAt = asTime(currentEvent?.double_xp_expires_at);
      const startedAt = currentEvent?.double_xp === true && Number.isFinite(currentStartedAt)
        ? currentStartedAt
        : nowMs;
      const expiresAt = currentEvent?.double_xp === true
        && Number.isFinite(currentExpiresAt)
        && !recalculateExisting
        ? currentExpiresAt
        : addDays(startedAt, days);

      if (expiresAt <= nowMs) return withoutDoubleXpWindow(event);
      return {
        ...event,
        double_xp: true,
        double_xp_started_at: new Date(startedAt).toISOString(),
        double_xp_expires_at: new Date(expiresAt).toISOString()
      };
    })
  }));
}
