import { getAuthToken } from './utils/auth.js';
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
// 1. BOT INJECTION LISTENER (FIXED FOR MV3 STATE)
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if this is the active search tab from session storage
    const session = await chrome.storage.session.get(['activeSearchTabId']);
    
    if (session.activeSearchTabId && tabId === session.activeSearchTabId) {
        console.log("🔍 Search tab loaded. Injecting Bot...");
        // If you need to inject scripts dynamically, ensure 'search_bot.js' is in manifest
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
  
  // --- NEW: Handle Whitelist Check ---
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
      
    return true; // Keep channel open for async response
  }

  // A. FIND EVENT URL
  if (request.action === 'findEventUrl') {
    handleDynamicSearch(request.data).then(sendResponse);
    return true; 
  }

  // B. GET VERTICAL DATA
  if (request.action === 'getVerticalData') {
    getEventData(request.vertical).then(data => {
      sendResponse({ success: true, data: data });
    });
    return true; 
  }

  // C. BOT SUCCESS
  if (request.action === 'botSearchComplete') {
    // Retrieve state from session
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

          // Clear session state
          chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
        }
    });
    return true;
  }

  // D. BOT FAILURE
  if (request.action === 'botSearchFailed') {
    console.warn("🤖 Bot failed to find URL.");
    chrome.runtime.sendMessage({ 
        action: 'botSearchFailed', 
        error: request.reason
    });
    // Clear session state
    chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    return true;
  }

  // E. LOG TO SHEET (Triggered by TikTok Overlay)
  if (request.action === 'logToSheet') {
      handleBatchReport(request.data).then(res => {
          sendResponse({ success: res.success });
          if(res.success) {
             playJingle();
             chrome.runtime.sendMessage({ action: "playSuccessSound" }); 
          }
      });
      return true;
  }

  // F. Config Fetch
  if (request.action === 'getConfig') {
    handleConfigFetch().then(sendResponse);
    return true;
  }

  // G. Add Video to Cart
  if (request.action === 'addToCart') {
    handleAddVideo(sender.tab, request.data).then(sendResponse);
    return true; 
  }

  // H. Clear Cart
  if (request.action === 'clearCart') {
    chrome.storage.local.remove('piracy_cart', () => sendResponse({success: true}));
    return true;
  }

  // I. Save URL Manually
  if (request.action === "saveEventUrl") {
    handleUrlSave(request.data);
    return false; 
  }

  // J. Open Panel
  if (request.action === 'openPopup') {
    if (sender.tab && sender.tab.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id });
    }
    return true;
  }
  
  // K. Append Event (From Source Grabber)
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
    
    // Construct state object
    const eventDetails = {
        vertical: vertical,
        eventName: eventName,
        originalName: eventName,
        rowIndex: existingEvent ? existingEvent.rowIndex : 'APPEND'
    };

    // Manual Search Mode: Open base URL, user types manually
    const finalUrl = searchBaseUrl; 

    const tab = await chrome.tabs.create({ url: finalUrl, active: true });
    
    // Save state to Session Storage (Persists even if SW sleeps)
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

async function handleAddVideo(tab, data) {
  try {
    // Attempt to capture screenshot
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    
    const storage = await chrome.storage.local.get('piracy_cart');
    let cart = storage.piracy_cart || [];
    
    if (!cart.some(item => item.url === data.url)) {
      cart.push({
        ...data,
        screenshot: screenshotUrl || null,
        timestamp: new Date().toISOString()
      });
      await chrome.storage.local.set({ 'piracy_cart': cart });
    }
    return { success: true, count: cart.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleBatchReport(formData) {
  try {
    // 1. GET DATA (INCLUDING SAVED NAME)
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    const cart = storage.piracy_cart || [];
    
    // Use saved name if formData is empty
    const savedName = storage.last_reporter || "Unknown User";
    const finalReporterName = formData.reporterName || savedName;

    // Safety check for empty cart
    if (cart.length === 0 && formData.urls) {
        if (Array.isArray(formData.urls)) {
            formData.urls.forEach(u => cart.push({ url: u, handle: "Manual", views: "N/A" }));
        }
    }

    const token = await getAuthToken();
    const dateStr = new Date().toISOString().split('T')[0];
    const todayFormatted = new Date().toLocaleDateString("en-US");

    // 2. Prepare Folders
    const eventFolderId = await ensureFolderHierarchy(token, formData.eventName, dateStr);
    const screenshotFolderId = await ensureDailyScreenshotFolder(token, dateStr);

    // 3. Group by Handle
    const grouped = {};
    cart.forEach(item => {
      const handle = item.handle || "Unknown";
      if (!grouped[handle]) grouped[handle] = [];
      grouped[handle].push(item);
    });

    const handles = Object.keys(grouped);

    for (const handle of handles) {
      const items = grouped[handle];
      const urls = items.map(i => i.url);
      const urlString = urls.join('\n'); 
      const viewString = items.map(i => i.views || "N/A").join('\n');
      
      const reportId = generateReportId();

      // DETECT PLATFORM DYNAMICALLY
      let detectedPlatform = "TikTok"; // Default
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

      // 4. Generate & Upload PDF
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

      // 5. Upload Screenshots
      if (screenshotFolderId) {
        for (const item of items) {
          if(item.screenshot) {
            const response = await fetch(item.screenshot);
            const blob = await response.blob();
            const imgName = `${formData.eventName}_${reportId}_@${handle}_Evidence.jpg`;
            await uploadToDrive(token, screenshotFolderId, imgName, blob, 'image/jpeg');
          }
        }
      }

      // 6. Append to Google Sheet (20 Columns)
      const rowValues = [
          todayFormatted,                 // 1. Date
          formData.vertical,              // 2. Vertical
          formData.eventName,             // 3. Event
          detectedPlatform,               // 4. Platform (Dynamic)
          "VOD",                          // 5. Type
          viewString,                     // 6. Views
          finalReporterName,              // 7. Found By
          urlString,                      // 8. Link
          "DMCA takedown request",        // 9. Action
          "Reported",                     // 10. Status
          `Evidence: ${pdfUpload.webViewLink}`, // 11. Notes
          finalReporterName,              // 12. Submitter
          "",                             // 13. Investigators
          "",                             // 14. Report #
          "",                             // 15. Resolutions
          "",                             // 16. Flo Email
          "",                             // 17. Name on Account
          "",                             // 18. Canceled
          "",                             // 19. Slack ID
          reportId                        // 20. Report ID
      ];

      await appendToSheet(token, { values: rowValues });
    }

    await chrome.storage.local.remove('piracy_cart');
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
    // DESTUCTURE 'platform' from the data object
    const { vertical, eventName, url, platform } = data; 
    
    console.log(`💾 Saving ${platform || 'unknown'} URL for ${eventName}...`);

    const sheetData = await getEventData(vertical);
    const eventKey = eventName.toLowerCase();
    const eventInfo = sheetData.eventMap[eventKey];

    if (eventInfo && eventInfo.rowIndex) {
      // Pass platform to update specific column (e.g. 'youtube' -> Col D)
      await updateEventUrl(vertical, eventInfo.rowIndex, url, platform);
    } else {
      console.warn("⚠️ New event. Adding row.");
      // Pass platform to create row with URL in correct column
      await addNewEventToSheet(vertical, eventName, url, platform);
    }
  } catch (err) {
    console.error("❌ Error saving URL:", err);
  }
}
