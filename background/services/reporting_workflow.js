import { buildChannelUrl, detectPlatformDetails } from '../../utils/platforms.js';
import { getFreshTikTokViews } from './fresh_tiktok.js';

function generateReportId() {
  const nums = Math.floor(10 + Math.random() * 90);
  const letters = Math.random().toString(36).substring(2, 8);
  return `${nums}${letters}`.toUpperCase();
}

function parseViewCount(value) {
  const normalized = String(value || '0').toLowerCase();
  if (normalized === 'pending' || normalized === 'n/a' || normalized === 'deleted' || normalized === 'error') {
    return 0;
  }
  if (normalized.includes('k')) return parseFloat(normalized) * 1000;
  if (normalized.includes('m')) return parseFloat(normalized) * 1000000;
  return parseFloat(normalized.replace(/[^\d.]/g, '')) || 0;
}

const PLATFORM_BATCH_LIMITS = Object.freeze({
  youtube: 10,
  instagram: 30
});
<<<<<<< Updated upstream

const TWITCH_SCRAPE_SETTLE_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTwitchUrl(url) {
  return String(url || '').toLowerCase().includes('twitch.tv');
}

function inferTwitchContentTypeFromUrl(url) {
  try {
    const parsedUrl = new URL(String(url || ''));
    const host = parsedUrl.hostname.toLowerCase();
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());
    const firstSegment = pathParts[0] || '';

    if (host.includes('clips.twitch.tv') || firstSegment === 'clip' || pathParts.includes('clip')) return 'clip';
    if (firstSegment === 'videos' || firstSegment === 'collections') return 'vod';
  } catch (error) {
    // Ignore malformed URLs and let the item metadata decide.
  }

  return '';
}

function normalizeTwitchContentType(item = {}) {
  const explicitType = String(item.contentType || item.type || '').toLowerCase();
  if (item.isLive || explicitType.includes('live')) return 'live';
  if (explicitType.includes('clip')) return 'clip';
  if (explicitType.includes('vod') || explicitType.includes('video')) return 'vod';

  return inferTwitchContentTypeFromUrl(item.url) || 'vod';
}

function normalizeTwitchHandle(handle) {
  const normalized = String(handle || '').trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  return normalized && normalized.toLowerCase() !== 'twitchuser' ? normalized : '';
}

function mergeScrapedTwitchData(item, scrapedData) {
  if (!scrapedData || typeof scrapedData !== 'object') return item;

  const merged = { ...item };
  const scrapedHandle = normalizeTwitchHandle(scrapedData.handle);
  if (scrapedHandle) merged.handle = scrapedHandle;

  const scrapedViews = String(scrapedData.views || '').trim();
  if (scrapedViews && scrapedViews.toUpperCase() !== 'N/A') {
    merged.views = scrapedViews;
  } else if (!merged.views) {
    merged.views = 'N/A';
  }

  const contentType = normalizeTwitchContentType({
    ...merged,
    ...scrapedData,
    url: merged.url || scrapedData.url
  });

  merged.contentType = contentType;
  merged.isLive = contentType === 'live';
  if (contentType === 'clip') merged.isClip = true;

  return merged;
}

=======
>>>>>>> Stashed changes
export function createReportingWorkflow({
  appendToSheet,
  checkIfAuthorized,
  clearImages,
  ensureDailyScreenshotFolder,
  ensureYearlyReportFolder,
  generatePDF,
  getAuthToken,
  getEventData,
  getImage,
  getUserEmail,
  saveImage,
  saveUrlToSheet,
  setColumnKRichText,
  uploadToDrive,
  base64ToBlob
}) {
  async function captureVisibleTabImage() {
    try {
      const screenshotPromise = chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot timed out')), 5000);
      });

      return await Promise.race([screenshotPromise, timeoutPromise]);
    } catch (error) {
      console.warn('Screenshot capture skipped/failed:', error);
      return null;
    }
  }

  async function waitForTabComplete(tabId, timeout = 15000) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch (error) {
      return;
    }

    await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeout);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function injectContentScraper(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ['content_scraper.js']
      });
    } catch (error) {
      console.warn('Twitch scrape helper injection skipped/failed:', error);
    }
  }

  async function scrapeTwitchPageFallback(tabId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func: () => {
          const toText = (element) => [
            element?.innerText,
            element?.textContent,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title')
          ].filter(Boolean).join(' ');
          const readViews = (value) => {
            const text = String(value || '').trim();
            const match = text.match(/([\d.,]+(?:\s*[KMB])?)(?=\s*(?:views?|watching|viewers?)\b)/i) ||
              text.match(/^([\d.,]+(?:\s*[KMB])?)$/i);
            return match?.[1]?.replace(/\s+/g, '') || '';
          };
          const all = (selector) => {
            try {
              return Array.from(document.querySelectorAll(selector));
            } catch (error) {
              return [];
            }
          };
          const pathParts = window.location.pathname.split('/').filter(Boolean);
          const lowerParts = pathParts.map((part) => part.toLowerCase());
          const firstSegment = lowerParts[0] || '';
          const host = window.location.hostname.toLowerCase();
          const isClip = host.includes('clips.twitch.tv') || firstSegment === 'clip' || lowerParts.includes('clip');
          const isVod = !isClip && (firstSegment === 'videos' || firstSegment === 'collections');
          const liveSignal = Boolean(document.querySelector('[data-a-target="stream-live-indicator"], [data-a-target="channel-status-text-indicator"], [class*="tw-channel-status-text-indicator"], [class*="ScChannelStatusTextIndicator"]'));
          const isLive = !isClip && !isVod && liveSignal;
          const reserved = new Set(['clip', 'clips', 'collections', 'directory', 'downloads', 'jobs', 'login', 'p', 'settings', 'videos']);
          const handleSelectors = [
            '[data-test-selector="metadata-layout__split-top"] a[href^="/"]',
            '[class*="metadata-layout__split-top"] a[href^="/"]',
            '#live-channel-stream-information a[href^="/"]',
            'a[href^="/"][class*="CoreLink"]',
            'h1 a[href^="/"]',
            'a[href^="/"] h1'
          ];
          let handle = '';
          for (const selector of handleSelectors) {
            for (const element of all(selector)) {
              const anchor = element.matches?.('a[href]') ? element : element.closest?.('a[href]') || element.querySelector?.('a[href]');
              const candidate = (anchor?.getAttribute('href') || '').split('/').filter(Boolean).find((segment) => !reserved.has(segment.toLowerCase()));
              if (candidate) {
                handle = candidate.replace(/^@/, '');
                break;
              }
            }
            if (handle) break;
          }
          if (!handle) {
            handle = pathParts.find((segment) => !reserved.has(segment.toLowerCase())) || 'TwitchUser';
          }

          const viewSelectors = [
            '[data-a-target="animated-channel-viewers-count"]',
            '[data-a-target="channel-viewers-count"]',
            '[data-test-selector="metadata-layout__split-top"] p',
            '[class*="metadata-layout__split-top"] p',
            '[class*="ScAnimatedNumber"]',
            'p[class*="CoreText"]'
          ];
          let views = '';
          for (const selector of viewSelectors) {
            for (const element of all(selector)) {
              views = readViews(toText(element));
              if (views) break;
            }
            if (views) break;
          }

          return {
            platform: 'Twitch',
            url: window.location.href,
            handle,
            views: views || 'N/A',
            contentType: isClip ? 'clip' : (isLive ? 'live' : 'vod'),
            isLive,
            timestamp: new Date().toISOString()
          };
        }
      });

      return result?.result || null;
    } catch (error) {
      console.warn('Twitch fallback scrape failed:', error);
      return null;
    }
  }

  async function scrapeTwitchUrlInSecondTab(url, options = {}) {
    const createOptions = { url, active: false };
    if (Number.isInteger(options.windowId)) createOptions.windowId = options.windowId;

    let tab = null;
    try {
      tab = await chrome.tabs.create(createOptions);
      if (!tab?.id) return null;

      await waitForTabComplete(tab.id);
      await sleep(TWITCH_SCRAPE_SETTLE_MS);
      await injectContentScraper(tab.id);
      await sleep(300);

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentPirateScrape' });
        if (response?.success && response.data) return response.data;
      } catch (error) {
        // Fall through to the self-contained scraper when the content script is unavailable.
      }

      return scrapeTwitchPageFallback(tab.id);
    } catch (error) {
      console.warn(`Failed to scrape Twitch URL in second tab: ${url}`, error);
      return null;
    } finally {
      if (tab?.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (error) {
          // The user may have closed the temporary tab manually.
        }
      }
    }
  }

  async function refreshTwitchQueueMetadata(options = {}) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (!cart.some((item) => isTwitchUrl(item.url))) return cart;

    const refreshedCart = [];
    let twitchIndex = 0;
    const twitchItems = cart.filter((item) => isTwitchUrl(item.url));

    for (const item of cart) {
      if (!isTwitchUrl(item.url)) {
        refreshedCart.push(item);
        continue;
      }

      twitchIndex += 1;
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        status: `Scraping Twitch metadata (${twitchIndex}/${twitchItems.length})...`,
        percent: Math.min(35, 5 + Math.floor((twitchIndex / twitchItems.length) * 25))
      });

      const scrapedData = await scrapeTwitchUrlInSecondTab(item.url, options);
      refreshedCart.push(mergeScrapedTwitchData(item, scrapedData));
    }

    await chrome.storage.local.set({ piracy_cart: refreshedCart });
    return refreshedCart;
  }

  async function handleAddVideo(tab, data) {
    void tab;

    try {
      const screenshotUrl = await captureVisibleTabImage();
      const screenshotId = crypto.randomUUID();
      if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
      }

      const scoutedByEmail = (await getUserEmail()) || 'Unknown';
      const newItem = {
        ...data,
        screenshotId: screenshotUrl ? screenshotId : null,
        timestamp: new Date().toISOString(),
        scoutedBy: scoutedByEmail
      };

      const storage = await chrome.storage.local.get('piracy_cart');
      const cart = storage.piracy_cart || [];

      if (!cart.some((item) => item.url === data.url)) {
        cart.push(newItem);
        await chrome.storage.local.set({ piracy_cart: cart });
      }

      return { success: true, count: cart.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function handleProcessNewItem(tab, data) {
    void tab;

    try {
      const screenshotUrl = await captureVisibleTabImage();

      try {
        const isAuthorized = await checkIfAuthorized(data.platform, data.handle);
        if (isAuthorized) {
          const userEmail = (await getUserEmail()) || 'Unknown';
          await appendToSheet(await getAuthToken(), {
            values: [
              new Date().toLocaleDateString('en-US'),
              data.vertical || 'Unknown',
              'Penalty',
              data.platform,
              'N/A',
              '0',
              userEmail,
              data.url,
              'Whitelist Penalty',
              'Failed',
              '',
              userEmail,
              userEmail,
              -15,
              0,
              '',
              '',
              '',
              '',
              'PENALTY'
            ]
          });

          return {
            success: false,
            status: 'whitelisted',
            milestoneHit: true,
            milestoneMessage: `⚠️ BLOCKED: @${data.handle} is whitelisted! Penalty: -15 Points.`
          };
        }
      } catch (error) {
        console.warn('Whitelist check failed, proceeding to save anyway:', error);
      }

      const screenshotId = crypto.randomUUID();
      if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
      }

      const scoutedByEmail = (await getUserEmail()) || 'Unknown';
      const newItem = {
        ...data,
        screenshotId: screenshotUrl ? screenshotId : null,
        timestamp: new Date().toISOString(),
        scoutedBy: scoutedByEmail
      };

      const storage = await chrome.storage.local.get('piracy_cart');
      const cart = storage.piracy_cart || [];
      if (!cart.some((item) => item.url === data.url)) {
        cart.push(newItem);
        await chrome.storage.local.set({ piracy_cart: cart });
      }

      return { success: true, status: 'added', count: cart.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function handleBatchReport(formData) {
    try {
      const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
      let cart = storage.piracy_cart || [];
      const savedName = storage.last_reporter || 'Unknown User';
      const finalReporterName = formData.reporterName || savedName;
      const enforcedByEmail = (await getUserEmail()) || 'Unknown';

      if (cart.some((item) => isTwitchUrl(item.url))) {
        cart = await refreshTwitchQueueMetadata(formData?.tabOptions || {});
      }

      let remainingCart = [];
      const primaryPlatformKey = cart.length > 0 ? detectPlatformDetails(cart[0].url).key : '';
      const batchLimit = PLATFORM_BATCH_LIMITS[primaryPlatformKey];
      if (batchLimit && cart.length > batchLimit) {
        remainingCart = cart.slice(batchLimit);
        cart = cart.slice(0, batchLimit);
      }

      const updatedCart = [];
      let failedScrapeCount = 0;
      chrome.runtime.sendMessage({ action: 'progressUpdate', status: 'Verifying view counts...', percent: 5 });

      for (let index = 0; index < cart.length; index++) {
        const item = cart[index];
        if (item.url.includes('tiktok.com') && (item.views === 'PENDING' || item.views === 'N/A')) {
          chrome.runtime.sendMessage({
            action: 'progressUpdate',
            status: `Scraping views (${index + 1}/${cart.length})...`,
            percent: 5 + Math.floor((index / cart.length) * 30)
          });

          try {
            const freshData = await getFreshTikTokViews(item.url);
            if (freshData.views) item.views = freshData.views;

            if (item.views === 'N/A') failedScrapeCount++;
            if (freshData.status === 'DELETED') {
              item.views = 'DELETED';
            }
          } catch (error) {
            console.error(`Failed fresh scrape for ${item.url}`, error);
            failedScrapeCount++;
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        updatedCart.push(item);
      }

      if (failedScrapeCount > 5) {
        chrome.runtime.sendMessage({
          action: 'progressError',
          error: "Selector Repair Needed: TikTok/YouTube data structure changed. Please use 'Record Selectors' tool."
        });
        return { success: false, error: 'Selector Repair Needed - View count mapping broken.' };
      }

      cart = updatedCart;
      await chrome.storage.local.set({ piracy_cart: cart });

      chrome.runtime.sendMessage({ action: 'progressUpdate', status: 'Connecting to Google...', percent: 40 });
      const token = await getAuthToken();
      const currentYear = new Date().getFullYear();
      const dateStr = new Date().toISOString().split('T')[0];
      const todayFormatted = new Date().toLocaleDateString('en-US');
      const yearFolderId = await ensureYearlyReportFolder(token, currentYear);
      const screenshotsFolderId = await ensureDailyScreenshotFolder(token, dateStr);

      const grouped = {};
      cart.forEach((item) => {
        const handle = item.handle || 'Unknown';
        const platformDetails = detectPlatformDetails(item.url);
        const twitchLabel = platformDetails.key === 'twitch'
          ? (normalizeTwitchContentType(item) === 'live' ? 'Live' : 'VOD')
          : '';
        const groupKey = twitchLabel ? `${handle}::${twitchLabel}` : handle;

        if (!grouped[groupKey]) {
          grouped[groupKey] = {
            handle,
            items: [],
            contentTypeLabel: twitchLabel
          };
        }

        grouped[groupKey].items.push(item);
      });

      const groups = Object.values(grouped);
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const handle = group.handle;
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          status: `Processing Report ${groupIndex + 1}/${groups.length} (@${handle})...`,
          percent: 40 + Math.floor(((groupIndex + 1) / groups.length) * 50)
        });

        const items = group.items;
        const urls = items.map((item) => item.url);
        const urlString = urls.join('\n');
        const viewString = items.reduce((sum, item) => sum + parseViewCount(item.views), 0);
        const reportId = generateReportId();
        const platformDetails = detectPlatformDetails(urls[0]);
        const savedProfileUrl = items.find((item) => item.profileUrl || item.channelUrl)?.profileUrl ||
          items.find((item) => item.profileUrl || item.channelUrl)?.channelUrl || '';
        const channelUrl = savedProfileUrl || buildChannelUrl(platformDetails.key, handle) || urls[0];
        const contentTypeLabel = group.contentTypeLabel || (items.some((item) => item.isLive || String(item.contentType || '').toLowerCase() === 'live')
          ? 'Live'
          : 'VOD');

        const evidenceLinks = await Promise.all(
          items.map(async (item, index) => {
            let screenshotLink = 'No Screenshot Available';

            if (formData.uploadScreenshots !== false && item.screenshotId) {
              try {
                const imageDataUrl = await getImage(item.screenshotId);
                if (imageDataUrl) {
                  const imageBlob = base64ToBlob(imageDataUrl);
                  const upload = await uploadToDrive(
                    token,
                    screenshotsFolderId,
                    `${reportId}_Evidence_${index + 1}_@${handle}.jpg`,
                    imageBlob,
                    'image/jpeg'
                  );
                  screenshotLink = upload.webViewLink;
                }
              } catch (error) {
                console.error(`Failed to upload screenshot for ${item.url}:`, error);
              }
            }

            return {
              url: item.url,
              screenshotLink,
              views: item.views
            };
          })
        );

        const pdfBlob = await generatePDF({
          eventName: formData.eventConfig?.eventName || formData.eventName || 'Unknown Event',
          vertical: formData.vertical,
          reporterName: finalReporterName,
          handle,
          items: evidenceLinks,
          reportId
        });

        const pdfUpload = await uploadToDrive(
          token,
          yearFolderId,
          `Report_${reportId}_@${handle}.pdf`,
          pdfBlob,
          'application/pdf'
        );

        const streakRes = await chrome.storage.local.get([
          'streak_count',
          'last_report_date',
          'streak_freezes'
        ]);
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        let currentStreak = streakRes.streak_count || 0;
        let freezes = streakRes.streak_freezes || 0;

        if (streakRes.last_report_date !== dateStr) {
          if (streakRes.last_report_date === yesterday) currentStreak += 1;
          else if (freezes > 0) {
            freezes -= 1;
            currentStreak += 1;
          } else {
            currentStreak = 1;
          }

          if (currentStreak > 0 && currentStreak % 5 === 0) {
            freezes += 1;
          }
        }

        await chrome.storage.local.set({
          streak_count: currentStreak,
          last_report_date: dateStr,
          streak_freezes: freezes
        });

        const xpMult = formData.eventConfig?.double_xp ? 2 : 1;
        const queueMult = cart.length > 50 ? 1.2 : 1;
        const enforcerScore =
          Math.floor(items.length * 20 * xpMult * queueMult) + (currentStreak >= 3 ? 50 : 0);
        const scoutedByEmails = [...new Set(items.map((item) => item.scoutedBy || 'Unknown'))].join(', ');
        const totalScoutScore = items.reduce(
          (sum, item) => sum + ((item.scoutScore || 10) * xpMult),
          0
        );

        const appendResponse = await appendToSheet(token, {
          values: [
            todayFormatted,
            formData.vertical,
            formData.eventConfig?.eventName || formData.eventName || 'Unknown Event',
            platformDetails.label,
            contentTypeLabel,
            viewString > 0 ? viewString.toLocaleString() : 'N/A',
            finalReporterName,
            urlString,
            'DMCA takedown request',
            formData.mode === 'scout' ? 'Open' : 'Reported',
            `Report #: ${reportId}\nGenerating Links...`,
            scoutedByEmails,
            enforcedByEmail,
            reportId,
            '',
            '',
            '',
            '',
            '',
            totalScoutScore,
            enforcerScore
          ]
        });

        const updatedRange = appendResponse?.updates?.updatedRange;
        if (updatedRange) {
          const rangePart = updatedRange.split('!')[1] || updatedRange;
          const match = rangePart.match(/\d+/);
          if (match) {
            const rowIndex = parseInt(match[0], 10) - 1;
            await setColumnKRichText(
              rowIndex,
              channelUrl,
              handle,
              pdfUpload.webViewLink || 'https://drive.google.com',
              reportId
            );
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (remainingCart.length > 0) {
        await chrome.storage.local.set({ piracy_cart: remainingCart });
      } else {
        await chrome.storage.local.remove('piracy_cart');
        await clearImages();
      }

      return { success: true };
    } catch (error) {
      console.error('Batch Report Error:', error);
      return { success: false, error: error.message };
    }
  }

  async function handleUrlSave(data) {
    const { vertical, eventName, url, platform } = data;
    const sheetData = await getEventData(vertical);
    const eventInfo = sheetData.eventMap[eventName.toLowerCase()];

    if (eventInfo && eventInfo.rowIndex) {
      await saveUrlToSheet(vertical, eventInfo.rowIndex, url, platform);
    } else {
      await saveUrlToSheet(vertical, eventName, url, platform, true);
    }
  }

  async function undoCart() {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (cart.length > 0) {
      cart.pop();
    }
    await chrome.storage.local.set({ piracy_cart: cart });
    return { success: true };
  }

  return {
    handleAddVideo,
    handleBatchReport,
    handleProcessNewItem,
    handleUrlSave,
    undoCart
  };
}
