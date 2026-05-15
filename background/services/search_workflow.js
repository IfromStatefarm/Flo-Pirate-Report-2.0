export function createSearchWorkflow({
  addNewEventToSheet,
  getEventData,
  updateEventUrl
}) {
  function normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch (error) {
      void error;
      return String(url || '').trim();
    }
  }

  function hostsMatch(currentHost, baseHost) {
    return (
      currentHost === baseHost ||
      currentHost.endsWith(`.${baseHost}`) ||
      baseHost.endsWith(`.${currentHost}`)
    );
  }

  function shouldCaptureSelectedUrl(currentUrl, searchBaseUrl) {
    if (!currentUrl || !searchBaseUrl) return false;

    try {
      const current = new URL(currentUrl);
      const base = new URL(searchBaseUrl);
      const currentPath = current.pathname.replace(/\/+$/, '') || '/';
      const basePath = base.pathname.replace(/\/+$/, '') || '/';
      const normalizedCurrent = normalizeUrl(current.href);
      const normalizedBase = normalizeUrl(base.href);

      if (!hostsMatch(current.hostname, base.hostname)) return false;
      if (normalizedCurrent === normalizedBase) return false;
      if (currentPath === '/' || currentPath === basePath) return false;
      if (/\/search\/?$/i.test(currentPath)) return false;

      return true;
    } catch (error) {
      console.warn('Unable to evaluate selected search URL:', error);
      return false;
    }
  }

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;

    const session = await chrome.storage.session.get([
      'activeSearchTabId',
      'activeSearchBaseUrl'
    ]);
    if (session.activeSearchTabId !== tabId) return;

    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url || changeInfo.url;

      if (!shouldCaptureSelectedUrl(currentUrl, session.activeSearchBaseUrl)) {
        return;
      }

      await handleBotSearchComplete(currentUrl);
    } catch (error) {
      console.error('Failed to auto-capture selected search URL:', error);
    }
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const session = await chrome.storage.session.get(['activeSearchTabId']);
    if (session.activeSearchTabId !== tabId) return;

    await handleBotSearchFailed('Search was closed before a FloSports page was selected.');
  });

  async function handleDynamicSearch(data) {
    try {
      const session = await chrome.storage.session.get([
        'activeSearchTabId',
        'activeEventDetails'
      ]);
      if (session.activeSearchTabId) {
        try {
          await chrome.tabs.get(session.activeSearchTabId);
          return {
            success: false,
            error: 'SEARCH_IN_PROGRESS',
            activeEvent: session.activeEventDetails?.eventName || 'Unknown'
          };
        } catch (error) {
          await chrome.storage.session.remove([
            'activeSearchTabId',
            'activeSearchBaseUrl',
            'activeEventDetails'
          ]);
        }
      }

      const { eventName, vertical } = data;
      const sheetData = await getEventData(vertical);
      const searchBaseUrl = sheetData.searchUrl;
      if (!searchBaseUrl) {
        return { success: false, error: 'No Search URL found in Sheet.' };
      }

      const existingEvent = sheetData.eventMap[eventName.toLowerCase()];
      const tab = await chrome.tabs.create({ url: searchBaseUrl, active: true });

      await chrome.storage.session.set({
        activeSearchTabId: tab.id,
        activeSearchBaseUrl: searchBaseUrl,
        activeEventDetails: {
          vertical,
          eventName,
          originalName: eventName,
          rowIndex: existingEvent ? existingEvent.rowIndex : 'APPEND'
        }
      });

      return { success: true, status: 'tab_opened' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function handleBotSearchComplete(url) {
    const session = await chrome.storage.session.get(['activeEventDetails', 'activeSearchTabId']);
    const activeEventDetails = session.activeEventDetails;
    const activeSearchTabId = session.activeSearchTabId;

    if (activeEventDetails) {
      const { vertical, rowIndex, originalName } = activeEventDetails;
      if (rowIndex === 'APPEND') {
        await addNewEventToSheet(vertical, originalName, url);
      } else {
        await updateEventUrl(vertical, rowIndex, url);
      }

      await chrome.storage.session.remove([
        'activeSearchTabId',
        'activeSearchBaseUrl',
        'activeEventDetails'
      ]);

      if (activeSearchTabId) {
        chrome.tabs.remove(activeSearchTabId).catch(() => {});
      }

      chrome.runtime
        .sendMessage({
          action: 'urlFound',
          url,
          source: 'Automated Search'
        })
        .catch(() => {});
    }

    return { received: true };
  }

  async function handleBotSearchFailed(reason) {
    chrome.runtime.sendMessage({ action: 'botSearchFailed', error: reason }).catch(() => {});
    await chrome.storage.session.remove([
      'activeSearchTabId',
      'activeSearchBaseUrl',
      'activeEventDetails'
    ]);
    return { received: true };
  }

  return {
    handleDynamicSearch,
    handleBotSearchComplete,
    handleBotSearchFailed
  };
}
