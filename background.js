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
// 1. LIVE AUDIT ENGINE
// ==========================================

/**
 * Performs a real-time audit of TikTok view counts.
 * Uses JSON rehydration data for high-precision integer counts.
 */
async function auditTikTokViews(url) {
    console.log(`🔍 Auditing real-time views for: ${url}`);
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

        // Wait for page load
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
        
        await new Promise(r => setTimeout(r, 2000)); // Buffer for hydration

        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const getNested = (obj, path) => path.split('.').reduce((o, i) => o?.[i], obj);
                
                // 1. Check for deletion/404
                const text = document.body.innerText.toLowerCase();
                if (text.includes("video currently unavailable") || text.includes("video not found")) return "DELETED";

                // 2. Try JSON Data Extraction (Highest Accuracy)
                const jsonIds = ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"];
                for (const id of jsonIds) {
                    const el = document.getElementById(id);
                    if (el && el.textContent) {
                        try {
                            const json = JSON.parse(el.textContent);
                            // Extract video ID from URL
                            const vidMatch = window.location.href.match(/\/video\/(\d+)/);
                            const vidId = vidMatch ? vidMatch[1] : null;

                            // Strategy A: SIGI_STATE
                            if (vidId && json.ItemModule && json.ItemModule[vidId]) {
                                return json.ItemModule[vidId].stats.playCount;
                            }
                            // Strategy B: UNIVERSAL_DATA
                            const struct = getNested(json, "__DEFAULT_SCOPE__.webapp.video-detail.itemInfo.itemStruct");
                            if (struct) return struct.stats.playCount;
                        } catch(e) {}
                    }
                }

                // 3. Fallback to DOM Selectors
                const selectors = ['[data-e2e="video-views"]', 'strong[data-e2e="video-views"]'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) return el.innerText;
                }

                return "N/A";
            }
        });

        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return result[0]?.result || "N/A";

    } catch (e) {
        console.error("Audit Error:", e);
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
});

// ==========================================
// 3. BATCH PROCESSING & LIVE AUDIT
// ==========================================

async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    let cart = storage.piracy_cart || [];
    const finalReporterName = formData.fullName || storage.last_reporter || "Unknown User";

    if (cart.length === 0) return { success: false, error: "Cart is empty" };

    // --- PHASE 1: LIVE AUDIT ---
    // Update all TikTok views with real-time data before reporting
    console.log("🚀 Starting Live Audit of all cart items...");
    for (let i = 0; i < cart.length; i++) {
        const item = cart[i];
        if (item.platform === "TikTok") {
            const freshViews = await auditTikTokViews(item.url);
            cart[i].views = freshViews;
            // 2 second rate-limit buffer to prevent IP block
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    const token = await getAuthToken();
    const currentYear = new Date().getFullYear();
    const dateStr = new Date().toISOString().split('T')[0];
    const todayFormatted = new Date().toLocaleDateString("en-US");
    
    const yearFolderId = await ensureYearlyReportFolder(token, currentYear);
    const screenshotsFolderId = await ensureDailyScreenshotFolder(token, dateStr);

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

      const evidenceLinks = []; 
      for (const item of items) {
          let imgLink = "No Screenshot";
          if (item.screenshotId) {
              const imgDataUrl = await getImage(item.screenshotId);
              if (imgDataUrl) {
                  const response = await fetch(imgDataUrl);
                  const upload = await uploadToDrive(token, screenshotsFolderId, `${reportId}_@${handle}.jpg`, await response.blob(), 'image/jpeg');
                  imgLink = upload.webViewLink; 
              }
          }
          evidenceLinks.push({ url: item.url, screenshotLink: imgLink, views: item.views });
      }

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
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const screenshotUrl = await Promise.race([screenshotPromise, new Promise(r => setTimeout(() => r(null), 2500))]);
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
}
