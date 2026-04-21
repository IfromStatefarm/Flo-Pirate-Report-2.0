let configData = null;
const ALLOWED_EMAIL = "@flosports.tv";

// --- SECURITY LOCK OVERLAY (Duplicated for Popup context) ---
async function enforceIdentity() {
  const overlayId = 'flo-lock-overlay-pop';
  let overlay = document.getElementById(overlayId);
  
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(255, 255, 255, 0.98); z-index: 2147483647 !important;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; color: #333; font-family: sans-serif;
      backdrop-filter: blur(5px);
    `;
    overlay.innerHTML = `
      <div style="background:white; padding:20px; border-radius:8px; border:2px solid #ce0e2d; box-shadow:0 4px 15px rgba(0,0,0,0.2); width: 80%;">
        <h3 style="color: #ce0e2d; margin: 0 0 10px 0;">Restricted</h3>
        <p style="margin: 0 0 10px 0; font-size:13px;">Please log into the <strong>Copyright Profile</strong>.</p>
        <p style="font-size: 11px; color: #666; margin-bottom: 15px; font-family:monospace; background:#eee; padding:4px; border-radius:4px;">${ALLOWED_EMAIL}</p>
        <button id="flo-login-retry-pop" style="padding: 8px 15px; background: #ce0e2d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight:bold;">Check Account</button>
        <div id="flo-lock-status-pop" style="margin-top:10px; font-size:12px; min-height:15px; color:#666;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('flo-login-retry-pop').addEventListener('click', () => {
        document.getElementById('flo-lock-status-pop').innerText = "Checking...";
        enforceIdentity();
    });
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    const currentEmail = response && response.email ? response.email.toLowerCase().trim() : "";

    if (currentEmail.endsWith("@flosports.tv")) {
      overlay.style.display = 'none'; // Unlocked
      return true;
    } else {
      overlay.style.display = 'flex'; // Locked
      const status = document.getElementById('flo-lock-status-pop');
      if (currentEmail) {
         status.innerText = `Logged in as: ${currentEmail}`;
         status.style.color = "red";
      } else {
         status.innerText = "Not logged in.";
      }
      return false;
    }
  } catch (e) { 
      console.error(e);
      return false;
  }
}

// FAIL-SAFE
async function verifyAccessBeforeAction() {
    const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    const currentEmail = response && response.email ? response.email.toLowerCase().trim() : "";
    if (!currentEmail.endsWith("@flosports.tv")) {
        enforceIdentity(); // Re-trigger lock if somehow bypassed
        return false;
    }
    return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. RUN SECURITY CHECK IMMEDIATELY
  await enforceIdentity();

  const cancelBtn = document.getElementById('cancelBtn');
  const reportBtn = document.getElementById('reportBtn');
  const videoCountEl = document.getElementById('video-count');
  const statusEl = document.getElementById('status');
  const loadingEl = document.getElementById('loading');
  const formEl = document.getElementById('form');
  const progContainer = document.getElementById('progress-container');
  const progBar = document.getElementById('progress-bar');

  if (cancelBtn) cancelBtn.addEventListener('click', () => window.close());

  // Listen for Progress Updates from Background
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'progressUpdate') {
      if (progContainer) progContainer.style.display = 'block';
      if (progBar) progBar.style.width = request.percent + '%';
      if (statusEl) statusEl.innerText = request.status;
    }
    if (request.action === 'progressComplete') {
      if (window.successAudio) {
          window.successAudio.currentTime = 0;
          window.successAudio.play().catch(e => console.log("Audio blocked:", e));
      }
      if (progBar) progBar.style.width = '100%';
      if (statusEl) {
         statusEl.innerText = "Success! All reports filed.";
         statusEl.style.color = "green";
      }
      // Reset video count immediately
      if (videoCountEl) videoCountEl.innerText = "0";
      setTimeout(() => window.close(), 2000);
    }
    if (request.action === 'progressError') {
      if (statusEl) {
          statusEl.innerText = "Error: " + request.error;
          statusEl.style.color = "red";
      }
      if (reportBtn) reportBtn.disabled = false;
    }
  });

  // Load State
  chrome.storage.local.get(['piracy_cart', 'last_reporter', 'last_vertical', 'last_event'], (res) => {
    const count = (res.piracy_cart || []).length;
    if (videoCountEl) videoCountEl.innerText = count;
    
    if (count === 0 && statusEl && reportBtn) {
      statusEl.innerText = "Warning: Queue is empty.";
      reportBtn.disabled = true;
    }
    if (res.last_reporter) document.getElementById('reporterName').value = res.last_reporter;
    window.lastVertical = res.last_vertical;
    window.lastEvent = res.last_event;
  });

  // Load Config
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success) {
      configData = response.config;
      populateVerticals();
      if (loadingEl) loadingEl.classList.add('hidden');
      if (formEl) formEl.classList.remove('hidden');
    } else {
      if (loadingEl) loadingEl.innerText = "Config Error: " + (response ? response.error : "Unknown");
    }
  } catch (e) { if (loadingEl) loadingEl.innerText = "Error: " + e.message; }

  // Submit Logic
  if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
      // --- SECURITY CHECK BEFORE SUBMIT ---
      if (!(await verifyAccessBeforeAction())) return;

      // Unlock audio context instantly on click
      window.successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
      window.successAudio.play().then(() => window.successAudio.pause()).catch(()=>{});

      const reporterName = document.getElementById('reporterName').value;
      const vertical = document.getElementById('verticalSelect').value;
      const eventSelect = document.getElementById('eventSelect');
      
      if (!reporterName || !vertical || eventSelect.selectedIndex <= 0) {
        if (statusEl) statusEl.innerText = "Please complete all fields.";
        return;
      }

      // Lock UI
      statusEl.innerText = "Initializing...";
      reportBtn.disabled = true;
      cancelBtn.disabled = true;
      progContainer.style.display = 'block';
      progBar.style.width = '5%'; // Start slightly filled

      chrome.storage.local.set({
        last_reporter: reporterName,
        last_vertical: vertical,
        last_event: eventSelect.value
      });

      const payload = {
        reporterName,
        vertical,
        eventConfig: JSON.parse(eventSelect.selectedOptions[0].dataset.config),
        uploadScreenshots: document.getElementById('screenshotToggle').checked
      };

      // Trigger Background Process
      chrome.runtime.sendMessage({ action: 'processQueue', data: payload });
    });
  }
});

function populateVerticals() {
  const vSelect = document.getElementById('verticalSelect');
  if (!vSelect) return;
  vSelect.innerHTML = '<option value="">Select Vertical...</option>';
  
  if (configData && configData.verticals) {
    configData.verticals.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.innerText = v.name;
      vSelect.appendChild(opt);
    });
  }

  if (window.lastVertical) {
    vSelect.value = window.lastVertical;
    populateEvents(window.lastVertical); 
  }

  vSelect.addEventListener('change', () => {
    populateEvents(vSelect.value);
  });
}

function populateEvents(verticalName) {
  const vSelect = document.getElementById('verticalSelect');
  const selectedV = configData.verticals.find(v => v.name === verticalName);
  const eSelect = document.getElementById('eventSelect');
  if (!eSelect) return;
  eSelect.innerHTML = '<option value="">Select Event...</option>';
  eSelect.disabled = false;
  
  if (selectedV && selectedV.events) {
    selectedV.events.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.eventName;
      opt.innerText = e.eventName;
      opt.dataset.config = JSON.stringify(e);
      eSelect.appendChild(opt);
    });
  }

  if (window.lastEvent) {
    const exists = Array.from(eSelect.options).some(o => o.value === window.lastEvent);
    if (exists) eSelect.value = window.lastEvent;
  }
}
