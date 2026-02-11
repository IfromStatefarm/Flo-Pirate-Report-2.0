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

// --- STOP FLAG ---
let stopScannerSignal = false;

// ==========================================
// 1. FRESH SCRAPING LOGIC (LAZY LOADING)
// ==========================================

async function getFreshTikTokViews(url) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

        // Wait for tab to load completely
        await new Promise(resolve => {
            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        // Small buffer for hydration
        await new Promise(r => setTimeout(r, 2000));

        // Inject extractor
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                try {
                    // Check for deleted content indicators
                    const bodyText = document.body.innerText;
                    if (bodyText.includes("Video currently unavailable") || 
                        bodyText.includes("not find this account") ||
                        bodyText.includes("Video not found")) {
                        return { views: "DELETED", status: "DELETED" };
                    }

                    // Strategy 1: __UNIVERSAL_DATA_FOR_REHYDRATION__
                    let el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
                    if (el && el.textContent) {
                        const json = JSON.parse(el.textContent);
                        const defaultScope = json.__DEFAULT_SCOPE__;
                        // Path: webapp.video-detail.itemInfo.itemStruct.stats.playCount
                        const struct = defaultScope?.['webapp.video-detail']?.itemInfo?.itemStruct;
                        if (struct && struct.stats) {
                            return { views: struct.stats.playCount, status: "ACTIVE" };
                        }
                    }
                    
                    // Strategy 2: SIGI_STATE
                    el = document.getElementById('SIGI_STATE');
                    if (el && el.textContent) {
                         const json = JSON.parse(el.textContent);
                         const itemMod = json.ItemModule;
                         if (itemMod) {
                             const keys = Object.keys(itemMod);
                             if (keys.length > 0 && itemMod[keys[0]].stats) {
                                 return { views: itemMod[keys[0]].stats.playCount, status: "ACTIVE" };
                             }
                         }
                    }
                    
                    // Strategy 3: DOM Fallback
                    const viewEl = document.querySelector('[data-e2e="video-views"]');
                    if (viewEl) return { views: viewEl.innerText, status: "ACTIVE" };

                    return { views: "N/A", status: "UNKNOWN" };
                } catch(e) {
                    return { views: "ERROR", status: "ERROR" };
                }
            }
        });
        
        // Cleanup
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return result[0]?.result || { views: "N/A", status: "UNKNOWN" };

    } catch(e) {
        console.error("Fresh Scrape Error:", e);
        if(tabId) chrome.tabs.remove(tabId).catch(()=>{});
        return { views: "N/A", status: "ERROR" };
    }
}

// ==========================================
// 2. THE SHEET SCANNER (The Closer 2.0)
// ==========================================

// Helper to send progress to sidepanel
function sendProgress(status, details) {
    chrome.runtime.sendMessage({ 
        action: 'closerProgress', 
        status: status,
        details: details 
    }).catch(() => {}); // Ignore error if panel closed
}

async function runSheetScanner(startRow = 1) {
  stopScannerSignal = false;
  console.log(`🕵️ Sheet Scanner: Starting from Row ${startRow}...`);
  sendProgress(`Starting from Row ${startRow}`, "Fetching sheet data...");
  
  try {
    const rows = await getColumnHData();
    let consecutiveBlanks = 0;
    
    if (startRow < 1) startRow = 1;

    for (let i = startRow; i < rows.length; i++) {
        if (stopScannerSignal) {
            console.log("🛑 Sheet Scanner: Stopped by user.");
            sendProgress("Scanner Stopped", "User interrupted the process.");
            break;
        }

        if (consecutiveBlanks >= 3) {
            console.log("🕵️ Sheet Scanner: Hit 3 blank cells. Stopping.");
            sendProgress("Scanner Stopped", "Hit 3 consecutive blank cells.");
            break;
        }

        const cellValue = rows[i][0]; 
        
        if (!cellValue) {
            consecutiveBlanks++;
            continue;
        }
        
        consecutiveBlanks = 0; 

        const urlRegex = /https?:\/\/[^\s,]+/g;
        let match;
        const matches = [];
        while ((match = urlRegex.exec(cellValue)) !== null) {
            matches.push({ url: match[0], index: match.index, end: match.index + match[0].length });
        }
        
        if (matches.length === 0) continue;

        console.log(`Row ${i+1}: Checking ${matches.length} links...`);
        sendProgress(`Scanning Row ${i+1}`, `Found ${matches.length} link(s)...`);

        let activeCount = 0;
        let deadCount = 0;
        
        const defaultStyle = { strikethrough: false, foregroundColor: { red: 0, green: 0, blue: 0 } };
        const deadStyle = { strikethrough: true, foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 } };
        
        let currentRuns = [{ startIndex: 0, format: defaultStyle }];
        const deadRanges = []; 

        for (let j = 0; j < matches.length; j++) {
            if (stopScannerSignal) break;

            const { url, index, end } = matches[j];
            sendProgress(`Row ${i+1}`, `Link ${j+1}/${matches.length}: Checking...`);
            
            let platform = 'unknown';
            if (url.includes('tiktok')) platform = 'tiktok';
            else if (url.includes('youtube') || url.includes('youtu.be')) platform = 'youtube';
            else if (url.includes('twitter') || url.includes('x.com')) platform = 'twitter';
            else if (url.includes('instagram')) platform = 'instagram';
            else if (url.includes('facebook')) platform = 'facebook';
            else if (url.includes('twitch')) platform = 'twitch';

            try {
                const isDown = await verifyTakedownViaTab(url, platform); 
                
                if (isDown) {
                    deadCount++;
                    console.log(`  - DOWN: ${url}`);
                    deadRanges.push({ start: index, end: end });
                    deadRanges.sort((a, b) => a.start - b.start);

                    const newRuns = [];
                    let cursor = 0;
                    
                    if (deadRanges.length > 0 && deadRanges[0].start > 0) {
                         newRuns.push({ startIndex: 0, format: defaultStyle });
                    }
                    
                    for (const range of deadRanges) {
                        if (range.start > cursor) {
                            newRuns.push({ startIndex: cursor, format: defaultStyle });
                        }
                        newRuns.push({ startIndex: range.start, format: deadStyle });
                        cursor = range.end;
                    }
                    
                    if (cursor < cellValue.length) {
                        newRuns.push({ startIndex: cursor, format: defaultStyle });
                    }

                    await updateCellWithRichText(i, cellValue, newRuns);
                    
                } else {
                    activeCount++;
                    console.log(`  - ACTIVE: ${url}`);
                }
            } catch (err) {
                console.warn(`  - Error checking ${url}:`, err);
                activeCount++; 
            }
            
            await new Promise(r => setTimeout(r, 1500)); 
        }

        if (stopScannerSignal) {
             sendProgress("Scanner Stopped", "Operation cancelled.");
             break;
        }

        if (deadCount > 0 && activeCount === 0) {
            console.log(`Row ${i+1}: Resolved (All ${deadCount} links down).`);
            sendProgress(`Row ${i+1}: Resolved`, "Updating Sheet...");
            await updateRowStatus(i, "Resolved");
        } else if (activeCount > 0 && deadCount > 0) {
             console.log(`Row ${i+1}: Investigating (${activeCount} active, ${deadCount} down).`);
             sendProgress(`Row ${i+1}: Investigating`, `${deadCount} dead links struck.`);
             await updateRowStatus(i, "Investigating");
        }
    }
    
    if (!stopScannerSignal) {
        console.log("🕵️ Sheet Scanner: Complete.");
        sendProgress("Scanner Complete", "Finished processing rows.");
    }

  } catch (e) {
    console.error("Sheet Scanner Failed:", e);
    sendProgress("Scanner Failed", e.message);
  }
}

// Uses Tab Loading to check if video exists
async function verifyTakedownViaTab(url, platform) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

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
        
        await new Promise(r => setTimeout(r, 2000));

        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (plat) => {
                const text = document.body.innerText.toLowerCase();
                const title = document.title.toLowerCase();
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

        chrome.tabs.remove(tabId).catch(() => {});
        return result[0]?.result || false;

    } catch (e) {
        console.error("Tab Check Error:", e);
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        return false;
    }
}

// ==========================================
// 3. BOT INJECTION LISTENER
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
// 4. MAIN MESSAGE HANDLER
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

  // --- UPDATED PROCESS QUEUE HANDLER ---
  if (request.action === 'processQueue') {
      handleBatchReport(request.data).then(res => {
          if (res.success) {
              chrome.runtime.sendMessage({ action: "progressComplete" });
          } else {
              chrome.runtime.sendMessage({ action: "progressError", error: res.error });
          }
      });
      return false; // Async status handled by runtime messages
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

  if (request.action === 'triggerCloser') {
      const startRow = request.startRow || 1;
      runSheetScanner(startRow).then(() => sendResponse({ success: true }));
      return true;
  }

  if (request.action === 'stopSheetScanner') {
      stopScannerSignal = true;
      sendResponse({ success: true });
      return true;
  }
});

// ==========================================
// 5. HELPER FUNCTIONS
// ==========================================

async function handleDynamicSearch(data) {
  try {
    const session = await chrome.storage.session.get(['activeSearchTabId', 'activeEventDetails']);
    if (session.activeSearchTabId) {
        try {
            await chrome.tabs.get(session.activeSearchTabId);
            return { 
                success: false, 
                error: "SEARCH_IN_PROGRESS", 
                activeEvent: session.activeEventDetails?.eventName || "Unknown"
            };
        } catch (e) {
            await chrome.storage.session.remove(['activeSearchTabId', 'activeEventDetails']);
        }
    }

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

// ------------------------------------------
// UPDATED BATCH REPORT LOGIC (LAZY SCRAPE)
// ------------------------------------------
async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    let cart = storage.piracy_cart || [];
    const savedName = storage.last_reporter || "Unknown User";
    const finalReporterName = formData.reporterName || savedName;

    // --- PHASE 1: FRESH SCRAPE (LAZY LOADING) ---
    const updatedCart = [];
    chrome.runtime.sendMessage({ action: 'progressUpdate', status: 'Verifying view counts...', percent: 5 });

    for (let i = 0; i < cart.length; i++) {
        let item = cart[i];
        
        // Only lazy scrape TikTok if views are PENDING or N/A
        if (item.url.includes('tiktok.com') && (item.views === 'PENDING' || item.views === 'N/A')) {
             chrome.runtime.sendMessage({ 
                 action: 'progressUpdate', 
                 status: `Scraping views (${i+1}/${cart.length})...`, 
                 percent: 5 + Math.floor((i/cart.length)*30) 
             });
             
             try {
                 const freshData = await getFreshTikTokViews(item.url);
                 if (freshData.views) item.views = freshData.views;
                 if (freshData.status === 'DELETED') {
                     item.views = 'DELETED';
                     console.log(`Video ${item.url} is DELETED.`);
                 } else {
                     console.log(`Verified ${item.url}: ${item.views} views.`);
                 }
             } catch(e) {
                 console.error(`Failed fresh scrape for ${item.url}`, e);
             }
             
             // Rate limit delay to avoid TikTok flagging
             await new Promise(r => setTimeout(r, 2000));
        }
        updatedCart.push(item);
    }
    
    // Update local cart with verified numbers just in case
    cart = updatedCart;
    await chrome.storage.local.set({ 'piracy_cart': cart });

    // --- PHASE 2: PROCESSING REPORTS ---
    chrome.runtime.sendMessage({ action: 'progressUpdate', status: 'Connecting to Google...', percent: 40 });
    const token = await getAuthToken();
    const currentYear = new Date().getFullYear();
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const todayFormatted = new Date().toLocaleDateString("en-US");
    
    // 1. Ensure Folder Structure
    const yearFolderId = await ensureYearlyReportFolder(token, currentYear);
    const screenshotsFolderId = await ensureDailyScreenshotFolder(token, dateStr);

    // Grouping logic
    const grouped = {};
    cart.forEach(item => {
      const handle = item.handle || "Unknown";
      if (!grouped[handle]) grouped[handle] = [];
      grouped[handle].push(item);
    });

    const totalGroups = Object.keys(grouped).length;
    let groupIdx = 0;

    // --- BATCH PROCESSING LOOP ---
    for (const handle of Object.keys(grouped)) {
      groupIdx++;
      chrome.runtime.sendMessage({ 
          action: 'progressUpdate', 
          status: `Processing Report ${groupIdx}/${totalGroups} (@${handle})...`, 
          percent: 40 + Math.floor((groupIdx/totalGroups)*50) 
      });

      const items = grouped[handle];
      const urls = items.map(i => i.url);
      const urlString = urls.join('\n'); 
      const viewString = items.map(i => i.views || "N/A").join('\n');
      const reportId = generateReportId();

      let detectedPlatform = "TikTok"; 
      if (urls[0].includes('youtube')) detectedPlatform = "YouTube";
      
      // 2. UPLOAD SCREENSHOTS
      const evidenceLinks = []; 
      
      for (const item of items) {
          let imgLink = "No Screenshot Available";
          if (formData.uploadScreenshots && item.screenshotId) {
              const imgDataUrl = await getImage(item.screenshotId);
              if (imgDataUrl) {
                  const response = await fetch(imgDataUrl);
                  // Upload to the separate daily screenshots folder
                  const upload = await uploadToDrive(token, screenshotsFolderId, `${reportId}_Evidence_@${handle}.jpg`, await response.blob(), 'image/jpeg');
                  imgLink = upload.webViewLink; 
              }
          }
          evidenceLinks.push({ 
              url: item.url, 
              screenshotLink: imgLink, 
              views: item.views 
          });
      }

      // 3. GENERATE PDF
      const pdfData = { 
          eventName: formData.eventConfig?.eventName || formData.eventName || "Unknown Event", 
          vertical: formData.vertical, 
          reporterName: finalReporterName, 
          handle, 
          items: evidenceLinks,
          reportId: reportId 
      };
      
      const pdfBlob = await generatePDF(pdfData);
      
      // 4. UPLOAD PDF
      const pdfName = `Report_${reportId}_@${handle}.pdf`;
      const pdfUpload = await uploadToDrive(token, yearFolderId, pdfName, pdfBlob, 'application/pdf');

      // 5. LOG TO SHEET
      // viewString contains the verified numbers (e.g. "1200\n500") or "DELETED"
      await appendToSheet(token, { values: [todayFormatted, formData.vertical, pdfData.eventName, detectedPlatform, "VOD", viewString, finalReporterName, urlString, "DMCA takedown request", "Reported", `Report: ${pdfUpload.webViewLink}`, finalReporterName, "", "", "", "", "", "", "", reportId] });
      
      await new Promise(r => setTimeout(r, 1000));
    }

    // Cleanup
    await chrome.storage.local.remove('piracy_cart');
    await clearImages();
    return { success: true };
  } catch (e) {
    console.error("Batch Report Error:", e);
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
