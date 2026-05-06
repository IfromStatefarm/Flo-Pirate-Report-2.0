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

      let remainingCart = [];
      const isYouTube = cart.length > 0 && detectPlatformDetails(cart[0].url).key === 'youtube';
      if (isYouTube && cart.length > 10) {
        remainingCart = cart.slice(10);
        cart = cart.slice(0, 10);
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
        if (!grouped[handle]) grouped[handle] = [];
        grouped[handle].push(item);
      });

      const handles = Object.keys(grouped);
      for (let groupIndex = 0; groupIndex < handles.length; groupIndex++) {
        const handle = handles[groupIndex];
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          status: `Processing Report ${groupIndex + 1}/${handles.length} (@${handle})...`,
          percent: 40 + Math.floor(((groupIndex + 1) / handles.length) * 50)
        });

        const items = grouped[handle];
        const urls = items.map((item) => item.url);
        const urlString = urls.join('\n');
        const viewString = items.reduce((sum, item) => sum + parseViewCount(item.views), 0);
        const reportId = generateReportId();
        const platformDetails = detectPlatformDetails(urls[0]);
        const channelUrl = buildChannelUrl(platformDetails.key, handle) || urls[0];

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
            'VOD',
            viewString > 0 ? viewString.toLocaleString() : 'N/A',
            finalReporterName,
            urlString,
            'DMCA takedown request',
            formData.mode === 'scout' ? 'Open' : 'Reported',
            'Generating Links...',
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
            await setColumnKRichText(rowIndex, channelUrl, handle, pdfUpload.webViewLink || 'https://drive.google.com');
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
