import { populateEventSelect, populateVerticalSelect } from '../utils/select_options.js';
import {
  PERMISSIONS,
  hasPermission,
  hasPlatformAccess,
  normalizeAccessPlatform
} from '../utils/access_control.js';
import { detectPlatformDetails } from '../utils/platforms.js';

const state = {
  configData: null,
  lastVertical: '',
  lastEvent: '',
  successAudio: null,
  accessProfile: null
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

  if (!(await enforceIdentity())) return;
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
      <p style="margin: 0 0 10px 0; font-size:13px;">Log in to the extension and obtain approved Report access.</p>
      <button id="flo-login-retry-pop" style="padding: 8px 15px; background: #ce0e2d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight:bold;">Open Settings</button>
      <div id="flo-lock-status-pop" style="margin-top:10px; font-size:12px; min-height:15px; color:#666;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('flo-login-retry-pop')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  return overlay;
}

async function enforceIdentity() {
  const overlay = ensureIdentityOverlay();

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAccessProfile', forceRefresh: true });
    const statusEl = document.getElementById('flo-lock-status-pop');
    const profile = response?.profile;

    if (response?.success && hasPermission(profile, PERMISSIONS.SIDEPANEL_REPORT)) {
      state.accessProfile = profile;
      overlay.style.display = 'none';
      return true;
    }

    overlay.style.display = 'flex';
    if (statusEl) {
      if (profile?.status === 'logged_out') {
        statusEl.innerText = 'Open Settings to log in or create a user.';
        statusEl.style.color = '#666';
      } else if (profile?.email) {
        statusEl.innerText = profile.status === 'waiting_approval'
          ? `Waiting for approval: ${profile.name || profile.email}`
          : `Access denied: ${profile.email}`;
        statusEl.style.color = 'red';
      } else {
        statusEl.innerText = response?.error || 'Google identity or access registry unavailable.';
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
    const response = await chrome.runtime.sendMessage({ action: 'getAccessProfile' });
    if (response?.success && hasPermission(response.profile, PERMISSIONS.SIDEPANEL_REPORT)) {
      const storage = await chrome.storage.local.get('piracy_cart');
      const cart = Array.isArray(storage.piracy_cart) ? storage.piracy_cart : [];
      const allTargetsAllowed = cart.every((item) => {
        const requestedPlatforms = new Set([
          normalizeAccessPlatform(item?.platform),
          detectPlatformDetails(item?.url || '').key
        ].filter((platform) => platform && platform !== 'all'));
        return [...requestedPlatforms].every((platform) => hasPlatformAccess(response.profile, platform));
      });

      if (allTargetsAllowed) return true;

      const overlay = ensureIdentityOverlay();
      overlay.style.display = 'flex';
      const statusEl = document.getElementById('flo-lock-status-pop');
      if (statusEl) {
        statusEl.innerText = 'Access denied: the queue contains a platform that is not assigned to your account.';
        statusEl.style.color = 'red';
      }
      return false;
    }
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

  if (dom.reporterName) {
    dom.reporterName.value = state.accessProfile?.name || storage.last_reporter || '';
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
