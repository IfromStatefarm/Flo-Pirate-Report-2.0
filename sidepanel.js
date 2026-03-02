// sidepanel.js
import { getUserEmail } from './utils/auth.js';

let isCrawling = false;
let consecutiveFailures = 0;
let crawlQueue = [];
let configData = null;
const ALLOWED_EMAIL = "social@flosports.tv";

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('loading');
  const verticalSelect = document.getElementById('verticalSelect');
  const eventInput = document.getElementById('eventInput');
  const eventList = document.getElementById('eventList');
  const startBtn = document.getElementById('startBtn');
  const grabBtn = document.getElementById('btn-grab-flo');
  const sourceDisplay = document.getElementById('sourceUrlDisplay');
  const closerBtn = document.getElementById('testCloserBtn');
  const crawlBtn = document.getElementById('autoCrawlBtn');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const searchEventBtn = document.getElementById('searchEventBtn');
  const reporterInput = document.getElementById('reporterName');
  const crawlStatusEl = document.getElementById('crawlStatus');
  const startRowInput = document.getElementById('startRowInput');
  const closerStatusEl = document.getElementById('closerStatus'); 
  
  // Create Stop Button dynamically if not present
  let stopCloserBtn = document.getElementById('stopCloserBtn');
  if (!stopCloserBtn && closerBtn) {
      stopCloserBtn = document.createElement('button');
      stopCloserBtn.id = 'stopCloserBtn';
      stopCloserBtn.className = 'btn';
      stopCloserBtn.style.backgroundColor = '#e74c3c'; // Red
      stopCloserBtn.style.marginTop = '5px';
      stopCloserBtn.style.fontSize = '11px';
      stopCloserBtn.style.padding = '8px';
      stopCloserBtn.innerText = 'Stop Scanner';
      stopCloserBtn.style.display = 'none';
      if(closerBtn.parentNode && closerBtn.parentNode.parentNode) {
          closerBtn.parentNode.parentNode.insertBefore(stopCloserBtn, closerStatusEl);
      }
  }

  // --- Message Listener for Crawler & Closer ---
  chrome.runtime.onMessage.addListener((msg) => {
    // Closer Status Update
    if (msg.action === 'closerProgress') {
        if (closerStatusEl) {
            closerStatusEl.style.display = 'block';
            closerStatusEl.innerHTML = `<strong>${msg.status}</strong><br>${msg.details || ''}`;
            
            // If running, show stop button
            if (!msg.status.includes("Complete") && !msg.status.includes("Stop") && !msg.status.includes("Failed")) {
                 if (closerBtn) closerBtn.style.display = 'none';
                 if (stopCloserBtn) stopCloserBtn.style.display = 'block';
            } else {
                 // Stopped/Done
                 if (closerBtn) {
                     closerBtn.style.display = 'block';
                     closerBtn.disabled = false;
                     closerBtn.innerText = 'Run "The Closer"';
                 }
                 if (stopCloserBtn) stopCloserBtn.style.display = 'none';
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
    
    if (currentEmail !== ALLOWED_EMAIL) {
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

  // Copy Tool
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
       const txt = `Content stolen from ${eventInput ? eventInput.value : ""}. Original source: ${sourceDisplay ? sourceDisplay.value : ""}`;
       navigator.clipboard.writeText(txt);
       copyUrlBtn.innerText = "Copied!";
       setTimeout(() => copyUrlBtn.innerText = 'Copy "Stolen From" Text', 2000);
    });
  }

  // --- Test Closer Button ---
  if (closerBtn) {
      closerBtn.addEventListener('click', async () => {
          const startVal = startRowInput ? startRowInput.value : 1;
          const startRow = parseInt(startVal) || 1;

          closerBtn.innerText = "Starting...";
          closerBtn.disabled = true;
          if(closerStatusEl) closerStatusEl.style.display = 'block';
          if(closerStatusEl) closerStatusEl.innerText = "Initializing Scanner...";
          
          chrome.runtime.sendMessage({ action: 'triggerCloser', startRow: startRow }, (res) => {
              if (chrome.runtime.lastError) {
                  closerBtn.innerText = "Error (Reload Panel)";
                  closerBtn.disabled = false;
                  if(closerStatusEl) closerStatusEl.innerText = "Error: " + chrome.runtime.lastError.message;
                  return;
              }
          });
      });
  }

  // --- Stop Closer Button Listener ---
  if (stopCloserBtn) {
      stopCloserBtn.addEventListener('click', () => {
          stopCloserBtn.innerText = "Stopping...";
          stopCloserBtn.disabled = true;
          chrome.runtime.sendMessage({ action: 'stopSheetScanner' });
      });
  }

  // --- CRAWLER BUTTON LOGIC ---
  if (crawlBtn) {
      crawlBtn.addEventListener('click', async () => {
          if (isCrawling) {
              stopCrawl("Stopped by user.");
              return;
          }

          const vertical = verticalSelect.value;
          if (!vertical) {
              alert("Please select a Vertical first.");
              return;
          }

          crawlStatusEl.innerText = "Fetching sheet data...";
          crawlBtn.disabled = true;

          const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
          
          if (!response || !response.success) {
              crawlStatusEl.innerText = "Error fetching data.";
              crawlBtn.disabled = false;
              return;
          }

          const allEvents = Object.values(response.data.eventMap);
          allEvents.sort((a, b) => a.rowIndex - b.rowIndex);

          crawlQueue = allEvents.filter(e => !e.urls.tiktok || e.urls.tiktok.trim() === "");

          if (crawlQueue.length === 0) {
              crawlStatusEl.innerText = "No empty TikTok cells found.";
              crawlBtn.disabled = false;
              return;
          }

          isCrawling = true;
          consecutiveFailures = 0;
          crawlBtn.disabled = false;
          crawlBtn.innerText = "Stop Auto-Crawl";
          crawlBtn.style.backgroundColor = "#e74c3c";
          
          crawlStatusEl.innerText = `Queue: ${crawlQueue.length} events. Starting...`;
          
          processNextCrawlItem();
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