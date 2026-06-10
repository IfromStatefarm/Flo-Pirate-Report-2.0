import { buildChannelUrl, detectPlatformDetails } from '../../utils/platforms.js';
import { CONTENT_SCRAPER_INJECTION_FILES } from '../../utils/content_script_assets.js';
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

<<<<<<< Updated upstream
=======
const PLATFORM_BATCH_LIMITS = Object.freeze({
  youtube: 10,
  instagram: 30,
  facebook: 30
});

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
  function emitProgress(status, percent, progressOptions = {}) {
    const mapper = progressOptions?.mapPercent;
    const mappedPercent = typeof mapper === 'function' ? mapper(percent) : percent;
    const workflow = progressOptions?.workflow;
    chrome.runtime.sendMessage({
      action: 'progressUpdate',
      status,
      percent: Math.max(0, Math.min(100, Math.round(mappedPercent))),
      ...(workflow ? { workflow } : {})
    }).catch(() => {});
  }

  async function captureVisibleTabImage(windowId = null) {
    try {
      const screenshotPromise = chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot timed out')), 5000);
      });

      return await Promise.race([screenshotPromise, timeoutPromise]);
    } catch (error) {
      console.warn('Screenshot capture skipped/failed:', error);
      return null;
    }
  }

  async function waitForTabComplete(tabId, timeoutMs = 30000) {
    return await new Promise((resolve, reject) => {
      let finished = false;
      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        chrome.tabs.onUpdated.removeListener(handleUpdate);
        reject(new Error(`Timed out waiting for tab ${tabId} to finish loading.`));
      }, timeoutMs);

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(handleUpdate);
        resolve();
      };

      const handleUpdate = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        finish();
      };

      chrome.tabs.onUpdated.addListener(handleUpdate);
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab?.status === 'complete') {
          finish();
        }
      });
    });
  }

  async function injectScraper(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRAPER_INJECTION_FILES
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (!message.includes('hasFloScraperRun')) {
        console.warn(`Rumble scraper injection skipped for tab ${tabId}:`, error);
      }
    }
  }

  async function scrapeTabForPlatform(tabId, platformKey) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (key) => {
          const registry = globalThis.__floPlatformRegistry;
          const registeredScraper = registry?.getScraper?.(key) || registry?.findScraperByUrl?.(window.location.href);
          if (registeredScraper?.run) return registeredScraper.run();
          return globalThis.__floLegacyScrapers?.run?.(key) || null;
        },
        args: [platformKey]
      });

      return results?.[0]?.result || null;
    } catch (error) {
      console.warn(`Rumble scrape failed for tab ${tabId}:`, error);
      return null;
    }
  }

  function mergeScrapedRumbleData(item, scrapedData) {
    if (!scrapedData) return item;

    const hasLiveSignal = Object.prototype.hasOwnProperty.call(scrapedData, 'isLive');
    const isLive = hasLiveSignal ? !!scrapedData.isLive : !!item.isLive;

    return {
      ...item,
      platform: 'Rumble',
      url: scrapedData.url || item.url,
      handle: scrapedData.handle || item.handle,
      views: scrapedData.views || item.views,
      isLive,
      contentType: scrapedData.contentType || (isLive ? 'live' : (item.contentType || 'vod')),
      timestamp: scrapedData.timestamp || item.timestamp
    };
  }

  function mergeScrapedFacebookData(item, scrapedData) {
    if (!scrapedData) return item;

    const scrapedViews = scrapedData.views && scrapedData.views !== 'N/A'
      ? scrapedData.views
      : item.views;

    return {
      ...item,
      platform: 'Facebook',
      url: scrapedData.url || item.url,
      handle: scrapedData.handle || item.handle,
      profileUrl: scrapedData.profileUrl || item.profileUrl || item.channelUrl,
      views: scrapedViews || item.views || 'N/A',
      contentType: scrapedData.contentType || item.contentType || 'vod',
      timestamp: scrapedData.timestamp || item.timestamp
    };
  }

  function normalizeTwitchContentType(item = {}) {
    const contentType = String(item.contentType || item.mediaType || '').toLowerCase();
    if (item.isLive || contentType === 'live' || contentType.includes('live')) return 'live';
    if (contentType.includes('clip')) return 'clip';
    return 'vod';
  }

  function mergeScrapedTwitchData(item, scrapedData) {
    if (!scrapedData) return {
      ...item,
      platform: 'Twitch',
      contentType: normalizeTwitchContentType(item),
      isLive: normalizeTwitchContentType(item) === 'live'
    };

    const scrapedViews = scrapedData.views && scrapedData.views !== 'N/A'
      ? scrapedData.views
      : item.views;
    const mergedContentType = normalizeTwitchContentType({
      ...item,
      contentType: scrapedData.contentType || item.contentType,
      isLive: Object.prototype.hasOwnProperty.call(scrapedData, 'isLive') ? scrapedData.isLive : item.isLive
    });

    return {
      ...item,
      platform: 'Twitch',
      url: scrapedData.url || item.url,
      handle: scrapedData.handle || item.handle,
      profileUrl: scrapedData.profileUrl || item.profileUrl || item.channelUrl,
      views: scrapedViews || item.views || 'N/A',
      contentType: mergedContentType,
      isLive: mergedContentType === 'live',
      timestamp: scrapedData.timestamp || item.timestamp
    };
  }

  async function captureQueueScreenshots(options = {}) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (cart.length === 0) {
      return { success: true, count: 0 };
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = options.windowId ?? activeTabs[0]?.windowId ?? null;
    const composerTabId = options.composerTabId || null;

    emitProgress('Preparing Kick evidence tabs...', 5, options.progressOptions);

    for (let index = 0; index < cart.length; index++) {
      const item = cart[index];
      const currentLabel = `Capturing screenshot ${index + 1}/${cart.length}...`;
      emitProgress(currentLabel, 8 + Math.floor(((index + 1) / cart.length) * 25), options.progressOptions);

      let evidenceTab = null;
      try {
        evidenceTab = await chrome.tabs.create({
          url: item.url,
          active: true,
          windowId: windowId || undefined
        });

        await waitForTabComplete(evidenceTab.id);
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const screenshotUrl = await captureVisibleTabImage(evidenceTab.windowId || windowId || null);
        if (screenshotUrl) {
          const screenshotId = item.screenshotId || crypto.randomUUID();
          await saveImage(screenshotId, screenshotUrl);
          item.screenshotId = screenshotId;
        }
      } catch (error) {
        console.warn(`Kick screenshot capture failed for ${item.url}:`, error);
      } finally {
        if (evidenceTab?.id) {
          await chrome.tabs.remove(evidenceTab.id).catch(() => {});
        }
      }
    }

    await chrome.storage.local.set({ piracy_cart: cart });

    if (composerTabId) {
      await chrome.tabs.update(composerTabId, { active: true }).catch(() => {});
    }

    emitProgress('Kick screenshots captured. Preparing final report...', 35, options.progressOptions);
    return { success: true, count: cart.length };
  }

  async function captureRumbleQueueEvidence(options = {}) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (cart.length === 0) {
      return { success: true, count: 0 };
    }

    let evidenceWindow = null;
    let evidenceTab = null;

    emitProgress('Preparing Rumble evidence tabs...', 5, options.progressOptions);

    try {
      for (let index = 0; index < cart.length; index++) {
        const item = cart[index];
        const basePercent = 8 + Math.floor((index / Math.max(cart.length, 1)) * 24);

        try {
          emitProgress(`Opening Rumble URL ${index + 1}/${cart.length}...`, basePercent, options.progressOptions);

          if (!evidenceWindow?.id || !evidenceTab?.id) {
            evidenceWindow = await chrome.windows.create({
              url: item.url,
              focused: false,
              type: 'popup',
              width: 1280,
              height: 900
            });
            evidenceTab = evidenceWindow.tabs?.[0] || null;
            if (!evidenceTab?.id) {
              throw new Error('Could not create Rumble evidence capture tab.');
            }
          } else {
            evidenceTab = await chrome.tabs.update(evidenceTab.id, {
              url: item.url,
              active: true
            });
          }

          await waitForTabComplete(evidenceTab.id);
          await new Promise((resolve) => setTimeout(resolve, 1800));
          await injectScraper(evidenceTab.id);
          await new Promise((resolve) => setTimeout(resolve, 300));

          emitProgress(`Scraping Rumble metadata ${index + 1}/${cart.length}...`, basePercent + 3, options.progressOptions);
          const scrapedData = await scrapeTabForPlatform(evidenceTab.id, 'rumble');
          cart[index] = mergeScrapedRumbleData(item, scrapedData);

          emitProgress(`Capturing Rumble screenshot ${index + 1}/${cart.length}...`, basePercent + 6, options.progressOptions);
          await new Promise((resolve) => setTimeout(resolve, 600));

          const screenshotUrl = await captureVisibleTabImage(evidenceWindow.id);
          if (screenshotUrl) {
            const screenshotId = cart[index].screenshotId || crypto.randomUUID();
            await saveImage(screenshotId, screenshotUrl);
            cart[index].screenshotId = screenshotId;
          }
        } catch (error) {
          console.warn(`Rumble evidence capture failed for ${item.url}:`, error);
        }
      }
    } finally {
      if (evidenceWindow?.id) {
        await chrome.windows.remove(evidenceWindow.id).catch(() => {});
      }
    }

    await chrome.storage.local.set({ piracy_cart: cart });

    emitProgress('Rumble evidence captured. Preparing final report...', 35, options.progressOptions);
    return { success: true, count: cart.length };
  }

  async function refreshFacebookQueueMetadata(options = {}) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (cart.length === 0) {
      return { success: true, count: 0 };
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = options.windowId ?? activeTabs[0]?.windowId ?? null;
    const composerTabId = options.composerTabId || null;
    const limit = PLATFORM_BATCH_LIMITS.facebook || cart.length;
    const countToRefresh = Math.min(cart.length, limit);

    emitProgress('Preparing Facebook scrape tabs...', 5, options.progressOptions);

    for (let index = 0; index < countToRefresh; index++) {
      const item = cart[index];
      let evidenceTab = null;
      const basePercent = 8 + Math.floor((index / Math.max(countToRefresh, 1)) * 27);

      try {
        emitProgress(`Opening Facebook URL ${index + 1}/${countToRefresh}...`, basePercent, options.progressOptions);
        evidenceTab = await chrome.tabs.create({
          url: item.url,
          active: false,
          windowId: windowId || undefined
        });

        await waitForTabComplete(evidenceTab.id);
        await new Promise((resolve) => setTimeout(resolve, 2200));
        await injectScraper(evidenceTab.id);
        await new Promise((resolve) => setTimeout(resolve, 1400));

        emitProgress(`Scraping Facebook metadata ${index + 1}/${countToRefresh}...`, basePercent + 5, options.progressOptions);
        let scrapedData = await scrapeTabForPlatform(evidenceTab.id, 'facebook');
        if (!scrapedData) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          scrapedData = await scrapeTabForPlatform(evidenceTab.id, 'facebook');
        }

        cart[index] = mergeScrapedFacebookData(item, scrapedData);
      } catch (error) {
        console.warn(`Facebook metadata scrape failed for ${item.url}:`, error);
      } finally {
        if (evidenceTab?.id) {
          await chrome.tabs.remove(evidenceTab.id).catch(() => {});
        }
      }
    }

    await chrome.storage.local.set({ piracy_cart: cart });

    if (composerTabId) {
      await chrome.tabs.update(composerTabId, { active: true }).catch(() => {});
    }

    emitProgress('Facebook metadata refreshed. Preparing final report...', 35, options.progressOptions);
    return { success: true, count: countToRefresh };
  }

  async function refreshTwitchQueueMetadata(options = {}) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = storage.piracy_cart || [];
    if (cart.length === 0) {
      return { success: true, count: 0 };
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = options.windowId ?? activeTabs[0]?.windowId ?? null;
    const composerTabId = options.composerTabId || null;

    emitProgress('Preparing Twitch scrape tabs...', 5, options.progressOptions);

    for (let index = 0; index < cart.length; index++) {
      const item = cart[index];
      let evidenceTab = null;
      const basePercent = 8 + Math.floor((index / Math.max(cart.length, 1)) * 27);

      try {
        emitProgress(`Opening Twitch URL ${index + 1}/${cart.length}...`, basePercent, options.progressOptions);
        evidenceTab = await chrome.tabs.create({
          url: item.url,
          active: false,
          windowId: windowId || undefined
        });

        await waitForTabComplete(evidenceTab.id);
        await new Promise((resolve) => setTimeout(resolve, 2200));
        await injectScraper(evidenceTab.id);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        emitProgress(`Scraping Twitch metadata ${index + 1}/${cart.length}...`, basePercent + 5, options.progressOptions);
        let scrapedData = await scrapeTabForPlatform(evidenceTab.id, 'twitch');
        if (!scrapedData) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          scrapedData = await scrapeTabForPlatform(evidenceTab.id, 'twitch');
        }

        cart[index] = mergeScrapedTwitchData(item, scrapedData);
      } catch (error) {
        console.warn(`Twitch metadata scrape failed for ${item.url}:`, error);
        cart[index] = mergeScrapedTwitchData(item, null);
      } finally {
        if (evidenceTab?.id) {
          await chrome.tabs.remove(evidenceTab.id).catch(() => {});
        }
      }
    }

    await chrome.storage.local.set({ piracy_cart: cart });

    if (composerTabId) {
      await chrome.tabs.update(composerTabId, { active: true }).catch(() => {});
    }

    emitProgress('Twitch metadata refreshed. Preparing final report...', 35, options.progressOptions);
    return { success: true, count: cart.length };
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

  async function handleBatchReport(formData, progressOptions = {}) {
    try {
      const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
      let cart = storage.piracy_cart || [];
      const savedName = storage.last_reporter || 'Unknown User';
      const finalReporterName = formData.reporterName || savedName;
      const enforcedByEmail = (await getUserEmail()) || 'Unknown';

      let remainingCart = [];
      const isYouTube = cart.length > 0 && detectPlatformDetails(cart[0].url).key === 'youtube';
      if (isYouTube && cart.length > 10) {
        remainingCart = cart.slice(10);
        cart = cart.slice(0, 10);
      }
      const reportedCount = cart.length;

      const updatedCart = [];
      let failedScrapeCount = 0;
      emitProgress('Verifying view counts...', 5, progressOptions);

      for (let index = 0; index < cart.length; index++) {
        const item = cart[index];
        if (item.url.includes('tiktok.com') && (item.views === 'PENDING' || item.views === 'N/A')) {
          emitProgress(
            `Scraping views (${index + 1}/${cart.length})...`,
            5 + Math.floor((index / cart.length) * 30),
            progressOptions
          );

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

      emitProgress('Connecting to Google...', 40, progressOptions);
      const token = await getAuthToken();
      const currentYear = new Date().getFullYear();
      const dateStr = new Date().toISOString().split('T')[0];
      const todayFormatted = new Date().toLocaleDateString('en-US');
      const yearFolderId = await ensureYearlyReportFolder(token, currentYear);
      const screenshotsFolderId = await ensureDailyScreenshotFolder(token, dateStr);

      const grouped = {};
      cart.forEach((item) => {
        const handle = item.handle || 'Unknown';
        const itemPlatformKey = detectPlatformDetails(item.url).key;
        const twitchBucket = itemPlatformKey === 'twitch'
          ? (normalizeTwitchContentType(item) === 'live' ? 'Live' : 'VOD')
          : '';
        const groupKey = twitchBucket ? `${handle}::${twitchBucket}` : handle;
        if (!grouped[groupKey]) {
          grouped[groupKey] = {
            handle,
            contentTypeLabel: twitchBucket || '',
            items: []
          };
        }
        grouped[groupKey].items.push(item);
      });

      const groups = Object.values(grouped);
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const handle = group.handle;
        emitProgress(
          `Processing Report ${groupIndex + 1}/${groups.length} (@${handle})...`,
          40 + Math.floor(((groupIndex + 1) / groups.length) * 50),
          progressOptions
        );

        const items = group.items;
        const urls = items.map((item) => item.url);
        const urlString = urls.join('\n');
        const viewString = items.reduce((sum, item) => sum + parseViewCount(item.views), 0);
        const contentTypeLabel = group.contentTypeLabel || (
          items.some((item) => item.isLive || String(item.contentType || '').toLowerCase() === 'live')
            ? 'Live'
            : 'VOD'
        );
        const reportId = generateReportId();
        const platformDetails = detectPlatformDetails(urls[0]);
        const savedProfileUrl = items.find((item) => item.profileUrl || item.channelUrl)?.profileUrl ||
          items.find((item) => item.profileUrl || item.channelUrl)?.channelUrl ||
          '';
        const channelUrl = savedProfileUrl || buildChannelUrl(platformDetails.key, handle) || urls[0];

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
            '',
            '',
            '',
            '',
            '',
            '',
            totalScoutScore,
            enforcerScore,
            reportId
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

      return { success: true, reportedCount, remainingCount: remainingCart.length };
    } catch (error) {
      console.error('Batch Report Error:', error);
      return { success: false, error: error.message };
    }
  }

  async function handleKickBatchReport(formData, options = {}) {
    const baseFormData = {
      ...formData,
      mode: formData.mode || 'enforcer',
      uploadScreenshots: formData.uploadScreenshots !== false
    };

    await captureQueueScreenshots({
      composerTabId: options.composerTabId,
      windowId: options.windowId,
      progressOptions: {
        mapPercent: (percent) => percent
      }
    });

    return await handleBatchReport(baseFormData, {
      mapPercent: (percent) => 35 + Math.round((percent / 100) * 65)
    });
  }

  async function handleRumbleBatchReport(formData, options = {}) {
    const baseFormData = {
      ...formData,
      mode: formData.mode || 'enforcer',
      uploadScreenshots: formData.uploadScreenshots !== false
    };

    await captureRumbleQueueEvidence({
      composerTabId: options.composerTabId,
      windowId: options.windowId,
      progressOptions: {
        mapPercent: (percent) => 35 + Math.round((percent / 100) * 25)
      }
    });

    return await handleBatchReport(baseFormData, {
      mapPercent: (percent) => 60 + Math.round((percent / 100) * 40)
    });
  }

  async function handleFacebookBatchReport(formData, options = {}) {
    const baseFormData = {
      ...formData,
      mode: formData.mode || 'enforcer',
      uploadScreenshots: formData.uploadScreenshots !== false
    };

    await refreshFacebookQueueMetadata({
      composerTabId: options.composerTabId,
      windowId: options.windowId,
      progressOptions: {
        workflow: 'facebook',
        mapPercent: (percent) => percent
      }
    });

    return await handleBatchReport(baseFormData, {
      workflow: 'facebook',
      mapPercent: (percent) => 35 + Math.round((percent / 100) * 65)
    });
  }

  async function handleTwitchBatchReport(formData, options = {}) {
    const baseFormData = {
      ...formData,
      mode: formData.mode || 'enforcer',
      uploadScreenshots: formData.uploadScreenshots !== false
    };

    await refreshTwitchQueueMetadata({
      composerTabId: options.composerTabId,
      windowId: options.windowId,
      progressOptions: {
        workflow: 'twitch',
        mapPercent: (percent) => percent
      }
    });

    return await handleBatchReport(baseFormData, {
      workflow: 'twitch',
      mapPercent: (percent) => 35 + Math.round((percent / 100) * 65)
    });
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
    handleKickBatchReport,
    handleFacebookBatchReport,
    handleTwitchBatchReport,
    handleRumbleBatchReport,
    handleProcessNewItem,
    handleUrlSave,
    undoCart
  };
}
