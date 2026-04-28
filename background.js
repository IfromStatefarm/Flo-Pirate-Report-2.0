// background.js
import { getAuthToken, getUserEmail } from './utils/auth.js';
import { 
  uploadToDrive, 
  appendToSheet, 
  ensureYearlyReportFolder,
  ensureDailyScreenshotFolder,
  ensureRogueScreenshotFolder,
  logRogueToSheet, 
  fetchConfig, 
  getEventData,       
  updateEventUrl,     
  addNewEventToSheet,
  checkIfAuthorized,
  getColumnHDataWithFormatting,
  updateRowStatus,
  updateCellWithRichText,
  setColumnKRichText,
  patchConfigSelector,
  fetchLeaderboardData,
  addEnforcerBonusPoints,
  submitSuggestionToSheet,
  getRecommendedStartRow,
  fetchIntelligenceData
} from './utils/google_api.js';
import { generatePDF, generateIntelligencePDF } from './utils/pdf_gen.js';
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

// EVENT-DRIVEN URL SYNC: Ping Side Panel when active URL changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const url = tab.url ? tab.url.toLowerCase() : '';
    if (url.includes('flosports') || url.includes('varsity') || url.includes('milesplit')) {
        chrome.runtime.sendMessage({ action: 'activeUrlChanged', url: tab.url }).catch(() => {});
    }
});
// Also listen for URL changes within the same tab (e.g., SPA navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
        const url = changeInfo.url.toLowerCase();
        if (url.includes('flosports') || url.includes('varsity') || url.includes('milesplit')) {
            chrome.runtime.sendMessage({ action: 'activeUrlChanged', url: changeInfo.url }).catch(() => {});
        }
    }
});

// ==========================================
// AUTO-OPEN SIDE PANEL ON LEGAL PAGES
/*chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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
*/

// ==========================================
// --- ALARMS ---
const ALARM_NAME = "theCloser";
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  chrome.storage.local.set({ onboarding_step: 'NEEDS_CONFIG' });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const { closer_enabled } = await chrome.storage.local.get('closer_enabled');
    if (closer_enabled) runSheetScanner(1); // Default to row 1 on auto-run
  }
});
// --- Onboarding State Monitor & Messenger ---
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && (changes.piracy_folder_id || changes.piracy_sheet_id || changes.event_sheet_id)) {
    chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'], (items) => {
      if (items.piracy_folder_id && items.piracy_sheet_id && items.event_sheet_id) {
        chrome.storage.local.get(['onboarding_step'], (res) => {
          if (res.onboarding_step === 'NEEDS_CONFIG') {
            chrome.storage.local.set({ onboarding_step: 'READY_FOR_FIRST_REPORT' }, () => {
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: 'clippyStateChange', state: 'READY_FOR_FIRST_REPORT' }).catch(() => {}));
              });
            });
          }
        });
      }
    });
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
let isScannerRunning = false;

// ==========================================
// ROGUE STREAM SNIFFER & IP RESOLVER
// ==========================================
// Upgraded to a Map to store URL -> IP Address pairings
let sniffedNetworkTraffic = new Map();

// 1. Catch WebSockets (C2 Infrastructure)
chrome.webRequest.onBeforeRequest.addListener(
   (details) => {
       const url = details.url.toLowerCase();
       if (url.includes('flosports') || url.includes('varsity') || url.includes('milesplit')) return;
       
       if (details.url.startsWith('wss://')) {
           sniffedNetworkTraffic.set(details.url, 'WebSocket/C2');
       }
   },
   { urls: ["<all_urls>"] }
);

// 2. Catch Video Pipes and resolve their Server IP
chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const url = details.url.toLowerCase();
        // Global Exclusion List: Ignore internal CDN segments
        if (url.includes('flosports') || url.includes('varsity') || url.includes('milesplit') || url.includes('lom.flosports.net')) return;

        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts')) {
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

        tabId = tab.id;

        // Wait for tab to load completely
        await new Promise(resolve => {
            const safetyTimeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 8000); // 8-second safety timeout prevents infinite hangs

            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    clearTimeout(safetyTimeout);
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

let heartbeatPort = null;

// Helper to send progress to sidepanel
function sendProgress(status, details) {
    // Keep SW alive by resetting the 30s idle timer via an active port
    if (!heartbeatPort) {
        heartbeatPort = chrome.runtime.connect({ name: 'sw-heartbeat' });
        heartbeatPort.onDisconnect.addListener(() => { heartbeatPort = null; });
    }
    try { heartbeatPort.postMessage({ ping: true }); } catch (e) { heartbeatPort = null; }

    chrome.runtime.sendMessage({ 
        action: 'closerProgress', 
        status: status,
        details: details 
    }).catch(() => {}); // Ignore error if panel closed
}

// --- UPDATED UTILITY: Improved Strikethrough Detection ---
function isUrlCrossedOut(startIndex, endIndex, formatRuns, cellStrikethrough) {
    // RULE 1: If the entire cell has strikethrough applied at the base level, all content is "dead"
    if (cellStrikethrough) return true;
    
    if (!formatRuns || formatRuns.length === 0) return false;

    // RULE 2: Find the specific formatting run that covers this URL's start index
    let appliedFormat = null;
    for (let i = 0; i < formatRuns.length; i++) {
        const run = formatRuns[i];
        if (run.startIndex <= startIndex) {
            appliedFormat = run.format;
        } else {
            break; 
        }
    }
    return appliedFormat?.strikethrough === true;
}

async function runSheetScanner(startRowUI = 1, maxConcurrentTabs = 4) {
  if (isScannerRunning) return; // Concurrency Lock
  isScannerRunning = true;
  stopScannerSignal = false;
  console.log(`🕵️ Sheet Scanner: Starting from Row ${startRowUI} checking sequentially...`);
  sendProgress(`Starting from Row ${startRowUI}`, "Fetching sheet data with formatting...");
  
  try {
    const rows = await getColumnHDataWithFormatting();
    let consecutiveBlanks = 0;
    
    const startIdx = Math.max(0, startRowUI - 1);

    // Prevent out-of-bounds errors before the loop starts
    if (startIdx >= rows.length) {
        sendProgress("Scanner Stopped", `Row ${startRowUI} is out of bounds. The sheet only has ${rows.length} rows.`);
        return;
    }

    // OUTER LOOP: Process one row (cell) at a time sequentially
    for (let i = startIdx; i < rows.length; i++) {
        if (stopScannerSignal) {
            sendProgress("Scanner Stopped", "User interrupted the process.");
            break;
        }

        const cellData = rows[i]; 
        
        if (!cellData || !cellData.text) {
            consecutiveBlanks++;
            if (consecutiveBlanks >= 3) {
                sendProgress("Scanner Complete", "Hit 3 consecutive blank cells.");
                break;
            }
            continue;
        }
        
        consecutiveBlanks = 0; 
        const rowIndex = i;
        const cellValue = cellData.text;

        // Fix: Explicitly escaping forward slashes in regex to avoid SyntaxError in some environments
        const urlRegex = /https?:\/\/[^\s,]+/g;
        let match;
        const matches = [];
        while ((match = urlRegex.exec(cellValue)) !== null) {
            matches.push({ url: match[0], index: match.index, end: match.index + match[0].length });
        }
        
        if (matches.length === 0) continue;

        sendProgress(`Scanning Row ${rowIndex+1}`, `Checking ${matches.length} link(s)...`);

        let newlyStruck = 0;
        let totalActive = 0;
        let previouslyDeadCount = 0;
        
        const deadRanges = []; 
        const activeRanges = [];

        // INNER LOOP: Process URLs sequentially within the cell
        for (let j = 0; j < matches.length; j++) {
            if (stopScannerSignal) break;
            const { url, index, end } = matches[j];

            // 1. Filter out internal links and exempt websites
            const EXEMPT_WEBSITES = ['varsity.com', 'flosports.tv', 'floracing.tv', 'milesplit.com', 'houston.flosports.net', 'google.com', 'amazon.com', 'flocasts.atlassian.net','gemini.google.com/', 'chatgpt.com', 'fso-heatmap.vercel.app', 'gmail.com', 'app.slack.com/', '10.43.29.8:3000', 'flosports.okta.com', 'hockeytech.zen.zixi.com/', 'workforcenow.adp.com', 'flosports.kazoohr.com/', 'flosports', 'app.hibob.com', 'dashboard.airbase.io', 'app.ashbyhq.com','flosports.ziphq.com', 'sites.google.com', 'flosports.latticehq.com','keep.google.com', 'drive.google.com'];
            if (EXEMPT_WEBSITES.some(site => url.includes(site))) continue;

            const isCrossedOut = isUrlCrossedOut(index, end, cellData.formatRuns, cellData.cellStrikethrough);

            if (isCrossedOut) {
                previouslyDeadCount++;
                deadRanges.push({ start: index, end: end, url: url });
                continue;
            }

            sendProgress(`Row ${rowIndex+1}`, `Link ${j+1}/${matches.length}: Checking availability...`);
            
            let platform = 'unknown';
            if (url.includes('tiktok')) platform = 'tiktok';
            else if (url.includes('youtube') || url.includes('youtu.be')) platform = 'youtube';
            else if (url.includes('twitter') || url.includes('x.com')) platform = 'twitter';
            else if (url.includes('instagram')) platform = 'instagram';
            else if (url.includes('facebook')) platform = 'facebook';
            else if (url.includes('twitch')) platform = 'twitch';

            let isDown = false;
            try {
                isDown = await verifyTakedownViaTab(url, platform); 
            } catch (err) {
                console.error("Link check failed:", err);
            }

            if (isDown) {
                newlyStruck++;
                deadRanges.push({ start: index, end: end, url: url });
                
                // --- APPLY RICH TEXT UPDATES IMMEDIATELY ---
                sendProgress(`Row ${rowIndex+1}`, `Link ${j+1}/${matches.length} is DEAD. Crossing out...`);
                
                const defaultStyle = { strikethrough: false, foregroundColor: { red: 0, green: 0, blue: 0 }, underline: false };
                const deadStyle = { strikethrough: true, foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 }, underline: false };
                const activeLinkStyle = { foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 }, underline: true, strikethrough: false };

                // Map all matches so we don't accidentally remove formatting from pending or active links
                const currentLinkRanges = matches.map(m => {
                    const isDead = deadRanges.some(dr => dr.url === m.url && dr.start === m.index);
                    
                    if (isDead) return { start: m.index, end: m.end, style: deadStyle };
                    
                    // Active or Pending -> keep as clickable link
                    return { start: m.index, end: m.end, style: { ...activeLinkStyle, link: { uri: m.url } } };
                }).sort((a, b) => a.start - b.start);

                const newRuns = [];
                let cursor = 0;
                
                for (const range of currentLinkRanges) {
                    if (range.start > cursor) {
                        newRuns.push({ startIndex: cursor, format: defaultStyle });
                    }
                    newRuns.push({ startIndex: range.start, format: range.style });
                    cursor = range.end;
                }
                
                if (cursor < cellValue.length) {
                    newRuns.push({ startIndex: cursor, format: defaultStyle });
                }

                await updateCellWithRichText(rowIndex, cellValue, newRuns);
            } else {
                totalActive++;
                activeRanges.push({ start: index, end: end, url: url });
            }
            
            await new Promise(r => setTimeout(r, 2000)); // Delay between checking each link
        } // End of inner loop

        if (stopScannerSignal) break;

        const totalDead = newlyStruck + previouslyDeadCount;
        if (totalDead > 0 && totalActive === 0) {
            await updateRowStatus(rowIndex, "Resolved");
            if (newlyStruck > 0) {
                await addEnforcerBonusPoints(rowIndex, newlyStruck * 15);
            }
        } else if (totalActive > 0 && totalDead > 0) {
             await updateRowStatus(rowIndex, "Investigating");
        }
    } // End of outer loop
    
    if (!stopScannerSignal) {
        sendProgress("Scanner Complete", "Finished processing rows.");
    }

  } catch (e) {
    console.error("Sheet Scanner Failed:", e);
    sendProgress("Scanner Failed", e.message);
  } finally {
    isScannerRunning = false; // Release Lock
  }
}

// Uses Tab Loading to check if video exists
async function verifyTakedownViaTab(url, platform) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url: url, active: false });
        tabId = tab.id;

        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve("timeout");
            }, 20000); // Bumped to 20s
            
            const listener = (tid, info, tabData) => {
                if (tid === tabId && info.status === 'complete') {
                    if (tabData.url && (tabData.url === 'about:blank' || tabData.url.startsWith('chrome://'))) return;
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve("complete");
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        await new Promise(r => setTimeout(r, 2000)); // Base buffer

        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: async (plat) => {
                return new Promise((resolve) => {
                    let attempts = 0;
                    
                    const checkStatus = () => {
                        const text = document.body.innerText.toLowerCase();
                        const title = document.title.toLowerCase();
                        
                        if (title.includes("404") || title.includes("not found") || title.includes("page not found")) return resolve(true);

                        if (plat === 'tiktok') {
                            if (text.includes("video currently unavailable")) return resolve(true);
                            if (text.includes("video not found")) return resolve(true);
                            if (text.includes("couldn't find this account")) return resolve(true);
                            if (text.includes("page not available")) return resolve(true);
                            if (document.querySelector('[data-e2e="video-removed"]')) return resolve(true);
                            
                            // Positive indicator: video is active
                            if (document.querySelector('[data-e2e="video-views"]') || document.querySelector('video')) return resolve(false);
                        }
                        
                        if (plat === 'youtube') {
                            if (text.includes("video unavailable")) return resolve(true);
                            if (text.includes("video has been removed")) return resolve(true);
                            if (text.includes("video is private")) return resolve(true);
                            if (text.includes("this video is no longer available")) return resolve(true);
                            if (text.includes("account has been terminated")) return resolve(true);
                            if (text.includes("video is no longer available due to a copyright claim by flosports")) return resolve(true);
                            if (window.location.href === "https://www.youtube.com/") return resolve(true); 
                            
                            // Consent / Captcha blocker (Treat as active so user can investigate)
                            if (text.includes("before you continue to youtube")) return resolve(false);

                            // Strong positive indicators for YouTube
                            if (document.querySelector('#movie_player') || document.querySelector('ytd-video-primary-info-renderer')) return resolve(false);
                        }
                        
                        if (plat === 'twitter') {
                            if (text.includes("this page doesn’t exist")) return resolve(true);
                            if (text.includes("tweet has been deleted")) return resolve(true);
                            if (text.includes("account suspended")) return resolve(true);
                        }
                        
                        if (plat === 'instagram' || plat === 'facebook') {
                            if (text.includes("sorry, this page isn't available")) return resolve(true);
                            if (text.includes("link you followed may be broken")) return resolve(true);
                            if (text.includes("content isn't available")) return resolve(true);
                        }
                        
                        if (plat === 'rumble') {
                            if (text.includes("this video is unavailable") || text.includes("page not found")) return resolve(true);
                        }
                        
                        if (plat === 'discord') {
                            if (text.includes("invalid message") || text.includes("message deleted")) return resolve(true);
                        }

                        attempts++;
                        if (attempts >= 30) return resolve(false); // Max ~15 seconds of active polling
                        setTimeout(checkStatus, 500);
                    };
                    
                    checkStatus();
                });
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
          //files: ['search_bot.js'] // We will inject the bot code directly here to ensure it runs before any potential blockers on the page
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
  if (request.action === 'getRecommendedStartRow') {
    getRecommendedStartRow().then(row => sendResponse({ success: true, row }))
      .catch(error => sendResponse({ success: false, error: error.message, row: 2 }));
    return true;
  }

  // --- GAMIFICATION LISTENER ---
  if (request.action === 'getGamificationStats') {
      getUserEmail().then(email => {
          if (!email) return sendResponse(null);
          fetchLeaderboardData(email).then(sendResponse).catch(e => {
          console.error("Leaderboard fetch error:", e);
          // FIX: Return a safe fallback state instead of `null` so the UI 
          // gracefully shows an offline message instead of hanging indefinitely.
          sendResponse({
              error: true,
              scoutPoints: "-",
              enforcerPoints: "-",
              scoutRank: "Offline",
              enforcerRank: "Offline",
              teamTotal: "-",
              topScouts: [{ name: "Network Disconnected", points: 0 }],
              topEnforcers: [{ name: "Retrying...", points: 0 }]
          });
      });
  }).catch(e => {
      // Catch potential network drops during the Auth Token fetch as well
      sendResponse(null);
  });
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
  if (request.action === 'submitSuggestion') {
      getAuthToken().then(async token => {
          try {
              const userEmail = await getUserEmail() || "Unknown User";
              await submitSuggestionToSheet(token, request.text, userEmail);
              sendResponse({ success: true });
          } catch (err) {
              sendResponse({ success: false, error: err.message });
          }
      }).catch(err => sendResponse({ success: false, error: err.message }));
      return true;
  }
  if (request.action === 'generateIntelligenceReport') {
    (async () => {
        try {
            const token = await getAuthToken();
            
            // 1. Fetch data
            const stats = await fetchIntelligenceData(request.startDate, request.endDate);
            if (!stats) throw new Error("No data available for this timeframe.");
            
            // 2. Generate PDF
            const pdfBlob = await generateIntelligencePDF(stats);

            // 3. Ensure "Tactical Briefings" folder exists under root
            const storage = await chrome.storage.sync.get('piracy_folder_id');
            const driveRootId = storage.piracy_folder_id;
            if (!driveRootId) throw new Error("Drive Root ID not configured.");

            // Find or create "Tactical Briefings" folder
            const query = `mimeType='application/vnd.google-apps.folder' and '${driveRootId}' in parents and name='Tactical Briefings' and trashed=false`;
            const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const searchData = await searchRes.json();
            
            let folderId;
            if (searchData.files && searchData.files.length > 0) {
                folderId = searchData.files[0].id;
            } else {
                const createRes = await fetch('[https://www.googleapis.com/drive/v3/files](https://www.googleapis.com/drive/v3/files)', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Tactical Briefings', mimeType: 'application/vnd.google-apps.folder', parents: [driveRootId] })
                });
                const createData = await createRes.json();
                folderId = createData.id;
            }

            // 4. Upload PDF
            const filename = `Intelligence_Briefing_${request.startDate}_to_${request.endDate}.pdf`;
            const uploadRes = await uploadToDrive(token, folderId, filename, pdfBlob, 'application/pdf');

            // 5. Return webViewLink and open instantly
            chrome.tabs.create({ url: uploadRes.webViewLink });
            sendResponse({ success: true, url: uploadRes.webViewLink });
        } catch (err) {
            console.error("Intelligence Report Error:", err);
            sendResponse({ success: false, error: err.message });
        }
    })();
    return true;
  }
  // ---  MACRO REAL-TIME STREAMING ---
  if (request.action === 'startMacroSession') {
    // Just initialize the storage, don't set a timer here
    chrome.storage.session.set({ activeMacroPlatform: request.platform, macroEvents: [] });
    return false;
}

if (request.action === 'compileMacro') {
    chrome.storage.session.get(['macroEvents', 'activeMacroPlatform']).then(async (data) => {
        const { macroEvents, activeMacroPlatform } = data;
        
        // If nothing was recorded, notify the user via the side panel
        if (!macroEvents || macroEvents.length === 0) {
            chrome.runtime.sendMessage({ 
                action: 'macroTrainingFailed', 
                reason: 'No actions were recorded. Please click elements on the page while recording.' 
            }).catch(() => {});
            return;
        }
        
        const processedMacro = macroEvents.map((ev, i) => ({
            action: ev.action, 
            selector: ev.selector, 
            value: ev.value, 
            delay: i === 0 ? 0 : ev.timestamp - macroEvents[i-1].timestamp
        }));
        
        // 1. Notify the Side Panel that we are finished (Stops the flashing/badge)
        chrome.runtime.sendMessage({ 
            action: 'macroTrainingComplete', 
            platform: activeMacroPlatform, 
            macro: processedMacro 
        }).catch(() => {});

        // 2. Trigger the "Save Confirmation" Modal on the actual Video Page
        // We use 'showMacroConfirmation' specifically to trigger the showPatchUI with the full macro string
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'showMacroConfirmation',
                platform: activeMacroPlatform,
                macro: processedMacro
            }).catch(err => {
                console.error("Failed to show confirmation UI on page:", err);
                // Fallback: Notify sidepanel to show an error if the content script is unreachable
                chrome.runtime.sendMessage({ action: 'macroTrainingFailed', reason: 'Could not reach the video page. Please refresh the video tab.' });
            });
        }
        
        // Clear session storage to prep for the next recording
        chrome.storage.session.remove(['macroEvents', 'activeMacroPlatform']);
    });
    return false;
}

  if (request.action === 'recordMacroStep') {
      // Append streaming step to session storage memory
      chrome.storage.session.get('macroEvents').then((data) => {
          const events = data.macroEvents || [];
          events.push(request.step);
          chrome.storage.session.set({ macroEvents: events });
      });
      return false;
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
     
     (async () => {
         let screenshotUrl = null;
         try {
             screenshotUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
         } catch (e) { console.warn("Screenshot failed:", e); }

         const rogueData = { ...request.data, networkTraffic: trafficArray, screenshot: screenshotUrl };
         
         chrome.storage.local.set({ rogue_target_data: rogueData }, () => {
             sniffedNetworkTraffic.clear(); // Reset map after capture
             sendResponse({ success: true });
         });
     })();
     return true;
 }

  if (request.action === 'logRogueToSheet') {
      getAuthToken().then(async token => {
          try {
              let finalNotes = request.notes || "";
              
              if (request.data.screenshot) {
                  const imageBlob = base64ToBlob(request.data.screenshot);
                  const folderId = await ensureRogueScreenshotFolder(token);
                  
                  const urlObj = new URL(request.data.url);
                  const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
                  const dateStr = new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '.');
                  
                  // Clean the URL to prevent invalid filename characters
                  const safeLink = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '.').replace(/^\.+|\.+$/g, '').substring(0, 40) || 'stream';
                  const filename = `${domain}.${safeLink}.${dateStr}.jpg`;
                  
                  const uploadRes = await uploadToDrive(token, folderId, filename, imageBlob, 'image/jpeg');
                  finalNotes += `\n\nEvidence Screenshot: ${uploadRes.webViewLink}`;
              }
              
              await logRogueToSheet(token, request.data, finalNotes);
              sendResponse({ success: true });
              } catch (err) {
              sendResponse({ success: false, error: err.message });
          }
      }).catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
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

    const scoutedByEmail = await getUserEmail() || "Unknown";
    const newItem = { ...data, screenshotId: screenshotUrl ? screenshotId : null, timestamp: new Date().toISOString(), scoutedBy: scoutedByEmail };
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
                const userEmail = await getUserEmail() || "Unknown";
                await appendToSheet(await getAuthToken(), { values: [new Date().toLocaleDateString("en-US"), data.vertical || "Unknown", "Penalty", data.platform, "N/A", "0", userEmail, data.url, "Whitelist Penalty", "Failed", "", userEmail, userEmail, -15, 0, "", "", "", "", "PENALTY"] });
                // If whitelisted, discard the screenshot in memory and stop
                return { 
                    success: false, 
                    status: 'whitelisted',
                    milestoneHit: true,
                    milestoneMessage: `⚠️ BLOCKED: @${data.handle} is whitelisted! Penalty: -15 Points.`
                };
            }
        } catch (err) {
        console.warn("Whitelist check failed, proceeding to save anyway:", err);
    }

    // 3. SAVE DATA
    const screenshotId = crypto.randomUUID();
    if (screenshotUrl) {
        await saveImage(screenshotId, screenshotUrl);
    }

    const scoutedByEmail = await getUserEmail() || "Unknown";
    const newItem = { ...data, screenshotId: screenshotUrl ? screenshotId : null, timestamp: new Date().toISOString(), scoutedBy: scoutedByEmail };
    
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
// BATCH REPORT LOGIC
// ------------------------------------------
async function handleBatchReport(formData) {
  try {
    const storage = await chrome.storage.local.get(['piracy_cart', 'last_reporter']);
    let cart = storage.piracy_cart || [];
    const savedName = storage.last_reporter || "Unknown User";
    const finalReporterName = formData.reporterName || savedName;
    const enforcedByEmail = await getUserEmail() || "Unknown";
    
    // --- YOUTUBE LIMIT LOGIC ---
    let remainingCart = [];
    const isYouTube = cart.length > 0 && (cart[0].url.includes('youtube') || cart[0].url.includes('youtu.be'));
    if (isYouTube && cart.length > 10) {
        remainingCart = cart.slice(10);
        cart = cart.slice(0, 10);
    }

    // --- PHASE 1: FRESH SCRAPE (LAZY LOADING) ---
    const updatedCart = [];
    let failedScrapeCount = 0; // Track consecutive N/A returns
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

                 // Count invalid view returns to detect broken universal data keys
                 if (item.views === 'N/A') failedScrapeCount++;

                 if (freshData.status === 'DELETED') {
                     item.views = 'DELETED';
                     console.log(`Video ${item.url} is DELETED.`);
                 } else {
                     console.log(`Verified ${item.url}: ${item.views} views.`);
                 }
             } catch(e) {
                 console.error(`Failed fresh scrape for ${item.url}`, e);
                 failedScrapeCount++;
             }
             
             // Rate limit delay to avoid TikTok flagging
             await new Promise(r => setTimeout(r, 2000));
        }
        updatedCart.push(item);
    }
    
    // Trigger Selector Repair Alert if threshold is exceeded
    if (failedScrapeCount > 5) {
        chrome.runtime.sendMessage({ action: 'progressError', error: "Selector Repair Needed: TikTok/YouTube data structure changed. Please use 'Record Selectors' tool." });
        return { success: false, error: "Selector Repair Needed - View count mapping broken." };
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
      
      // 2. UPLOAD SCREENSHOTS (Parallelized)
      const shouldUploadScreenshots = formData.uploadScreenshots !== false;
      // Map each item to an upload promise, then await them all together
      const evidenceLinks = await Promise.all(items.map(async (item, index) => {
          let imgLink = "No Screenshot Available";
          //   Only attempt upload if user opted in and screenshot exists for the item
          if (shouldUploadScreenshots && item.screenshotId) {
              try {
                  const imgDataUrl = await getImage(item.screenshotId);
                  if (imgDataUrl) {
                      // Use manual conversion instead of fetch() to avoid MV3 data URI restrictions
                      const imageBlob = base64ToBlob(imgDataUrl);
                      const upload = await uploadToDrive(
                          token, 
                          screenshotsFolderId, 
                          `${reportId}_Evidence_${index + 1}_@${handle}.jpg`, 
                          imageBlob, 
                          'image/jpeg'
                      );
                      imgLink = upload.webViewLink; 
                  }
              } catch (imgUploadErr) {
                  console.error(`Failed to upload screenshot for ${item.url}:`, imgUploadErr);
              }
          }
          
          return { 
              url: item.url, 
              screenshotLink: imgLink, 
              views: item.views 
          };
      }));
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
      const streakRes = await chrome.storage.local.get(['streak_count', 'last_report_date', 'streak_freezes']);
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      let currentStreak = streakRes.streak_count || 0;
      let freezes = streakRes.streak_freezes || 0;
      
      if (streakRes.last_report_date !== dateStr) {
          if (streakRes.last_report_date === yesterday) currentStreak += 1;
          else if (freezes > 0) { freezes -= 1; currentStreak += 1; }
          else currentStreak = 1;
          if (currentStreak > 0 && currentStreak % 5 === 0) freezes += 1;
      }
      await chrome.storage.local.set({ streak_count: currentStreak, last_report_date: dateStr, streak_freezes: freezes });
      
      const xpMult = formData.eventConfig?.double_xp ? 2 : 1; // Bounty Event Check
      const queueMult = cart.length > 50 ? 1.2 : 1; // Dynamic Queue Bloat Bonus
      const enforcerScore = Math.floor(((items.length * 20) * xpMult * queueMult)) + (currentStreak >= 3 ? 50 : 0);
      const scoutedByEmails = [...new Set(items.map(i => i.scoutedBy || "Unknown"))].join(', ');
      const totalScoutScore = items.reduce((acc, item) => acc + ((item.scoutScore || 10) * xpMult), 0);
      
      const statusText = formData.mode === 'scout' ? "Open" : "Reported";
      
      const appendResponse = await appendToSheet(token, { 
          values: [todayFormatted, formData.vertical, pdfData.eventName, detectedPlatform, "VOD", viewString, finalReporterName, urlString, "DMCA takedown request", statusText, "Generating Links...", scoutedByEmails, enforcedByEmail, "", "", "", "", "", "", totalScoutScore, enforcerScore, reportId] 
      });
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

    // Cleanup: Keep remaining items for the next batch if over the limit
if (remainingCart.length > 0) {
    await chrome.storage.local.set({ 'piracy_cart': remainingCart });
} else {
    await chrome.storage.local.remove('piracy_cart');
    await clearImages();
}

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
        const scannerEmail = await getUserEmail() || "Unknown";
        const rows = await getColumnHDataWithFormatting();
         if (!rows || rows.length === 0) return { success: false, error: "Failed to fetch sheet data" };
       
        let activeLinks = [];
        const startIdx = Math.max(0, startRowUI - 1);
        
        const activeWorkers = [];
        const MAX_CONCURRENT_TABS = 3;

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

             const checkTask = (async () => {
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
                        timestamp: new Date().toISOString(),
                        scoutedBy: `Auto-Scanner (${scannerEmail})`
                    });
                }
            })().catch(err => console.error("Worker Error:", err));

            activeWorkers.push(checkTask);
            checkTask.finally(() => activeWorkers.splice(activeWorkers.indexOf(checkTask), 1));
            
            if (activeWorkers.length >= MAX_CONCURRENT_TABS) {
                await Promise.race(activeWorkers);
            }
            
            await new Promise(r => setTimeout(r, 2000)); // Stagger tab creation slightly
        }
    }
    
    await Promise.all(activeWorkers); // Wait for any remaining background tabs to finish

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