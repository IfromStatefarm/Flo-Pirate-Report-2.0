import { ApiError } from '../api_error.js';

const HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const unavailable = () => new ApiError(400, 'target_identity_unverified', 'Use a supported TikTok video URL or a share link that resolves to one.');

export function isTiktokUrl(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
    host === 'tiktokforbusiness.com' || host.endsWith('.tiktokforbusiness.com');
}

function parseTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw unavailable(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOSTS.has(host) || !['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password) throw unavailable();
  url.hostname = host;
  url.hash = '';
  return { url, host };
}

// IDs stay decimal strings: adjacent 64-bit IDs cannot safely pass through Number.
export function tiktokVideoId(value) {
  const { url } = parseTarget(value);
  const id = url.pathname.match(/^\/(?:@[^/]+\/video|share\/video|embed\/v2|player\/v1)\/([1-9][0-9]{0,19})\/?$/)?.[1];
  return id && BigInt(id) <= 18446744073709551615n ? id : null;
}

function shareUrl(value) {
  const { url, host } = parseTarget(value);
  const shortHost = host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
  if (url.protocol !== 'https:' || !(shortHost ? /^\/[A-Za-z0-9_-]+\/?$/ : /^\/t\/[A-Za-z0-9_-]+\/?$/).test(url.pathname)) throw unavailable();
  return url;
}

export function requireTiktokVideoId(value) {
  const id = tiktokVideoId(value);
  if (!id) throw unavailable();
  return id;
}

export function createTiktokTargetResolver({ fetchImpl = globalThis.fetch } = {}) {
  return async function resolveTiktokVideoUrl(value) {
    try {
      if (tiktokVideoId(value)) return new URL(value).href;
      let url = shareUrl(value);
      const seen = new Set();
      const signal = AbortSignal.timeout(8000);
      for (let hop = 0; hop < 3; hop++) {
        if (seen.has(url.href)) throw unavailable();
        seen.add(url.href);
        // Never forward Google credentials, cookies, or follow unchecked redirects.
        const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal });
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw unavailable();
        const next = new URL(location, url);
        if (next.protocol !== 'https:') throw unavailable();
        if (tiktokVideoId(next.href)) return next.href;
        url = shareUrl(next.href);
      }
    } catch { throw unavailable(); }
    throw unavailable();
  };
}
