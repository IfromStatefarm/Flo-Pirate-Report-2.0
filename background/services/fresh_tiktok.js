export async function getFreshTikTokViews(url) {
  let tabId = null;

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    await new Promise((resolve) => {
      const safetyTimeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 8000);

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          clearTimeout(safetyTimeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const bodyText = document.body.innerText;
          if (
            bodyText.includes('Video currently unavailable') ||
            bodyText.includes('not find this account') ||
            bodyText.includes('Video not found')
          ) {
            return { views: 'DELETED', status: 'DELETED' };
          }

          let el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (el && el.textContent) {
            const json = JSON.parse(el.textContent);
            const defaultScope = json.__DEFAULT_SCOPE__;
            const struct = defaultScope?.['webapp.video-detail']?.itemInfo?.itemStruct;
            if (struct && struct.stats) {
              return { views: struct.stats.playCount, status: 'ACTIVE' };
            }
          }

          el = document.getElementById('SIGI_STATE');
          if (el && el.textContent) {
            const json = JSON.parse(el.textContent);
            const itemMod = json.ItemModule;
            if (itemMod) {
              const keys = Object.keys(itemMod);
              if (keys.length > 0 && itemMod[keys[0]].stats) {
                return { views: itemMod[keys[0]].stats.playCount, status: 'ACTIVE' };
              }
            }
          }

          const viewEl = document.querySelector('[data-e2e="video-views"]');
          if (viewEl) return { views: viewEl.innerText, status: 'ACTIVE' };

          return { views: 'N/A', status: 'UNKNOWN' };
        } catch (error) {
          return { views: 'ERROR', status: 'ERROR' };
        }
      }
    });

    return result[0]?.result || { views: 'N/A', status: 'UNKNOWN' };
  } catch (error) {
    console.error('Fresh Scrape Error:', error);
    return { views: 'N/A', status: 'ERROR' };
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}
