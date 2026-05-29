function normalizeUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return String(url || '').split('#')[0];
  }
}

export function createRumbleWorkflow({
  handleBatchReport
}) {
  const STORAGE_KEY = 'rumble_report_session';

  async function openRumbleTab(url) {
    const tab = await chrome.tabs.create({ url, active: true });
    return tab;
  }

  async function start(formData) {
    const storage = await chrome.storage.local.get(['piracy_cart']);
    const cart = storage.piracy_cart || [];
    const urls = cart.map((item) => item.url).filter(Boolean);

    if (urls.length === 0) {
      throw new Error('Queue is empty. Use the Add buttons on Rumble pages first.');
    }

    const session = {
      active: true,
      startedAt: new Date().toISOString(),
      currentIndex: 0,
      urls: urls.map(normalizeUrl),
      formData
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: session });
    await openRumbleTab(urls[0]);

    return { success: true, total: urls.length, currentUrl: urls[0] };
  }

  async function advance(currentUrl, senderTabId) {
    const storage = await chrome.storage.local.get([STORAGE_KEY]);
    const session = storage[STORAGE_KEY];

    if (!session?.active || !Array.isArray(session.urls) || session.urls.length === 0) {
      throw new Error('No active Rumble reporting session found.');
    }

    const normalizedCurrentUrl = normalizeUrl(currentUrl);
    const currentIndex = session.urls.findIndex((url) => url === normalizedCurrentUrl);
    if (currentIndex < 0) {
      throw new Error('Current Rumble page does not match the active queue item.');
    }
    const nextIndex = currentIndex + 1;

    if (nextIndex < session.urls.length) {
      const nextUrl = session.urls[nextIndex];
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          ...session,
          currentIndex: nextIndex
        }
      });

      await openRumbleTab(nextUrl);
      if (senderTabId) {
        chrome.tabs.remove(senderTabId).catch(() => {});
      }

      return {
        success: true,
        done: false,
        nextUrl,
        currentIndex: nextIndex,
        total: session.urls.length
      };
    }

    await chrome.storage.local.remove(STORAGE_KEY);
    const response = await handleBatchReport(session.formData);
    return {
      success: !!response?.success,
      done: true,
      logged: !!response?.success,
      error: response?.error || null
    };
  }

  async function cancel() {
    await chrome.storage.local.remove(STORAGE_KEY);
    return { success: true };
  }

  return {
    start,
    advance,
    cancel
  };
}
