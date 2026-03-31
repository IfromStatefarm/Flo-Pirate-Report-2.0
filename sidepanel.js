// sidepanel.js
import { getUserEmail } from './utils/auth.js';

let isCrawling = false;
let consecutiveFailures = 0;
let crawlQueue = [];
let configData = null;
const ALLOWED_EMAIL = "@flosports.tv";

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('loading');
  const verticalSelect = document.getElementById('verticalSelect');
  const eventInput = document.getElementById('eventInput');
  const eventList = document.getElementById('eventList');
  const startBtn = document.getElementById('startBtn');
  const grabBtn = document.getElementById('btn-grab-flo');
  const sourceDisplay = document.getElementById('sourceUrlDisplay');
  const crawlBtn = document.getElementById('autoCrawlBtn');
  const doubleTapBtn = document.getElementById('doubleTapBtn');
  const reportFromSheetBtn = document.getElementById('reportFromSheetBtn');
  const stopScanBtn = document.getElementById('stopScanBtn');
  const platformScanSelect = document.getElementById('platformScanSelect');
  const copyEventNameBtn = document.getElementById('copyEventNameBtn');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const searchEventBtn = document.getElementById('searchEventBtn');
  const reporterInput = document.getElementById('reporterName');
  const crawlStatusEl = document.getElementById('crawlStatus');
  const startRowInput = document.getElementById('startRowInput');
  
  // Rogue Site Elements
  const nukeStreamBtn = document.getElementById('nukeStreamBtn');
  const nukeBtn = document.getElementById('nukeBtn');
  const nukeStatus = document.getElementById('nukeStatus');
  const mainUiContainer = document.querySelector('.container'); // Fallback to class since ID was missing in HTML
  const rogueWalkthrough = document.getElementById('rogue-walkthrough');
  const dmcaNoticeArea = document.getElementById('dmcaNotice');
  const generateDmcaBtn = document.getElementById('generateDmcaBtn');
  const googleDeindexBtn = document.getElementById('googleDeindexBtn');
  const closeRogueBtn = document.getElementById('closeRogueBtn');
  let currentRogueData = null;
  const rogueToggle = document.getElementById('rogueToggle');
// Platform Repair Elements
  const startTrainingBtn = document.getElementById('startTrainingBtn');
  const repairPlatformSelect = document.getElementById('repairPlatformSelect');
  const selectorPatchUI = document.getElementById('selectorPatchUI');
  const capturedSelectorRaw = document.getElementById('capturedSelectorRaw');
  const selectorFieldMap = document.getElementById('selectorFieldMap');
  const saveSelectorBtn = document.getElementById('saveSelectorBtn');
  const patchStatus = document.getElementById('patchStatus');
  let currentCapturedPlatform = null;

  // 🚨 CRITICAL FIX: Escaping unclosed HTML tags 🚨
  // sidepanel.html is missing a few closing </div> tags, causing the Walkthrough UI to get trapped 
  // inside the mainUiContainer. When the main container hides, it takes the walkthrough down with it.
  // Reparenting these elements to the body prevents the blank screen issue.
  if (rogueWalkthrough) document.body.appendChild(rogueWalkthrough);
  if (nukeBtn) document.body.appendChild(nukeBtn);
  if (nukeStatus) document.body.appendChild(nukeStatus);

  // New Toggle Elements
  const closerToggle = document.getElementById('closerToggle');
  const closerToggleLabel = document.getElementById('closerToggleLabel');
  const closerStatusEl = document.getElementById('closerStatus'); 
  
  // --- Message Listener for Crawler & Closer ---
  chrome.runtime.onMessage.addListener((msg) => {
    // New listener for Double Tap progress
    if (msg.action === 'scanProgress' && crawlStatusEl) {
        crawlStatusEl.innerText = msg.message;
        return;
    }
    // Closer Status Update
    if (msg.action === 'closerProgress') {
        if (closerStatusEl) {
            closerStatusEl.style.display = 'block';
            closerStatusEl.innerHTML = `<strong>${msg.status}</strong><br>${msg.details || ''}`;
            
            // If stopped, finished, or failed, toggle the switch off automatically
            if (msg.status.includes("Complete") || msg.status.includes("Stop") || msg.status.includes("Failed")) {
                 if (closerToggle && closerToggle.checked) {
                     closerToggle.checked = false;
                     if (closerToggleLabel) {
                         closerToggleLabel.innerText = "Off";
                         closerToggleLabel.style.color = "#666";
                     }
                 }
            }
        }
        return; 
    }

    if (!isCrawling) return;

    if (msg.action === 'urlFound') {
        consecutiveFailures = 0; // Reset failure count on success
        if (crawlStatusEl) crawlStatusEl.innerText = "✅ URL Found! Saving...";
        setTimeout(() => processNextCrawlItem(), 2000); 
    } 
    else if (msg.action === 'botSearchFailed') {
        consecutiveFailures++;
        if (crawlStatusEl) crawlStatusEl.innerText = `⚠️ No Result/Skipped (${consecutiveFailures}/3)`;
        
        if (consecutiveFailures >= 3) {
            stopCrawl("Stopped: 3 consecutive blank results.");
        } else {
            setTimeout(() => processNextCrawlItem(), 2000);
        }
    }
  });

  // Helper to show error
  const showInitError = (msg) => {
      if (loadingEl) {
          loadingEl.innerHTML = `⚠️ <strong>Connection Failed</strong><br>${msg}<br><button id="retryInitBtn" style="margin-top:5px;cursor:pointer;">Retry</button>`;
          loadingEl.style.color = "red";
          document.getElementById('retryInitBtn')?.addEventListener('click', () => window.location.reload());
      }
  };

  // 1. Load Config & Init
  try {
    const authPromise = chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    
    const emailRes = await Promise.race([authPromise, timeoutPromise]).catch(err => null);
    
    if (!emailRes && chrome.runtime.lastError) {
        showInitError("Extension context invalidated. Please reopen.");
        return;
    }
    
    if (!emailRes) {
         showInitError("Background script unresponsive.");
         return;
    }

    const currentEmail = emailRes && emailRes.email ? emailRes.email.toLowerCase().trim() : "";
    
    if (!currentEmail.endsWith("@flosports.tv")) {
       if (loadingEl) {
           loadingEl.innerHTML = `⚠️ <strong>Access Restricted</strong><br>Logged in as: ${currentEmail || "Unknown"}<br>Required: ${ALLOWED_EMAIL}`;
           loadingEl.style.color = "red";
       }
       return; 
    }

    // Load Config
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success) {
      configData = response.config;
      populateVerticals(verticalSelect);
      if (loadingEl) loadingEl.style.display = 'none';
      if (startBtn) startBtn.disabled = false;
    } else {
      showInitError("Config Load Failed: " + (response?.error || "Unknown"));
    }
  } catch (e) {
    console.error("Init error:", e);
    showInitError(e.message || "Unknown Error");
  }

  // Load Saved State
  chrome.storage.local.get(['last_reporter', 'last_vertical'], (res) => {
      if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;
      if (res.last_vertical && verticalSelect) {
          verticalSelect.value = res.last_vertical;
          // Trigger change logic manually to load events
          verticalSelect.dispatchEvent(new Event('change'));
      }
  });
  chrome.storage.local.get(['rogue_target_data'], (rogueRes) => {
      if (rogueRes.rogue_target_data) {
          renderRogueWalkthrough(rogueRes.rogue_target_data);
      }
  });

  // 2. Event Listeners
  if (verticalSelect) {
      verticalSelect.addEventListener('change', async () => {
          const vertical = verticalSelect.value;
          chrome.storage.local.set({ last_vertical: vertical });
          
          if (eventList) eventList.innerHTML = ''; // Clear current options

          if (vertical) {
              if (eventInput) eventInput.placeholder = "Loading events...";
              
              try {
                  const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
                  
                  if (response && response.success && response.data && response.data.eventMap) {
                      const events = Object.values(response.data.eventMap).map(e => e.name);
                      events.sort();
                      
                      eventList.innerHTML = '';
                      events.forEach(name => {
                          const opt = document.createElement('option');
                          opt.value = name;
                          eventList.appendChild(opt);
                      });
                      window.currentEventMap = response.data.eventMap;
                      
                      if (eventInput) eventInput.placeholder = "Select or Type...";
                  }
              } catch(e) {
                  console.error("Error fetching events:", e);
                  if (eventInput) eventInput.placeholder = "Error loading events";
              }
          }
      });
  }

  const performSearch = () => {
      const vertical = verticalSelect.value;
      const eventName = eventInput.value;
      
      if (vertical && eventName) {
          // --- NEW: Levenshtein distance check ---
          const existingEvents = Array.from(eventList.options).map(opt => opt.value);
          const similarEvent = existingEvents.find(name => 
              name.toLowerCase() !== eventName.toLowerCase() && 
              levenshtein(name.toLowerCase(), eventName.toLowerCase()) <= 2
          );

          if (similarEvent && !confirm(`"${eventName}" is very similar to existing event "${similarEvent}".\n\nClick OK to proceed anyway (this may create a duplicate row), or Cancel to correct it.`)) {
              return;
          }
          // --- END NEW ---

          if (loadingEl) {
              loadingEl.innerText = "Opening Search Page...";
              loadingEl.style.display = "block";
              loadingEl.style.color = "blue";
          }
          
          chrome.runtime.sendMessage({ 
              action: 'findEventUrl', 
              data: { eventName, vertical } 
          }, (res) => {
              if (loadingEl) loadingEl.style.display = "none";
              if (!res.success) {
                  alert("Error opening search: " + res.error);
              }
          });
      } else {
          alert("Please select a Vertical and enter an Event Name.");
        }
    };

    if (eventInput) {
        eventInput.addEventListener('change', () => {
            const ev = window.currentEventMap && window.currentEventMap[eventInput.value.toLowerCase().trim()];
            if (ev && sourceDisplay) sourceDisplay.value = Object.values(ev.urls).find(u => u) || "";
        });
        
        eventInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                performSearch();
          }
      });
  }

  if (searchEventBtn) {
      searchEventBtn.addEventListener('click', performSearch);
  }

  if (reporterInput) {
      reporterInput.addEventListener('change', () => {
          chrome.storage.local.set({ last_reporter: reporterInput.value });
      });
  }

  if (grabBtn) {
      grabBtn.addEventListener('click', async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url) {
              if (sourceDisplay) sourceDisplay.value = tab.url;
          }
      });
  }

  // --- ROGUE SITE SCRAPE LOGIC (Consolidated for all buttons) ---
  const handleNukeClick = async (btn) => {
      const originalText = btn.innerText;
      btn.innerText = "Scraping & Sniffing...";
      btn.disabled = true;
      if (nukeStatus) nukeStatus.innerText = "Working...";

      try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error("No active tab");

          // Inject a targeted scraper directly into the current page
          const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                  return {
                      title: document.title,
                      url: window.location.href,
                      iframes: Array.from(document.querySelectorAll('iframe')).map(i => i.src).filter(Boolean),
                      videos: Array.from(document.querySelectorAll('video')).map(v => v.src).filter(Boolean),
                      emails: (document.body.innerText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi) || []).filter(e => e.toLowerCase().includes('abuse'))
                  };
              }
          });

          // Send the scraped DOM data to background to merge with sniffed network URLs
          chrome.runtime.sendMessage({ action: 'initRogueTakedown', data: results[0].result }, () => {
              btn.innerText = originalText;
              btn.disabled = false;
              if (nukeStatus) nukeStatus.innerText = "Data captured! See Rogue Walkthrough.";
              setTimeout(() => { if (nukeStatus) nukeStatus.innerText = ""; }, 3000);
          });
      } catch (e) {
          console.error(e);
          btn.innerText = "Error - Refresh Page";
          if (nukeStatus) nukeStatus.innerText = "Failed.";
          setTimeout(() => { btn.innerText = originalText; btn.disabled = false; if (nukeStatus) nukeStatus.innerText = ""; }, 2000);
      }
  };

  if (nukeStreamBtn) nukeStreamBtn.addEventListener('click', () => handleNukeClick(nukeStreamBtn));
  if (nukeBtn) nukeBtn.addEventListener('click', () => handleNukeClick(nukeBtn));

  // --- START REPORT LOGIC ---
  if (startBtn) {
      startBtn.addEventListener('click', async () => {
          const reporterName = reporterInput.value;
          const vertical = verticalSelect.value;
          const eventName = eventInput.value;
          const sourceUrl = document.getElementById('sourceUrlDisplay').value;
          
          if (!reporterName || !vertical || !eventName) {
              alert("Please fill in Reporter, Vertical, and Event Name.");
              return;
          }

          startBtn.disabled = true;
          startBtn.innerText = "Checking Queue...";

          // 1. Check Cart
          const storage = await chrome.storage.local.get('piracy_cart');
          const cart = storage.piracy_cart || [];
          
          if (cart.length === 0) {
              alert("Queue is empty. Use the 'Add' buttons on video pages first.");
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              return;
          }

          // 2. Determine Platform & URL
          const firstUrl = cart[0].url;
          let reportUrl = "";
          let platform = "TikTok";

          if (firstUrl.includes("youtube") || firstUrl.includes("youtu.be")) {
              platform = "YouTube";
              reportUrl = "https://www.youtube.com/copyright_complaint_form";
          } else if (firstUrl.includes("tiktok")) {
              platform = "TikTok";
              reportUrl = "https://www.tiktok.com/legal/report/Copyright";
          } else {
              // Fallback or handle other platforms
              platform = "Other";
              alert("Auto-reporting is currently optimized for TikTok and YouTube. Please manually report other platforms.");
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              return;
          }

          // 3. Save Context for Content Script
          const reporterInfo = {
              name: reporterName,
              email: await getUserEmail() || "copyright@flosports.tv",
              eventName: eventName,
              vertical: vertical,
              sourceUrl: sourceUrl || ""
          };
          
          if (sourceUrl) chrome.runtime.sendMessage({ action: 'saveEventUrl', data: { vertical, eventName, url: sourceUrl, platform: platform.toLowerCase() } });

          await chrome.storage.local.set({ reporterInfo });

          // 4. Open Reporting Page
          startBtn.innerText = `Opening ${platform}...`;
          
          chrome.tabs.create({ url: reportUrl }, (tab) => {
              // For TikTok, manually inject content_autofill.js because the manifest 
              // might not match the specific legal report page URL automatically.
              if (platform === "TikTok") {
                  const listener = (tabId, changeInfo, tabInfo) => {
                      if (tabId === tab.id && changeInfo.status === 'complete') {
                          chrome.tabs.onUpdated.removeListener(listener);
                          chrome.scripting.executeScript({
                              target: { tabId: tabId },
                              files: ['content_autofill.js']
                          }).then(() => console.log("Autofill script injected for TikTok"))
                            .catch(err => console.warn("Injection failed:", err));
                      }
                  };
                  chrome.tabs.onUpdated.addListener(listener);
              }

              // Done. The content script on that page will pick up 'reporterInfo' and 'piracy_cart'.
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
          });
      });
  }

  // Copy Name Tool
  if (copyEventNameBtn) {
    copyEventNameBtn.addEventListener('click', () => {
       const txt = eventInput ? eventInput.value : "";
       navigator.clipboard.writeText(txt);
       copyEventNameBtn.innerText = "Copied!";
       setTimeout(() => copyEventNameBtn.innerText = 'Copy Event Name', 2000);
    });
  }
  //Copy URL Tool
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
       const txt = sourceDisplay ? sourceDisplay.value : "";
       navigator.clipboard.writeText(txt);
       copyUrlBtn.innerText = "Copied!";
       setTimeout(() => copyUrlBtn.innerText = "Copy 'Stolen From' URL", 2000);
    });
  }

  // --- TOGGLE CLOSER SCANNER LOGIC ---
  if (closerToggle) {
      closerToggle.addEventListener('change', async (e) => {
          const isChecked = e.target.checked;
          chrome.storage.local.set({ closer_enabled: isChecked });
          
          if (closerToggleLabel) {
              closerToggleLabel.innerText = isChecked ? "On" : "Off";
              closerToggleLabel.style.color = isChecked ? "#4CAF50" : "#666";
          }

          if (isChecked) {
              const startVal = startRowInput ? startRowInput.value : 1;
              const startRow = parseInt(startVal) || 1;
              
              if (closerStatusEl) {
                  closerStatusEl.style.display = 'block';
                  closerStatusEl.innerText = "Initializing Scanner...";
              }

              chrome.runtime.sendMessage({ action: 'triggerCloser', startRow: startRow }, (res) => {
                  if (chrome.runtime.lastError) {
                      // Revert toggle if error
                      closerToggle.checked = false;
                      if (closerToggleLabel) {
                          closerToggleLabel.innerText = "Off";
                          closerToggleLabel.style.color = "#666";
                      }
                      if (closerStatusEl) closerStatusEl.innerText = "Error: " + chrome.runtime.lastError.message;
                  }
              });
          } else {
              if (closerStatusEl) closerStatusEl.innerText = "Stopping...";
              chrome.runtime.sendMessage({ action: 'stopSheetScanner' });
          }
      });
  }

  // --- DOUBLE TAP & BULK REPORT LOGIC ---
   if (doubleTapBtn) {
      doubleTapBtn.addEventListener('click', async () => {
          const platform = platformScanSelect ? platformScanSelect.value : 'tiktok';
          const vertical = verticalSelect.value;
          const startRowVal = document.getElementById('doubleTapStartRow')?.value || 1;
          const startRow = parseInt(startRowVal) || 1;
          
          if (!vertical) {
              alert("Please select a Vertical first.");
              return;
          }

          crawlStatusEl.innerText = `Scanning sheet for active ${platform} links...`;
          doubleTapBtn.disabled = true;
          if (stopScanBtn) stopScanBtn.style.display = 'block';

          // Delegate formatting fetch and parsing to background script
          const response = await chrome.runtime.sendMessage({ action: 'scanSheetForActiveLinks', platform, vertical, startRow });
          
          doubleTapBtn.disabled = false;
          if (stopScanBtn) stopScanBtn.style.display = 'none';

          if (response && response.success) {
              crawlStatusEl.innerText = `Queued ${response.count} active links.`;
              if (response.count > 0 && reportFromSheetBtn) {
                  reportFromSheetBtn.style.display = 'block';
              } else if (reportFromSheetBtn) {
                  reportFromSheetBtn.style.display = 'none';
              }
          } else {
              crawlStatusEl.innerText = "Error: " + (response?.error || "Failed to scan.");
          }
      });
  }

  if (reportFromSheetBtn) {
      reportFromSheetBtn.addEventListener('click', async () => {
          const reporterName = reporterInput.value;
          const vertical = verticalSelect.value;
          
          if (!reporterName || !vertical) {
              alert("Please fill in Reporter and Vertical.");
              return;
          }

          reportFromSheetBtn.disabled = true;
          reportFromSheetBtn.innerText = "Processing Bulk Report...";

          // Trigger the existing bulk reporting logic in background.js
          chrome.runtime.sendMessage({ 
              action: 'processQueue', 
              data: { 
                  reporterName, 
                  vertical, 
                  eventName: "Bulk Sheet Report", 
                  uploadScreenshots: false // Skip screenshots to save memory on bulk runs
              } 
          });
          
          crawlStatusEl.innerText = "Bulk report started. Monitor via Popup.";
      });
  }

  if (stopScanBtn) {
      stopScanBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'stopSheetScanner' });
          if (crawlStatusEl) crawlStatusEl.innerText = "Stopping scan...";
      });
  }
  // --- PLATFORM REPAIR LOGIC ---
  if (startTrainingBtn) {
      startTrainingBtn.addEventListener('click', async () => {
          const platform = repairPlatformSelect ? repairPlatformSelect.value : 'tiktok';
          startTrainingBtn.innerText = "Recording...";
          startTrainingBtn.disabled = true;
          
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
              chrome.tabs.sendMessage(tab.id, { action: 'startSelectorTraining', platform }, (res) => {
                  if (res && res.success) {
                      startTrainingBtn.innerText = "Select Element on Page";
                  } else {
                      startTrainingBtn.innerText = "Error (Refresh Page)";
                      setTimeout(() => { startTrainingBtn.innerText = "Record Selectors"; startTrainingBtn.disabled = false; }, 3000);
                  }
              });
          }
      });
  }
if (selectorPatchUI) selectorPatchUI.style.display = 'block';
  const startMacroBtn = document.getElementById('startMacroBtn');
  if (startMacroBtn) {
      startMacroBtn.addEventListener('click', async () => {
          const platform = repairPlatformSelect ? repairPlatformSelect.value : 'tiktok';
          startMacroBtn.innerText = "Recording (10s)...";
          startMacroBtn.disabled = true;
          
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) chrome.tabs.sendMessage(tab.id, { action: 'startMacroTraining', platform });
      });
  }

  // Listen for completed training from content script and show mapping UI with captured selector/macro data 
  chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'selectorTrainingComplete') {
          if (startTrainingBtn) {
              startTrainingBtn.innerText = "Record Selectors";
              startTrainingBtn.disabled = false;
          }
          
          // Show the mapping UI instead of just alerting
          currentCapturedPlatform = msg.platform;
          if (capturedSelectorRaw) capturedSelectorRaw.value = msg.selector;
          if (selectorPatchUI) selectorPatchUI.style.display = 'block';
          if (patchStatus) patchStatus.innerText = "";
      }

      if (msg.action === 'macroTrainingComplete') {
          if (startMacroBtn) {
              startMacroBtn.innerText = "Record Macro";
              startMacroBtn.disabled = false;
          }
          currentCapturedPlatform = msg.platform;
          if (capturedSelectorRaw) capturedSelectorRaw.value = JSON.stringify(msg.macro);
          if (selectorPatchUI) selectorPatchUI.style.display = 'block';
          if (patchStatus) patchStatus.innerText = "";
      }
  });

  // --- SAVE PATCHED SELECTOR TO GOOGLE DRIVE ---
  if (saveSelectorBtn) {
      saveSelectorBtn.addEventListener('click', () => {
          const field = selectorFieldMap ? selectorFieldMap.value : null;
          const selector = capturedSelectorRaw ? capturedSelectorRaw.value : null;
          const section = document.getElementById('selectorSectionMap') ? document.getElementById('selectorSectionMap').value : 'scraper';
          const actionType = document.getElementById('flo-patch-action') ? document.getElementById('flo-patch-action').value : 'click';

          if (!field || !selector || !currentCapturedPlatform) {
              alert("Missing data for configuration patch.");
              return;
          }

          saveSelectorBtn.disabled = true;
          saveSelectorBtn.innerText = "Syncing to Cloud...";
          if (patchStatus) patchStatus.innerText = "Updating events_config.json...";

          chrome.runtime.sendMessage({
              action: 'patchSelectorConfig',
              platform: currentCapturedPlatform,
              section: section,
              field: field,
              selector: selector,
              actionType: actionType
          }, (res) => {
              if (res && res.success) {
                  if (patchStatus) {
                      patchStatus.style.color = "green";
                      patchStatus.innerText = "✅ Cloud Config Updated!";
                  }
                  setTimeout(() => {
                      if (selectorPatchUI) selectorPatchUI.style.display = 'none';
                      saveSelectorBtn.disabled = false;
                      saveSelectorBtn.innerText = "Patch Cloud Config";
                      if (patchStatus) patchStatus.style.color = "#b91c1c";
                  }, 2500);
              } else {
                  if (patchStatus) {
                      patchStatus.style.color = "red";
                      patchStatus.innerText = "❌ Error: " + (res?.error || "Failed to update config");
                  }
                  saveSelectorBtn.disabled = false;
                  saveSelectorBtn.innerText = "Try Again";
              }
          });
      });
  }

  // --- ROGUE SITE WALKTHROUGH LOGIC ---
  function renderRogueWalkthrough(data) {
      currentRogueData = data;
      if (mainUiContainer) mainUiContainer.style.display = 'none';
      if (nukeBtn) nukeBtn.style.display = 'none'; // Hide Nuke button to keep UI clean
      if (rogueWalkthrough) rogueWalkthrough.style.display = 'block';
      
      // Use optional chaining (?.) to prevent fatal crashes if data is missing
      const iframesStr = (data?.iframes?.length > 0) ? data.iframes.join('\n') : 'None found';
      const sniffedStr = (data?.sniffedUrls?.length > 0) ? data.sniffedUrls.join('\n') : 'None found';
      const abuseEmails = (data?.emails?.length > 0) ? data.emails.join(', ') : '[INSERT ABUSE EMAIL]';
      const urlStr = data?.url || 'Unknown URL';
      
      if (dmcaNoticeArea) {
          dmcaNoticeArea.value = `Subject: DMCA Takedown Notice - FloSports\n\nTo Whom It May Concern (Abuse Dept: ${abuseEmails}),\n\nWe are contacting you on behalf of FloSports regarding unauthorized broadcasting of our copyrighted content.\n\nInfringing URL: ${urlStr}\nEmbedded Players/Iframes:\n${iframesStr}\nRaw Media Feeds:\n${sniffedStr}\n\nPlease remove or disable access to this material immediately.\n\nRegards,\nFloSports Anti-Piracy Team`;
      }
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.rogue_target_data && changes.rogue_target_data.newValue) {
          renderRogueWalkthrough(changes.rogue_target_data.newValue);
      }
  });

  chrome.storage.local.get(['rogue_target_data'], (res) => {
      if (res.rogue_target_data) renderRogueWalkthrough(res.rogue_target_data);
  });

  if (generateDmcaBtn) {
      generateDmcaBtn.addEventListener('click', () => {
          const emails = (currentRogueData?.emails?.length > 0) ? currentRogueData.emails.join(',') : '';
          const body = encodeURIComponent(dmcaNoticeArea ? dmcaNoticeArea.value : '');
          window.open(`mailto:${emails}?subject=DMCA Takedown Notice - FloSports&body=${body}`);
      });
  }

  if (googleDeindexBtn) googleDeindexBtn.addEventListener('click', () => window.open('https://reportcontent.google.com/'));

  if (closeRogueBtn) {
      closeRogueBtn.addEventListener('click', () => {
          chrome.storage.local.remove('rogue_target_data');
          if (rogueWalkthrough) rogueWalkthrough.style.display = 'none';
          if (mainUiContainer) mainUiContainer.style.display = 'flex'; // Restore container as flex
          if (nukeBtn) nukeBtn.style.display = 'block'; // Bring Nuke button back
      });
  }

  // --- ROGUE TOGGLE & COLOR LOGIC ---
  if (rogueToggle && nukeStreamBtn) {
      // Load initial state on open
     chrome.storage.local.get(['showNukeButton'], (res) => {
          const isChecked = !!res.showNukeButton;
          rogueToggle.checked = isChecked;
          nukeStreamBtn.style.backgroundColor = isChecked ? '#ce0e2d' : '#1a1a1a';
          nukeStreamBtn.style.color = 'white';
          nukeStreamBtn.innerText = isChecked ? '☢️ 3rd Party Site Safety OFF' : '🛡️ 3rd Party Safety: ON';
      });

      // Listen for toggle changes
      rogueToggle.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          chrome.storage.local.set({ showNukeButton: isChecked });
          nukeStreamBtn.style.backgroundColor = isChecked ? '#ce0e2d' : '#1a1a1a';
          nukeStreamBtn.innerText = isChecked ? '☢️ 3rd Party Site Safety OFF' : '🛡️ 3rd Party Safety: ON';
      });
  }
});

function processNextCrawlItem() {
    const statusEl = document.getElementById('crawlStatus');
    const vertical = document.getElementById('verticalSelect').value;

    if (!isCrawling) return;
    
    if (crawlQueue.length === 0) {
        stopCrawl("Done! Queue finished.");
        return;
    }

    const event = crawlQueue.shift();
    if (statusEl) statusEl.innerText = `Searching: ${event.name}...`;

    chrome.runtime.sendMessage({ 
        action: 'findEventUrl', 
        data: { 
            eventName: event.name, 
            vertical: vertical 
        } 
    });
}

function stopCrawl(reason) {
    isCrawling = false;
    const statusEl = document.getElementById('crawlStatus');
    const btn = document.getElementById('autoCrawlBtn');
    
    if (statusEl) {
        statusEl.innerText = reason;
        statusEl.style.color = reason.includes("Stopped") ? "red" : "green";
    }
    
    if (btn) {
        btn.innerText = "Start Auto-Crawl (TikTok)";
        btn.style.backgroundColor = "#f39c12"; // Restore orange
    }
}

function populateVerticals(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select Vertical...</option>';
  
  if (configData && configData.verticals) {
    configData.verticals.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.innerText = v.name;
      selectEl.appendChild(opt);
    });
  }
}
// --- Levenshtein distance helper ---
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    }
    return matrix[b.length][a.length];
}