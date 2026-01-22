import { getUserEmail } from './utils/auth.js';

let configData = null;
const ALLOWED_EMAIL = "social@flosports.tv";

// --- SECURITY CHECK ---
async function verifyAccessBeforeAction() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    if (chrome.runtime.lastError) {
        console.error("Runtime error:", chrome.runtime.lastError);
        return false;
    }
    const currentEmail = response && response.email ? response.email.toLowerCase().trim() : "";
    
    if (currentEmail !== ALLOWED_EMAIL) {
        // Optional: Show UI overlay if denied
        return false;
    }
    return true;
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
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const reporterInput = document.getElementById('reporterName');

  // 1. Load Config & Init
  try {
    // Check Auth first
    const emailRes = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' }).catch(err => null);
    
    if (!emailRes && chrome.runtime.lastError) {
        if (loadingEl) {
            loadingEl.innerHTML = "⚠️ <strong>Extension Context Invalidated</strong><br>Please close and reopen this side panel.";
            loadingEl.style.color = "red";
        }
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
      if (loadingEl) loadingEl.innerText = "Config Load Failed: " + (response?.error || "Unknown");
    }
  } catch (e) {
    console.error("Init error:", e);
    if (loadingEl) loadingEl.innerText = "Connection Failed. Reload Extension.";
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
              urlsToReport = cart.map(i => i.url);
          } else {
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
});

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
