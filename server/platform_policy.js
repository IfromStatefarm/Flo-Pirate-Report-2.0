import { assert } from './api_error.js';
import { detectPlatformDetails, normalizePlatformKey } from '../utils/platforms.js';

export function effectivePlatforms(config, assigned = []) {
  const enabled = config.capabilities.enabledPlatforms;
  // Empty persisted assignments mean all customer platforms, matching bootstrap.
  return [...new Set((assigned.length ? assigned : enabled).map(normalizePlatformKey))]
    .filter(platform => enabled.includes(platform));
}

export function requirePlatforms(actor, platforms) {
  // The repository must supply this, never the browser. Missing context denies.
  assert(Array.isArray(actor.platforms), 403, 'scope_mismatch', 'Platform access could not be verified.');
  const normalized = [...new Set(platforms.map(normalizePlatformKey))];
  assert(normalized.length > 0 && normalized.every(p => actor.platforms.includes(p)),
    403, 'scope_mismatch', 'One or more platforms are outside your assigned access.');
  return normalized;
}

export function requireUrlPlatforms(actor, urls, claimedPlatform) {
  const platforms = urls.map(value => {
    let url;
    try { url = new URL(value); } catch { /* rejected below */ }
    assert(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
      400, 'invalid_event', 'A credential-free HTTP or HTTPS URL is required.');
    return detectPlatformDetails(url.href).key;
  });
  if (claimedPlatform) assert(platforms.every(p => p === normalizePlatformKey(claimedPlatform)),
    400, 'invalid_event', 'The platform does not match the target URL.');
  return requirePlatforms(actor, platforms);
}

export function authorizeEventPlatforms(actor, event) {
  const a = event.attributes;
  if (a.urls?.length) return requireUrlPlatforms(actor, a.urls, a.platform);
  if (a.target_url) return requireUrlPlatforms(actor, [a.target_url], a.platform);
  if (a.platform) return requirePlatforms(actor, [a.platform]);
  const aggregateEvents = new Set(['automation.scan_started', 'automation.scan_completed',
    'automation.row_status_changed', 'report.intelligence_generated']);
  assert(aggregateEvents.has(event.event_type), 400, 'invalid_event', 'This observation requires a target URL or platform.');
}

export function statisticsPlatforms(actor, requested = []) {
  return requirePlatforms(actor, requested.length ? requested : actor.platforms || []);
}
