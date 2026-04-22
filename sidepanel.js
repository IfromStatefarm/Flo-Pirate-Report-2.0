// sidepanel.js
import { getUserEmail } from './utils/auth.js';

let isCrawling = false;
let consecutiveFailures = 0;
let crawlQueue = [];
let configData = null;
const ALLOWED_EMAIL = "@flosports.tv";
// --- SECURITY LOCK OVERLAY (Duplicated for Side Panel context) ---
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
  const rogueScrapedData = document.getElementById('rogueScrapedData');
  const rogueUserNotes = document.getElementById('rogueUserNotes');
  const saveRogueBtn = document.getElementById('saveRogueBtn');
  const closeRogueBtn = document.getElementById('closeRogueBtn');
  let currentRogueData = null;
  const rogueToggle = document.getElementById('rogueToggle');
  const generateDmcaBtn = document.getElementById('generateDmcaBtn');
  const dmcaNoticeArea = document.getElementById('dmcaNoticeArea');
  const googleDeindexBtn = document.getElementById('googleDeindexBtn');
// Platform Repair Elements
  const startTrainingBtn = document.getElementById('startTrainingBtn');
  const repairPlatformSelect = document.getElementById('repairPlatformSelect');
  const recordingBadge = document.getElementById('recording-badge');
  const selectorPatchUI = document.getElementById('selectorPatchUI');
  const capturedSelectorRaw = document.getElementById('capturedSelectorRaw');
  const selectorFieldMap = document.getElementById('selectorFieldMap');
  const saveSelectorBtn = document.getElementById('saveSelectorBtn');
  const patchStatus = document.getElementById('patchStatus');
  let currentCapturedPlatform = null;
  
  // --- RANDOM CLIPPY QUOTES ---
  const clippyPhrases = [
    "Alright, let’s make the internet a better place—one report at a time.",
    "You’ve got this. Let’s go catch some rule-breakers.",
    "Every report counts—let’s clean up the game.",
    "Time to step up and defend the sport.",
    "You’re not just browsing—you’re making a difference.",
    "Let’s turn fair play into the only play.",
    "Eyes sharp—pirates won’t catch themselves.",
    "You’re on the front lines now. Let’s go.",
    "Small actions, big impact. Let’s get to work.",
    "This is how we keep the game honest.",
    "Stay focused. Spot it, report it, done.",
    "You’re part of the team now—let’s win this.",
    "Let’s protect the streams that matter.",
    "Game face on—it’s go time.",
    "You’ve got the tools. Now let’s use them.",
    "One clean click at a time—let’s do this.",
    "Together, we shut piracy down.",
    "Let’s raise the standard—starting now.",
    "Ready, set… report.",
    "Go make Clippy proud. Let’s hunt."
  ];
  
  const clippyFeedbackEl = document.getElementById('clippy-feedback-text');
  if (clippyFeedbackEl) {
      clippyFeedbackEl.innerText = clippyPhrases[Math.floor(Math.random() * clippyPhrases.length)];
  }

  const closeClippyBtn = document.getElementById('close-clippy-btn');
  if (closeClippyBtn) {
      closeClippyBtn.addEventListener('click', () => {
          document.getElementById('clippy-process-bubble').style.display = 'none';
      });
  }

  // 🚨 CRITICAL FIX: Escaping unclosed HTML tags 🚨
  // sidepanel.html is missing a few closing </div> tags, causing the Walkthrough UI to get trapped 
  // inside the mainUiContainer. When the main container hides, it takes the walkthrough down with it.
  // Reparenting these elements to the body prevents the blank screen issue.
  if (rogueWalkthrough) document.body.appendChild(rogueWalkthrough);
  if (nukeBtn) document.body.appendChild(nukeBtn);
  if (nukeStatus) document.body.appendChild(nukeStatus);

  // Toggle Elements
  const closerToggle = document.getElementById('closerToggle');
  const closerToggleLabel = document.getElementById('closerToggleLabel');
  const closerStatusEl = document.getElementById('closerStatus'); 

  // --- VERSION RELEASE NOTES ---
  const currentVersion = chrome.runtime.getManifest().version;
  chrome.storage.local.get(['last_seen_version'], (res) => {
      if (res.last_seen_version !== currentVersion) {
          alert(`🎉 What's New in v${currentVersion}!\n\nShoutout to Justin M. for catching that TikTok selector bug! We've patched it up and dropped +50 bonus points into your account.\n\nKeep hunting! 🏴‍☠️`);
          chrome.storage.local.set({ last_seen_version: currentVersion });
      }
  });
  // --- SETTINGS GEAR LOGIC (MV3 Compliant) ---
  const optionsGearBtn = document.getElementById('openOptionsGearBtn');
  if (optionsGearBtn) {
      optionsGearBtn.addEventListener('click', () => {
          if (chrome.runtime.openOptionsPage) {
              // This natively handles focusing the options tab if it's already open
              chrome.runtime.openOptionsPage(); 
          } else {
              // Fallback just in case
              window.open(chrome.runtime.getURL('options.html'));
          }
      });
  }
  // --- Message Listener for Crawler & Closer ---
  // Accept heartbeat connections to prevent Service Worker zombification
  chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'sw-heartbeat') {
          port.onMessage.addListener(() => { /* Heartbeat acknowledged */ });
      }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    // Event-Driven URL capture from background ping
    if (msg.action === 'activeUrlChanged' && sourceDisplay) {
        chrome.storage.local.get(['highlight_start_disabled'], (res) => {
            // Only auto-populate if the user hasn't locked in a search and the field is empty
            if (!res.highlight_start_disabled && !sourceDisplay.value.trim()) {
                sourceDisplay.value = msg.url;
                if (grabBtn) grabBtn.disabled = true;
            }
        });
    }

    // New listener for Double Tap progress and Closer Scanner updates
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
          loadingEl.innerHTML = `⚠️ <strong>Connection Failed</strong><br>${msg}<br>
          <div class="flex-row" style="justify-content:center; margin-top:10px;">
            <button id="retryInitBtn" class="btn btn-info" style="width:auto; padding:5px 15px;">Retry</button>
            <button id="openOptionsBtn" class="btn btn-warning" style="width:auto; padding:5px 15px;">Settings</button>
          </div>`;
          loadingEl.style.color = "red";
          document.getElementById('retryInitBtn')?.addEventListener('click', () => window.location.reload());
          document.getElementById('openOptionsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
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

    // Fetch User Stats & Leaderboard
    chrome.runtime.sendMessage({ action: 'getGamificationStats' }, (stats) => {
        if (stats) {
            document.getElementById('gamification-header').style.display = 'block';
            document.getElementById('scout-rank').innerText = stats.scoutRank || 'Spotter';
            document.getElementById('enforcer-rank').innerText = stats.enforcerRank || 'Agent';
            document.getElementById('scout-points').innerText = stats.scoutPoints || 0;
            document.getElementById('enforcer-points').innerText = stats.enforcerPoints || 0;
            
            if (stats.mvp) document.getElementById('mvp-name').innerText = stats.mvp.name;
            document.getElementById('team-takedowns').innerText = stats.teamTotal || 0;
            
            if (stats.teamTotal >= 1000 && !window.teamGoalMet) {
                window.teamGoalMet = true;
                document.getElementById('gamification-header').style.backgroundColor = '#d1fae5';
            }

            if(stats.topScouts) {
                document.getElementById('scout-leaderboard').innerHTML = stats.topScouts.map((u, i) => `<li><strong>#${i+1}</strong> <span style="text-transform:capitalize">${u.name}</span> - ${u.points} pts</li>`).join('');
                document.getElementById('enforcer-leaderboard').innerHTML = stats.topEnforcers.map((u, i) => `<li><strong>#${i+1}</strong> <span style="text-transform:capitalize">${u.name}</span> - ${u.points} pts</li>`).join('');
            }
        }
    });

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
    showClippyToast(e.message || "Unknown Error", 'images/clippy smrik.gif', 6000);
    showInitError(e.message || "Unknown Error");
  }

  // Dynamically set the Google Sheet link
  chrome.storage.sync.get(['piracy_sheet_id'], (res) => {
      const sheetLink = document.getElementById('automationSheetLink');
      if (sheetLink && res.piracy_sheet_id) sheetLink.href = `https://docs.google.com/spreadsheets/d/${res.piracy_sheet_id}/edit`;
  });

  // Load Saved State
  chrome.storage.local.get(['last_reporter', 'last_vertical'], (res) => {
      if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;

      if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;
      if (res.last_vertical && verticalSelect) {
          verticalSelect.value = res.last_vertical;
          // Trigger change logic manually to load events
          verticalSelect.dispatchEvent(new Event('change'));
      }
  });
  // Fetch Dynamic Start Row for Closer and Double Tap
  chrome.runtime.sendMessage({ action: 'getRecommendedStartRow' }, (res) => {
      if (res && res.success && res.row) {
          if (startRowInput) startRowInput.value = res.row;
          const doubleTapInput = document.getElementById('doubleTapStartRow');
          if (doubleTapInput) doubleTapInput.value = res.row;
      }
  });
  // PATCH: Trigger initial UI evaluation to set the proper button text on load
  chrome.storage.local.get('piracy_cart', (res) => evaluateWorkflowFocus(res.piracy_cart?.length || 0));

  chrome.storage.local.get(['rogue_target_data'], (rogueRes) => {
      if (rogueRes.rogue_target_data) {
          renderRogueWalkthrough(rogueRes.rogue_target_data);
      }
  });

  // Dynamic Sync: Fetch Leaderboard stats periodically to keep UI fresh
  setInterval(() => {
      // Fetch User Stats & Leaderboard
    chrome.runtime.sendMessage({ action: 'getGamificationStats' }, (stats) => {
        if (stats) {
            document.getElementById('gamification-header').style.display = 'block';

            let themeColor = '#ce0e2d'; // Default Flo Red
            if (stats.scoutRank === 'Sentinel' || stats.enforcerRank === 'The Purge') themeColor = '#9333ea'; // Diamond / Purple Tier
            else if (stats.scoutRank === 'Pathfinder' || stats.enforcerRank === 'Sheriff') themeColor = '#fbbf24'; // Gold Tier
            document.getElementById('gamification-header').style.borderColor = themeColor;

            document.getElementById('scout-rank').innerText = stats.scoutRank || 'Spotter';
            document.getElementById('enforcer-rank').innerText = stats.enforcerRank || 'Agent';
            document.getElementById('scout-points').innerText = stats.scoutPoints || 0;
              document.getElementById('enforcer-points').innerText = stats.enforcerPoints || 0;
              
              if (stats.mvp) document.getElementById('mvp-name').innerText = stats.mvp.name;
              document.getElementById('team-takedowns').innerText = stats.teamTotal || 0;
              
              if (stats.teamTotal >= 1000 && !window.teamGoalMet) {
                  window.teamGoalMet = true;
                  document.getElementById('gamification-header').style.backgroundColor = '#d1fae5';
              }

              document.getElementById('scout-leaderboard').innerHTML = stats.topScouts.map((u, i) => `<li><strong>#${i+1}</strong> <span style="text-transform:capitalize">${u.name}</span> - ${u.points} pts</li>`).join('');
              document.getElementById('enforcer-leaderboard').innerHTML = stats.topEnforcers.map((u, i) => `<li><strong>#${i+1}</strong> <span style="text-transform:capitalize">${u.name}</span> - ${u.points} pts</li>`).join('');
          }
      });
  }, 30000);

  // 2. Event Listeners
 if (verticalSelect) {
      verticalSelect.addEventListener('change', async () => {
          const vertical = verticalSelect.value;
          chrome.storage.local.set({ last_vertical: vertical });
          
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
                  showClippyToast("Error opening search: " + res.error, 'images/clippy smrik.gif');
              }
          });
      } else {
          showClippyToast("Please select a Vertical and enter an Event Name.", 'images/clippy smrik.gif');
      }
  };
// Levenshtein distance function for fuzzy matching
  if (eventInput) {
        eventInput.addEventListener('change', () => {
            const ev = window.currentEventMap && window.currentEventMap[eventInput.value.toLowerCase().trim()];
            if (ev && sourceDisplay) {
                sourceDisplay.value = Object.values(ev.urls).find(u => u) || "";

                //  this line is to disable the grab button if a URL was auto-populated
                if (grabBtn) grabBtn.disabled = sourceDisplay.value.trim() !== "";
                
                if (!sourceDisplay.value.trim()) {
                    sourceDisplay.placeholder = "No URL found for this event.";
                    document.getElementById('searchEventBtn')?.classList.add('clippy-focus');
                } else {
                    document.getElementById('startBtn')?.classList.add('clippy-focus');
                }
            }
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

    if (sourceDisplay && grabBtn) {
        sourceDisplay.addEventListener('input', () => {
            grabBtn.disabled = sourceDisplay.value.trim() !== "";
        });
    }

    if (grabBtn) {
        grabBtn.addEventListener('click', async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                if (sourceDisplay) {
                    sourceDisplay.value = tab.url;
                    grabBtn.disabled = true;
                }
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

          // Verify domain to prevent accidental self-nuking
          const isSafeDomain = tab.url.match(/(flosports\.tv|varsity\.com|milesplit\.com)/i);
          if (isSafeDomain && !confirm(`⚠️ WARNING: You are on an official domain.\n\nAre you sure you want to NUKE ${new URL(tab.url).hostname}?`)) {
              btn.innerText = originalText;
              btn.disabled = false;
              if (nukeStatus) nukeStatus.innerText = "";
              return;
          }
          
          // Inject a targeted scraper directly into the current page
          const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                  return {
                      title: document.title,
                      url: window.location.href,
                      iframes: [...new Set(Array.from(document.querySelectorAll('iframe')).map(i => i.src).filter(Boolean))],
                      videos: [...new Set(Array.from(document.querySelectorAll('video, source')).map(v => v.src || v.srcset).filter(Boolean))],
                      emails: [...new Set((document.body.innerText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi) || []).filter(e => e.toLowerCase().includes('abuse')))]
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
// Attach the same handler to both buttons, but only allow it to run if the rogue toggle is ON for the stream button
  if (nukeStreamBtn) nukeStreamBtn.addEventListener('click', () => {
      if (rogueToggle && !rogueToggle.checked) return; // Prevent click if Safety is ON
      handleNukeClick(nukeStreamBtn);
  });
  if (nukeBtn) nukeBtn.addEventListener('click', () => handleNukeClick(nukeBtn));

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
          const reporterName = reporterInput.value;
          const vertical = verticalSelect.value;
          const eventName = eventInput.value;
          const sourceUrl = document.getElementById('sourceUrlDisplay').value;
          
          // PATCH: Fetch mode early and define default text for resets
          const syncData = await chrome.storage.sync.get(['report_mode']);
          const isScout = (syncData.report_mode || 'scout') === 'scout';
          const defaultBtnText = isScout ? "Save to Log (Scout Mode)" : "Start Report";
          
          startBtn.classList.remove('clippy-focus');
          chrome.storage.local.set({ highlight_start_disabled: true });

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
              startBtn.innerText = defaultBtnText; // PATCHED
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
              startBtn.innerText = defaultBtnText; // PATCHED
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

          // 4. Open Reporting Page or Skip (Scout Mode)
          if (isScout) { // PATCHED
              startBtn.innerText = `Logging (Scout Mode)...`;
              const payload = { reporterName, vertical, eventName, mode: 'scout', uploadScreenshots: true };
              chrome.runtime.sendMessage({ action: 'processQueue', data: payload });
              setTimeout(() => { startBtn.innerText = defaultBtnText; startBtn.disabled = false; }, 3000); // PATCHED
              return;
          }

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

              // The content script on that page will pick up 'reporterInfo' and 'piracy_cart'.
              startBtn.disabled = false;
              startBtn.innerText = defaultBtnText; // PATCHED
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

  // --- BOUNTY EVENTS (DOUBLE XP) TOGGLE ---
  const bountyBtn = document.getElementById('bountyBtn');
  const bountyContainer = document.getElementById('bounty-list-container');
  const bountyList = document.getElementById('bounty-list');
  
  if (bountyBtn) {
      bountyBtn.addEventListener('click', () => {
          if (bountyContainer.style.display === 'block') {
              bountyContainer.style.display = 'none';
              return;
          }
          bountyList.innerHTML = '';
          let foundBounties = false;
          if (configData && configData.verticals) {
              configData.verticals.forEach(v => {
                  (v.events || []).forEach(e => {
                      if (e.double_xp) {
                          foundBounties = true;
                          bountyList.innerHTML += `<li><strong>${v.name}:</strong> ${e.eventName || e.name}</li>`;
                      }
                  });
              });
          }
          if (!foundBounties) bountyList.innerHTML = '<li>No active bounties right now.</li>';
          bountyContainer.style.display = 'block';
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
const stopMacroBtn = document.getElementById('stopMacroBtn');
// Reuse the same platform select dropdown for macro recording
if (startMacroBtn && stopMacroBtn) {
    startMacroBtn.addEventListener('click', async () => {
        const platform = repairPlatformSelect ? repairPlatformSelect.value : 'tiktok';
        
        // Enter UI Recording State
          startMacroBtn.style.display = 'none';
          stopMacroBtn.style.display = 'inline-block';
          
          // ADD THE CLASS TO THE BODY FOR FLASHING BORDER
          document.body.classList.add('recording-active');
          if (recordingBadge) recordingBadge.style.display = 'inline-block';
          
          if (patchStatus) {
              patchStatus.style.color = "#ce0e2d";
              patchStatus.innerText = "🔴 RECORDING: Click elements on the video page.";
          }

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
              chrome.tabs.sendMessage(tab.id, { action: 'startMacroTraining', platform });
          }
      });

    stopMacroBtn.addEventListener('click', async () => {
        // UI Flip back
        startMacroBtn.style.display = 'inline-block';
        stopMacroBtn.style.display = 'none';
        
        document.body.classList.remove('recording-active');
          if (recordingBadge) recordingBadge.style.display = 'none';
          
          if (patchStatus) patchStatus.innerText = "Processing captured macro...";

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
              chrome.tabs.sendMessage(tab.id, { action: 'stopMacroTraining' });
          }
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
      
      // 1. Format the raw forensic log for verification
      const iframeSummary = (data?.iframes?.length > 0) ? data.iframes.map(i => `[IFRAME]: ${i}`).join('\n') : 'No Iframes';
      const videoSummary = (data?.videos?.length > 0) ? data.videos.map(v => `[VIDEO/SRC]: ${v}`).join('\n') : 'No Video Tags';
      const trafficSummary = (data?.networkTraffic?.length > 0) ? data.networkTraffic.map(t => `[NETWORK]: ${t.url} -> IP: ${t.ip}`).join('\n') : 'No Intercepted Traffic';
      
      const forensicLog = `SOURCE: ${data?.url || 'Unknown'}\n\n${iframeSummary}\n\n${videoSummary}\n\n${trafficSummary}`;
      const logArea = document.getElementById('rogueScrapedData');
      if (logArea) logArea.value = forensicLog;

      // 2. Format the DMCA Notice
      const iframesStr = (data?.iframes?.length > 0) ? data.iframes.join('\n') : 'None found';
      const sniffedStr = (data?.networkTraffic?.length > 0) ? data.networkTraffic.map(t => t.url).join('\n') : 'None found';
      const abuseEmails = (data?.emails?.length > 0) ? data.emails.join(', ') : '[INSERT ABUSE EMAIL]';
      const urlStr = data?.url || 'Unknown URL';
      
      if (dmcaNoticeArea) {
          dmcaNoticeArea.value = `Subject: DMCA Takedown Notice - FloSports\n\nTo Whom It May Concern (Abuse Dept: ${abuseEmails}),\n\nWe are contacting you on behalf of FloSports regarding unauthorized broadcasting of our copyrighted content.\n\nInfringing URL: ${urlStr}\nEmbedded Players/Iframes:\n${iframesStr}\nRaw Media Feeds:\n${sniffedStr}\n\nPlease remove or disable access to this material immediately.\n\nRegards,\nFloSports Anti-Piracy Team`;
      }
  }

  // Triggered when items are added to cart (Listener for processNewItem or similar)
  chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.piracy_cart) {
          evaluateWorkflowFocus(changes.piracy_cart.newValue?.length || 0);
      }
      if (namespace === 'local' && changes.rogue_target_data && changes.rogue_target_data.newValue) {
          renderRogueWalkthrough(changes.rogue_target_data.newValue);
      }
      // Listen for real-time changes to the report_mode from the options page
      if (namespace === 'sync' && changes.report_mode) {
          chrome.storage.local.get('piracy_cart', (res) => evaluateWorkflowFocus(res.piracy_cart?.length || 0));
      }
  });

      // Re-evaluate focus immediately when the user types or selects an option
  ['reporterName', 'verticalSelect', 'eventInput', 'sourceUrlDisplay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
          chrome.storage.local.get('piracy_cart', (res) => evaluateWorkflowFocus(res.piracy_cart?.length || 0));
      });
  });
function evaluateWorkflowFocus(cartSize) {
      // PATCH: Fetch mode first and set button text BEFORE any early returns
      chrome.storage.sync.get(['report_mode'], (syncRes) => {
          const isScout = (syncRes.report_mode || 'scout') === 'scout';
          const startBtn = document.getElementById('startBtn');
          if (startBtn) startBtn.innerText = isScout ? "Save to Log (Scout Mode)" : "Start Report";

          chrome.storage.local.get(['highlight_start_disabled'], (res) => {
              if (res.highlight_start_disabled) return;

              // Clear all existing spotlights
              document.querySelectorAll('.clippy-focus').forEach(el => el.classList.remove('clippy-focus'));
              
              if (cartSize === 0) {
                  const clippyText = document.getElementById('clippy-feedback-text');
                  if (clippyText) clippyText.innerText = "Open YouTube or TikTok and click '+ Add' on a video!";
                  return;
              }
              
              let missingFields = false;

              // Check all 4 fields independently to highlight them together
              if (!document.getElementById('reporterName').value.trim()) {
                  document.getElementById('reporterName').classList.add('clippy-focus');
                  missingFields = true;
              }
              if (!document.getElementById('verticalSelect').value) {
                  document.getElementById('verticalSelect').classList.add('clippy-focus');
                  missingFields = true;
              }
              if (!document.getElementById('eventInput').value.trim()) {
                  document.getElementById('eventInput').classList.add('clippy-focus');
                  missingFields = true;
              }
              if (!document.getElementById('sourceUrlDisplay').value.trim()) {
                  document.getElementById('sourceUrlDisplay').classList.add('clippy-focus');
                  missingFields = true;
              }

              const clippyText = document.getElementById('clippy-feedback-text');
              if (missingFields) {
                  if (clippyText) clippyText.innerText = "Please fill in all 4 highlighted boxes to continue.";
              } else {
                  if (startBtn) startBtn.classList.add('clippy-focus');
                  if (clippyText) clippyText.innerText = isScout ? "Ready! Click to save these links to the intelligence log." : "Ready! Click Start Report to generate your PDF.";
              }
          });
      });
  }

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

  // Handle the 'Save to Sheets' action for rogue infrastructure
  const rogueLogBtn = document.getElementById('saveRogueToSheetBtn');
  if (rogueLogBtn) {
      rogueLogBtn.addEventListener('click', () => {
          if (!currentRogueData) {
              alert("No scraped data available to save.");
              return;
          }

          // Unlock audio context instantly on click
          window.successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
          window.successAudio.play().then(() => window.successAudio.pause()).catch(()=>{});

          // Explicitly grab the latest notes from the UI
          const userNotes = document.getElementById('rogueUserNotes')?.value || "";

          rogueLogBtn.innerText = "Logging...";
          rogueLogBtn.disabled = true;

          // Call the correct background action specifically built for rogue sites
          chrome.runtime.sendMessage({ 
              action: "logRogueToSheet", 
              data: currentRogueData,
              notes: userNotes
          }, (res) => {
              if (res?.success) {
                  if (window.successAudio) {
                      window.successAudio.currentTime = 0;
                      window.successAudio.play().catch(e => console.log("Audio blocked:", e));
                  }
                  rogueLogBtn.innerText = "✅ Saved!";
                  setTimeout(() => {
                      rogueLogBtn.innerText = "Save to Pirate Websites Sheet"; 
                      rogueLogBtn.disabled = false; 
                      // Auto-close the walkthrough on success
                      if (closeRogueBtn) closeRogueBtn.click();
                  }, 1500);
              } else {
                  rogueLogBtn.innerText = "❌ Error (See Console)";
                  console.error("Rogue Log Error:", res?.error);
                  setTimeout(() => { 
                      rogueLogBtn.innerText = "Save to Pirate Websites Sheet"; 
                      rogueLogBtn.disabled = false; 
                  }, 2500);
              }
          });
      });
  }

  if (closeRogueBtn) {
      closeRogueBtn.addEventListener('click', () => {
          chrome.storage.local.remove('rogue_target_data');
          if (rogueWalkthrough) rogueWalkthrough.style.display = 'none';
          
          // Restore the main UI container as a flex element
          if (mainUiContainer) {
              mainUiContainer.style.display = 'flex';
          }
          // Restore the Nuke button to the default view
          if (nukeBtn) {
              nukeBtn.style.display = 'block';
          }
          // Reset forensic log display
          const logArea = document.getElementById('rogueScrapedData');
          if (logArea) logArea.value = "";
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
          nukeStreamBtn.style.cursor = isChecked ? 'pointer' : 'not-allowed';
      });

      // Listen for toggle changes
      rogueToggle.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          chrome.storage.local.set({ showNukeButton: isChecked });
          nukeStreamBtn.style.backgroundColor = isChecked ? '#ce0e2d' : '#1a1a1a';
          nukeStreamBtn.innerText = isChecked ? '☢️ 3rd Party Site Safety OFF' : '🛡️ 3rd Party Safety: ON';
          nukeStreamBtn.style.cursor = isChecked ? 'pointer' : 'not-allowed';
      });
  }
});
// --- AUTO-CRAWL LOGIC for Bulk Reporting ---
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
// This function can be called from background.js after each crawl attempt to continue the process
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
// --- Populate Verticals Dropdown ---
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