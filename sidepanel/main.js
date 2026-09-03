import { getUserEmail } from '../utils/auth.js';
import { SIDEPANEL_CLIPPY_PHRASES } from '../utils/extension_constants.js';
import { renderGamificationStats } from '../utils/gamification_ui.js';
import { detectPlatformDetails, getSupportedPlatforms } from '../utils/platforms.js';
import {
  PERMISSIONS,
  hasPermission,
  hasPlatformAccess,
  normalizeAccessPlatform,
  roleLabel
} from '../utils/access_control.js';
import { populateVerticalSelect } from '../utils/select_options.js';

let isCrawling = false;
let consecutiveFailures = 0;
let crawlQueue = [];
let configData = null;
let currentAccessProfile = null;
let sidepanelAccessRefreshScheduled = false;
const SIDEPANEL_SETUP_KEYS = ['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'];
const ENFORCER_ALLOWED_EMAILS = ['social@flosports.tv', 'copyright@flosports.tv', 'copyrights@flosports.tv'];
const ENFORCER_PLATFORM_DEFAULTS = Object.freeze({
  youtube: {
    authorizedHandles: [
      '@flosocial4531',
      '@floelite',
      '@flocollegevolleyball',
      '@florugby',
      '@flocollegebasketball',
      '@floflomarching',
      '@florodeo',
      '@floracingwk4fk',
      '@flogrppling',
      '@floswimming',
      '@milesplit',
      '@flovoice',
      '@floclimbing1847',
      '@flobowling',
      '@flodance',
      '@flodragracing',
      '@flosports'
    ],
    authorizedChannelIds: [
      'uci1khgc-guvaoej1qpy7sba',
      'ucjemiyjzlelf1xmfuzemzq',
      'ucjl8uhcmj3gfmtde5_miggg',
      'uc3mj0nm-7groyzuqgo-lhmq',
      'ucjfcsyefs4g-rjhxzoba9ng',
      'ucbcjdshcwmyzvyofmqfot8q',
      'ucanzxt5pmv8phtmsnavn7qg',
      'ucx7mxflg3dxdjtzi5mjriow',
      'ucngvn3lc9pnoovjsq9x-ldq',
      'ucrroh-g-vdcl57u-agy3ymq',
      'uc80xbt9erxjjdlvmter1toq',
      'ucj8-bad2gi7cn4zuans8qjg',
      'uc4qlqyxfiebf-xuxrhrbjfg',
      'ucfjgrug4y7t3zf6fy38mauw'
    ],
    authorizedStudioManagerIds: [
      'vcbdhoyo0l5szyprzc85ia',
      'an9wotyzuy413s3j75rs0a'
    ]
  },
  tiktok: {
    authorizedHandles: [
      '@flosocial3'
    ]
  }
});

<<<<<<< Updated upstream
const ENFORCER_PLATFORM_ACCESS_MESSAGE = "Access Denied: Enforcer mode requires social@flosports.tv, copyright@flosports.tv, copyrights@flosports.tv, or an approved FloSports platform account session.";
=======
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sender;
  if (message.action !== 'refreshSidepanelAccessView') return false;

  sendResponse({ success: true });
  if (!sidepanelAccessRefreshScheduled) {
    sidepanelAccessRefreshScheduled = true;
    setTimeout(() => window.location.reload(), 0);
  }
  return false;
});

const ENFORCER_PLATFORM_ACCESS_MESSAGE = "Access Denied: Enforcer mode requires social@flosports.tv, copyright@flosports.tv, copyrights@flosports.tv, ivan.mcclay@flosports.tv, or an approved FloSports platform account session.";
>>>>>>> Stashed changes
const ENFORCER_SESSION_SELECTOR_DEFAULTS = Object.freeze({
  youtube: {
    channelHandle: [
      'yt-formatted-string#channel-handle',
      'ytd-active-account-header-renderer yt-formatted-string#channel-handle'
    ],
    accountMenuTrigger: [
      'button#avatar-btn',
      '#avatar-btn',
      'button[aria-label*="account" i]',
      'button[aria-label*="channel" i]'
    ],
    candidateAnchors: [
      'ytd-guide-renderer a[href]',
      'ytd-mini-guide-renderer a[href]',
      'ytd-popup-container a[href]',
      'ytd-masthead a[href]',
      'tp-yt-paper-dialog a[href]'
    ]
  },
  tiktok: {
    accountHandle: [
      'a[data-e2e="nav-profile"]',
      '[data-e2e="nav-profile"] a[href]',
      'header a[href^="/@"]',
      'nav a[href^="/@"]',
      '[data-e2e*="profile"] a[href^="/@"]'
    ]
  }
});

function toSelectorList(value, fallback = []) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const selectors = values
    .map((entry) => (typeof entry === 'string' ? entry : entry?.selector))
    .filter(Boolean);
  return selectors.length > 0 ? selectors : fallback;
}

function toValueList(value, fallback = []) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const parsedValues = values
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return entry?.value || entry?.handle || entry?.id || entry?.channel_id || entry?.manager_id || '';
    })
    .filter(Boolean);
  return parsedValues.length > 0 ? parsedValues : fallback;
}

function getEnforcerAccessConfig() {
  const platformSelectors = configData?.platform_selectors || {};
  const youtubeSession = platformSelectors.youtube?.session || {};
  const tiktokSession = platformSelectors.tiktok?.session || {};

  return {
    youtube: {
      authorizedHandles: toValueList(
        youtubeSession.authorized_handles || youtubeSession.approved_handles,
        ENFORCER_PLATFORM_DEFAULTS.youtube.authorizedHandles
      ),
      authorizedChannelIds: toValueList(
        youtubeSession.authorized_channel_ids || youtubeSession.approved_channel_ids,
        ENFORCER_PLATFORM_DEFAULTS.youtube.authorizedChannelIds
      ),
      authorizedStudioManagerIds: toValueList(
        youtubeSession.authorized_studio_manager_ids || youtubeSession.approved_studio_manager_ids || youtubeSession.authorized_studio_ids,
        ENFORCER_PLATFORM_DEFAULTS.youtube.authorizedStudioManagerIds
      ),
      channelHandle: toSelectorList(
        youtubeSession.channel_handle || youtubeSession.account_handle || youtubeSession.handle,
        ENFORCER_SESSION_SELECTOR_DEFAULTS.youtube.channelHandle
      ),
      accountMenuTrigger: toSelectorList(
        youtubeSession.account_menu_trigger || youtubeSession.menu_trigger,
        ENFORCER_SESSION_SELECTOR_DEFAULTS.youtube.accountMenuTrigger
      ),
      candidateAnchors: toSelectorList(
        youtubeSession.candidate_anchors || youtubeSession.anchor_selectors,
        ENFORCER_SESSION_SELECTOR_DEFAULTS.youtube.candidateAnchors
      )
    },
    tiktok: {
      authorizedHandles: toValueList(
        tiktokSession.authorized_handles || tiktokSession.approved_handles,
        ENFORCER_PLATFORM_DEFAULTS.tiktok.authorizedHandles
      ),
      accountHandle: toSelectorList(
        tiktokSession.account_handle || tiktokSession.handle,
        ENFORCER_SESSION_SELECTOR_DEFAULTS.tiktok.accountHandle
      )
    }
  };
}

<<<<<<< Updated upstream
let gamificationStatsInFlight = false;

function createUnavailableGamificationStats(errorMessage = '') {
  return {
    error: true,
    errorMessage: String(errorMessage || ''),
    stale: false,
    scoutPoints: 0,
    enforcerPoints: 0,
    scoutRank: 'Offline',
    enforcerRank: 'Offline',
    teamTotal: 0,
    topScouts: [],
    topEnforcers: [],
    overallLeaderboard: [],
    mvp: { name: 'TBD', points: 0 },
    isCurrentMvp: false
  };
=======
function canUseScoutMode() {
  return hasPermission(currentAccessProfile, PERMISSIONS.SIDEPANEL_REPORT);
>>>>>>> Stashed changes
}

function refreshGamificationStats() {
  if (gamificationStatsInFlight) return;

  gamificationStatsInFlight = true;
  chrome.runtime.sendMessage({ action: 'getGamificationStats' }, (stats) => {
    gamificationStatsInFlight = false;

    if (chrome.runtime.lastError) {
      console.warn('Leaderboard refresh failed:', chrome.runtime.lastError.message);
      renderGamificationStats(createUnavailableGamificationStats(chrome.runtime.lastError.message));
      return;
    }

    if (!stats || stats.success === false) {
      renderGamificationStats(createUnavailableGamificationStats(stats?.error || 'Leaderboard unavailable.'));
      return;
    }

    renderGamificationStats(stats);
  });
}

function isApprovedEnforcerPlatformUrl(url, accessConfig = getEnforcerAccessConfig()) {
  const normalizedUrl = String(url || '').toLowerCase();
  if (!normalizedUrl) return false;

  const youtubeHandles = (accessConfig.youtube?.authorizedHandles || []).map((handle) => String(handle).toLowerCase());
  const youtubeChannelIds = (accessConfig.youtube?.authorizedChannelIds || []).map((channelId) => String(channelId).toLowerCase());
  const youtubeStudioIds = (accessConfig.youtube?.authorizedStudioManagerIds || []).map((managerId) => String(managerId).toLowerCase());
  const tiktokHandles = (accessConfig.tiktok?.authorizedHandles || []).map((handle) => String(handle).toLowerCase());

  const hasApprovedYouTubeHandle = youtubeHandles.some((handle) => normalizedUrl.includes(handle));
  const hasApprovedChannelId = youtubeChannelIds.some((channelId) => normalizedUrl.includes(channelId));
  const hasApprovedStudioId = youtubeStudioIds.some((managerId) => normalizedUrl.includes(managerId));
  const hasApprovedTikTokHandle = tiktokHandles.some((handle) => normalizedUrl.includes(handle));

  const isApprovedYouTube =
    (normalizedUrl.includes('youtube.com') || normalizedUrl.includes('youtu.be') || normalizedUrl.includes('studio.youtube.com')) &&
    (hasApprovedYouTubeHandle || hasApprovedChannelId || hasApprovedStudioId);

  const isApprovedTikTok =
    normalizedUrl.includes('tiktok.com') &&
    hasApprovedTikTokHandle;

  return isApprovedYouTube || isApprovedTikTok;
}

function isEnforcerPlatformTabUrl(url) {
  const normalizedUrl = String(url || '').toLowerCase();
  return normalizedUrl.includes('youtube.com') ||
    normalizedUrl.includes('youtu.be') ||
    normalizedUrl.includes('studio.youtube.com') ||
    normalizedUrl.includes('tiktok.com');
}

function isEnforcerAllowlistExemptPlatform(platformKey) {
  const normalizedPlatform = String(platformKey || '').toLowerCase();
  return normalizedPlatform === 'tiktok' || normalizedPlatform === 'instagram';
}

function getManualReportingMessage(platformDetails) {
  if (platformDetails?.key === 'rumble') {
    return 'Rumble uses the on-page report menu instead of a separate complaint form. Start the Rumble queue from the side panel so Pirate AI can open each URL and submit the copyright report from that video page.';
  }

  return 'Auto-reporting is currently optimized for TikTok, X (Twitter), and YouTube. Please manually report other platforms.';
}

async function tabHasApprovedEnforcerSession(tabId, accessConfig = getEnforcerAccessConfig()) {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: async (sessionAccessConfig) => {
        const normalize = (value) => String(value || '').trim().toLowerCase();
        const currentUrl = normalize(window.location.href);
        const isYouTube = currentUrl.includes('youtube.com') || currentUrl.includes('youtu.be') || currentUrl.includes('studio.youtube.com');
        const isTikTok = currentUrl.includes('tiktok.com');
        const platformConfig = sessionAccessConfig || {};
        const approvedYouTubeHandles = (platformConfig.youtube?.authorizedHandles || []).map(normalize).filter(Boolean);
        const approvedChannelIds = (platformConfig.youtube?.authorizedChannelIds || []).map(normalize).filter(Boolean);
        const approvedStudioIds = (platformConfig.youtube?.authorizedStudioManagerIds || []).map(normalize).filter(Boolean);
        const approvedTikTokHandles = (platformConfig.tiktok?.authorizedHandles || []).map(normalize).filter(Boolean);

        const candidateStrings = [];
        const pushCandidate = (value) => {
          if (value == null) return;
          if (Array.isArray(value)) {
            value.forEach(pushCandidate);
            return;
          }

          if (typeof value === 'object') {
            try {
              candidateStrings.push(JSON.stringify(value));
            } catch (error) {
              // Ignore unserializable values from page globals.
            }
            return;
          }

          candidateStrings.push(String(value));
        };

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const selectorList = (selectors) => Array.isArray(selectors) ? selectors.filter(Boolean) : [];
        const findFirstElement = (selectors) => {
          for (const selector of selectorList(selectors)) {
            try {
              const element = document.querySelector(selector);
              if (element) return element;
            } catch (error) {
              // Ignore invalid selectors from remote config.
            }
          }
          return null;
        };
        const scanSelectors = (selectors) => {
          selectorList(selectors).forEach((selector) => {
            let elements = [];
            try {
              elements = Array.from(document.querySelectorAll(selector));
            } catch (error) {
              return;
            }
            elements.forEach((el) => {
              pushCandidate(el.href || el.getAttribute?.('href'));
              pushCandidate(el.getAttribute?.('title'));
              pushCandidate(el.getAttribute?.('aria-label'));
              pushCandidate(el.getAttribute?.('alt'));
              pushCandidate(el.dataset);
              pushCandidate(el.textContent?.trim());
            });
          });
        };

        if (isYouTube) {
          const ytcfgGet = typeof window.ytcfg?.get === 'function' ? (key) => window.ytcfg.get(key) : () => undefined;
          const isLoggedIn = Boolean(ytcfgGet('LOGGED_IN') ?? window.ytcfg?.data_?.LOGGED_IN);
          if (!isLoggedIn) return false;

          pushCandidate(ytcfgGet('DELEGATED_SESSION_ID'));
          pushCandidate(window.ytcfg?.data_?.DELEGATED_SESSION_ID);
          scanSelectors(platformConfig.youtube?.channelHandle);
          scanSelectors(platformConfig.youtube?.candidateAnchors);

          const hasApprovedHandleBeforeMenu = candidateStrings
            .map(normalize)
            .filter(Boolean)
            .some((candidate) => approvedHandles.some((handle) => candidate.includes(handle)));

          if (!hasApprovedHandleBeforeMenu) {
            const trigger = findFirstElement(platformConfig.youtube?.accountMenuTrigger);
            if (trigger) {
              trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              await wait(250);
              scanSelectors(platformConfig.youtube?.channelHandle);
              scanSelectors(platformConfig.youtube?.candidateAnchors);
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
          }
        }

        if (isTikTok) {
          scanSelectors(platformConfig.tiktok?.accountHandle);
        }

        const normalizedCandidates = candidateStrings
          .map(normalize)
          .filter(Boolean);

        const hasApprovedYouTubeHandle = normalizedCandidates.some((candidate) => approvedYouTubeHandles.some((handle) => candidate.includes(handle)));
        const hasApprovedTikTokHandle = normalizedCandidates.some((candidate) => approvedTikTokHandles.some((handle) => candidate.includes(handle)));
        const hasApprovedYouTubeId = normalizedCandidates.some((candidate) =>
          approvedChannelIds.some((channelId) => candidate.includes(channelId)) ||
          approvedStudioIds.some((managerId) => candidate.includes(managerId))
        );

        if (isYouTube) return hasApprovedYouTubeHandle || hasApprovedYouTubeId;
        if (isTikTok) return hasApprovedTikTokHandle;
        return false;
      },
      args: [accessConfig]
    });

    return !!injected?.result;
  } catch (error) {
    console.warn('Unable to inspect platform session for enforcer access.', error);
    return false;
  }
}

async function canUseEnforcerMode() {
  const currentUserEmail = ((await getUserEmail()) || '').toLowerCase();
  if (ENFORCER_ALLOWED_EMAILS.includes(currentUserEmail)) {
    return true;
  }

  const accessConfig = getEnforcerAccessConfig();
  const tabs = await chrome.tabs.query({});
  const candidateTabs = tabs
    .filter((tab) => isEnforcerPlatformTabUrl(tab.url))
    .sort((left, right) => {
      const activityDelta = Number(Boolean(right.active)) - Number(Boolean(left.active));
      if (activityDelta !== 0) return activityDelta;

      const incognitoDelta = Number(Boolean(right.incognito)) - Number(Boolean(left.incognito));
      if (incognitoDelta !== 0) return incognitoDelta;

      return (right.lastAccessed || 0) - (left.lastAccessed || 0);
    });

  for (const tab of candidateTabs) {
    if (isApprovedEnforcerPlatformUrl(tab.url, accessConfig)) return true;
    if (tab.id && await tabHasApprovedEnforcerSession(tab.id, accessConfig)) return true;
  }

  return false;
}

function setupGoalCelebrationOverlay() {
  const triggerButtons = [
    document.getElementById('scout-level3-video-btn'),
    document.getElementById('enforcer-level3-video-btn'),
    document.getElementById('team-goal-video-btn'),
    document.getElementById('mvp-video-btn')
  ].filter(Boolean);
  const overlay = document.getElementById('goal-video-overlay');
  const frame = document.getElementById('goal-video-frame');
  const title = document.getElementById('goal-video-title');
  const shell = overlay?.querySelector('.goal-video-shell');

  if (triggerButtons.length === 0 || !overlay || !frame || !shell) return;

  const closeOverlay = () => {
    overlay.style.display = 'none';
    frame.src = '';
  };

  triggerButtons.forEach((triggerBtn) => {
    if (triggerBtn.dataset.overlayBound === 'true') return;

    triggerBtn.dataset.overlayBound = 'true';
    triggerBtn.addEventListener('click', (event) => {
      const videoUrl = triggerBtn.dataset.videoUrl;
      if (!videoUrl) return;

      event.preventDefault();
      event.stopPropagation();
      if (title) title.innerText = triggerBtn.dataset.videoTitle || 'Celebration';
      frame.src = videoUrl;
      overlay.style.display = 'flex';
    });
  });

  overlay.addEventListener('click', closeOverlay);
  shell.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.style.display === 'flex') {
      closeOverlay();
    }
  });
}

function setupSidepanelTabs() {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  if (tabButtons.length === 0 || tabPanels.length === 0) return;

  const activateTab = (target) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === target;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.tabPanel === target);
    });
  };

  tabButtons.forEach((button) => {
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', button.classList.contains('active') ? 'true' : 'false');
    button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
  });
}

<<<<<<< Updated upstream
=======
const TAB_PERMISSIONS = Object.freeze({
  report: PERMISSIONS.SIDEPANEL_REPORT,
  automate: PERMISSIONS.SIDEPANEL_AUTOMATE,
  intel: PERMISSIONS.SIDEPANEL_INTEL,
  scoreboard: PERMISSIONS.SIDEPANEL_SCOREBOARD,
  repair: PERMISSIONS.SIDEPANEL_REPAIR
});

async function openSettingsWithAccessRefresh() {
  try {
    await chrome.runtime.sendMessage({ action: 'refreshAccessProfile' });
  } catch (error) {
    console.warn('Access refresh before opening Settings failed:', error);
  }

  // If Settings is already open, make that existing page rerun its sheet-backed access bootstrap.
  chrome.runtime.sendMessage({ action: 'refreshSettingsAccessView' }).catch(() => {});

  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
}

function showSidepanelAccessState({ title, message, state = '', showRetry = false, showSettings = false }) {
  const accessState = document.getElementById('sidepanel-access-state');
  if (!accessState) return;

  accessState.replaceChildren();
  accessState.className = `access-state${state ? ` is-${state}` : ''}`;

  const heading = document.createElement('strong');
  heading.textContent = title;
  const copy = document.createElement('div');
  copy.textContent = message;
  accessState.append(heading, copy);

  if (showRetry) {
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn btn-info btn-small';
    retryButton.textContent = 'Retry access check';
    retryButton.addEventListener('click', () => window.location.reload());
    accessState.appendChild(retryButton);
  }

  if (showSettings) {
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'btn btn-primary btn-small';
    settingsButton.textContent = 'Open Settings';
    settingsButton.addEventListener('click', () => void openSettingsWithAccessRefresh());
    accessState.appendChild(settingsButton);
  }

  accessState.hidden = false;
}

function filterPlatformSelect(selectElement, profile) {
  if (!selectElement) return;
  Array.from(selectElement.options).forEach((option) => {
    const allowed = hasPlatformAccess(profile, option.value);
    option.hidden = !allowed;
    option.disabled = !allowed;
  });

  const firstAllowedOption = Array.from(selectElement.options).find((option) => !option.disabled);
  if (selectElement.selectedOptions[0]?.disabled) {
    selectElement.value = firstAllowedOption?.value || '';
  }
}

function applySidepanelAccess(profile) {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

  tabButtons.forEach((button) => {
    button.hidden = !hasPermission(profile, TAB_PERMISSIONS[button.dataset.tabTarget]);
  });
  tabPanels.forEach((panel) => {
    panel.hidden = !hasPermission(profile, TAB_PERMISSIONS[panel.dataset.tabPanel]);
  });

  const firstAllowedButton = tabButtons.find((button) => !button.hidden);
  const activeButton = tabButtons.find((button) => button.classList.contains('active') && !button.hidden);
  const target = activeButton?.dataset.tabTarget || firstAllowedButton?.dataset.tabTarget;
  tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  tabPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === target));

  document.querySelector('.tabbar').hidden = false;
  document.querySelector('.container').hidden = false;
  document.getElementById('openOptionsGearBtn').hidden = false;
  document.getElementById('clippy-process-bubble').hidden = false;
  document.getElementById('gamification-header').hidden = false;
  document.getElementById('sidepanel-access-state').hidden = true;

  filterPlatformSelect(document.getElementById('platformScanSelect'), profile);
  filterPlatformSelect(document.getElementById('repairPlatformSelect'), profile);
}

>>>>>>> Stashed changes
function updateModeChip(mode = 'scout') {
  const modeChip = document.getElementById('modeChip');
  if (!modeChip) return;

  const isScout = (mode || 'scout') === 'scout';
  modeChip.innerText = isScout ? 'Scout Mode' : 'Enforcer Mode';
  modeChip.style.background = isScout ? '#ecfdf5' : '#eff6ff';
  modeChip.style.borderColor = isScout ? '#bbf7d0' : '#bfdbfe';
  modeChip.style.color = isScout ? '#047857' : '#1d4ed8';
}

function renderQueueSummary(cart = []) {
  const queueCount = document.getElementById('queueCount');
  const queuePlatform = document.getElementById('queuePlatform');
  const queueHint = document.getElementById('queueHint');
  const queue = Array.isArray(cart) ? cart : [];

  if (queueCount) queueCount.innerText = String(queue.length);

  if (queue.length === 0) {
    if (queuePlatform) queuePlatform.innerText = '-';
    if (queueHint) queueHint.innerText = 'Use the page overlay Add button to queue pirated links.';
    return;
  }

  const platformDetails = detectPlatformDetails(queue[0]?.url || '');
  if (queuePlatform) queuePlatform.innerText = platformDetails?.label || 'Unknown';
  if (queueHint) {
    const plural = queue.length === 1 ? 'link' : 'links';
    queueHint.innerText = `${queue.length} ${plural} queued. Fill in the setup fields, then run the primary action.`;
  }
}

<<<<<<< Updated upstream
function populatePlatformSelect(selectEl, platforms) {
  if (!selectEl || !Array.isArray(platforms) || platforms.length === 0) return;

  const selectedValue = selectEl.value;
  selectEl.innerHTML = '';

  platforms.forEach(({ key, label }) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    selectEl.appendChild(option);
  });

  if (selectedValue && platforms.some(({ key }) => key === selectedValue)) {
    selectEl.value = selectedValue;
  }
}

const DEFAULT_SELECTOR_FIELD_OPTIONS = Object.freeze([
  'account_handle',
  'account_menu_trigger',
  'buttons.add_video',
  'buttons.next',
  'buttons.save',
  'candidate_anchors',
  'candidate_channel_links',
  'channel_handle',
  'channel_link',
  'clip_views',
  'copyright_reason',
  'fields.additional_links_checkbox',
  'fields.confirm_email',
  'fields.content_type_post',
  'fields.content_type_story',
  'fields.content_urls',
  'fields.copyrighted_work_description',
  'fields.country_select',
  'fields.email',
  'fields.full_name',
  'fields.infringement_explanation',
  'fields.relationship_radio',
  'fields.rights_owner_name',
  'fields.send_button',
  'fields.signature',
  'fields.source_url',
  'fields.work_type_select',
  'handle',
  'handle_links',
  'json_scripts',
  'likes',
  'live_indicators',
  'live_viewers',
  'menu_button',
  'meta_description',
  'profile_links',
  'report_button',
  'submit_button',
  'success_indicators',
  'url_match',
  'views',
  'views_shorts',
  'views_std',
  'vod_views'
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isSelectorPatchLeaf(pathSegments, value) {
  if (pathSegments.some((segment) => segment.startsWith('_COMMENT'))) return false;

  const topLevelGroup = pathSegments[0];
  const leafKey = pathSegments[pathSegments.length - 1];
  if (['defaults', 'templates'].includes(topLevelGroup)) return false;
  if (['authorized_handles', 'authorized_channel_ids', 'authorized_studio_manager_ids', 'success_text'].includes(leafKey)) return false;

  return typeof value === 'string' ||
    Array.isArray(value) ||
    (isPlainObject(value) && typeof value.selector === 'string');
}

function collectSelectorPatchFieldOptions(node, pathSegments = [], results = []) {
  if (!isPlainObject(node)) return results;

  Object.entries(node).forEach(([key, value]) => {
    const nextPath = [...pathSegments, key];

    if (isPlainObject(value) && typeof value.selector !== 'string') {
      collectSelectorPatchFieldOptions(value, nextPath, results);
      return;
    }

    if (isSelectorPatchLeaf(nextPath, value)) {
      results.push(nextPath.join('.'));
    }
  });

  return results;
}
// --- SECURITY LOCK OVERLAY (Duplicated for Side Panel context) ---
=======
function findUnassignedCartPlatform(cart, profile) {
  for (const item of Array.isArray(cart) ? cart : []) {
    const detectedPlatform = detectPlatformDetails(item?.url || '');
    const requestedPlatforms = new Set([
      normalizeAccessPlatform(item?.platform),
      detectedPlatform.key
    ].filter((platform) => platform && platform !== 'all'));

    for (const platform of requestedPlatforms) {
      if (!hasPlatformAccess(profile, platform)) {
        return platform === detectedPlatform.key ? detectedPlatform.label : platform;
      }
    }
  }
  return '';
}
// --- TIERED ACCESS BOOTSTRAP ---
>>>>>>> Stashed changes
document.addEventListener('DOMContentLoaded', async () => {
  setupSidepanelTabs();

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
<<<<<<< Updated upstream
=======
  let rumbleProgressActive = false;
  let rumbleDefaultStartText = 'Start Report';
  let bulkReportActive = false;
  const bulkReportDefaultText = reportFromSheetBtn?.innerText || 'Report Queued';

  try {
    const accessResponse = await Promise.race([
      chrome.runtime.sendMessage({ action: 'getAccessProfile', forceRefresh: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Access check timed out.')), 12000))
    ]);

    if (!accessResponse?.success || !accessResponse.profile) {
      throw new Error(accessResponse?.error || 'The access registry did not return a profile.');
    }

    currentAccessProfile = accessResponse.profile;
    if (currentAccessProfile.status === 'logged_out') {
      showSidepanelAccessState({
        title: 'Extension login required',
        message: 'Open Settings to log in or create a user account.',
        showSettings: true
      });
      if (loadingEl) loadingEl.textContent = 'Signed out';
      return;
    }

    if (currentAccessProfile.status === 'identity_error') {
      showSidepanelAccessState({
        title: 'Google account mismatch',
        message: 'Open Settings, log out, and sign in with the Google account connected to this extension user.',
        state: 'error',
        showRetry: true,
        showSettings: true
      });
      if (loadingEl) loadingEl.textContent = 'Identity unavailable';
      return;
    }

    if (currentAccessProfile.status !== 'ready') {
      showSidepanelAccessState({
        title: 'Waiting for approval',
        message: `${currentAccessProfile.name || currentAccessProfile.email || 'This account'} is waiting for an administrator to assign an access level and platforms.`,
        state: 'pending',
        showRetry: true,
        showSettings: true
      });
      if (loadingEl) loadingEl.textContent = 'Approval pending';
      return;
    }

    applySidepanelAccess(currentAccessProfile);
    if (loadingEl) loadingEl.textContent = `${roleLabel(currentAccessProfile.role)} access`;
    if (reporterInput && currentAccessProfile.name) reporterInput.value = currentAccessProfile.name;
  } catch (error) {
    console.error('Access initialization failed:', error);
    showSidepanelAccessState({
      title: 'Access could not be verified',
      message: error.message || 'Check your Google sign-in and access to the user registry.',
      state: 'error',
      showRetry: true,
      showSettings: true
    });
    if (loadingEl) loadingEl.textContent = 'Access check failed';
    return;
  }

  function getRumbleWorkflowModal() {
    let modal = document.getElementById('rumble-workflow-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'rumble-workflow-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647; display: none;
      align-items: center; justify-content: center; padding: 18px;
      background: rgba(17, 24, 39, 0.48); font-family: sans-serif;
    `;
    modal.innerHTML = `
      <div style="width: min(440px, 100%); max-height: 92vh; overflow:auto; background:#fff; border-radius:8px; border:2px solid #2f855a; box-shadow:0 18px 45px rgba(0,0,0,0.28); padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:1px solid #e5e7eb; padding-bottom:10px; margin-bottom:12px;">
          <h3 id="rumble-workflow-title" style="margin:0; color:#166534; font-size:16px;">Rumble Reporter</h3>
          <button id="rumble-workflow-close" type="button" style="border:none; background:transparent; color:#6b7280; font-size:22px; line-height:1; cursor:pointer;">×</button>
        </div>
        <div id="rumble-workflow-copy" style="font-size:13px; line-height:1.45; color:#374151;"></div>
        <ol id="rumble-workflow-steps" style="margin:12px 0 12px 18px; padding:0; font-size:12px; line-height:1.55; color:#1f2937;">
          <li>Open each queued Rumble URL in a background tab.</li>
          <li>Submit the Rumble copyright report on each page.</li>
          <li>Revisit each URL to scrape views, handle, live/VOD status, and evidence screenshots.</li>
          <li>Log the final batch to the report sheet.</li>
        </ol>
        <div id="rumble-workflow-url-shell" style="display:none; margin:12px 0; padding:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px;">
          <div id="rumble-workflow-url-heading" style="font-size:12px; font-weight:700; color:#111827; margin-bottom:6px;"></div>
          <div id="rumble-workflow-url-list" style="max-height:96px; overflow:auto; font-size:11px; line-height:1.45; color:#4b5563; word-break:break-word;"></div>
        </div>
        <div id="rumble-workflow-progress-shell" style="display:none; margin-top:12px;">
          <div style="height:10px; background:#e5e7eb; border-radius:999px; overflow:hidden;">
            <div id="rumble-workflow-progress-bar" style="height:100%; width:0%; background:linear-gradient(90deg, #166534, #53fc18); transition:width .25s ease;"></div>
          </div>
          <div id="rumble-workflow-progress-status" style="margin-top:10px; color:#111827; font-size:13px; font-weight:700;">Preparing...</div>
          <div id="rumble-workflow-progress-meta" style="margin-top:3px; color:#6b7280; font-size:11px;">0% complete</div>
        </div>
        <div id="rumble-workflow-actions" style="display:flex; gap:8px; margin-top:14px;">
          <button id="rumble-workflow-cancel" type="button" style="flex:1; border:1px solid #d1d5db; background:#fff; color:#374151; border-radius:6px; padding:10px; font-weight:700; cursor:pointer;">Cancel</button>
          <button id="rumble-workflow-confirm" type="button" style="flex:1; border:none; background:#166534; color:#fff; border-radius:6px; padding:10px; font-weight:800; cursor:pointer;">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function setRumbleWorkflowUrls(cart) {
    const modal = getRumbleWorkflowModal();
    const shell = modal.querySelector('#rumble-workflow-url-shell');
    const heading = modal.querySelector('#rumble-workflow-url-heading');
    const list = modal.querySelector('#rumble-workflow-url-list');
    const urls = cart.map((item) => item.url).filter(Boolean);

    shell.style.display = urls.length > 0 ? 'block' : 'none';
    heading.textContent = `${urls.length} queued URL${urls.length === 1 ? '' : 's'}`;
    list.replaceChildren();
    urls.slice(0, 6).forEach((url) => {
      const row = document.createElement('div');
      row.textContent = url;
      list.appendChild(row);
    });
    if (urls.length > 6) {
      const more = document.createElement('div');
      more.textContent = `...and ${urls.length - 6} more`;
      more.style.marginTop = '4px';
      more.style.fontWeight = '700';
      list.appendChild(more);
    }
  }

  function showRumbleConfirmDialog(cart) {
    return new Promise((resolve) => {
      const modal = getRumbleWorkflowModal();
      const count = cart.length;
      modal.querySelector('#rumble-workflow-title').textContent = 'Confirm Rumble Report';
      modal.querySelector('#rumble-workflow-copy').textContent =
        `You are about to report ${count} Rumble URL${count === 1 ? '' : 's'}. Pirate AI will run the queue in background tabs so you can stay on this page.`;
      modal.querySelector('#rumble-workflow-progress-shell').style.display = 'none';
      modal.querySelector('#rumble-workflow-actions').style.display = 'flex';
      modal.querySelector('#rumble-workflow-confirm').textContent = `Report ${count} URL${count === 1 ? '' : 's'}`;
      modal.querySelector('#rumble-workflow-cancel').textContent = 'Cancel';
      setRumbleWorkflowUrls(cart);

      const closeBtn = modal.querySelector('#rumble-workflow-close');
      const cancelBtn = modal.querySelector('#rumble-workflow-cancel');
      const confirmBtn = modal.querySelector('#rumble-workflow-confirm');
      const finish = (confirmed) => {
        modal.style.display = 'none';
        closeBtn.onclick = null;
        cancelBtn.onclick = null;
        confirmBtn.onclick = null;
        resolve(confirmed);
      };

      closeBtn.style.display = 'block';
      closeBtn.onclick = () => finish(false);
      cancelBtn.onclick = () => finish(false);
      confirmBtn.onclick = () => finish(true);
      modal.style.display = 'flex';
    });
  }

  function showRumbleProgressWindow(total) {
    const modal = getRumbleWorkflowModal();
    rumbleProgressActive = true;
    modal.querySelector('#rumble-workflow-title').textContent = 'Rumble Reporting Progress';
    modal.querySelector('#rumble-workflow-copy').textContent =
      `Reporting ${total} Rumble URL${total === 1 ? '' : 's'} in background tabs. Keep this panel open to watch progress.`;
    modal.querySelector('#rumble-workflow-url-shell').style.display = 'none';
    modal.querySelector('#rumble-workflow-progress-shell').style.display = 'block';
    modal.querySelector('#rumble-workflow-actions').style.display = 'none';
    modal.querySelector('#rumble-workflow-close').style.display = 'none';
    updateRumbleProgressWindow('Starting Rumble queue...', 3);
    modal.style.display = 'flex';
  }

  function updateRumbleProgressWindow(status, percent, metaText) {
    const modal = getRumbleWorkflowModal();
    const safePercent = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Math.round(Number(percent)))) : null;
    const bar = modal.querySelector('#rumble-workflow-progress-bar');
    const statusEl = modal.querySelector('#rumble-workflow-progress-status');
    const metaEl = modal.querySelector('#rumble-workflow-progress-meta');

    if (statusEl && status) statusEl.textContent = status;
    if (bar && safePercent !== null) bar.style.width = `${safePercent}%`;
    if (metaEl) metaEl.textContent = metaText || (safePercent !== null ? `${safePercent}% complete` : '');
  }

  function finishRumbleProgressWindow(status, isError = false) {
    const modal = getRumbleWorkflowModal();
    rumbleProgressActive = false;
    updateRumbleProgressWindow(status, isError ? 100 : 100, isError ? 'Needs attention' : '100% complete');
    const actions = modal.querySelector('#rumble-workflow-actions');
    const closeBtn = modal.querySelector('#rumble-workflow-close');
    const cancelBtn = modal.querySelector('#rumble-workflow-cancel');
    const confirmBtn = modal.querySelector('#rumble-workflow-confirm');
    const statusEl = modal.querySelector('#rumble-workflow-progress-status');

    if (statusEl) statusEl.style.color = isError ? '#ce0e2d' : '#166534';
    actions.style.display = 'flex';
    cancelBtn.style.display = 'none';
    confirmBtn.textContent = 'Close';
    confirmBtn.style.background = isError ? '#ce0e2d' : '#166534';
    closeBtn.style.display = 'block';

    const close = () => {
      modal.style.display = 'none';
      cancelBtn.style.display = '';
      closeBtn.onclick = null;
      confirmBtn.onclick = null;
      if (statusEl) statusEl.style.color = '#111827';
    };
    closeBtn.onclick = close;
    confirmBtn.onclick = close;
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerText = rumbleDefaultStartText;
    }
  }

  async function minimizeActivePirateOverlay() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return;

      await chrome.tabs.sendMessage(activeTab.id, { action: 'minimizePirateOverlay' }).catch(() => {});
    } catch (error) {
      // Some active tabs do not run the page overlay content script. That is fine.
    }
  }

  async function minimizePirateOverlayInTab(tabId, attempts = 8) {
    if (!tabId) return;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'minimizePirateOverlay' });
        if (response?.success || response?.minimized) return;
      } catch (error) {
        // The content script may still be starting on the newly opened tab.
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
>>>>>>> Stashed changes
  
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
  const selectorSectionMap = document.getElementById('selectorSectionMap');
  const selectorFieldMap = document.getElementById('selectorFieldMap');
  const selectorFieldOptions = document.getElementById('selectorFieldOptions');
  const saveSelectorBtn = document.getElementById('saveSelectorBtn');
  const patchStatus = document.getElementById('patchStatus');
  let currentCapturedPlatform = null;

  const supportedPlatforms = getSupportedPlatforms();
  populatePlatformSelect(platformScanSelect, [
      ...supportedPlatforms,
      { key: 'other', label: 'Other' }
  ]);
  populatePlatformSelect(repairPlatformSelect, supportedPlatforms);

  const updateSelectorFieldOptions = () => {
      if (!selectorFieldOptions) return;

      const platform = repairPlatformSelect?.value || 'tiktok';
      const section = selectorSectionMap?.value || 'scraper';
      const sectionConfig = configData?.platform_selectors?.[platform]?.[section];
      const fieldOptions = new Set([
          ...collectSelectorPatchFieldOptions(sectionConfig),
          ...DEFAULT_SELECTOR_FIELD_OPTIONS
      ]);

      selectorFieldOptions.innerHTML = '';
      Array.from(fieldOptions).forEach((value) => {
          const option = document.createElement('option');
          option.value = value;
          selectorFieldOptions.appendChild(option);
      });
  };

  repairPlatformSelect?.addEventListener('change', updateSelectorFieldOptions);
  selectorSectionMap?.addEventListener('change', updateSelectorFieldOptions);
  updateSelectorFieldOptions();
  
  const clippyBubble = document.getElementById('clippy-process-bubble');
  const clippyFeedbackEl = document.getElementById('clippy-feedback-text');
  let sidepanelClippyDismissed = false;
  let sidepanelClippyMode = 'idle';
  let currentIdleClippyPhrase = '';

  const getRandomSidepanelClippyPhrase = (exclude = '') => {
      const pool = SIDEPANEL_CLIPPY_PHRASES.filter((phrase) => phrase !== exclude);
      const sourcePool = pool.length > 0 ? pool : SIDEPANEL_CLIPPY_PHRASES;
      return sourcePool[Math.floor(Math.random() * sourcePool.length)];
  };

  const hasConfiguredSetupIds = (syncData) =>
      SIDEPANEL_SETUP_KEYS.every((key) => String(syncData?.[key] || '').trim());

  const setSidepanelClippyMessage = (text, { mode = 'status' } = {}) => {
      if (!clippyBubble || !clippyFeedbackEl || sidepanelClippyDismissed) return;
      sidepanelClippyMode = mode;
      clippyFeedbackEl.innerText = text;
      clippyBubble.style.display = 'flex';
  };

  const showIdleSidepanelClippy = ({ forceNew = false } = {}) => {
      if (!clippyBubble || !clippyFeedbackEl || sidepanelClippyDismissed) return;

      if (forceNew || !currentIdleClippyPhrase) {
          currentIdleClippyPhrase = getRandomSidepanelClippyPhrase(currentIdleClippyPhrase);
      }

      sidepanelClippyMode = 'idle';
      clippyFeedbackEl.innerText = currentIdleClippyPhrase;
      clippyBubble.style.display = 'flex';
  };

  const syncSidepanelClippyToSetup = (syncData = null) => {
      const applyState = (data) => {
          if (!hasConfiguredSetupIds(data)) {
              setSidepanelClippyMessage('Please fill in the 3 setup boxes in Settings to finish setup.', { mode: 'setup' });
              return;
          }

          if (sidepanelClippyMode === 'setup' || !currentIdleClippyPhrase) {
              showIdleSidepanelClippy({ forceNew: true });
          }
      };

      if (syncData) {
          applyState(syncData);
          return;
      }

      chrome.storage.sync.get(SIDEPANEL_SETUP_KEYS, applyState);
  };

  const requestWorkflowFocusRefresh = () => {
      chrome.storage.local.get('piracy_cart', (res) => {
          renderQueueSummary(res.piracy_cart || []);
          evaluateWorkflowFocus(res.piracy_cart?.length || 0);
      });
  };

  if (clippyFeedbackEl) {
      clippyFeedbackEl.style.cursor = 'pointer';
      clippyFeedbackEl.title = 'Click for a new saying';
      clippyFeedbackEl.addEventListener('click', () => {
          if (sidepanelClippyMode !== 'idle' || sidepanelClippyDismissed) return;
          showIdleSidepanelClippy({ forceNew: true });
      });
  }

  const closeClippyBtn = document.getElementById('close-clippy-btn');
  if (closeClippyBtn) {
      closeClippyBtn.addEventListener('click', () => {
          sidepanelClippyDismissed = true;
          if (clippyBubble) clippyBubble.style.display = 'none';
      });
  }

  syncSidepanelClippyToSetup();

  setupGoalCelebrationOverlay();

  // Keep the takedown walkthrough outside the tab container so it can replace
  // the main panel view during rogue-site capture.
  if (rogueWalkthrough && rogueWalkthrough.closest('.container')) {
      document.body.appendChild(rogueWalkthrough);
  }

  // Toggle Elements
  const closerToggle = document.getElementById('closerToggle');
  const closerToggleLabel = document.getElementById('closerToggleLabel');
  const closerDurationSelect = document.getElementById('closerDurationSelect');
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
      optionsGearBtn.addEventListener('click', () => void openSettingsWithAccessRefresh());
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
                requestWorkflowFocusRefresh();
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
                 chrome.storage.local.set({ closer_enabled: false });
            }
        }
        return; 
    }

    if (msg.action === 'progressComplete') {
        refreshGamificationStats();
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
          loadingEl.classList.add('init-error');
          loadingEl.innerHTML = `⚠️ <strong>Connection Failed</strong><br>${msg}<br>
          <div class="flex-row" style="justify-content:center; margin-top:10px;">
            <button id="retryInitBtn" class="btn btn-info" style="width:auto; padding:5px 15px;">Retry</button>
            <button id="openOptionsBtn" class="btn btn-warning" style="width:auto; padding:5px 15px;">Settings</button>
          </div>`;
          loadingEl.style.color = "red";
          document.getElementById('retryInitBtn')?.addEventListener('click', () => window.location.reload());
          document.getElementById('openOptionsBtn')?.addEventListener('click', () => void openSettingsWithAccessRefresh());
      }
  };

  // 1. Load Config & Init
  try {
    refreshGamificationStats();

    // Load Config
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success) {
      configData = response.config;
      populateVerticals(verticalSelect);
      updateSelectorFieldOptions();
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
      if (reporterInput) {
          reporterInput.value = currentAccessProfile?.name || res.last_reporter || '';
      }
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
  chrome.storage.local.get('piracy_cart', (res) => {
      renderQueueSummary(res.piracy_cart || []);
      evaluateWorkflowFocus(res.piracy_cart?.length || 0);
  });

  chrome.storage.local.get(['rogue_target_data'], (rogueRes) => {
      if (rogueRes.rogue_target_data) {
          renderRogueWalkthrough(rogueRes.rogue_target_data);
      }
  });

  // Dynamic Sync: Fetch Leaderboard stats periodically to keep UI fresh
  setInterval(() => {
    refreshGamificationStats();
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
                    requestWorkflowFocusRefresh();
                }
            }
        });
    }

    const updateRogueButtonState = (isEnabled) => {
        if (!nukeStreamBtn) return;
        nukeStreamBtn.style.backgroundColor = isEnabled ? '#ce0e2d' : '#1a1a1a';
        nukeStreamBtn.style.color = 'white';
        nukeStreamBtn.innerText = isEnabled ? '☢️ Show 3rd Party Nuke Overlay' : '🛡️ 3rd Party Safety: ON';
        nukeStreamBtn.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
    };

    const summonPirateOverlayOnCurrentTab = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) {
            throw new Error("No active tab found.");
        }

        if (!/^https?:/i.test(tab.url)) {
            throw new Error("Pirate AI can only be opened on regular web pages.");
        }

        await chrome.storage.local.set({ showNukeButton: true });

        const message = {
            action: 'showPirateOverlay',
            showNukeButton: true,
            expand: true
        };

        try {
            await chrome.tabs.sendMessage(tab.id, message);
            return;
        } catch (error) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    window.__floForceOverlay = true;
                }
            });

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content_scraper.js']
            });

            await chrome.tabs.sendMessage(tab.id, message);
        }
    };

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
  if (nukeStreamBtn) nukeStreamBtn.addEventListener('click', async () => {
      if (rogueToggle && !rogueToggle.checked) return; // Prevent click if Safety is ON

      const originalText = nukeStreamBtn.innerText;
      nukeStreamBtn.innerText = "Opening Overlay...";
      nukeStreamBtn.disabled = true;
      if (nukeStatus) nukeStatus.innerText = "Launching Pirate AI on the current tab...";

      try {
          await summonPirateOverlayOnCurrentTab();
          if (nukeStatus) nukeStatus.innerText = "Pirate AI ready on the current tab.";
      } catch (e) {
          console.error(e);
          if (nukeStatus) nukeStatus.innerText = e.message || "Failed to launch Pirate AI.";
      } finally {
          setTimeout(() => {
              nukeStreamBtn.disabled = false;
              updateRogueButtonState(!!rogueToggle?.checked);
              if (nukeStatus) nukeStatus.innerText = "";
          }, 1200);
      }
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
                
                // --- NEW: SCOUT / ENFORCER ACCESS FILTER ---
<<<<<<< Updated upstream
                const currentUserEmail = await getUserEmail();
                if (isScout && (!currentUserEmail || !currentUserEmail.endsWith('@flosports.tv'))) {
                    alert("Access Denied: Scout mode requires a @flosports.tv email address.");
=======
                if (isScout && !canUseScoutMode()) {
                    alert("Access Denied: Your assigned access level does not include reporting.");
>>>>>>> Stashed changes
                    return;
                }
                // -------------------------------------------

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

          const unassignedCartPlatform = findUnassignedCartPlatform(cart, currentAccessProfile);
          if (unassignedCartPlatform) {
              alert(`Access Denied: ${unassignedCartPlatform} is not assigned to your account. Remove those queued items or ask an administrator for access.`);
              startBtn.disabled = false;
              startBtn.innerText = defaultBtnText;
              return;
          }

           // 2. Determine Platform & URL
          const firstUrl = cart[0].url;
          const platformDetails = detectPlatformDetails(firstUrl);
          const platform = platformDetails.label;
          const reportUrl = platformDetails.reportUrl;

<<<<<<< Updated upstream
=======
          if (!hasPlatformAccess(currentAccessProfile, platformDetails.key)) {
              alert(`Access Denied: ${platformDetails.label} is not assigned to your account.`);
              startBtn.disabled = false;
              startBtn.innerText = defaultBtnText;
              return;
          }

>>>>>>> Stashed changes
          if (!isScout && !isEnforcerAllowlistExemptPlatform(platformDetails.key) && !(await canUseEnforcerMode())) {
              alert(ENFORCER_PLATFORM_ACCESS_MESSAGE);
              startBtn.disabled = false;
              startBtn.innerText = defaultBtnText;
              return;
          }

          if (!reportUrl && platformDetails.key !== 'rumble') {
              alert(getManualReportingMessage(platformDetails));
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
          
          if (sourceUrl) chrome.runtime.sendMessage({ action: 'saveEventUrl', data: { vertical, eventName, url: sourceUrl, platform: platformDetails.key } });

          await chrome.storage.local.set({ reporterInfo });

          // 4. Open Reporting Page or Skip (Scout Mode)
          if (isScout) { // PATCHED
              startBtn.innerText = `Logging (Scout Mode)...`;
              const payload = { reporterName, vertical, eventName, mode: 'scout', uploadScreenshots: true };
              chrome.runtime.sendMessage({ action: 'processQueue', data: payload });
              setTimeout(() => { startBtn.innerText = defaultBtnText; startBtn.disabled = false; }, 3000); // PATCHED
              return;
          }

<<<<<<< Updated upstream
          if (platformDetails.key === 'rumble') {
=======
		          if (platformDetails.key === 'rumble') {
	              rumbleDefaultStartText = defaultBtnText;
	              const confirmed = await showRumbleConfirmDialog(cart);
	              if (!confirmed) {
	                  startBtn.innerText = defaultBtnText;
	                  startBtn.disabled = false;
	                  return;
	              }

	              showRumbleProgressWindow(cart.length);
		              startBtn.innerText = `Reporting ${cart.length} Rumble URL${cart.length === 1 ? '' : 's'}...`;
		              const payload = { reporterName, vertical, eventName, mode: 'enforcer', uploadScreenshots: true };
		              chrome.runtime.sendMessage({ action: 'startRumbleQueue', data: payload }, (response) => {
		                  if (chrome.runtime.lastError) {
		                      finishRumbleProgressWindow(chrome.runtime.lastError.message || "Failed to start the Rumble report queue.", true);
		                      startBtn.innerText = defaultBtnText;
		                      startBtn.disabled = false;
		                      return;
		                  }

		                  if (response && response.success) {
		                      updateRumbleProgressWindow('Rumble queue started in background tabs.', 4);
		                      return;
		                  }

	                  finishRumbleProgressWindow(response?.error || "Failed to start the Rumble report queue.", true);
	                  startBtn.innerText = defaultBtnText;
	                  startBtn.disabled = false;
	              });
	              return;
	          }

          if (platformDetails.key === 'kick') {
>>>>>>> Stashed changes
              startBtn.innerText = `Opening ${platform}...`;
              const payload = { reporterName, vertical, eventName, mode: 'enforcer', uploadScreenshots: true };
              chrome.runtime.sendMessage({ action: 'startRumbleQueue', data: payload }, (response) => {
                  if (response && response.success) {
                      startBtn.innerText = defaultBtnText;
                      startBtn.disabled = false;
                      return;
                  }

                  alert(response?.error || "Failed to start the Rumble report queue.");
                  startBtn.innerText = defaultBtnText;
                  startBtn.disabled = false;
              });
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
          const durationValue = closerDurationSelect ? closerDurationSelect.value : 'on';
          const durationMinutes = durationValue === 'on' ? null : parseInt(durationValue, 10);
          chrome.storage.local.set({
              closer_enabled: isChecked,
              closer_duration_minutes: isChecked ? durationMinutes : null
          });
          
          if (closerToggleLabel) {
              closerToggleLabel.innerText = isChecked ? "On" : "Off";
              closerToggleLabel.style.color = isChecked ? "#4CAF50" : "#666";
          }

          if (isChecked) {
              const startVal = startRowInput ? startRowInput.value : 1;
              const startRow = parseInt(startVal) || 1;

              if (closerStatusEl) {
                  closerStatusEl.style.display = 'block';
                  closerStatusEl.innerText = durationMinutes
                      ? `Initializing Scanner for ${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}...`
                      : "Initializing Scanner...";
              }

              chrome.runtime.sendMessage({ action: 'triggerCloser', startRow: startRow, durationMinutes }, () => {
                  if (chrome.runtime.lastError) {
                      // Revert toggle if error
                      closerToggle.checked = false;
                      chrome.storage.local.set({ closer_enabled: false });
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

  // --- INTELLIGENCE BRIEFING LOGIC ---
    const generateIntelReportBtn = document.getElementById('generateIntelReportBtn');
    if (generateIntelReportBtn) {
        generateIntelReportBtn.addEventListener('click', () => {
            const vertical = verticalSelect.value;
            
            if (!vertical) {
                alert("Please select a Vertical first.");
                return;
            }

            const startDate = document.getElementById('reportStartDate').value;
            const endDate = document.getElementById('reportEndDate').value;
            
            if (!startDate || !endDate) {
                alert("Please select both a start and end date.");
                return;
            }
            
            const clippyText = document.getElementById('clippy-feedback-text');
            if (clippyText) setSidepanelClippyMessage(`Analyzing logs from ${startDate} to ${endDate}... standing by.`);
            
            generateIntelReportBtn.disabled = true;
            generateIntelReportBtn.innerText = "Analyzing...";

            chrome.runtime.sendMessage({ 
                action: 'generateIntelligenceReport', 
                startDate: startDate,
                endDate: endDate,
                vertical: vertical
            }, (res) => {
                generateIntelReportBtn.disabled = false;
                generateIntelReportBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Briefing`;
                
                if (clippyText) {
                    if (res?.success) {
                        setSidepanelClippyMessage('Briefing generated successfully!');
                    } else {
                        setSidepanelClippyMessage('Failed to generate briefing.');
                    }
                }
                if (res && res.error) alert("Briefing Error: " + res.error);
            });
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
          const platform = platformScanSelect ? platformScanSelect.value : 'tiktok';
          
          if (!reporterName || !vertical) {
              alert("Please fill in Reporter and Vertical.");
              return;
          }
                // --- BULK ENFORCER ACCESS FILTER ---
                  if (!isEnforcerAllowlistExemptPlatform(platform) && !(await canUseEnforcerMode())) {
                      alert(ENFORCER_PLATFORM_ACCESS_MESSAGE);
                      return;
                  }
                  // ----------------------------------------

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
          const accessCheck = await chrome.runtime.sendMessage({
              action: 'checkAccess',
              permission: PERMISSIONS.SIDEPANEL_REPAIR,
              platform
          });
          if (!accessCheck?.allowed) {
              alert(accessCheck?.error || `Access Denied: ${platform} is not assigned to your account.`);
              return;
          }
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
if (selectorPatchUI) selectorPatchUI.style.display = 'none';
  const startMacroBtn = document.getElementById('startMacroBtn');
const stopMacroBtn = document.getElementById('stopMacroBtn');
// Reuse the same platform select dropdown for macro recording
if (startMacroBtn && stopMacroBtn) {
    startMacroBtn.addEventListener('click', async () => {
        const platform = repairPlatformSelect ? repairPlatformSelect.value : 'tiktok';
        const accessCheck = await chrome.runtime.sendMessage({
            action: 'checkAccess',
            permission: PERMISSIONS.SIDEPANEL_REPAIR,
            platform
        });
        if (!accessCheck?.allowed) {
            alert(accessCheck?.error || `Access Denied: ${platform} is not assigned to your account.`);
            return;
        }
        
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
          renderQueueSummary(changes.piracy_cart.newValue || []);
          evaluateWorkflowFocus(changes.piracy_cart.newValue?.length || 0);
      }
      if (namespace === 'local' && changes.rogue_target_data && changes.rogue_target_data.newValue) {
          renderRogueWalkthrough(changes.rogue_target_data.newValue);
      }
      // Listen for real-time changes to the report_mode from the options page
      if (namespace === 'sync' && changes.report_mode) {
          updateModeChip(changes.report_mode.newValue || 'scout');
          requestWorkflowFocusRefresh();
      }
      if (namespace === 'sync' && SIDEPANEL_SETUP_KEYS.some((key) => changes[key])) {
          syncSidepanelClippyToSetup();
          requestWorkflowFocusRefresh();
      }
  });

      // Re-evaluate focus immediately when the user types or selects an option
  ['reporterName', 'verticalSelect', 'eventInput', 'sourceUrlDisplay'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const refreshFocus = () => requestWorkflowFocusRefresh();
      el.addEventListener('input', refreshFocus);
      el.addEventListener('change', refreshFocus);
  });
function evaluateWorkflowFocus(cartSize) {
      // PATCH: Fetch mode first and set button text BEFORE any early returns
      chrome.storage.sync.get(['report_mode', ...SIDEPANEL_SETUP_KEYS], (syncRes) => {
          const isScout = (syncRes.report_mode || 'scout') === 'scout';
          updateModeChip(syncRes.report_mode || 'scout');
          const startBtn = document.getElementById('startBtn');
          if (startBtn) startBtn.innerText = isScout ? "Save to Log (Scout Mode)" : "Start Report";

          chrome.storage.local.get(['highlight_start_disabled'], (res) => {
              if (!hasConfiguredSetupIds(syncRes)) {
                  setSidepanelClippyMessage('Please fill in the 3 setup boxes in Settings to finish setup.', { mode: 'setup' });
                  return;
              }

              if (res.highlight_start_disabled) {
                  showIdleSidepanelClippy({ forceNew: sidepanelClippyMode !== 'idle' });
                  return;
              }

              // Clear all existing spotlights
              document.querySelectorAll('.clippy-focus').forEach(el => el.classList.remove('clippy-focus'));
              
              if (cartSize === 0) {
                  showIdleSidepanelClippy({ forceNew: sidepanelClippyMode !== 'idle' });
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

              if (missingFields) {
                  setSidepanelClippyMessage('Please fill in the highlighted boxes to continue.', { mode: 'workflow' });
              } else {
                  if (startBtn) startBtn.classList.add('clippy-focus');
                  showIdleSidepanelClippy({ forceNew: sidepanelClippyMode !== 'idle' });
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
          updateRogueButtonState(isChecked);
      });

      // Listen for toggle changes
      rogueToggle.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          chrome.storage.local.set({ showNukeButton: isChecked });
          updateRogueButtonState(isChecked);
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
  populateVerticalSelect(selectEl, configData);
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
