// background.js
import { getAuthToken, getUserEmail } from './utils/auth.js';
import { 
  uploadToDrive, 
  appendToSheet, 
  ensureFolderHierarchy, 
  fetchConfig, 
  fetchRightsPdf,
  getEventData,       
  updateEventUrl,     
  addNewEventToSheet,
  ensureDailyScreenshotFolder,
  checkIfAuthorized,
  getColumnHData,
  updateRowStatus,
  formatCellAsTakenDown
} from './utils/google_api.js';
import { generatePDF } from './utils/pdf_gen.js';
import { saveImage, getImage, clearImages } from './utils/idb_storage.js';

// Open Side Panel on Click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- ALARMS ---
const ALARM_NAME = "theCloser";
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runSheetScanner(1); // Default to row 1 on auto-run
  }
});

// --- ID GENERATOR ---
function generateReportId() {
  const nums = Math.floor(10 + Math.random() * 90); 
  const letters = Math.random().toString(36).substring(2, 8); 
  return `${nums}${letters}`.toUpperCase();
}

// ==========================================
// 1. THE SHEET SCANNER (The Closer 2.0)
// ==========================================

async function runSheetScanner(startRow = 1) {
  console.log(`🕵️ Sheet Scanner: Starting from Row ${startRow}...`);
  
  try {
    const rows = await getColumnHData();
    let consecutiveBlanks = 0;
    
    // Safety check: startRow cannot be less than 1 (header is 0)
    if (startRow < 1) startRow = 1;

    // Loop through rows
    for (let i = startRow; i < rows.length; i++) {
        // Safety Break for 3 consecutive blanks
        if (consecutiveBlanks >= 3) {
            console.log("🕵️ Sheet Scanner: Hit 3 blank cells. Stopping.");
            break;
        }

        const cellValue = rows[i][0]; // Column H is index 0 in the response values
        
        // Skip empty cells but count them for safety break
        if (!cellValue) {
            consecutiveBlanks++;
            continue;
        }
        
        consecutiveBlanks = 0; // Reset count on non-blank

        // Extract URLs (split by newline, space, or comma)
        // Matches http/https URLs
        const urls = cellValue.match(/https?:\/\/[^\s,]+/g);
        
        if (!urls || urls.length === 0) continue;

        console.log(`Row ${i+1}: Found ${urls.length} links.`);

        let activeCount = 0;
        let deadCount = 0;

        for (let j = 0; j < urls.length; j++) {
            const url = urls[j];
            console.log(`Row ${i+1} - URL ${j + 1} of ${urls.length}: Checking...`);
            
            let platform = 'unknown';
            if (url.includes('tiktok')) platform = 'tiktok';
            else if (url.includes('youtube') || url.includes('youtu.be')) platform = 'youtube';
            else if (url.includes('twitter') || url.includes('x.com')) platform = 'twitter';
            else if (url.includes('instagram')) platform = 'instagram';
            else if (url.includes('facebook')) platform = 'facebook';
            else if (url.includes('twitch')) platform = 'twitch';

            try {
                // Check using Tab-based verification
                const isDown = await verifyTakedownViaTab(url, platform); 
                if (isDown) {
                    deadCount++;
                    console.log(`  - DOWN: ${url}`);
                } else {
                    activeCount++;
                    console.log(`  - ACTIVE: ${url}`);
                }
            } catch (err) {
                console.warn(`  - Error checking ${url}:`, err);
                activeCount++; // Assume active on error
            }
            
            // Rate limit (1.5s) to avoid browser throttling tabs
            await new Promise(r => setTimeout(r, 1500)); 
        }

        // Determine Status based on counts
        if (deadCount > 0 && activeCount === 0) {
            console.log(`Row ${i+1}: Resolved (All ${deadCount} links down).`);
            await updateRowStatus(i, "Resolved");
        } else if (activeCount > 0) {
             // Only mark investigating if mix? Or if ANY active?
             // User request: "If there are some urls still up it would write 'Investigating'"
            console.log(`Row ${i+1}: Investigating (${activeCount} active, ${deadCount} down).`);
            await updateRowStatus(i, "Investigating");
        } else if (activeCount > 0 && deadCount === 0) {
             // All active, maybe mark nothing or investigating?
             // We'll leave it alone or mark investigating.
             // console.log(`Row ${i+1}: All active.`);
        }
    }
    
    console.log("🕵️ Sheet Scanner: Complete.");

  } catch (e) {
    console.error("Sheet Scanner Failed:", e);
  }
}

// Uses Tab Loading to check if video exists
async function verifyTakedownViaTab(url, platform) {
    let tabId = null;
    try {
        // 1. Open Tab in Background (active: false)
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

        // 2. Wait for Load (with timeout)
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve("timeout"), 12000); 
            
            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve("complete");
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        // Wait a bit for dynamic content to render
        await new Promise(r => setTimeout(r, 2000));

        // 3. Inject Script to Check Tombstone
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (plat) => {
                const text = document.body.innerText.toLowerCase();
                const title = document.title.toLowerCase();
                
                // Generic Tombstones
                if (title.includes("404") || title.includes("not found") || title.includes("page not found")) return true;

                if (plat === 'tiktok') {
                    if (text.includes("video currently unavailable")) return true;
                    if (text.includes("video not found")) return true;
                    if (text.includes("couldn't find this account")) return true;
                    if (text.includes("page not available")) return true;
                    if (document.querySelector('[data-e2e="video-removed"]')) return true;
                }
                
                if (plat === 'youtube') {
                    if (text.includes("video unavailable")) return true;
                    if (text.includes("video has been removed")) return true;
                    if (text.includes("video is private")) return true;
                    if (text.includes("this video is no longer available")) return true;
                    // If redirected to home, likely removed (heuristic)
                    if (window.location.href === "https://www.youtube.com/") return true; 
                }
                
                if (plat === 'twitter') {
                    if (text.includes("this page doesn’t exist")) return true;
                    if (text.includes("tweet has been deleted")) return true;
                    if (text.includes("account suspended")) return true;
                }
                
                if (plat === 'instagram' || plat === 'facebook') {
                    if (text.includes("sorry, this page isn't available")) return true;
                    if (text.includes("link you followed may be broken")) return true;
                    if (text.includes("content isn't available")) return true;
                }

                return false;
            },
            args: [platform]
        });

        // 4. Cleanup
        chrome.tabs.remove(tabId).catch(() => {});
        
        return result[0]?.result || false;

    } catch (e) {
        console.error("Tab Check Error:", e);
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return false; // Fail safe: Assume active
    }
}

// ... (addToTrackingQueue legacy helper, kept empty if needed by other files)
async function addToTrackingQueue(reportId, urls, platform) {}

// ==========================================
// 2. BOT INJECTION LISTENER
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const session = await chrome.storage.session.get(['activeSearchTabId']);
    if (session.activeSearchTabId && tabId === session.activeSearchTabId) {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['search_bot.js']
        }).catch(err => console.error("Failed to inject bot:", err));
    }
  }
});

// ==========================================
// 3. MAIN MESSAGE HANDLER
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

  if (request.action === 'findEventUrl') {
    handleDynamicSearch(request.data).then(sendResponse);
    return true; 
  }

  if (request.action === 'getVerticalData') {
    getEventData(request.vertical).then(data => sendResponse({ success: true, data: data }));
    return true; 
  }

  if (request.action === 'botSearchComplete') {
    chrome.storage.session.get(['activeEventDetails', 'activeSearchTabId'], (session) => {
        const activeEventDetails = session.activeEventDetails;
        const activeSearchTabId = session.activeSearchTabId;

        if (activeEventDetails) {
          const { vertical, rowIndex, originalName } = activeEventDetails;
          if (rowIndex === 'APPEND') {
            addNewEventToSheet(vertical, originalName, request.url);
          } else {
            updateEventUrl(vertical, rowIndex, request.url);
          }
          if (activeSearchTabId) chrome.tabs.remove(activeSearchTabId).catch(() => {});
          
          chrome.runtime.sendMessage({ 
            action: 'urlFound', 
            url: request.url,
            source: 'Automated Search' 
          });
          chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
        }
    });
    sendResponse({ received: true });
    return true;
  }

  if (request.action === 'botSearchFailed') {
    chrome.runtime.sendMessage({ action: 'botSearchFailed', error: request.reason });
    chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    sendResponse({ received: true });
    return true;
  }

  if (request.action === 'logToSheet') {
      handleBatchReport(request.data).then(res => {
          sendResponse({ success: res.success });
          if(res.success) chrome.runtime.sendMessage({ action: "playSuccessSound" }); 
      });
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

  if (request.action === "saveEventUrl") {
    handleUrlSave(request.data);
    return false; 
  }

  if (request.action === 'openPopup') {
    if (sender.tab && sender.tab.id) chrome.sidePanel.open({ tabId: sender.tab.id });
    return true;
  }
  
  if (request.action === 'appendEventToSheet') {
      const { vertical, eventName, eventUrl } = request.data;
      addNewEventToSheet(vertical, eventName, eventUrl);
      return false;
  }

  // UPDATED LISTENER FOR CLOSER
  if (request.action === 'triggerCloser') {
      // Pass startRow if provided, or default to 1
      const startRow = request.startRow || 1;
      runSheetScanner(startRow).then(() => sendResponse({ success: true }));
      return true;
  }
});

// ==========================================
// 4. HELPER FUNCTIONS
// ==========================================

async function handleDynamicSearch(data) {
  try {
    const { eventName, vertical } = data;
    const sheetData = await getEventData(vertical); 
    const searchBaseUrl = sheetData.searchUrl;
    if (!searchBaseUrl) return { success: false, error: "No Search URL found in Sheet." };

    const eventKey = eventName.toLowerCase();
    const existingEvent = sheetData.eventMap[eventKey];
    
    const eventDetails = {
        vertical: vertical,
        eventName: eventName,
        originalName: eventName,
        rowIndex: existingEvent ? existingEvent.rowIndex : 'APPEND'
    };

    const finalUrl = searchBaseUrl; 
    const tab = await chrome.tabs.create({ url: finalUrl, active: true });
    
    await chrome.storage.session.set({
        activeSearchTabId: tab.id,
        activeEventDetails: eventDetails
    });
    return { success: true, status: "tab_opened" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleAddVideo(tab, data) {
  try {
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    const screenshotId = crypto.randomUUID();
    if (screenshotUrl) await saveImage(screenshotId, screenshotUrl);

    const newItem = { ...data, screenshotId: screenshotUrl ? screenshotId : null, timestamp: new Date().toISOString() };
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

async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    const cart = storage.piracy_cart || [];
    const savedName = storage.last_reporter || "Unknown User";
    const finalReporterName = formData.reporterName || savedName;

    if (cart.length === 0 && formData.urls) {
        if (Array.isArray(formData.urls)) formData.urls.forEach(u => cart.push({ url: u, handle: "Manual", views: "N/A" }));
    }

    const token = await getAuthToken();
    const dateStr = new Date().toISOString().split('T')[0];
    const todayFormatted = new Date().toLocaleDateString("en-US");
    const eventFolderId = await ensureFolderHierarchy(token, formData.eventName, dateStr);
    const screenshotFolderId = await ensureDailyScreenshotFolder(token, dateStr);

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
      const viewString = items.map(i => i.views || "N/A").join('\n');
      const reportId = generateReportId();

      let detectedPlatform = "TikTok"; 
      if (urls[0].includes('youtube')) detectedPlatform = "YouTube";
      
      const pdfData = { eventName: formData.eventName, vertical: formData.vertical, reporterName: finalReporterName, handle, urls, notes: `Report ID: ${reportId}` };
      const pdfBlob = await generatePDF(pdfData);
      const pdfUpload = await uploadToDrive(token, eventFolderId, `${reportId}_@${handle}.pdf`, pdfBlob, 'application/pdf');

      if (screenshotFolderId) {
        for (const item of items) {
          let imgDataUrl = item.screenshot; 
          if (item.screenshotId) imgDataUrl = await getImage(item.screenshotId);
          if(imgDataUrl) {
            const response = await fetch(imgDataUrl);
            await uploadToDrive(token, screenshotFolderId, `${formData.eventName}_${reportId}_@${handle}_Evidence.jpg`, await response.blob(), 'image/jpeg');
          }
        }
      }

      await appendToSheet(token, { values: [todayFormatted, formData.vertical, formData.eventName, detectedPlatform, "VOD", viewString, finalReporterName, urlString, "DMCA takedown request", "Reported", `Evidence: ${pdfUpload.webViewLink}`, finalReporterName, "", "", "", "", "", "", "", reportId] });
    }

    await chrome.storage.local.remove('piracy_cart');
    await clearImages();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleUrlSave(data) {
  try {
    const { vertical, eventName, url, platform } = data; 
    const sheetData = await getEventData(vertical);
    const eventKey = eventName.toLowerCase();
    const eventInfo = sheetData.eventMap[eventKey];
    if (eventInfo && eventInfo.rowIndex) await updateEventUrl(vertical, eventInfo.rowIndex, url, platform);
    else await addNewEventToSheet(vertical, eventName, url, platform);
  } catch (err) { console.error(err); }
}
