// background.js
import { getAuthToken, getUserEmail } from './utils/auth.js';
import { 
  uploadToDrive, 
  appendToSheet, 
  ensureYearlyReportFolder,
  ensureDailyScreenshotFolder, 
  fetchConfig, 
  getEventData,       
  updateEventUrl,     
  addNewEventToSheet,
  checkIfAuthorized,
  getColumnHData,
  updateRowStatus,
  formatCellAsTakenDown,
  updateCellWithRichText
} from './utils/google_api.js';
import { generatePDF } from './utils/pdf_gen.js';
import { saveImage, getImage, clearImages } from './utils/idb_storage.js';

// Open Side Panel on Click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- ID GENERATOR ---
function generateReportId() {
  const nums = Math.floor(10 + Math.random() * 90); 
  const letters = Math.random().toString(36).substring(2, 8); 
  return `${nums}${letters}`.toUpperCase();
}

// ==========================================
// 1. THE LIVE AUDIT ENGINE (New)
// ==========================================

/**
 * auditTikTokViews
 * Opens a background tab for a specific URL, waits for load, and scrapes fresh view counts.
 * Prioritizes raw integer data from JSON scripts.
 */
async function auditTikTokViews(url) {
    console.log(`🔍 Auditing real-time views for: ${url}`);
    let tabId = null;
    try {
        // Open URL in an inactive tab
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

        // Wait for page to reach 'complete' status
        await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve("timeout"), 15000); 
            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve("complete");
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        // Brief buffer for client-side hydration
        await new Promise(r => setTimeout(r, 2500));

        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const text = document.body.innerText.toLowerCase();
                
                // Check if video is deleted or unavailable
                if (text.includes("video currently unavailable") || 
                    text.includes("video not found") || 
                    text.includes("page not available") ||
                    document.title.includes("404")) {
                    return "DELETED";
                }

                // Strategy 1: Extract from rehydration JSON (Highest Precision)
                const jsonIds = ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"];
                for (const id of jsonIds) {
                    const el = document.getElementById(id);
                    if (el && el.textContent) {
                        try {
                            const json = JSON.parse(el.textContent);
                            const vidMatch = window.location.href.match(/\/video\/(\d+)/) || window.location.href.match(/\/photo\/(\d+)/);
                            const vidId = vidMatch ? vidMatch[1] : null;

                            // Check SIGI_STATE path
                            if (vidId && json.ItemModule?.[vidId]?.stats?.playCount !== undefined) {
                                return json.ItemModule[vidId].stats.playCount;
                            }
                            // Check Universal Data path
                            const detail = json.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
                            if (detail?.stats?.playCount !== undefined) {
                                return detail.stats.playCount;
                            }
                        } catch(e) {}
                    }
                }

                // Strategy 2: DOM Fallback
                const selectors = ['[data-e2e="video-views"]', 'strong[data-e2e="video-views"]'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText) return el.innerText;
                }

                return "N/A";
            }
        });

        // Close the audit tab immediately
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return result[0]?.result || "N/A";

    } catch (e) {
        console.error("Audit Tab Error:", e);
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return "ERROR";
    }
}

// ==========================================
// 2. MAIN MESSAGE HANDLER
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.action === 'checkUserIdentity') {
    getUserEmail().then(email => sendResponse({ email: email }));
    return true; 
  }

  if (request.action === "checkWhitelist") {
    checkIfAuthorized(request.platform, request.handle)
      .then(isAuthorized => sendResponse({ authorized: isAuthorized }))
      .catch(err => sendResponse({ error: err.message }));
    return true; 
  }

  if (request.action === 'logToSheet') {
      handleBatchReport(request.data).then(res => sendResponse({ success: res.success }));
      return true;
  }

  if (request.action === 'getConfig') {
    fetchConfig().then(config => sendResponse({ success: true, config }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'addToCart') {
    handleAddVideo(sender.tab, request.data).then(sendResponse);
    return true; 
  }

  if (request.action === 'clearCart') {
    Promise.all([chrome.storage.local.remove('piracy_cart'), clearImages()])
      .then(() => sendResponse({success: true}));
    return true;
  }

  if (request.action === 'openPopup') {
    if (sender.tab && sender.tab.id) chrome.sidePanel.open({ tabId: sender.tab.id });
    return true;
  }

  // Messenger for automated search bots
  if (request.action === 'botSearchComplete' || request.action === 'botSearchFailed') {
      // Logic for handling crawler updates
      return true;
  }
});

// ==========================================
// 3. BATCH PROCESSING & AUDIT LOGIC
// ==========================================

async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    let cart = storage.piracy_cart || [];
    const finalReporterName = formData.fullName || storage.last_reporter || "Unknown User";

    if (cart.length === 0) return { success: false, error: "Empty cart" };

    // --- PHASE 1: LIVE AUDIT ---
    // Iterate through the cart and refresh data for TikTok items
    console.log("🚀 Starting Live Audit of all cart items...");
    for (let i = 0; i < cart.length; i++) {
        const item = cart[i];
        if (item.platform === "TikTok") {
            const freshViews = await auditTikTokViews(item.url);
            cart[i].views = freshViews;
            
            // 2-second rate limit delay between opening tabs
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    const token = await getAuthToken();
    const currentYear = new Date().getFullYear();
    const dateStr = new Date().toISOString().split('T')[0];
    const todayFormatted = new Date().toLocaleDateString("en-US");
    
    const yearFolderId = await ensureYearlyReportFolder(token, currentYear);
    const screenshotsFolderId = await ensureDailyScreenshotFolder(token, dateStr);

    // Group items by handle for individual reports
    const grouped = {};
    cart.forEach(item => {
      const handle = item.handle || "Unknown";
      if (!grouped[handle]) grouped[handle] = [];
      grouped[handle].push(item);
    });

    for (const handle of Object.keys(grouped)) {
      const items = grouped[handle];
      const urls = items.map(i => i.url);
      const urlString = urls.join('\n'); 
      const viewString = items.map(i => i.views).join('\n'); 
      const reportId = generateReportId();

      // Upload Screenshots and build evidence list
      const evidenceLinks = []; 
      for (const item of items) {
          let imgLink = "No Screenshot Available";
          if (item.screenshotId) {
              const imgDataUrl = await getImage(item.screenshotId);
              if (imgDataUrl) {
                  const response = await fetch(imgDataUrl);
                  const upload = await uploadToDrive(token, screenshotsFolderId, `${reportId}_Evidence_@${handle}.jpg`, await response.blob(), 'image/jpeg');
                  imgLink = upload.webViewLink; 
              }
          }
          evidenceLinks.push({ url: item.url, screenshotLink: imgLink, views: item.views });
      }

      // Generate PDF
      const pdfData = { 
          eventName: formData.eventName, 
          vertical: formData.vertical, 
          reporterName: finalReporterName, 
          handle, 
          items: evidenceLinks,
          reportId: reportId 
      };
      
      const pdfBlob = await generatePDF(pdfData);
      const pdfUpload = await uploadToDrive(token, yearFolderId, `Report_${reportId}_@${handle}.pdf`, pdfBlob, 'application/pdf');

      // Final Log to Foundation Sheet
      await appendToSheet(token, { values: [
          todayFormatted, 
          formData.vertical, 
          formData.eventName, 
          items[0].platform, 
          "VOD", 
          viewString, 
          finalReporterName, 
          urlString, 
          "DMCA takedown request", 
          "Reported", 
          `Report: ${pdfUpload.webViewLink}`, 
          finalReporterName, 
          "", "", "", "", "", "", "", 
          reportId
      ]});
      
      await new Promise(r => setTimeout(r, 1000));
    }

    // Cleanup session
    await chrome.storage.local.remove('piracy_cart');
    await clearImages();
    chrome.runtime.sendMessage({ action: "playSuccessSound" }).catch(() => {});
    return { success: true };
  } catch (e) {
    console.error("Batch Report Error:", e);
    return { success: false, error: e.message };
  }
}

async function handleAddVideo(tab, data) {
  try {
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2500));
    const screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    const screenshotId = crypto.randomUUID();
    if (screenshotUrl) await saveImage(screenshotId, screenshotUrl);

    const newItem = { ...data, screenshotId: screenshotUrl ? screenshotId : null };
    const storage = await chrome.storage.local.get('piracy_cart');
    let cart = storage.piracy_cart || [];
    if (!cart.some(item => item.url === data.url)) {
      cart.push(newItem);
      await chrome.storage.local.set({ 'piracy_cart': cart });
    }
    return { success: true, count: cart.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
