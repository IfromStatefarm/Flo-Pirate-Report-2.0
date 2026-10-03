// Page observations are an operator aid, never authorization evidence. The API
// independently requires sidepanel.enforce from the verified customer role.
export function enforcerPlatform(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'studio.youtube.com'].includes(parsed.hostname)) return 'youtube';
    if (['tiktok.com', 'www.tiktok.com'].includes(parsed.hostname)) return 'tiktok';
  } catch { /* Unsupported URL. */ }
  return null;
}

export function normalizeSessionAccount(value, platform) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (/^https:\/\//i.test(text)) {
    if (enforcerPlatform(text) !== platform) return null;
    const url = new URL(text);
    if (url.search || url.hash) return null;
    try { text = decodeURIComponent(url.pathname.replace(/^\//, '').replace(/\/$/, '')); }
    catch { return null; }
    if (platform === 'youtube') text = text.replace(/^channel\//, '');
  }
  // Channel IDs are case sensitive. Handles are compared in their entirety.
  if (platform === 'youtube' && /^UC[A-Za-z0-9_-]{22}$/.test(text)) return text;
  if (/^@[\p{L}\p{M}\p{N}_.·-]{1,100}$/u.test(text)) return text.normalize('NFC').toLowerCase();
  return null;
}

export async function tabHasApprovedEnforcerSession(tabId, config, scripting = chrome.scripting) {
  try {
    const [injected] = await scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      // Only read active-account fields. Never collect arbitrary anchors,
      // labels, datasets, serialized objects or a viewed channel's identity.
      func: async () => {
        const host = window.location.hostname;
        const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'studio.youtube.com'].includes(host);
        const tiktok = ['tiktok.com', 'www.tiktok.com'].includes(host);
        if (window.location.protocol !== 'https:' || (!youtube && !tiktok)) return null;
        if (tiktok) {
          const profile = document.querySelector('a[data-e2e="nav-profile"], [data-e2e="nav-profile"] a[href]');
          return { platform: 'tiktok', accounts: [profile?.href] };
        }
        const get = key => typeof window.ytcfg?.get === 'function' ? window.ytcfg.get(key) : window.ytcfg?.data_?.[key];
        if (get('LOGGED_IN') !== true) return null;
        const managerId = get('DELEGATED_SESSION_ID');
        // Opening the account menu exposes the active account, not a channel
        // being watched. The menu's scoped handle is only a UI hint as well.
        let header = document.querySelector('ytd-active-account-header-renderer');
        if (!header) {
          const trigger = document.querySelector('button#avatar-btn, #avatar-btn');
          if (trigger) {
            trigger.click();
            for (let attempt = 0; attempt < 10 && !header; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 100));
              header = document.querySelector('ytd-active-account-header-renderer');
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          }
        }
        return {
          platform: 'youtube',
          managerId: typeof managerId === 'string' ? managerId : null,
          accounts: [header?.querySelector('#channel-handle')?.textContent,
            header?.querySelector('a[href^="/channel/"], a[href^="https://www.youtube.com/channel/"]')?.href]
        };
      }
    });
    const observation = injected?.result;
    if (!['youtube', 'tiktok'].includes(observation?.platform)) return false;
    const platform = observation.platform;
    const settings = config?.[platform] || {};
    const approved = new Set([...(settings.authorizedHandles || []), ...(settings.authorizedChannelIds || [])]
      .map(value => normalizeSessionAccount(value, platform)).filter(Boolean));
    const matched = Array.isArray(observation.accounts) && observation.accounts.some(value => {
      const id = normalizeSessionAccount(value, platform);
      return id !== null && approved.has(id);
    });
    const managerId = observation.managerId;
    const matchedManager = platform === 'youtube' && typeof managerId === 'string' && /^\d+$/.test(managerId) &&
      (settings.authorizedStudioManagerIds || []).some(value => typeof value === 'string' && value.trim() === managerId);
    return Boolean(matched || matchedManager);
  } catch {
    return false;
  }
}
