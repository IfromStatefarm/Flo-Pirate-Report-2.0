export function createRogueWorkflow({
  base64ToBlob,
  ensureRogueScreenshotFolder,
  getAuthToken,
  logRogueToSheet,
  uploadToDrive
}) {
  const sniffedNetworkTraffic = new Map();

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const url = details.url.toLowerCase();
      if (url.includes('flosports') || url.includes('varsity') || url.includes('milesplit')) return;

      if (details.url.startsWith('wss://')) {
        sniffedNetworkTraffic.set(details.url, 'WebSocket/C2');
      }
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      const url = details.url.toLowerCase();
      if (
        url.includes('flosports') ||
        url.includes('varsity') ||
        url.includes('milesplit') ||
        url.includes('lom.flosports.net')
      ) {
        return;
      }

      if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts')) {
        sniffedNetworkTraffic.set(details.url, details.ip || 'IP Hidden/Cloudflare');
      }
    },
    { urls: ['<all_urls>'] }
  );

  async function capture(data) {
    const trafficArray = Array.from(sniffedNetworkTraffic.entries()).map(([url, ip]) => ({ url, ip }));

    let screenshotUrl = null;
    try {
      screenshotUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
    } catch (error) {
      console.warn('Screenshot failed:', error);
    }

    const rogueData = { ...data, networkTraffic: trafficArray, screenshot: screenshotUrl };
    await chrome.storage.local.set({ rogue_target_data: rogueData });
    sniffedNetworkTraffic.clear();

    return { success: true };
  }

  async function log(data, notes = '') {
    const token = await getAuthToken();
    let finalNotes = notes;

    if (data.screenshot) {
      const imageBlob = base64ToBlob(data.screenshot);
      const folderId = await ensureRogueScreenshotFolder(token);
      const urlObj = new URL(data.url);
      const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
      const dateStr = new Date()
        .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        .replace(/\//g, '.');
      const safeLink =
        urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '.').replace(/^\.+|\.+$/g, '').substring(0, 40) ||
        'stream';
      const filename = `${domain}.${safeLink}.${dateStr}.jpg`;

      const uploadRes = await uploadToDrive(token, folderId, filename, imageBlob, 'image/jpeg');
      finalNotes += `\n\nEvidence Screenshot: ${uploadRes.webViewLink}`;
    }

    await logRogueToSheet(token, data, finalNotes);
    return { success: true };
  }

  return {
    capture,
    log
  };
}
