import { requestVerifiedRuntimeIdentity } from '../utils/runtime_identity.js';
import { ALLOWED_EMAIL_DOMAIN } from '../utils/extension_constants.js';
import { populateEventSelect, populateVerticalSelect } from '../utils/select_options.js';

const state = {
  configData: null,
  lastVertical: '',
  lastEvent: '',
  successAudio: null
};

document.addEventListener('DOMContentLoaded', () => {
  initializePopup().catch((error) => {
    console.error('Popup init failed:', error);
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.innerText = `Error: ${error.message}`;
      statusEl.style.color = 'red';
    }
  });
});

async function initializePopup() {
  const dom = getPopupDom();

  await enforceIdentity();
  bindPopupEvents(dom);
  bindProgressListener(dom);
  await hydrateSavedState(dom);
  await loadConfig(dom);
}

function getPopupDom() {
  return {
    cancelBtn: document.getElementById('cancelBtn'),
    eventSelect: document.getElementById('eventSelect'),
    formEl: document.getElementById('form'),
    loadingEl: document.getElementById('loading'),
    progressBar: document.getElementById('progress-bar'),
    progressContainer: document.getElementById('progress-container'),
    reportBtn: document.getElementById('reportBtn'),
    reporterName: document.getElementById('reporterName'),
    screenshotToggle: document.getElementById('screenshotToggle'),
    statusEl: document.getElementById('status'),
    verticalSelect: document.getElementById('verticalSelect'),
    videoCountEl: document.getElementById('video-count')
  };
}

function ensureIdentityOverlay() {
  const overlayId = 'flo-lock-overlay-pop';
  let overlay = document.getElementById(overlayId);

  if (overlay) return overlay;

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
      <p style="font-size: 11px; color: #666; margin-bottom: 15px; font-family:monospace; background:#eee; padding:4px; border-radius:4px;">${ALLOWED_EMAIL_DOMAIN}</p>
      <button id="flo-login-retry-pop" style="padding: 8px 15px; background: #ce0e2d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight:bold;">Check Account</button>
      <div id="flo-lock-status-pop" style="margin-top:10px; font-size:12px; min-height:15px; color:#666;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('flo-login-retry-pop')?.addEventListener('click', () => {
    const statusEl = document.getElementById('flo-lock-status-pop');
    if (statusEl) statusEl.innerText = 'Checking...';
    enforceIdentity();
  });

  return overlay;
}

async function enforceIdentity() {
  const overlay = ensureIdentityOverlay();

  try {
    const identity = await requestVerifiedRuntimeIdentity();
    const statusEl = document.getElementById('flo-lock-status-pop');

    if (identity.allowed) {
      overlay.style.display = 'none';
      return true;
    }

    overlay.style.display = 'flex';
    if (statusEl) {
      if (identity.email) {
        statusEl.innerText = `Logged in as: ${identity.email}`;
        statusEl.style.color = 'red';
      } else {
        statusEl.innerText = 'Not logged in.';
      }
    }

    return false;
  } catch (error) {
    console.error('Identity check failed:', error);
    return false;
  }
}

async function verifyAccessBeforeAction() {
  try {
    const identity = await requestVerifiedRuntimeIdentity();
    if (identity.allowed) return true;
  } catch (error) {
    console.error('Access verification failed:', error);
  }

  await enforceIdentity();
  return false;
}

function bindPopupEvents(dom) {
  dom.cancelBtn?.addEventListener('click', () => window.close());

  dom.verticalSelect?.addEventListener('change', () => {
    populateEvents(dom, dom.verticalSelect.value);
  });

  dom.reportBtn?.addEventListener('click', async () => {
    if (!(await verifyAccessBeforeAction())) return;

    state.successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
    state.successAudio.play().then(() => state.successAudio.pause()).catch(() => {});

    const reporterName = dom.reporterName?.value;
    const vertical = dom.verticalSelect?.value;
    const selectedEvent = dom.eventSelect?.selectedOptions?.[0];

    if (!reporterName || !vertical || !selectedEvent || dom.eventSelect.selectedIndex <= 0) {
      if (dom.statusEl) dom.statusEl.innerText = 'Please complete all fields.';
      return;
    }

    if (dom.statusEl) {
      dom.statusEl.innerText = 'Initializing...';
      dom.statusEl.style.color = '#666';
    }

    dom.reportBtn.disabled = true;
    if (dom.cancelBtn) dom.cancelBtn.disabled = true;
    if (dom.progressContainer) dom.progressContainer.style.display = 'block';
    if (dom.progressBar) dom.progressBar.style.width = '5%';

    await chrome.storage.local.set({
      last_reporter: reporterName,
      last_vertical: vertical,
      last_event: selectedEvent.value
    });

    chrome.runtime.sendMessage({
      action: 'processQueue',
      data: {
        reporterName,
        vertical,
        eventConfig: JSON.parse(selectedEvent.dataset.config),
        uploadScreenshots: dom.screenshotToggle?.checked
      }
    });
  });
}

function bindProgressListener(dom) {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'progressUpdate') {
      if (dom.progressContainer) dom.progressContainer.style.display = 'block';
      if (dom.progressBar) dom.progressBar.style.width = `${request.percent}%`;
      if (dom.statusEl) dom.statusEl.innerText = request.status;
      return;
    }

    if (request.action === 'progressComplete') {
      if (state.successAudio) {
        state.successAudio.currentTime = 0;
        state.successAudio.play().catch((error) => console.log('Audio blocked:', error));
      }

      if (dom.progressBar) dom.progressBar.style.width = '100%';
      if (dom.statusEl) {
        dom.statusEl.innerText = 'Success! All reports filed.';
        dom.statusEl.style.color = 'green';
      }
      if (dom.videoCountEl) dom.videoCountEl.innerText = '0';
      setTimeout(() => window.close(), 2000);
      return;
    }

    if (request.action === 'progressError') {
      if (dom.statusEl) {
        dom.statusEl.innerText = `Error: ${request.error}`;
        dom.statusEl.style.color = 'red';
      }
      if (dom.reportBtn) dom.reportBtn.disabled = false;
    }
  });
}

async function hydrateSavedState(dom) {
  const storage = await chrome.storage.local.get([
    'piracy_cart',
    'last_reporter',
    'last_vertical',
    'last_event'
  ]);

  const count = (storage.piracy_cart || []).length;
  if (dom.videoCountEl) dom.videoCountEl.innerText = String(count);

  if (count === 0 && dom.statusEl && dom.reportBtn) {
    dom.statusEl.innerText = 'Warning: Queue is empty.';
    dom.reportBtn.disabled = true;
  }

  if (storage.last_reporter && dom.reporterName) {
    dom.reporterName.value = storage.last_reporter;
  }

  state.lastVertical = storage.last_vertical || '';
  state.lastEvent = storage.last_event || '';
}

async function loadConfig(dom) {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (!response?.success) {
      if (dom.loadingEl) dom.loadingEl.innerText = `Config Error: ${response?.error || 'Unknown'}`;
      return;
    }

    state.configData = response.config;
    populateVerticals(dom);

    if (dom.loadingEl) dom.loadingEl.classList.add('hidden');
    if (dom.formEl) dom.formEl.classList.remove('hidden');
  } catch (error) {
    if (dom.loadingEl) dom.loadingEl.innerText = `Error: ${error.message}`;
  }
}

function populateVerticals(dom) {
  populateVerticalSelect(dom.verticalSelect, state.configData);

  if (!state.lastVertical || !dom.verticalSelect) return;

  dom.verticalSelect.value = state.lastVertical;
  populateEvents(dom, state.lastVertical);
}

function populateEvents(dom, verticalName) {
  populateEventSelect(dom.eventSelect, state.configData, verticalName, {
    lastValue: state.lastEvent,
    includeConfigDataset: true
  });
}
