mport { getUserEmail } from './utils/auth.js';

let configData = null;
const ALLOWED_EMAIL = "social@flosports.tv";

// --- CRAWLER STATE ---
let isCrawling = false;
let crawlQueue = [];
let consecutiveFailures = 0;

// --- GLOBAL ERROR LISTENER (Moved from HTML) ---
window.addEventListener('error', function(e) {
  if (e.message && (
      e.message.includes('Extension context invalidated') || 
      e.message.includes('BLOCKED_BY_CLIENT')
  )) {
     const loading = document.getElementById('loading');
     if (loading) {
       loading.innerHTML = "⚠️ <strong>Extension Reloaded</strong><br>Please close and reopen this panel.";
       loading.style.color = "#ce0e2d";
       loading.style.border = "1px solid #ce0e2d";
       loading.style.padding = "10px";
       loading.style.background = "#fff0f0";
       loading.style.borderRadius = "4px";
     }
  }
}, true);

// --- SECURITY CHECK ---
async function verifyAccessBeforeAction() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    if (chrome.runtime.lastError) return false;
    
    const currentEmail = response && response.email ? response.email.toLowerCase().trim() : "";
    return currentEmail === ALLOWED_EMAIL;
  } catch (e) {
    console.error("Auth check failed:", e);
    return false;
  }
}

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
  const reporterInput = document.getElementById('reporterName');
  const crawlStatusEl = document.getElementById('crawlStatus');

  // --- Message Listener for Crawler ---
  chrome.runtime.onMessage.addListener((msg) => {
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
    // Check Auth first
    // Add a timeout to prevent infinite hanging
    const authPromise = chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    
    const emailRes = await Promise.race([authPromise, timeoutPromise]).catch(err => null);
    
    if (!emailRes && chrome.runtime.lastError) {
        showInitError("Extension context invalidated. Please reopen.");
        return;
    }
    
    if (!emailRes) {
         // Timeout or silent fail
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
          // Trigger change manually to load events
          if (configData) populateEvents(res.last_vertical, eventList);
      }
  });

  // 2. Event Listeners
  if (verticalSelect) {
      verticalSelect.addEventListener('change', () => {
          populateEvents(verticalSelect.value, eventList);
          chrome.storage.local.set({ last_vertical: verticalSelect.value });
      });
  }

  if (reporterInput) {
      reporterInput.addEventListener('change', () => {
          chrome.storage.local.set({ last_reporter: reporterInput.value });
      });
  }

  // Grab Source URL from current tab
  if (grabBtn) {
      grabBtn.addEventListener('click', async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url) {
              if (sourceDisplay) sourceDisplay.value = tab.url;
          }
      });
  }

  // Start Report
  if (startBtn) {
      startBtn.addEventListener('click', async () => {
          const reporterName = reporterInput.value;
          const vertical = verticalSelect.value;
          const eventName = eventInput.value;
          const sourceUrl = sourceDisplay.value;

          if (!reporterName || !vertical || !eventName) {
              alert("Please fill in Reporter, Vertical, and Event Name.");
              return;
          }

          startBtn.disabled = true;
          startBtn.innerText = "Submitting...";

          // Construct Payload
          let urlsToReport = [];
          
          const storage = await chrome.storage.local.get('piracy_cart');
          const cart = storage.piracy_cart || [];
          
          if (cart.length > 0) {
              // Report cart
              urlsToReport = cart.map(i => i.url);
          } else {
              // If cart empty, check if user input a "Source URL" (Infringing?)
              // The label says "Source URL", usually implying "Where it was stolen FROM".
              // Let's assume for now this panel triggers the batch report of the cart.
              // If cart is empty, we alert.
              alert("Queue is empty. Use the 'Add' buttons on video pages first.");
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              return;
          }

          const payload = {
              reporterName,
              vertical,
              eventName,
              urls: urlsToReport 
          };
          
          chrome.runtime.sendMessage({ action: 'logToSheet', data: payload }, (res) => {
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              
              if (chrome.runtime.lastError) {
                  alert("Communication Error: " + chrome.runtime.lastError.message);
                  return;
              }

              if (res && res.success) {
                  alert("✅ Report Logged Successfully!");
                  // clear form?
              } else {
                  alert("❌ Error: " + (res ? res.error : "Unknown"));
              }
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
          closerBtn.innerText = "Running...";
          closerBtn.disabled = true;
          
          chrome.runtime.sendMessage({ action: 'triggerCloser' }, (res) => {
              if (chrome.runtime.lastError) {
                  closerBtn.innerText = "Error (Reload Panel)";
                  return;
              }

              if (res && res.success) {
                  closerBtn.innerText = "Check Started";
              } else {
                  closerBtn.innerText = "Failed";
              }
              
              setTimeout(() => {
                  closerBtn.innerText = 'Run "The Closer" (Check Status)';
                  closerBtn.disabled = false;
              }, 3000);
          });
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

          // Fetch event data to identify blank rows
          const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
          
          if (!response || !response.success) {
              crawlStatusEl.innerText = "Error fetching data.";
              crawlBtn.disabled = false;
              return;
          }

          // Filter for events that lack a TikTok URL
          // eventMap is { "key": { name: "Name", urls: { tiktok: "...", ... } } }
          const allEvents = Object.values(response.data.eventMap);
          
          // Sort by row index to ensure we process in order
          allEvents.sort((a, b) => a.rowIndex - b.rowIndex);

          crawlQueue = allEvents.filter(e => !e.urls.tiktok || e.urls.tiktok.trim() === "");

          if (crawlQueue.length === 0) {
              crawlStatusEl.innerText = "No empty TikTok cells found.";
              crawlBtn.disabled = false;
              return;
          }

          // Start
          isCrawling = true;
          consecutiveFailures = 0;
          crawlBtn.disabled = false;
          crawlBtn.innerText = "Stop Auto-Crawl";
          crawlBtn.style.backgroundColor = "#e74c3c"; // Red for stop
          
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

function populateEvents(verticalName, dataListEl) {
  if (!dataListEl) return;
  dataListEl.innerHTML = '';
  
  const selectedV = configData.verticals.find(v => v.name === verticalName);
  if (selectedV && selectedV.events) {
    selectedV.events.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.eventName;
      dataListEl.appendChild(opt);
    });
  }
}
