import { getAuthToken, getUserEmail } from '../utils/auth.js';
import {
  addNewEventToSheet,
  appendToSheet,
  checkIfAuthorized,
  ensureRogueScreenshotFolder,
  fetchConfig,
  fetchIntelligenceData,
  fetchLeaderboardData,
  getColumnHDataWithFormatting,
  getEventData,
  getRecommendedStartRow,
  logRogueToSheet,
  patchConfigSelector,
  submitSuggestionToSheet,
  updateCellWithRichText,
  updateEventUrl,
  updateRowStatus,
  setColumnKRichText,
  addEnforcerBonusPoints,
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
import { createSearchWorkflow } from './services/search_workflow.js';

const ALARM_NAME = 'theCloser';

const sheetScanner = createSheetScanner({
  getColumnHDataWithFormatting,
  updateRowStatus,
  updateCellWithRichText,
  addEnforcerBonusPoints,
  getUserEmail,
  fetchConfig
});

const searchWorkflow = createSearchWorkflow({
  addNewEventToSheet,
  getEventData,
  updateEventUrl
});

const rogueWorkflow = createRogueWorkflow({
  base64ToBlob,
  ensureRogueScreenshotFolder,
  getAuthToken,
  logRogueToSheet,
  uploadToDrive
});

const macroWorkflow = createMacroWorkflow();

const reportingWorkflow = createReportingWorkflow({
  appendToSheet,
  checkIfAuthorized,
  clearImages,
  ensureDailyScreenshotFolder,
  ensureYearlyReportFolder,
  generatePDF,
  getAuthToken,
  getEventData,
  getImage,
  getUserEmail,
  saveImage,
  saveUrlToSheet: async (vertical, rowOrEventName, url, platform, shouldAppend = false) => {
    if (shouldAppend) {
      return addNewEventToSheet(vertical, rowOrEventName, url, platform);
    }
    return updateEventUrl(vertical, rowOrEventName, url, platform);
  },
  setColumnKRichText,
  uploadToDrive,
  base64ToBlob
});

<<<<<<< Updated upstream
=======
const rumbleWorkflow = createRumbleWorkflow({
  handleBatchReport: reportingWorkflow.handleBatchReport,
  handleRumbleBatchReport: reportingWorkflow.handleRumbleBatchReport
});

>>>>>>> Stashed changes
function maybeBroadcastManagedSourceUrl(url) {
  const normalizedUrl = String(url || '').toLowerCase();
  if (
    normalizedUrl.includes('flosports') ||
    normalizedUrl.includes('varsity') ||
    normalizedUrl.includes('milesplit')
  ) {
    chrome.runtime.sendMessage({ action: 'activeUrlChanged', url }).catch(() => {});
  }
}

function setupBrowserEventListeners() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      maybeBroadcastManagedSourceUrl(tab.url);
    } catch (error) {
      console.warn('Active tab lookup failed:', error);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void tabId;
    if (changeInfo.url && tab?.active) {
      maybeBroadcastManagedSourceUrl(changeInfo.url);
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
    chrome.storage.local.set({ onboarding_step: 'NEEDS_CONFIG' });
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    const { closer_enabled } = await chrome.storage.local.get('closer_enabled');
    if (closer_enabled) {
      await sheetScanner.run(1);
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

async function handleGamificationStats() {
  try {
    const email = await getUserEmail();
    if (!email) return null;
    return await fetchLeaderboardData(email);
  } catch (error) {
    console.error('Leaderboard fetch error:', error);
    return {
      error: true,
      scoutPoints: '-',
      enforcerPoints: '-',
      scoutRank: 'Offline',
      enforcerRank: 'Offline',
      teamTotal: '-',
      topScouts: [{ name: 'Network Disconnected', points: 0 }],
      topEnforcers: [{ name: 'Retrying...', points: 0 }]
    };
  }
}

async function handleGenerateIntelligenceReport(request) {
  const token = await getAuthToken();
  const stats = await fetchIntelligenceData(request.startDate, request.endDate);
  if (!stats) {
    throw new Error('No data available for this timeframe.');
  }

  const pdfBlob = await generateIntelligencePDF(stats);
  const storage = await chrome.storage.sync.get('piracy_folder_id');
  const driveRootId = storage.piracy_folder_id;
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
  const uploadRes = await uploadToDrive(token, folderId, filename, pdfBlob, 'application/pdf');
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
    async checkUserIdentity() {
      return { email: await getUserEmail() };
    },

    async checkWhitelist(request) {
      return { authorized: await checkIfAuthorized(request.platform, request.handle) };
    },

    async findEventUrl(request) {
      return searchWorkflow.handleDynamicSearch(request.data);
    },

    async getVerticalData(request) {
      return { success: true, data: await getEventData(request.vertical) };
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
        chrome.runtime.sendMessage({
          action: 'progressComplete',
          reportedCount: response.reportedCount || 0,
          remainingCount: response.remainingCount || 0
        }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({ action: 'progressError', error: response.error }).catch(() => {});
      }
      return response;
    },

    async processKickLog(request, sender) {
      const response = await reportingWorkflow.handleKickBatchReport(request.data, {
        composerTabId: sender?.tab?.id,
        windowId: sender?.tab?.windowId
      });
      if (response.success) {
        chrome.runtime.sendMessage({ action: 'progressComplete' }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({ action: 'progressError', error: response.error }).catch(() => {});
      }
      return response;
    },

<<<<<<< Updated upstream
=======
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

>>>>>>> Stashed changes
    async getConfig() {
      return { success: true, config: await fetchConfig() };
    },

    async getRecommendedStartRow() {
      return { success: true, row: await getRecommendedStartRow() };
    },

    async getGamificationStats() {
      return handleGamificationStats();
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
      await addNewEventToSheet(vertical, eventName, eventUrl);
      return { success: true };
    },

    async triggerCloser(request) {
      await sheetScanner.run(request.startRow || 1, request.maxTabs || 4);
      return { success: true };
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

    Promise.resolve(handler(request, sender))
      .then((response) => {
        sendResponse(response ?? { success: true });
      })
      .catch((error) => {
        console.error(`Action ${request.action} failed:`, error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  });
}

setupBrowserEventListeners();
registerMessageRouter();
