import { PLATFORM_CATALOG, PLATFORM_CATALOG_BY_KEY } from './platform_catalog.js';

const PLATFORM_DEFINITIONS = PLATFORM_CATALOG;
const SUPPORTED_PLATFORM_ORDER = Object.freeze([
  'tiktok',
  'instagram',
  'youtube',
  'twitter',
  'twitch',
  'facebook',
  'kick',
  'discord',
  'rumble'
]);

const INTERNAL_MANAGED_DOMAIN_FRAGMENTS = Object.freeze([]);

export function normalizePlatformKey(platform) {
  const normalized = String(platform || '').toLowerCase().trim();
  return normalized === 'x' ? 'twitter' : normalized;
}

export function getPlatformDefinition(platform) {
  const normalizedKey = normalizePlatformKey(platform);
  return PLATFORM_CATALOG_BY_KEY[normalizedKey] || null;
}

export function getSupportedPlatforms() {
  return SUPPORTED_PLATFORM_ORDER
    .map((key) => getPlatformDefinition(key))
    .filter(Boolean)
    .map(({ key, label }) => ({ key, label }));
}

export function detectPlatformDetails(url) {
  const normalizedUrl = String(url || '').toLowerCase();
  return PLATFORM_DEFINITIONS.find((definition) => definition.matches(normalizedUrl)) || {
    key: 'other',
    label: 'Other',
    reportUrl: null,
    buildChannelUrl: () => ''
  };
}

export function buildChannelUrl(platform, handle) {
  if (!handle) return '';

  const definition = getPlatformDefinition(platform) || detectPlatformDetails(platform);
  return definition.buildChannelUrl ? definition.buildChannelUrl(handle) : '';
}

export function urlMatchesPlatform(url, platform) {
  const normalizedUrl = String(url || '').toLowerCase();
  const normalizedPlatform = normalizePlatformKey(platform);

  if (normalizedPlatform === 'other') {
    return detectPlatformDetails(normalizedUrl).key === 'other';
  }

  const definition = getPlatformDefinition(normalizedPlatform);
  return definition ? definition.matches(normalizedUrl) : false;
}

export function isInternalManagedUrl(url) {
  const normalizedUrl = String(url || '').toLowerCase();
  return INTERNAL_MANAGED_DOMAIN_FRAGMENTS.some((fragment) => normalizedUrl.includes(fragment));
}

export function extractHandleFromUrl(url) {
  const rawUrl = String(url || '');

  if (rawUrl.includes('@')) {
    const afterAt = rawUrl.split('@')[1];
    return afterAt ? afterAt.split(/[/?]/)[0] || 'Unknown' : 'Unknown';
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const pathnameSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const firstSegment = pathnameSegments[0];

    if (parsedUrl.hostname.toLowerCase().includes('rumble.com')) {
      if (['c', 'user', 'channel'].includes((firstSegment || '').toLowerCase()) && pathnameSegments[1]) {
        return pathnameSegments[1].replace(/\.html$/i, '') || 'Unknown';
      }
      if (firstSegment?.startsWith('@')) {
        return firstSegment.slice(1) || 'Unknown';
      }
    }

    return firstSegment ? firstSegment.replace(/\.html$/i, '') : 'Unknown';
  } catch (error) {
    return 'Unknown';
  }
}
