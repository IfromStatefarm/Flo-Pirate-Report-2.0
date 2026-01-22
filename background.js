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
  checkIfAuthorized
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

// --- RATE LIMIT HELPER ---
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 1. BOT INJECTION LISTENER
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if this is the active search tab from session storage
    const session = await chrome.storage.session.get(['activeSearchTabId']);
    
    if (session.activeSearchTabId && tabId === session.activeSearchTabId) {
        console.log("🔍 Search tab loaded. Injecting Bot...");
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['search_bot.js']
        }).catch(err => console.error("Failed to inject bot:", err));
    }
  }
});

// ==========================================
// 2. MAIN MESSAGE HANDLER
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.action === 'checkUserIdentity') {
    getUserEmail().then(email => {
      sendResponse({ email: email });
    });
    return true; 
  }

  if (request.action === "checkWhitelist") {
    console.log(`🛡️ Whitelist Check - Platform: ${request.platform}, Handle: ${request.handle}`);
    checkIfAuthorized(request.platform, request.handle)
      .then(isAuthorized => {
        console.log(`🛡️ Result: ${isAuthorized ? "BLOCKED (Authorized)" : "ALLOWED"}`);
        sendResponse({ authorized: isAuthorized });
      })
      .catch(err => {
        console.error("🛡️ Whitelist Check Error:", err);
        sendResponse({ error: err.message });
      });
    return true; 
  }

  if (request.action === 'findEventUrl') {
    handleDynamicSearch(request.data).then(sendResponse);
    return true; 
  }

  if (request.action === 'getVerticalData') {
    getEventData(request.vertical).then(data => {
      sendResponse({ success: true, data: data });
    });
    return true; 
  }

  if (request.action === 'botSearchComplete') {
    chrome.storage.session.get(['activeEventDetails', 'activeSearchTabId'], (session) => {
        const activeEventDetails = session.activeEventDetails;
        const activeSearchTabId = session.activeSearchTabId;

        if (activeEventDetails) {
          const { vertical, rowIndex, originalName } = activeEventDetails;
          console.log("🤖 Bot found URL:", request.url);

          if (rowIndex === 'APPEND') {
            addNewEventToSheet(vertical, originalName, request.url);
          } else {
            updateEventUrl(vertical, rowIndex, request.url);
          }
          
          if (activeSearchTabId) {
            chrome.tabs.remove(activeSearchTabId).catch(() => {});
          }

          chrome.runtime.sendMessage({ 
            action: 'urlFound', 
            url: request.url,
            source: 'Automated Search' 
          });

          chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
        }
    });
    return true;
  }

  if (request.action === 'botSearchFailed') {
    console.warn("🤖 Bot failed to find URL.");
    chrome.runtime.sendMessage({ 
        action: 'botSearchFailed', 
        error: request.reason
    });
    chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    return true;
  }

  // --- CHANGED: Renamed action to be more descriptive or handle general processing ---
  if (request.action === 'processQueue' || request.action === 'logToSheet') {
      handleBatchReport(request.data).then(res => {
          if (res.success) {
             playJingle();
             chrome.runtime.sendMessage({ action: "progressComplete" }); // Notify UI of finish
          } else {
             chrome.runtime.sendMessage({ action: "progressError", error: res.error });
          }
          sendResponse({ success: res.success });
      });
      return true; // Async response
  }

  if (request.action === 'getConfig') {
    handleConfigFetch().then(sendResponse);
    return true;
  }

  // UPDATED: Now uses IndexedDB
  if (request.action === 'addToCart') {
    handleAddVideo(sender.tab, request.data).then(sendResponse);
    return true; 
  }

  // UPDATED: Clears both Storage and IDB
  if (request.action === 'clearCart') {
    Promise.all([
      chrome.storage.local.remove('piracy_cart'),
      clearImages()
    ]).then(() => sendResponse({success: true}));
    return true;
  }

  if (request.action === "saveEventUrl") {
    handleUrlSave(request.data);
    return false; 
  }

  if (request.action === 'openPopup') {
    if (sender.tab && sender.tab.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id });
    }
    return true;
  }
  
  if (request.action === 'appendEventToSheet') {
      const { vertical, eventName, eventUrl } = request.data;
      addNewEventToSheet(vertical, eventName, eventUrl)
        .then(() => console.log("✅ Event Auto-Saved to Sheet"))
        .catch(err => console.error("❌ Failed to save event:", err));
      return false;
  }
});

// ==========================================
// 3. HELPER FUNCTIONS
// ==========================================

async function playJingle() {
    chrome.runtime.sendMessage({ action: "playSuccessSound" });
}

// --- NEW: Storage Quicksand Prevention ---
async function checkStorageQuota(bytesToAdd = 0) {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES || 5242880; // Default 5MB
    // Safety buffer of 100KB
    if (bytesInUse + bytesToAdd >= (quota - 102400)) {
        throw new Error("Storage quota exceeded. Please clear your queue before adding more.");
    }
    return true;
  } catch (e) {
    console.warn("Quota check failed:", e);
    return true; // Fail open if API not supported
  }
}

async function handleDynamicSearch(data) {
  try {
    const { eventName, vertical } = data;
    const sheetData = await getEventData(vertical); 
    const searchBaseUrl = sheetData.searchUrl;

    if (!searchBaseUrl) {
      return { success: false, error: "No Search URL found in Sheet." };
    }

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
    console.error(e);
    return { success: false, error: e.message };
  }
}

// --- UPDATED: Save to IDB + Metadata to Storage ---
async function handleAddVideo(tab, data) {
  try {
    // 1. Capture Screenshot
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    
    // 2. Generate Reference ID
    const screenshotId = crypto.randomUUID();

    // 3. Save heavy image to IndexedDB
    if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
    }

    // 4. Prepare Lightweight Metadata
    const newItem = {
      ...data,
      screenshotId: screenshotUrl ? screenshotId : null, // Store Ref, NOT Data
      timestamp: new Date().toISOString()
    };

    // 5. Check Quota (Quicksand Prevention)
    // Approximate size of the JSON object
    const estimatedSize = new Blob([JSON.stringify(newItem)]).size;
    await checkStorageQuota(estimatedSize);

    // 6. Save to Local Storage
    const storage = await chrome.storage.local.get('piracy_cart');
    let cart = storage.piracy_cart || [];
    
    if (!cart.some(item => item.url === data.url)) {
      cart.push(newItem);
      await chrome.storage.local.set({ 'piracy_cart': cart });
    }
    return { success: true, count: cart.length };
  } catch (e) {
    console.error("Add to cart error:", e);
    return { success: false, error: e.message };
  }
}

// --- UPDATED: Retrieve from IDB for Report ---
async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    const cart = storage.piracy_cart || [];
    
    const savedName = storage.last_reporter || "Unknown User";
    const finalReporterName = formData.reporterName || savedName;

    if (cart.length === 0 && formData.urls) {
        if (Array.isArray(formData.urls)) {
            formData.urls.forEach(u => cart.push({ url: u, handle: "Manual", views: "N/A" }));
        }
    }

    const token = await getAuthToken();
    const dateStr = new Date().toISOString().split('T')[0];
    const todayFormatted = new Date().toLocaleDateString("en-US");

    const eventFolderId = await ensureFolderHierarchy(token, formData.eventName, dateStr);
    
    // Only verify screenshots folder if toggle is on (or if not provided, assume true for safety)
    const uploadScreenshots = formData.uploadScreenshots !== false; 
    let screenshotFolderId = null;
    if (uploadScreenshots) {
       screenshotFolderId = await ensureDailyScreenshotFolder(token, dateStr);
    }

    // Group items by Handle to reduce PDF generation count
    const grouped = {};
    cart.forEach(item => {
      const handle = item.handle || "Unknown";
      if (!grouped[handle]) grouped[handle] = [];
      grouped[handle].push(item);
    });

    const handles = Object.keys(grouped);
    const totalHandles = handles.length;

    for (let i = 0; i < totalHandles; i++) {
      const handle = handles[i];
      const items = grouped[handle];
      
      // Update UI Progress
      const percent = Math.round(((i + 1) / totalHandles) * 100);
      chrome.runtime.sendMessage({ 
          action: 'progressUpdate', 
          percent: percent,
          status: `Processing @${handle} (${i + 1}/${totalHandles})...`
      });

      const urls = items.map(i => i.url);
      const urlString = urls.join('\n'); 
      const viewString = items.map(i => i.views || "N/A").join('\n');
      
      const reportId = generateReportId();

      let detectedPlatform = "TikTok"; 
      const sampleUrl = urls[0] || "";
      
      if (sampleUrl.includes('youtube') || sampleUrl.includes('youtu.be')) {
          detectedPlatform = "YouTube";
      } else if (sampleUrl.includes('instagram')) {
          detectedPlatform = "Instagram";
      } else if (sampleUrl.includes('twitter') || sampleUrl.includes('x.com')) {
          detectedPlatform = "X (Twitter)";
      } else if (sampleUrl.includes('facebook')) {
          detectedPlatform = "Facebook";
      } else if (sampleUrl.includes('twitch')) {
          detectedPlatform = "Twitch";
      }

      const pdfData = { 
          eventName: formData.eventName, 
          vertical: formData.vertical, 
          reporterName: finalReporterName,
          handle, urls, 
          notes: `Report ID: ${reportId}` 
      };
      
      const pdfBlob = await generatePDF(pdfData);
      const pdfName = `${reportId}_@${handle}.pdf`;
      const pdfUpload = await uploadToDrive(token, eventFolderId, pdfName, pdfBlob, 'application/pdf');

      // 5. Upload Screenshots (RESOLVE FROM IDB)
      // Only if folder exists (meaning user checked the box)
      if (screenshotFolderId) {
        for (const item of items) {
          // Resolve Image Data
          let imgDataUrl = item.screenshot; // Legacy fallback
          if (item.screenshotId) {
             imgDataUrl = await getImage(item.screenshotId);
          }

          if(imgDataUrl) {
            const response = await fetch(imgDataUrl);
            const blob = await response.blob();
            // Naming convention: Event_ReportID_@Handle_Evidence.jpg
            const imgName = `${formData.eventName}_${reportId}_@${handle}_Evidence.jpg`;
            await uploadToDrive(token, screenshotFolderId, imgName, blob, 'image/jpeg');
          }
        }
      }

      const rowValues = [
          todayFormatted,                 
          formData.vertical,              
          formData.eventName,             
          detectedPlatform,               
          "VOD",                          
          viewString,                     
          finalReporterName,              
          urlString,                      
          "DMCA takedown request",        
          "Reported",                     
          `Evidence: ${pdfUpload.webViewLink}`, 
          finalReporterName,              
          "",                             
          "",                             
          "",                             
          "",                             
          "",                             
          "",                             
          "",                             
          reportId                        
      ];

      await appendToSheet(token, { values: rowValues });

      // === RATE LIMITING (THROTTLE) ===
      // Wait 1.5 seconds between sheet writes to prevent 429 errors
      console.log(`⏳ Rate Limit: Pausing 1.5s after @${handle}`);
      await wait(1500); 
    }

    // CLEANUP: Clear both storage and IDB
    await chrome.storage.local.remove('piracy_cart');
    await clearImages();
    
    return { success: true };

  } catch (e) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

async function handleConfigFetch() {
  try {
    const config = await fetchConfig();
    return { success: true, config };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleUrlSave(data) {
  try {
    const { vertical, eventName, url, platform } = data; 
    console.log(`💾 Saving ${platform || 'unknown'} URL for ${eventName}...`);

    const sheetData = await getEventData(vertical);
    const eventKey = eventName.toLowerCase();
    const eventInfo = sheetData.eventMap[eventKey];

    if (eventInfo && eventInfo.rowIndex) {
      await updateEventUrl(vertical, eventInfo.rowIndex, url, platform);
    } else {
      console.warn("⚠️ New event. Adding row.");
      await addNewEventToSheet(vertical, eventName, url, platform);
    }
  } catch (err) {
    console.error("❌ Error saving URL:", err);
  }
}
