import { ApiError, assert } from '../api_error.js';

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const unavailable = () => new ApiError(403, 'target_account_unverified', 'The YouTube target account could not be verified. Retry after checking the target and connector access.');

function youtubeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw unavailable(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) throw unavailable();
  return { url, host };
}

// Protected accounts must be pinned to immutable IDs. Resolving a stored handle
// on each request would silently change protection after a rename/reassignment.
export function protectedYoutubeChannelId(value) {
  const text = String(value ?? '').trim();
  if (CHANNEL_ID.test(text)) return text;
  try {
    const { url, host } = youtubeUrl(text);
    const id = host !== 'youtu.be' && url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
    if (id && !url.search && !url.hash) return id;
  } catch { /* Reject legacy handles instead of treating them as unprotected. */ }
  throw new ApiError(403, 'authorized_accounts_unverified', 'YouTube protected accounts must use stable channel IDs or /channel/ URLs in the customer whitelist.');
}

export function createYoutubeAccountResolver({ token, apiKey = process.env.YOUTUBE_DATA_API_KEY, fetchImpl = globalThis.fetch }) {
  // Adapter lifetime is one request: no cross-customer or stale identity cache.
  const requests = new Map();
  async function lookup(resource, params) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams(params).toString();
    if (apiKey) url.searchParams.set('key', apiKey);
    if (!requests.has(url.href)) requests.set(url.href, (async () => {
      try {
        const response = await fetchImpl(url.href, {
          headers: apiKey ? {} : { Authorization: `Bearer ${token}` }, redirect: 'error',
          signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw unavailable();
        const data = await response.json();
        if (!Array.isArray(data.items) || data.items.length !== 1 || !data.items[0] || typeof data.items[0] !== 'object') throw unavailable();
        return data.items[0];
      } catch { throw unavailable(); }
    })());
    return requests.get(url.href);
  }

  async function resolveAccount(value) {
    const text = String(value ?? '').trim();
    let id, handle, username;
    if (/^https?:\/\//i.test(text)) {
      const { url, host } = youtubeUrl(text);
      if (host === 'youtu.be' || url.search || url.hash) throw unavailable();
      id = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
      handle = url.pathname.match(/^\/@([^/]+)\/?$/)?.[1];
      username = url.pathname.match(/^\/user\/([^/]+)\/?$/)?.[1];
      try { if (handle) handle = decodeURIComponent(handle); if (username) username = decodeURIComponent(username); } catch { throw unavailable(); }
    } else if (CHANNEL_ID.test(text)) id = text;
    else handle = text.replace(/^@/, '');
    if (!id && !/^[\p{L}\p{M}\p{N}_.·-]{1,100}$/u.test(handle || username || '')) throw unavailable();
    const account = await lookup('channels', { part: 'id', ...(id ? { id } : username ? { forUsername: username } : { forHandle: handle }) });
    if (!CHANNEL_ID.test(account.id) || (id && account.id !== id)) throw unavailable();
    return account.id;
  }

  async function resolveTargetAccount(value) {
    const { url, host } = youtubeUrl(value);
    let videoId;
    if (host === 'youtu.be') videoId = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
    else if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v');
    else videoId = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
    if (videoId) {
      if (!VIDEO_ID.test(videoId)) throw unavailable();
      const video = await lookup('videos', { part: 'snippet', id: videoId });
      if (video.id !== videoId || !CHANNEL_ID.test(video.snippet?.channelId)) throw unavailable();
      return video.snippet.channelId;
    }
    // Only exact account routes are accepted; opaque or ambiguous routes deny.
    assert(!url.search && !url.hash, 403, 'target_account_unverified', 'The YouTube target URL is ambiguous.');
    return resolveAccount(url.href);
  }

  return { resolveAccount, resolveTargetAccount };
}
