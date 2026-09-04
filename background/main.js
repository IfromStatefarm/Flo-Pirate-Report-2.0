import { getAuthToken, getUserEmail } from '../utils/auth.js';
import {
  addNewEventToSheet,
  checkIfAuthorized,
  ensureRogueScreenshotFolder,
  fetchConfig,
  getColumnHDataWithFormatting,
  getEventData,
  getRecommendedStartRow,
  patchConfigSelector,
  submitSuggestionToSheet,
  updateCellWithRichText,
  updateEventUrl,
  updateRowStatus,
  addEnforcerBonusPoints,
  updateConfigSections,
  uploadToDrive,
  ensureYearlyReportFolder,
  ensureDailyScreenshotFolder
} from '../utils/google_api.js';
import { generatePDF, generateIntelligencePDF } from '../utils/pdf_gen.js';
import { clearImages, getImage, saveImage } from '../utils/idb_storage.js';
import { createSheetScanner } from '../services/sheet_scanner.js';
import { base64ToBlob } from './lib/blob_utils.js';
import { createMacroWorkflow } from './services/macro_workflow.js';
import { createReportingWorkflow } from './services/reporting_workflow.js';
import { createRogueWorkflow } from './services/rogue_workflow.js';
import { createRumbleWorkflow } from './services/rumble_workflow.js';
import { createSearchWorkflow } from './services/search_workflow.js';
import { createCustomerBootstrapService } from '../services/customer_bootstrap_service.js';
import { createCustomerConfigService } from '../services/customer_config_service.js';
import { createThemeAssetService } from '../services/theme_asset_service.js';
import { createCustomerMembershipService } from '../services/customer_membership_service.js';
import { createCustomerDataService } from '../services/customer_data_service.js';
import { createCustomerMigrationService } from '../services/customer_migration_service.js';
import { buildRuntimeTheme } from '../utils/runtime_theme.js';
import {
  PERMISSIONS,
  hasPermission,
  hasPlatformAccess,
  normalizeAccessPlatform
} from '../utils/access_control.js';
import { detectPlatformDetails } from '../utils/platforms.js';

const ALARM_NAME = 'theCloser';
const LEGACY_GAMIFICATION_STATS_CACHE_KEY = 'gamification_stats_cache';
const ACCESS_CONTEXT = Symbol('accessContext');

const accessRegistry = createCustomerBootstrapService({ getAuthToken, getUserEmail });
const customerConfigService = createCustomerConfigService();
const themeAssetService = createThemeAssetService();
const customerMembershipService = createCustomerMembershipService({ getAuthToken });
const customerDataService = createCustomerDataService({ getAuthToken });
const customerMigrationService = createCustomerMigrationService({ customerDataService });

async function resolveRuntimeTheme(profile) {
  let logoDataUrl = '';
  if (profile?.status === 'ready' && profile.theme?.logoUrl) {
    logoDataUrl = await themeAssetService.resolveLogo({
      customerId: profile.customerId,
      configVersion: profile.configVersion,
      logoUrl: profile.theme.logoUrl
    });
  }
  return buildRuntimeTheme(profile, logoDataUrl);
}

const ACTION_ACCESS_POLICIES = Object.freeze({
  checkWhitelist: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  findEventUrl: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  getVerticalData: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  botSearchComplete: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  botSearchFailed: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  processNewItem: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  logToSheet: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  processQueue: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true, includeCart: true },
  processKickLog: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  processFacebookLog: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  processTwitchLog: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  startRumbleQueue: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true, includeCart: true },
  advanceRumbleQueue: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  cancelRumbleQueue: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  getConfig: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  saveEventUrl: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true, ignoreUrls: true },
  appendEventToSheet: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  addToCart: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  clearCart: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  undoCart: { permission: PERMISSIONS.SIDEPANEL_REPORT },
  initRogueTakedown: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  logRogueToSheet: { permission: PERMISSIONS.SIDEPANEL_REPORT, platformScoped: true },
  getGamificationStats: { permission: PERMISSIONS.SIDEPANEL_SCOREBOARD },
  getRecommendedStartRow: { permission: PERMISSIONS.SIDEPANEL_AUTOMATE },
  scanSheetForActiveLinks: { permission: PERMISSIONS.SIDEPANEL_AUTOMATE, platformScoped: true },
  triggerCloser: { permission: PERMISSIONS.SIDEPANEL_AUTOMATE },
  stopSheetScanner: { permission: PERMISSIONS.SIDEPANEL_AUTOMATE },
  generateIntelligenceReport: { permission: PERMISSIONS.SIDEPANEL_INTEL },
  getMigrationStatus: { permission: PERMISSIONS.SETTINGS_ADMIN_ACCESS },
  listAccessUsers: { permission: PERMISSIONS.SETTINGS_ADMIN_ACCESS },
  updateAccessUser: { permission: PERMISSIONS.SETTINGS_ADMIN_ACCESS },
  updateSharedConfig: { permission: PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS },
  submitSuggestion: { permission: PERMISSIONS.SETTINGS_FEEDBACK_COMMS },
  patchSelectorConfig: { permission: PERMISSIONS.SIDEPANEL_REPAIR, platformScoped: true },
  startMacroSession: { permission: PERMISSIONS.SIDEPANEL_REPAIR, platformScoped: true },
  compileMacro: { permission: PERMISSIONS.SIDEPANEL_REPAIR },
  recordMacroStep: { permission: PERMISSIONS.SIDEPANEL_REPAIR }
});

function platformKeyFromUrl(url) {
  const normalizedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) return '';
  return detectPlatformDetails(normalizedUrl).key;
}

function addPlatformCandidate(platforms, value) {
  const normalized = normalizeAccessPlatform(value);
  if (normalized && normalized !== 'all') platforms.add(normalized);
}

function addUrlCandidate(platforms, value) {
  const platform = platformKeyFromUrl(value);
  if (platform) platforms.add(platform);
}

async function getRequestPlatforms(request, { includeCart = false, ignoreUrls = false } = {}) {
  const platforms = new Set();
  const data = request?.data || {};

  [request?.platform, request?.platformKey, data.platform, data.platformKey, data.reportPlatform]
    .forEach((value) => addPlatformCandidate(platforms, value));

  if (!ignoreUrls) {
    [request?.currentUrl, request?.url, data.url, data.currentUrl]
      .forEach((value) => addUrlCandidate(platforms, value));

    const urlCollections = [request?.urls, data.urls, data.items];
    urlCollections.forEach((collection) => {
      if (!Array.isArray(collection)) return;
      collection.forEach((item) => addUrlCandidate(platforms, typeof item === 'string' ? item : item?.url));
    });
  }

  if (includeCart) {
    const storage = await chrome.storage.local.get('piracy_cart');
    const cart = Array.isArray(storage.piracy_cart) ? storage.piracy_cart : [];
    cart.forEach((item) => {
      addPlatformCandidate(platforms, item?.platform);
      addUrlCandidate(platforms, item?.url);
    });
  }

  return [...platforms];
}

async function authorizeAction(action, request) {
  const policy = ACTION_ACCESS_POLICIES[action];
  if (!policy) return null;

  const profile = await accessRegistry.requirePermission(policy.permission);
  if (policy.platformScoped) {
    const requestedPlatforms = await getRequestPlatforms(request, policy);
    if (requestedPlatforms.length === 0) {
      throw new Error('Access denied: A recognized platform is required for this action.');
    }
    for (const platform of requestedPlatforms) {
      await accessRegistry.requirePlatform(profile, platform);
    }
  }

  request[ACCESS_CONTEXT] = profile;
  return profile;
}

const sheetScanner = createSheetScanner({
  getColumnHDataWithFormatting,
  updateRowStatus,
  updateCellWithRichText,
  addEnforcerBonusPoints,
  getUserEmail,
  getCustomerProfile: () => accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_AUTOMATE),
  recordCustomerEvent: (...args) => customerDataService.recordEvent(...args)
});

const searchWorkflow = createSearchWorkflow({
  addNewEventToSheet,
  getEventData,
  updateEventUrl,
  getCustomerProfile: () => accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_REPORT),
  recordCustomerEvent: (...args) => customerDataService.recordEvent(...args)
});

const rogueWorkflow = createRogueWorkflow({
  base64ToBlob,
  ensureRogueScreenshotFolder,
  getAuthToken,
  uploadToDrive,
  getCustomerProfile: () => accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_REPORT),
  recordCustomerEvent: (...args) => customerDataService.recordEvent(...args)
});

const macroWorkflow = createMacroWorkflow();

const reportingWorkflow = createReportingWorkflow({
  checkIfAuthorized,
  clearImages,
  ensureDailyScreenshotFolder,
  ensureYearlyReportFolder,
  generatePDF,
  getCustomerTheme: async () => resolveRuntimeTheme(await accessRegistry.getCurrentProfile()),
  getCustomerProfile: () => accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_REPORT),
  getAuthToken,
  getEventData,
  getImage,
  getUserEmail,
  saveImage,
  saveUrlToSheet: async (vertical, rowOrEventName, url, platform, shouldAppend = false, integrations = null) => {
    if (shouldAppend) {
      return addNewEventToSheet(vertical, rowOrEventName, url, platform, integrations);
    }
    return updateEventUrl(vertical, rowOrEventName, url, platform, integrations);
  },
  recordCustomerEvent: (...args) => customerDataService.recordEvent(...args),
  uploadToDrive,
  base64ToBlob
});

const rumbleWorkflow = createRumbleWorkflow({
  handleBatchReport: reportingWorkflow.handleBatchReport
});

async function maybeBroadcastManagedSourceUrl(url) {
  try {
    const profile = await accessRegistry.getDisplayProfile();
    if (profile.status !== 'ready' || !profile.legal?.originalWorkUrl) return;
    const activeHost = new URL(String(url || '')).hostname.toLowerCase();
    const officialHost = new URL(profile.legal.originalWorkUrl).hostname.toLowerCase();
    if (activeHost === officialHost || activeHost.endsWith(`.${officialHost}`)) {
      chrome.runtime.sendMessage({ action: 'activeUrlChanged', url }).catch(() => {});
    }
  } catch (error) {
    // Ignore browser-internal and malformed URLs.
  }
}

function setupBrowserEventListeners() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await maybeBroadcastManagedSourceUrl(tab.url);
    } catch (error) {
      console.warn('Active tab lookup failed:', error);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void tabId;
    if (changeInfo.url && tab?.active) {
      void maybeBroadcastManagedSourceUrl(changeInfo.url);
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
    chrome.storage.local.set({ onboarding_step: 'NEEDS_CONFIG' });
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    const { closer_enabled, closer_duration_minutes } = await chrome.storage.local.get([
      'closer_enabled',
      'closer_duration_minutes'
    ]);
    if (closer_enabled) {
      try {
        const profile = await accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_AUTOMATE);
        await sheetScanner.run(1, {
          durationMinutes: closer_duration_minutes,
          allowedPlatforms: profile.platforms,
          customerProfile: profile
        });
      } catch (error) {
        console.warn('Scheduled Closer skipped:', error.message);
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync') return;
    if (!(changes.piracy_folder_id || changes.piracy_sheet_id || changes.event_sheet_id)) return;

    chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'], (items) => {
      if (!(items.piracy_folder_id && items.piracy_sheet_id && items.event_sheet_id)) return;

      chrome.storage.local.get(['onboarding_step'], (res) => {
        if (res.onboarding_step !== 'NEEDS_CONFIG') return;

        chrome.storage.local.set({ onboarding_step: 'READY_FOR_FIRST_REPORT' }, () => {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              chrome.tabs
                .sendMessage(tab.id, { action: 'clippyStateChange', state: 'READY_FOR_FIRST_REPORT' })
                .catch(() => {});
            });
          });
        });
      });
    });
  });
}

function getGamificationCacheKey(profile) {
  return `gamification_stats_cache:${profile.customerId}:${profile.userId}`;
}

async function handleGamificationStats(profile) {
  try {
    const query = { period: 'current_month' };
    const result = await customerDataService.queryStatistics(profile, 'scoreboard', query);
    await customerMigrationService.compareStatistics(profile, 'scoreboard', query, result);
    const stats = result.data;
    const hydratedStats = {
      ...createEmptyGamificationStats(),
      ...stats,
      error: Boolean(stats?.error),
      stale: false,
      lastUpdated: Date.now()
    };
    if (hydratedStats.error) {
      hydratedStats.scoutRank = 'Offline';
      hydratedStats.enforcerRank = 'Offline';
    }

    if (!hydratedStats.error) {
      await chrome.storage.local.set({
        [getGamificationCacheKey(profile)]: {
          customerId: profile.customerId,
          userId: profile.userId,
          stats: hydratedStats,
          fetchedAt: hydratedStats.lastUpdated
        }
      });
      await chrome.storage.local.remove(LEGACY_GAMIFICATION_STATS_CACHE_KEY);
    }

    return hydratedStats;
  } catch (error) {
    console.error('Leaderboard fetch error:', error);
    return getCachedGamificationStats(profile, error.message);
  }
}

function createEmptyGamificationStats(overrides = {}) {
  return {
    error: false,
    errorMessage: '',
    stale: false,
    lastUpdated: null,
    scoutPoints: 0,
    enforcerPoints: 0,
    scoutRank: 'Level 1 Scout Reporter',
    enforcerRank: 'Level 1 Enforcer',
    teamTotal: 0,
    topScouts: [],
    topEnforcers: [],
    overallLeaderboard: [],
    mvp: { name: 'TBD', points: 0 },
    isCurrentMvp: false,
    ...overrides
  };
}

async function getCachedGamificationStats(profile, errorMessage = '') {
  const normalizedErrorMessage = String(errorMessage || '');
  const cacheKey = getGamificationCacheKey(profile);
  const cache = await chrome.storage.local.get(cacheKey);
  const envelope = cache[cacheKey];
  const cachedStats = envelope?.customerId === profile.customerId && envelope?.userId === profile.userId
    ? envelope.stats
    : null;

  if (cachedStats) {
    return {
      ...createEmptyGamificationStats(),
      ...cachedStats,
      error: true,
      errorMessage: normalizedErrorMessage,
      stale: true
    };
  }

  return createEmptyGamificationStats({
    error: true,
    errorMessage: normalizedErrorMessage,
    scoutRank: 'Offline',
    enforcerRank: 'Offline'
  });
}

async function handleGenerateIntelligenceReport(request) {
  const profile = request[ACCESS_CONTEXT] || await accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_INTEL);
  const token = await getAuthToken();
  const allowedPlatforms = profile.platforms.includes('all') ? [] : profile.platforms;
  const result = await customerDataService.queryStatistics(profile, 'intelligence', {
    start_date: request.startDate,
    end_date: request.endDate,
    platforms: allowedPlatforms
  });
  await customerMigrationService.compareStatistics(profile, 'intelligence', {
    start_date: request.startDate,
    end_date: request.endDate,
    platforms: allowedPlatforms
  }, result);
  const stats = result.data;
  if (!stats) {
    throw new Error('No data available for this timeframe.');
  }

  const briefingEventId = crypto.randomUUID();
  const pdfBlob = await generateIntelligencePDF(stats, await resolveRuntimeTheme(profile), {
    customerId: profile.customerId,
    userId: profile.userId,
    eventId: briefingEventId
  });
  const driveRootId = profile.integrations?.driveRootFolderId;
  if (!driveRootId) {
    throw new Error('Drive Root ID not configured.');
  }

  const query =
    `mimeType='application/vnd.google-apps.folder' and '${driveRootId}' in parents ` +
    `and name='Tactical Briefings' and trashed=false`;

  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();

  let folderId;
  if (searchData.files && searchData.files.length > 0) {
    folderId = searchData.files[0].id;
  } else {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Tactical Briefings',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [driveRootId]
      })
    });
    const createData = await createRes.json();
    folderId = createData.id;
  }

  const filename = `Intelligence_Briefing_${request.startDate}_to_${request.endDate}.pdf`;
  const uploadRes = await uploadToDrive(token, folderId, filename, pdfBlob, 'application/pdf', {
    customerId: profile.customerId,
    userId: profile.userId,
    eventId: briefingEventId
  });
  await customerDataService.recordEvent(profile, 'report.intelligence_generated', {
    start_date: request.startDate,
    end_date: request.endDate,
    pdf_url: uploadRes.webViewLink
  }, { eventId: briefingEventId });
  chrome.tabs.create({ url: uploadRes.webViewLink });

  return { success: true, url: uploadRes.webViewLink };
}

async function openSidePanelForSender(sender) {
  if (!sender.tab?.windowId) {
    return { success: false, error: 'No sender window available.' };
  }

  await chrome.sidePanel.open({ windowId: sender.tab.windowId });
  return { success: true };
}

function createActionHandlers() {
  return {
    async getCustomerConfig() {
      const resolved = await customerConfigService.getCurrentConfig();
      return { success: true, ...resolved };
    },

    async getRuntimeTheme() {
      const profile = await accessRegistry.getDisplayProfile();
      return { success: true, theme: await resolveRuntimeTheme(profile) };
    },

    async getAccessProfile(request) {
      const profile = await accessRegistry.getCurrentProfile({
        forceRefresh: request.forceRefresh === true
      });
      return { success: true, profile };
    },

    async bootstrapCustomerAccess() {
      const profile = await accessRegistry.bootstrap();
      return { success: profile.status === 'ready', profile, error: profile.message || '' };
    },

    async logoutAccessUser() {
      await Promise.all([accessRegistry.logout(), themeAssetService.clear()]);
      return { success: true };
    },

    async refreshAccessProfile() {
      const profile = await accessRegistry.getCurrentProfile({ forceRefresh: true });
      return { success: profile.status === 'ready', profile, error: profile.message || '' };
    },

    async checkAccess(request) {
      const allowedPermissions = new Set(Object.values(PERMISSIONS));
      if (!allowedPermissions.has(request.permission)) {
        return { success: false, allowed: false, error: 'Unknown permission.' };
      }

      const profile = await accessRegistry.getCurrentProfile({ forceRefresh: request.forceRefresh === true });
      let allowed = hasPermission(profile, request.permission);
      const platforms = new Set();
      addPlatformCandidate(platforms, request.platform);
      addUrlCandidate(platforms, request.url);
      if (allowed && platforms.size > 0) {
        allowed = [...platforms].every((platform) => hasPlatformAccess(profile, platform));
      }
      return { success: true, allowed, platforms: [...platforms], profile };
    },

    async listAccessUsers(request) {
      const actorProfile = request[ACCESS_CONTEXT];
      const result = await customerMembershipService.listMembers(actorProfile, request.query || '');
      return { success: true, ...result };
    },

    async updateAccessUser(request) {
      const actorProfile = request[ACCESS_CONTEXT];
      const result = await customerMembershipService.mutateMember(actorProfile, request.mutation);
      let profile = null;
      if (result.member.email === actorProfile.email) {
        await accessRegistry.clearProfileCache();
        profile = await accessRegistry.getCurrentProfile({ forceRefresh: true });
      }
      return { success: true, ...result, profile };
    },

    async checkUserIdentity() {
      return { email: await getUserEmail() };
    },

    async checkWhitelist(request) {
      const profile = request[ACCESS_CONTEXT];
      return { authorized: await checkIfAuthorized(request.platform, request.handle, profile.integrations) };
    },

    async findEventUrl(request) {
      return searchWorkflow.handleDynamicSearch(request.data);
    },

    async getVerticalData(request) {
      const profile = request[ACCESS_CONTEXT];
      return { success: true, data: await getEventData(request.vertical, profile.integrations) };
    },

    async botSearchComplete(request) {
      return searchWorkflow.handleBotSearchComplete(request.url);
    },

    async botSearchFailed(request) {
      return searchWorkflow.handleBotSearchFailed(request.reason);
    },

    async scanSheetForActiveLinks(request) {
      return sheetScanner.scanSheetForActiveLinks(request.platform, request.vertical, request.startRow);
    },

    async processNewItem(request, sender) {
      return reportingWorkflow.handleProcessNewItem(sender.tab, request.data);
    },

    async logToSheet(request) {
      return reportingWorkflow.handleBatchReport(request.data);
    },

    async processQueue(request) {
      const response = await reportingWorkflow.handleBatchReport(request.data);
      if (response.success) {
        chrome.runtime.sendMessage({ action: 'progressComplete' }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({ action: 'progressError', error: response.error }).catch(() => {});
      }
      return response;
    },

    async processFacebookLog(request, sender) {
      try {
        const response = await reportingWorkflow.handleFacebookBatchReport(request.data, {
          composerTabId: sender?.tab?.id,
          windowId: sender?.tab?.windowId
        });
        if (response.success) {
          chrome.runtime.sendMessage({
            action: 'progressComplete',
            workflow: 'facebook',
            reportedCount: response.reportedCount || 0,
            remainingCount: response.remainingCount || 0
          }).catch(() => {});
        } else {
          chrome.runtime.sendMessage({
            action: 'progressError',
            workflow: 'facebook',
            error: response.error
          }).catch(() => {});
        }
        return response;
      } catch (error) {
        chrome.runtime.sendMessage({
          action: 'progressError',
          workflow: 'facebook',
          error: error.message || 'Facebook logging failed.'
        }).catch(() => {});
        return { success: false, error: error.message };
      }
    },

    async processTwitchLog(request, sender) {
      try {
        const response = await reportingWorkflow.handleTwitchBatchReport(request.data, {
          composerTabId: sender?.tab?.id,
          windowId: sender?.tab?.windowId
        });
        if (response.success) {
          chrome.runtime.sendMessage({
            action: 'progressComplete',
            workflow: 'twitch',
            reportedCount: response.reportedCount || 0,
            remainingCount: response.remainingCount || 0
          }).catch(() => {});
        } else {
          chrome.runtime.sendMessage({
            action: 'progressError',
            workflow: 'twitch',
            error: response.error
          }).catch(() => {});
        }
        return response;
      } catch (error) {
        chrome.runtime.sendMessage({
          action: 'progressError',
          workflow: 'twitch',
          error: error.message || 'Twitch logging failed.'
        }).catch(() => {});
        return { success: false, error: error.message };
      }
    },

    async startRumbleQueue(request) {
      return rumbleWorkflow.start(request.data);
    },

    async advanceRumbleQueue(request, sender) {
      const response = await rumbleWorkflow.advance(request.currentUrl, sender?.tab?.id);
      if (response.done) {
        if (response.success) {
          chrome.runtime.sendMessage({ action: 'progressComplete' }).catch(() => {});
        } else {
          chrome.runtime.sendMessage({ action: 'progressError', error: response.error || 'Rumble logging failed.' }).catch(() => {});
        }
      }
      return response;
    },

    async cancelRumbleQueue() {
      return rumbleWorkflow.cancel();
    },

    async getConfig() {
      return { success: true, config: await fetchConfig() };
    },

    async updateSharedConfig(request) {
      const sections = request.sections || {};
      if (sections.platform_selectors) {
        const profile = request[ACCESS_CONTEXT] || await accessRegistry.requirePermission(PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS);
        if (!hasPermission(profile, PERMISSIONS.SETTINGS_SELECTOR_PATHS)) {
          throw new Error('Access denied: Selector Path editing is restricted to administrators.');
        }

        const platform = normalizeAccessPlatform(request.platform);
        if (!platform || platform === 'all' || !sections.platform_selectors[platform]) {
          throw new Error('A valid assigned platform is required for selector configuration updates.');
        }

        await accessRegistry.requirePlatform(profile, platform);

        const currentConfig = await fetchConfig();
        const mergedPlatformSelectors = {
          ...(currentConfig.platform_selectors || {}),
          [platform]: sections.platform_selectors[platform]
        };
        const config = await updateConfigSections({ platform_selectors: mergedPlatformSelectors });
        return { success: true, config };
      }

      return { success: true, config: await updateConfigSections(sections) };
    },

    async getRecommendedStartRow(request) {
      const profile = request[ACCESS_CONTEXT];
      return { success: true, row: await getRecommendedStartRow(profile.integrations) };
    },

    async getGamificationStats(request) {
      const profile = request[ACCESS_CONTEXT] || await accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_SCOREBOARD);
      return handleGamificationStats(profile);
    },

    async getMigrationStatus(request) {
      const profile = request[ACCESS_CONTEXT] || await accessRegistry.requirePermission(PERMISSIONS.SETTINGS_ADMIN_ACCESS);
      return { success: true, migration: await customerMigrationService.getStatus(profile) };
    },

    async patchSelectorConfig(request) {
      return {
        success: true,
        config: await patchConfigSelector(
          request.platform,
          request.section,
          request.field,
          request.selector,
          request.actionType
        )
      };
    },

    async submitSuggestion(request) {
      const token = await getAuthToken();
      const userEmail = (await getUserEmail()) || 'Unknown User';
      await submitSuggestionToSheet(token, request.text, userEmail);
      return { success: true };
    },

    async generateIntelligenceReport(request) {
      return handleGenerateIntelligenceReport(request);
    },

    async startMacroSession(request) {
      return macroWorkflow.startMacroSession(request.platform);
    },

    async compileMacro() {
      return macroWorkflow.compileMacro();
    },

    async recordMacroStep(request) {
      return macroWorkflow.recordMacroStep(request.step);
    },

    async addToCart(request, sender) {
      return reportingWorkflow.handleAddVideo(sender.tab, request.data);
    },

    async clearCart() {
      await Promise.all([chrome.storage.local.remove('piracy_cart'), clearImages()]);
      return { success: true };
    },

    async undoCart() {
      return reportingWorkflow.undoCart();
    },

    async saveEventUrl(request) {
      await reportingWorkflow.handleUrlSave(request.data);
      return { success: true };
    },

    async openPopup(request, sender) {
      void request;
      return openSidePanelForSender(sender);
    },

    async appendEventToSheet(request) {
      const { vertical, eventName, eventUrl } = request.data;
      const profile = request[ACCESS_CONTEXT];
      await customerDataService.recordEvent(profile, 'event.source_url_updated', {
        platform: 'tiktok',
        target_url: eventUrl,
        source_event_name: eventName,
        vertical
      });
      await addNewEventToSheet(vertical, eventName, eventUrl, 'tiktok', profile.integrations);
      return { success: true };
    },

    async triggerCloser(request) {
      const profile = request[ACCESS_CONTEXT] || await accessRegistry.requirePermission(PERMISSIONS.SIDEPANEL_AUTOMATE);
      return sheetScanner.run(request.startRow || 1, {
        durationMinutes: request.durationMinutes,
        allowedPlatforms: profile.platforms,
        customerProfile: profile
      });
    },

    async stopSheetScanner() {
      sheetScanner.stop();
      return { success: true };
    },

    async initRogueTakedown(request) {
      return rogueWorkflow.capture(request.data);
    },

    async logRogueToSheet(request) {
      return rogueWorkflow.log(request.data, request.notes);
    }
  };
}

function registerMessageRouter() {
  const actionHandlers = createActionHandlers();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = actionHandlers[request.action];
    if (!handler) return false;

    Promise.resolve(authorizeAction(request.action, request))
      .then(() => handler(request, sender))
      .then((response) => {
        sendResponse(response ?? { success: true });
      })
      .catch((error) => {
        console.error(`Action ${request.action} failed:`, error);
        sendResponse({
          success: false,
          error: error.message,
          errorCode: error.code || 'action_failed',
          utilization: error.utilization || null
        });
      });

    return true;
  });
}

setupBrowserEventListeners();
registerMessageRouter();
