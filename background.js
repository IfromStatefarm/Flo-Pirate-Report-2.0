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
  updateReportStatus
} from './utils/google_api.js';
import { generatePDF } from './utils/pdf_gen.js';
import { saveImage, getImage, clearImages } from './utils/idb_storage.js';

// Open Side Panel on Click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- ALARMS & THE CLOSER SETUP ---
const ALARM_NAME = "theCloser";
chrome.runtime.onInstalled.addListener(() => {
  // Check every 60 minutes
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  console.log("⏰ 'The Closer' Alarm Scheduled (60m)");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runTheCloser(); // Standard run (respects time limits)
  }
});

// --- ID GENERATOR ---
function generateReportId() {
  const nums = Math.floor(10 + Math.random() * 90); 
  const letters = Math.random().toString(36).substring(2, 8); 
  return `${nums}${letters}`.toUpperCase();
}

// ==========================================
// 1. THE CLOSER (Automated Verification)
// ==========================================

async function runTheCloser(force = false) {
  console.log(`🕵️ 'The Closer' started. (Force Mode: ${force})`);
  
  // 1. Get Tracking Queue
  const data = await chrome.storage.local.get('tracking_queue');
  let queue = data.tracking_queue || [];
  
  if (queue.length === 0) {
    console.log("🕵️ Tracking queue empty.");
    return;
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
  let updatedQueue = [];
  let changesMade = false;

  for (const item of queue) {
    try {
        // A. Check Age
        const age = now - item.timestamp;
        
        // If it's verified as taken down, we don't keep it.
        // If it's older than 7 days, we give up and drop it.
        if (age > SEVEN_DAYS_MS) {
            console.log(`🗑️ Dropping old item: ${item.reportId}`);
            changesMade = true;
            continue; 
        }

        // B. If older than 24 hours OR force is true (manual test)
        if (force || age > ONE_DAY_MS) {
            console.log(`🔍 Verifying: ${item.platform} - ${item.reportId} (${item.urls.length} links)`);
            
            // We verify ALL URLs in the batch. If all represent missing content, we mark taken down.
            let allDown = true;
            for (const url of item.urls) {
                const isDown = await verifyTakedown(url, item.platform);
                if (!isDown) {
                    allDown = false;
                    console.log(`   👉 Active Link Found: ${url}`);
                    break; // One active link means the report isn't fully "Closed"
                }
            }

            if (allDown) {
                // Update Sheet
                // NOTE: updateReportStatus now handles the strikethrough formatting in google_api.js
                const success = await updateReportStatus(item.reportId, "Taken Down");
                if (success) {
                    console.log(`✅ Closed Report: ${item.reportId} (Status Updated & Struck Through)`);
                    changesMade = true;
                    continue; // Remove from queue
                } else {
                    console.warn(`⚠️ Verification successful but Sheet update failed for ${item.reportId}`);
                    updatedQueue.push(item); 
                }
            } else {
                console.log(`❌ Still Active: ${item.reportId}`);
                updatedQueue.push(item);
            }
        } else {
            // Too new, keep waiting
            // console.log(`⏳ Skipping ${item.reportId} (Too new)`);
            updatedQueue.push(item);
        }
    } catch (err) {
        console.error(`Error processing item ${item.reportId}:`, err);
        updatedQueue.push(item); // Keep item in queue if error occurs
    }
  }

  if (changesMade) {
      await chrome.storage.local.set({ tracking_queue: updatedQueue });
  }
}

// Uses oEmbed to check if video exists. 
// 404/403 usually means deleted or private (effective takedown).
async function verifyTakedown(url, platform) {
    try {
        let checkUrl = "";
        
        if (platform.toLowerCase() === 'youtube') {
            checkUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        } 
        else if (platform.toLowerCase() === 'tiktok') {
            checkUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
        }
        else if (platform.toLowerCase().includes('twitter') || platform.toLowerCase().includes('x.com')) {
            checkUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
        }
        else {
            // Fallback for others: Assume active if we can't check
            return false; 
        }

        const res = await fetch(checkUrl);
        
        // If 404 (Not Found), 403 (Forbidden), 401 (Unauthorized) -> Content is effectively gone/private
        if (res.status === 404 || res.status === 403 || res.status === 401 || res.status === 400) {
            return true; 
        }
        
        return false; // Still exists (200 OK)

    } catch (e) {
        console.error("Verification Fetch Error:", e);
        return false; // Assume active on error
    }
}

// Add to Queue Helper
async function addToTrackingQueue(reportId, urls, platform) {
    try {
        const data = await chrome.storage.local.get('tracking_queue');
        const queue = data.tracking_queue || [];
        
        queue.push({
            reportId,
            urls, // Array of strings
            platform,
            timestamp: Date.now()
        });
        
        await chrome.storage.local.set({ tracking_queue: queue });
        console.log(`📝 Added Report ${reportId} to 'The Closer' queue.`);
    } catch(e) {
        console.error("Failed to add to tracking queue", e);
    }
}

// ==========================================
// 2. BOT INJECTION LISTENER
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
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
// 3. MAIN MESSAGE HANDLER
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.action === 'checkUserIdentity') {
    getUserEmail().then(email => {
      sendResponse({ email: email });
    });
    return true; 
  }

  if (request.action === "checkWhitelist") {
    checkIfAuthorized(request.platform, request.handle)
      .then(isAuthorized => {
        sendResponse({ authorized: isAuthorized });
      })
      .catch(err => {
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
    chrome.runtime.sendMessage({ action: 'botSearchFailed', error: request.reason });
    chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
    return true;
  }

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

  if (request.action === 'getConfig') {
    handleConfigFetch().then(sendResponse);
    return true;
  }

  if (request.action === 'addToCart') {
    handleAddVideo(sender.tab, request.data).then(sendResponse);
    return true; 
  }

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
        .catch(err => console.error("❌ Failed to save event:", err));
      return false;
  }

  if (request.action === 'triggerCloser') {
      // Pass FORCE=TRUE to bypass the 24 hour check
      runTheCloser(true).then(() => sendResponse({ success: true }));
      return true;
  }
});

// ==========================================
// 4. HELPER FUNCTIONS
// ==========================================

async function playJingle() {
    chrome.runtime.sendMessage({ action: "playSuccessSound" });
}

async function checkStorageQuota(bytesToAdd = 0) {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES || 5242880; 
    if (bytesInUse + bytesToAdd >= (quota - 102400)) {
        throw new Error("Storage quota exceeded. Please clear your queue before adding more.");
    }
    return true;
  } catch (e) {
    return true; 
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
    return { success: false, error: e.message };
  }
}

async function handleAddVideo(tab, data) {
  try {
    const screenshotPromise = chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    
    const screenshotId = crypto.randomUUID();

    if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
    }

    const newItem = {
      ...data,
      screenshotId: screenshotUrl ? screenshotId : null, 
      timestamp: new Date().toISOString()
    };

    const estimatedSize = new Blob([JSON.stringify(newItem)]).size;
    await checkStorageQuota(estimatedSize);

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
        if (Array.isArray(formData.urls)) {
            formData.urls.forEach(u => cart.push({ url: u, handle: "Manual", views: "N/A" }));
        }
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

    const handles = Object.keys(grouped);

    for (const handle of handles) {
      const items = grouped[handle];
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

      // 5. Upload Screenshots
      if (screenshotFolderId) {
        for (const item of items) {
          let imgDataUrl = item.screenshot; 
          if (item.screenshotId) {
             imgDataUrl = await getImage(item.screenshotId);
          }

          if(imgDataUrl) {
            const response = await fetch(imgDataUrl);
            const blob = await response.blob();
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

      // --- THE CLOSER: TRACK THIS REPORT ---
      await addToTrackingQueue(reportId, urls, detectedPlatform);
    }

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
      await addNewEventToSheet(vertical, eventName, url, platform);
    }
  } catch (err) {
    console.error("❌ Error saving URL:", err);
  }
}
