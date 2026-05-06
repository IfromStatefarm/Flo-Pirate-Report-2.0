export function createSearchWorkflow({
  addNewEventToSheet,
  getEventData,
  updateEventUrl
}) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;

    const session = await chrome.storage.session.get(['activeSearchTabId']);
    if (session.activeSearchTabId !== tabId) return;

    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ['search_bot.js']
      })
      .catch((error) => console.error('Failed to inject bot:', error));
  });

  async function handleDynamicSearch(data) {
    try {
      const session = await chrome.storage.session.get(['activeSearchTabId', 'activeEventDetails']);
      if (session.activeSearchTabId) {
        try {
          await chrome.tabs.get(session.activeSearchTabId);
          return {
            success: false,
            error: 'SEARCH_IN_PROGRESS',
            activeEvent: session.activeEventDetails?.eventName || 'Unknown'
          };
        } catch (error) {
          await chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
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
        addNewEventToSheet(vertical, originalName, url);
      } else {
        updateEventUrl(vertical, rowIndex, url);
      }

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

      chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    }

    return { received: true };
  }

  async function handleBotSearchFailed(reason) {
    chrome.runtime.sendMessage({ action: 'botSearchFailed', error: reason }).catch(() => {});
    await chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    return { received: true };
  }

  return {
    handleDynamicSearch,
    handleBotSearchComplete,
    handleBotSearchFailed
  };
}
