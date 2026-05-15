const PLATFORM_DEFINITIONS = Object.freeze([
  {
    key: 'youtube',
    label: 'YouTube',
    reportUrl: 'https://www.youtube.com/copyright_complaint_form',
    matches: (url) => url.includes('youtube') || url.includes('youtu.be'),
    buildChannelUrl: (handle) => `https://www.youtube.com/@${handle}`
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    reportUrl: 'https://www.tiktok.com/legal/report/Copyright',
    matches: (url) => url.includes('tiktok'),
    buildChannelUrl: (handle) => `https://www.tiktok.com/@${handle}`
  },
  {
    key: 'twitter',
    label: 'Twitter',
    reportUrl: 'https://help.x.com/en/forms/ipi/dmca',
    matches: (url) => url.includes('twitter.com') || url.includes('x.com'),
    buildChannelUrl: (handle) => `https://x.com/${handle}`
  },
  {
    key: 'instagram',
    label: 'Instagram',
    reportUrl: null,
    matches: (url) => url.includes('instagram'),
    buildChannelUrl: (handle) => `https://www.instagram.com/${handle}`
  },
  {
    key: 'facebook',
    label: 'Facebook',
    reportUrl: null,
    matches: (url) => url.includes('facebook'),
    buildChannelUrl: (handle) => `https://www.facebook.com/${handle}`
  },
  {
    key: 'twitch',
    label: 'Twitch',
    reportUrl: null,
    matches: (url) => url.includes('twitch'),
    buildChannelUrl: (handle) => `https://www.twitch.tv/${handle}`
  }
]);

const INTERNAL_MANAGED_DOMAIN_FRAGMENTS = Object.freeze([
  'varsity.com',
  'flosports',
  'floracing',
  'milesplit'
]);

export function normalizePlatformKey(platform) {
  const normalized = String(platform || '').toLowerCase().trim();
  return normalized === 'x' ? 'twitter' : normalized;
}

export function getPlatformDefinition(platform) {
  const normalizedKey = normalizePlatformKey(platform);
  return PLATFORM_DEFINITIONS.find(({ key }) => key === normalizedKey) || null;
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
    const pathname = new URL(rawUrl).pathname;
    const firstSegment = pathname.split('/').filter(Boolean)[0];
    return firstSegment || 'Unknown';
  } catch (error) {
    return 'Unknown';
  }
}
