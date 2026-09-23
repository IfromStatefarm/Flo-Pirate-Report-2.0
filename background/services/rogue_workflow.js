import { captureForTab, evidenceScope, belongsToScope, redactObservationUrl } from '../../utils/evidence_scope.js';

export function createRogueWorkflow({
  base64ToBlob,
  ensureRogueScreenshotFolder,
  getAuthToken,
  uploadToDrive,
  getCustomerProfile,
  recordCustomerEvent
}) {
  const sniffedNetworkTraffic = new Map();
  let session = null;
  function observe(details, value) {
    if (!session || session.expiresAt < Date.now() || details.tabId !== session.tabId) return;
    const url = redactObservationUrl(details.url);
    if (url && sniffedNetworkTraffic.size < 100) sniffedNetworkTraffic.set(url, value);
  }

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.url.startsWith('wss://')) {
        observe(details, 'WebSocket');
      }
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      const url = details.url.toLowerCase();

      if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts')) {
        observe(details, details.ip || 'IP unavailable');
      }
    },
    { urls: ['<all_urls>'] }
  );

  async function capture(data, tab) {
    const profile = await getCustomerProfile();
    if (!Number.isInteger(tab?.id) || data.url !== tab.url) throw new Error('Capture must originate from the selected page.');
    reset();
    const captureId = crypto.randomUUID();
    session = { captureId, ...evidenceScope(profile), tabId: tab.id, expiresAt: Date.now() + 5000 };
    // Observe only this explicit capture, never ambient browsing across tabs.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const trafficArray = Array.from(sniffedNetworkTraffic.entries()).map(([url, ip]) => ({ url, ip }));

    let screenshotUrl = null;
    try {
      screenshotUrl = await captureForTab(tab);
    } catch (error) {
      console.warn('Screenshot failed:', error);
    }

    const current = await getCustomerProfile();
    if (!session || session.captureId !== captureId || !belongsToScope(session, current)) throw new Error('Account changed during capture.');
    const rogueData = { ...data, ...evidenceScope(profile), networkTraffic: trafficArray, screenshot: screenshotUrl };
    await chrome.storage.local.set({ rogue_target_data: rogueData });
    reset();

    return { success: true };
  }

  async function log(data, notes = '') {
    const customerProfile = await getCustomerProfile();
    if (!belongsToScope(data, customerProfile)) throw new Error('Capture this evidence again with the current account.');
    const customerEventId = crypto.randomUUID();
    const token = await getAuthToken();
    let evidenceUrl = '';

    if (data.screenshot) {
      const imageBlob = base64ToBlob(data.screenshot);
      const folderId = await ensureRogueScreenshotFolder(token, customerProfile.integrations);
      const urlObj = new URL(data.url);
      const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
      const dateStr = new Date()
        .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        .replace(/\//g, '.');
      const safeLink =
        urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '.').replace(/^\.+|\.+$/g, '').substring(0, 40) ||
        'stream';
      const filename = `${domain}.${safeLink}.${dateStr}.jpg`;

      const uploadRes = await uploadToDrive(token, folderId, filename, imageBlob, 'image/jpeg', {
        customerId: customerProfile.customerId,
        userId: customerProfile.userId,
        eventId: customerEventId
      });
      evidenceUrl = uploadRes.webViewLink;
    }

    const domain = new URL(data.url).hostname.replace(/^www\./, '').toLowerCase();
    const accepted = await recordCustomerEvent(customerProfile, 'rogue.evidence_logged', {
      target_url: data.url,
      domain,
      notes,
      evidence_url: evidenceUrl,
      network_observation_count: Array.isArray(data.networkTraffic) ? data.networkTraffic.length : 0,
      embedded_video_count: Array.isArray(data.videos) ? data.videos.length : 0,
      iframe_count: Array.isArray(data.iframes) ? data.iframes.length : 0,
      email_count: Array.isArray(data.emails) ? data.emails.length : 0
    }, { eventId: customerEventId });
    return { success: true, eventId: accepted.event_id };
  }

  function reset() { session = null; sniffedNetworkTraffic.clear(); }
  return {
    capture,
    log,
    reset
  };
}
