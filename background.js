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
  getColumnHDataWithFormatting,
  updateRowStatus,
  formatCellAsTakenDown,
  updateCellWithRichText,
  setColumnKRichText,
  patchConfigSelector
} from './utils/google_api.js';
import { generatePDF } from './utils/pdf_gen.js';
import { saveImage, getImage, clearImages } from './utils/idb_storage.js';

// --- UTILITY: Convert Base64 Data URI to Blob --- //
function base64ToBlob(dataURI) {
  const splitDataURI = dataURI.split(',');
  const byteString = splitDataURI[0].indexOf('base64') >= 0 
      ? atob(splitDataURI[1]) 
      : decodeURI(splitDataURI[1]);
  const mimeString = splitDataURI[0].split(':')[1].split(';')[0];
  
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia], { type: mimeString });
}

// Ensure side panel behavior triggers on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// AUTO-OPEN SIDE PANEL ON LEGAL PAGES
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('tiktok.com/legal/report') || tab.url.includes('youtube.com/copyright_complaint_form')) {
      console.log("🛠️ Legal page detected. Opening Side Panel Wizard...");
      // windowId is strictly required for the side panel API to function consistently
      if (tab.windowId) {
          chrome.sidePanel.open({ windowId: tab.windowId }).catch(e => console.error(e));
      }
    }
  }
});

// --- ALARMS ---
const ALARM_NAME = "theCloser";
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const { closer_enabled } = await chrome.storage.local.get('closer_enabled');
    if (closer_enabled) runSheetScanner(1); // Default to row 1 on auto-run
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
// ROGUE STREAM SNIFFER & IP RESOLVER
// ==========================================
// Upgraded to a Map to store URL -> IP Address pairings
let sniffedNetworkTraffic = new Map();

// 1. Catch WebSockets (C2 Infrastructure)
chrome.webRequest.onBeforeRequest.addListener(
   (details) => {
       if (details.url.startsWith('wss://')) {
           sniffedNetworkTraffic.set(details.url, 'WebSocket/C2');
       }
   },
   { urls: ["<all_urls>"] }
);

// 2. Catch Video Pipes and resolve their Server IP
chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        if (details.url.includes('.m3u8') || details.url.includes('.mp4') || details.url.includes('.ts')) {
            // details.ip provides the actual resolved IP of the server delivering the payload
            sniffedNetworkTraffic.set(details.url, details.ip || 'IP Hidden/Cloudflare');
        }
    },
    { urls: ["<all_urls>"] }
);
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

function isUrlCrossedOut(startIndex, endIndex, formatRuns, cellStrikethrough) {
    if (cellStrikethrough) return true; // Base cell format covers it entirely
    if (!formatRuns || formatRuns.length === 0) return false;

    let runApply = null;
    for (let i = formatRuns.length - 1; i >= 0; i--) {
        if (formatRuns[i].startIndex <= startIndex) {
            runApply = formatRuns[i];
            break;
        }
    }
    return runApply?.format?.strikethrough || false;
}

async function runSheetScanner(startRowUI = 1) {
  stopScannerSignal = false;
  console.log(`🕵️ Sheet Scanner: Starting from Row ${startRowUI}...`);
  sendProgress(`Starting from Row ${startRowUI}`, "Fetching sheet data with formatting...");
  
  try {
    const rows = await getColumnHDataWithFormatting();
    let consecutiveBlanks = 0;
    
    // Map the 1-based UI start row to 0-based array index
    const startIdx = Math.max(0, startRowUI - 1);

    for (let i = startIdx; i < rows.length; i++) {
        if (stopScannerSignal) {
            console.log("🛑 Sheet Scanner: Stopped by user.");
            sendProgress("Scanner Stopped", "User interrupted the process.");
            break;
        }

        if (consecutiveBlanks >= 3) {
            console.log("🕵️ Sheet Scanner: Hit 3 blank cells. Stopping.");
            sendProgress("Scanner Complete", "Hit 3 consecutive blank cells.");
            break;
        }

        const cellData = rows[i]; 
        
        if (!cellData || !cellData.text) {
            consecutiveBlanks++;
            continue;
        }
        
        consecutiveBlanks = 0; 
        const cellValue = cellData.text;

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
        let previouslyDeadCount = 0;
        
        const deadRanges = []; 
        const activeRanges = [];

        for (let j = 0; j < matches.length; j++) {
            if (stopScannerSignal) break;

            const { url, index, end } = matches[j];

            // Smart Skip: Check if it's already struck through to save loading time
            const isCrossedOut = isUrlCrossedOut(index, end, cellData.formatRuns, cellData.cellStrikethrough);

            if (isCrossedOut) {
                previouslyDeadCount++;
                deadRanges.push({ start: index, end: end, url: url });
                console.log(`  - SKIPPED (Already crossed out): ${url}`);
                continue;
            }

            sendProgress(`Row ${i+1}`, `Link ${j+1}/${matches.length}: Checking availability...`);
            
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
                    console.log(`  - NEWLY DOWN: ${url}`);
                    deadRanges.push({ start: index, end: end, url: url });
                } else {
                    activeCount++;
                    console.log(`  - ACTIVE: ${url}`);
                    activeRanges.push({ start: index, end: end, url: url });
                }
            } catch (err) {
                console.warn(`  - Error checking ${url}:`, err);
                activeCount++; 
                activeRanges.push({ start: index, end: end, url: url });
            }
            
            await new Promise(r => setTimeout(r, 1500)); 
        }

        if (stopScannerSignal) {
             sendProgress("Scanner Stopped", "Operation cancelled.");
             break;
        }

        // Apply updated formatting ONLY if we found NEW dead links
        if (deadCount > 0) {
            sendProgress(`Row ${i+1}`, `Updating formatting...`);
            const defaultStyle = { link: null, strikethrough: false, foregroundColor: { red: 0, green: 0, blue: 0 }, underline: false };
            const deadStyle = { link: null, strikethrough: true, foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 }, underline: false };
            
            const allLinkRanges = [
                ...deadRanges.map(r => ({ ...r, style: deadStyle })),
                ...activeRanges.map(r => ({ ...r, style: { link: { uri: r.url }, foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 }, underline: true, strikethrough: false } }))
            ].sort((a, b) => a.start - b.start);

            const newRuns = [];
            let cursor = 0;
            
            if (allLinkRanges.length > 0 && allLinkRanges[0].start > 0) {
                 newRuns.push({ startIndex: 0, format: defaultStyle });
            }
            
            for (const range of allLinkRanges) {
                if (range.start > cursor) {
                    newRuns.push({ startIndex: cursor, format: defaultStyle });
                }
                newRuns.push({ startIndex: range.start, format: range.style });
                cursor = range.end;
            }
            
            if (cursor < cellValue.length) {
                newRuns.push({ startIndex: cursor, format: defaultStyle });
            }

            await updateCellWithRichText(i, cellValue, newRuns);
        }

        const totalDead = deadCount + previouslyDeadCount;
        if (totalDead > 0 && activeCount === 0) {
            console.log(`Row ${i+1}: Resolved (All ${totalDead} links down).`);
            sendProgress(`Row ${i+1}: Resolved`, "Updating Sheet...");
            await updateRowStatus(i, "Resolved");
        } else if (activeCount > 0 && totalDead > 0) {
             console.log(`Row ${i+1}: Investigating (${activeCount} active, ${totalDead} down).`);
             sendProgress(`Row ${i+1}: Investigating`, `${totalDead} dead links struck.`);
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
                    if (text.includes("account has been terminated")) return true;
                    if (text.includes("video is no longer available due to a copyright claim by FloSports")) return true;
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
                
                // NEW PLATFORMS ADDED HERE
                if (plat === 'rumble') {
                    if (text.includes("this video is unavailable") || text.includes("page not found")) return true;
                }
                
                if (plat === 'discord') {
                    if (text.includes("invalid message") || text.includes("message deleted")) return true;
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

  // Legacy Check, keep for fallback
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

  // --- NEW: DOUBLE TAP SHEET SCANNER ---
  if (request.action === 'scanSheetForActiveLinks') {
      handleScanSheetForActiveLinks(request.platform, request.vertical, request.startRow).then(sendResponse);
      return true;
  }

  // --- NEW: CAPTURE FIRST, VERIFY SECOND WORKFLOW ---
  if (request.action === 'processNewItem') {

      handleProcessNewItem(sender.tab, request.data).then(sendResponse);
      return true; // Keep channel open for async
  }

  if (request.action === 'logToSheet') {
      handleBatchReport(request.data).then(res => {
          sendResponse(res);
      });
      return true; 
  }

  if (request.action === 'processQueue') {
      handleBatchReport(request.data).then(res => {
          if (res.success) {
              chrome.runtime.sendMessage({ action: "progressComplete" });
          } else {
              chrome.runtime.sendMessage({ action: "progressError", error: res.error });
          }
      });
      return false; 
  }

  if (request.action === 'getConfig') {
    fetchConfig().then(config => sendResponse({ success: true, config }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // --- PATCH SELECTOR LISTENER ---
  if (request.action === 'patchSelectorConfig') {
      // Added request.section so we can target 'autofill' (forms) or 'scraper' (views/handles)
      patchConfigSelector(request.platform, request.section, request.field, request.selector, request.actionType)
          .then(config => sendResponse({ success: true, config }))
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

  if (request.action === 'undoCart') {
    chrome.storage.local.get('piracy_cart').then(res => {
      let cart = res.piracy_cart || [];
      if (cart.length > 0) cart.pop(); // Removes the most recently added item
      chrome.storage.local.set({ 'piracy_cart': cart }).then(() => sendResponse({success: true}));
    });
    return true;
  }

  if (request.action === "saveEventUrl") {
    handleUrlSave(request.data);
    return false; 
  }

  if (request.action === 'openPopup') {
    if (sender.tab && sender.tab.windowId) {
        chrome.sidePanel.open({ windowId: sender.tab.windowId })
            .catch(e => console.warn("Failed to open Side Panel:", e));
    }
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
  if (request.action === 'initRogueTakedown') {
     // Transform Map into an array of objects for easier handling in the UI
     const trafficArray = Array.from(sniffedNetworkTraffic.entries()).map(([url, ip]) => ({ url, ip }));
     const rogueData = { ...request.data, networkTraffic: trafficArray };
     
     chrome.storage.local.set({ rogue_target_data: rogueData }, () => {
         sniffedNetworkTraffic.clear(); // Reset map after capture
     });
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

// Legacy Fallback for direct adding
async function handleAddVideo(tab, data) {
  try {
    let screenshotUrl = null;
    
    try {
        const screenshotPromise = chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Screenshot timed out")), 5000));
        
        screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    } catch (imgErr) {
        console.warn("Screenshot capture skipped/failed:", imgErr);
    }

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

// NEW: Capture First, Verify Second Workflow
async function handleProcessNewItem(tab, data) {
  try {
    // 1. CAPTURE IMMEDIATELY (Before network delays)
    let screenshotUrl = null;
    try {
        const screenshotPromise = chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Screenshot timed out")), 5000));
        screenshotUrl = await Promise.race([screenshotPromise, timeoutPromise]);
    } catch (imgErr) {
        console.warn("Screenshot capture skipped/failed:", imgErr);
    }

    // 2. VERIFY SECOND (Check whitelist while image is safely in memory)
    try {
        const isAuthorized = await checkIfAuthorized(data.platform, data.handle);
        if (isAuthorized) {
            // If whitelisted, discard the screenshot in memory and stop
            return { success: false, status: 'whitelisted' };
        }
    } catch (err) {
        console.warn("Whitelist check failed, proceeding to save anyway:", err);
    }

    // 3. SAVE DATA
    const screenshotId = crypto.randomUUID();
    if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
    }

    const newItem = { ...data, screenshotId: screenshotUrl ? screenshotId : null, timestamp: new Date().toISOString() };
    const storage = await chrome.storage.local.get('piracy_cart');
    let cart = storage.piracy_cart || [];

    if (!cart.some(item => item.url === data.url)) {
      cart.push(newItem);
      await chrome.storage.local.set({ 'piracy_cart': cart });
    }
    return { success: true, status: 'added', count: cart.length };

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
      const totalViewsCount = items.reduce((acc, item) => {
        let val = 0;
        const v = String(item.views || "0").toLowerCase();
        if (v === "pending" || v === "n/a" || v === "deleted" || v === "error") val = 0;
        else if (v.includes('k')) val = parseFloat(v) * 1000;
        else if (v.includes('m')) val = parseFloat(v) * 1000000;
        else val = parseFloat(v.replace(/[^\d.]/g, '')) || 0;
        return acc + val;
      }, 0);
      const viewString = totalViewsCount > 0 ? totalViewsCount.toLocaleString() : "N/A";
      const reportId = generateReportId();

      let detectedPlatform = "TikTok";
      let channelUrl = `https://www.tiktok.com/@${handle}`;

      if (urls[0].includes('youtube') || urls[0].includes('youtu.be')) {
          detectedPlatform = "YouTube";
          channelUrl = `https://www.youtube.com/@${handle}`;
      } else if (urls[0].includes('instagram')) {
          detectedPlatform = "Instagram";
          channelUrl = `https://www.instagram.com/${handle}`;
      } else if (urls[0].includes('twitter') || urls[0].includes('x.com')) {
          detectedPlatform = "Twitter";
          channelUrl = `https://x.com/${handle}`;
      } else if (urls[0].includes('facebook')) {
          detectedPlatform = "Facebook";
          channelUrl = `https://www.facebook.com/${handle}`;
      } else if (urls[0].includes('twitch')) {
          detectedPlatform = "Twitch";
          channelUrl = `https://www.twitch.tv/${handle}`;
      }
      
      // 2. UPLOAD SCREENSHOTS
      const evidenceLinks = []; 
      
      for (const item of items) {
          let imgLink = "No Screenshot Available";
          
          // FIX: Default to true if undefined (handles requests from the in-page wizard)
          const shouldUploadScreenshots = formData.uploadScreenshots !== false;
          
          if (shouldUploadScreenshots && item.screenshotId) {
              try {
                  const imgDataUrl = await getImage(item.screenshotId);
                  if (imgDataUrl) {
                      // Use manual conversion instead of fetch() to avoid MV3 data URI restrictions
                      const imageBlob = base64ToBlob(imgDataUrl);
                      const upload = await uploadToDrive(
                          token, 
                          screenshotsFolderId, 
                          `${reportId}_Evidence_@${handle}.jpg`, 
                          imageBlob, 
                          'image/jpeg'
                      );
                      imgLink = upload.webViewLink; 
                  }
              } catch (imgUploadErr) {
                  console.error(`Failed to upload screenshot for ${item.url}:`, imgUploadErr);
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
      const appendResponse = await appendToSheet(token, { values: [todayFormatted, formData.vertical, pdfData.eventName, detectedPlatform, "VOD", viewString, finalReporterName, urlString, "DMCA takedown request", "Reported", "Generating Links...", finalReporterName, "", "", "", "", "", "", "", reportId] });
      
      // 6. APPLY RICH TEXT LINKS TO COLUMN K
      const updatedRange = appendResponse?.updates?.updatedRange;
      if (updatedRange) {
          // Extract the exact row number we just inserted
          const rangePart = updatedRange.split('!')[1] || updatedRange;
          const match = rangePart.match(/\d+/);
          if (match) {
              const rowIndex = parseInt(match[0], 10) - 1; // 0-based for API
              const safePdfUrl = pdfUpload.webViewLink || "https://drive.google.com";
              await setColumnKRichText(rowIndex, channelUrl, handle, safePdfUrl);
          }
      }
      
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

// ==========================================
// 6. BULK SCANNING LOGIC (DOUBLE TAP)
// ==========================================
async function handleScanSheetForActiveLinks(platform, vertical, startRowUI = 1) {
    stopScannerSignal = false; // Reset signal
    try {
        const rows = await getColumnHDataWithFormatting();
        if (!rows || rows.length === 0) return { success: false, error: "Failed to fetch sheet data" };

        let activeLinks = [];
        const startIdx = Math.max(0, startRowUI - 1);
        
        for (let i = startIdx; i < rows.length; i++) {
            if (stopScannerSignal) break;
            if (activeLinks.length >= 100) break; // Limit batch size to 100 to prevent browser crashes
            
            const cellData = rows[i];
            if (!cellData || !cellData.text) continue;

            // Extract all valid URLs from Column H
            const urlRegex = /https?:\/\/[^\s,]+/g;
            let match;
            const matches = [];
            while ((match = urlRegex.exec(cellData.text)) !== null) {
                matches.push({ url: match[0], index: match.index, end: match.index + match[0].length });
            }
            
            for (let j = 0; j < matches.length; j++) {
                if (activeLinks.length >= 100) break;
                const { url, index, end } = matches[j];

                // 1. Filter out internal FloSports/Varsity links
                if (url.includes('varsity.com') || url.includes('flosports') || url.includes('floracing') || url.includes('milesplit')) continue;

                // 2. Ensure URL matches the selected platform
                const pTarget = platform.toLowerCase();
                let isPlatformMatch = false;
                if (pTarget === 'twitter' || pTarget === 'x') {
                    isPlatformMatch = url.includes('twitter.com') || url.includes('x.com');
                } else if (pTarget === 'other') {
                    isPlatformMatch = !url.includes('tiktok') && !url.includes('youtube') && !url.includes('instagram') && !url.includes('facebook') && !url.includes('rumble') && !url.includes('discord') && !url.includes('twitter') && !url.includes('x.com');
                } else {
                    isPlatformMatch = url.includes(pTarget);
                }
                if (!isPlatformMatch) continue;

                // 3. Skip if already crossed out in the sheet
                if (isUrlCrossedOut(index, end, cellData.formatRuns, cellData.cellStrikethrough)) continue;

                if (stopScannerSignal) break;

                chrome.runtime.sendMessage({ 
                    action: 'scanProgress', 
                    message: `Scanning Row ${i+1} | Link ${j+1} of ${matches.length}`

                }).catch(() => {});

                // Verify if active (Headless Tab check)
                const isDown = await verifyTakedownViaTab(url, platform);
                if (!isDown) {
                    // Attempt to extract handle safely
                    let handle = "Unknown";
                    if (url.includes('@')) handle = url.split('@')[1]?.split(/[/?]/)[0] || "Unknown";
                    else {
                        try { handle = new URL(url).pathname.split('/')[1] || "Unknown"; } catch(e){}
                    }

                    activeLinks.push({
                        url: url,
                        platform: platform,
                        handle: handle,
                        views: "N/A", // Skip heavy view scraping on bulk runs
                        timestamp: new Date().toISOString()
                    });
                }
                await new Promise(r => setTimeout(r, 1000)); // Rate limit tab creation 
            }
        }
        
        if (activeLinks.length > 0) {
            const storage = await chrome.storage.local.get('piracy_cart');
            let cart = storage.piracy_cart || [];
            cart = [...cart, ...activeLinks];
            
            // Deduplicate by URL
            const uniqueCart = Array.from(new Map(cart.map(item => [item.url, item])).values());
            await chrome.storage.local.set({ 'piracy_cart': uniqueCart });
        }

        return { success: true, count: activeLinks.length };
    } catch (e) {
        console.error("Scan Sheet Error:", e);
        return { success: false, error: e.message };
    }
}