import {
  extractHandleFromUrl,
  isInternalManagedUrl,
  urlMatchesPlatform
} from '../utils/platforms.js';

export function createSheetScanner({
  getColumnHDataWithFormatting,
  updateRowStatus,
  updateCellWithRichText,
  addEnforcerBonusPoints,
  getUserEmail,
  fetchConfig = async () => ({})
}) {
  let stopRequested = false;
  let isRunning = false;
  let heartbeatPort = null;
  let selectorConfigCache = null;

  function sendProgress(status, details) {
    if (!heartbeatPort) {
      heartbeatPort = chrome.runtime.connect({ name: 'sw-heartbeat' });
      heartbeatPort.onDisconnect.addListener(() => {
        heartbeatPort = null;
      });
    }

    try {
      heartbeatPort.postMessage({ ping: true });
    } catch (error) {
      heartbeatPort = null;
    }

    chrome.runtime.sendMessage({
      action: 'closerProgress',
      status,
      details
    }).catch(() => {});
  }

  function isUrlCrossedOut(startIndex, endIndex, formatRuns, cellStrikethrough) {
    if (cellStrikethrough) return true;
    if (!formatRuns || formatRuns.length === 0) return false;

    let appliedFormat = null;
    for (let index = 0; index < formatRuns.length; index++) {
      const run = formatRuns[index];
      if (run.startIndex <= startIndex) {
        appliedFormat = run.format;
      } else {
        break;
      }
    }

    return appliedFormat?.strikethrough === true;
  }

  async function getPlatformScraperConfig(platform) {
    try {
      if (!selectorConfigCache) {
        selectorConfigCache = await fetchConfig();
      }

      const platformKey = platform === 'x' ? 'twitter' : platform;
      return selectorConfigCache?.platform_selectors?.[platformKey]?.scraper || {};
    } catch (error) {
      console.warn('Unable to load closer selector config. Using built-in fallbacks.', error);
      return {};
    }
  }

  async function verifyTakedownViaTab(url, platform, scraperConfig = {}) {
    let tabId = null;

    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve('timeout');
        }, 20000);

        const listener = (updatedTabId, info, tabData) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            if (tabData.url && (tabData.url === 'about:blank' || tabData.url.startsWith('chrome://'))) {
              return;
            }

            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve('complete');
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (targetPlatform, platformScraperConfig = {}) =>
          new Promise((resolve) => {
            let attempts = 0;

            const checkStatus = () => {
              const text = document.body.innerText.toLowerCase();
              const title = document.title.toLowerCase();

              if (title.includes('404') || title.includes('not found') || title.includes('page not found')) {
                return resolve(true);
              }

              if (targetPlatform === 'tiktok') {
                if (text.includes('video currently unavailable')) return resolve(true);
                if (text.includes('video not found')) return resolve(true);
                if (text.includes("couldn't find this account")) return resolve(true);
                if (text.includes('page not available')) return resolve(true);
                if (document.querySelector('[data-e2e="video-removed"]')) return resolve(true);

                if (document.querySelector('[data-e2e="video-views"]') || document.querySelector('video')) {
                  return resolve(false);
                }
              }

              if (targetPlatform === 'youtube') {
                if (
                  document.querySelector('yt-player-error-message-renderer') ||
                  document.querySelector('ytd-video-error-message-renderer')
                ) {
                  return resolve(true);
                }

                if (text.includes('video unavailable')) return resolve(true);
                if (text.includes('video has been removed')) return resolve(true);
                if (text.includes('video is private')) return resolve(true);
                if (text.includes('this video is no longer available')) return resolve(true);
                if (text.includes('account has been terminated')) return resolve(true);
                if (text.includes('copyright claim by flosports')) return resolve(true);
                if (window.location.href === 'https://www.youtube.com/') return resolve(true);

                if (text.includes('before you continue to youtube')) return resolve(false);

                if (
                  document.querySelector('ytd-watch-metadata') ||
                  document.querySelector('ytd-video-primary-info-renderer')
                ) {
                  setTimeout(() => {
                    const doubleCheckText = document.body.innerText.toLowerCase();
                    if (
                      document.querySelector('yt-player-error-message-renderer') ||
                      document.querySelector('ytd-video-error-message-renderer') ||
                      doubleCheckText.includes('video unavailable') ||
                      doubleCheckText.includes('video has been removed') ||
                      doubleCheckText.includes('video is private') ||
                      doubleCheckText.includes('this video is no longer available') ||
                      doubleCheckText.includes('copyright claim')
                    ) {
                      resolve(true);
                    } else {
                      resolve(false);
                    }
                  }, 2500);
                  return;
                }
              }

              if (targetPlatform === 'twitter' || targetPlatform === 'x') {
                const configuredList = (value, fallback = []) => {
                  const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
                  const normalizedValues = rawValues
                    .map((entry) => (typeof entry === 'string' ? entry : entry?.selector))
                    .filter(Boolean);
                  return normalizedValues.length > 0 ? normalizedValues : fallback;
                };
                const queryAllByPath = (selector) => {
                  try {
                    if (selector.startsWith('//') || selector.startsWith('(')) {
                      const snapshot = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                      const nodes = [];
                      for (let index = 0; index < snapshot.snapshotLength; index++) {
                        nodes.push(snapshot.snapshotItem(index));
                      }
                      return nodes;
                    }

                    return Array.from(document.querySelectorAll(selector));
                  } catch (error) {
                    return [];
                  }
                };
                const normalizeTwitterStatusText = (value) => String(value || '')
                  .toLowerCase()
                  .replace(/[\u2018\u2019`]/g, "'")
                  .replace(/\s+/g, ' ')
                  .trim();
                const twitterDownMessages = configuredList(platformScraperConfig.takedown_patterns, [
                  "this page doesn't exist",
                  'this post has been deleted',
                  'tweet has been deleted',
                  'account suspended',
                  'this media has been disabled in response to a report by the copyright owner',
                  'this media has been disabled',
                  'disabled in response to a report by the copyright owner'
                ]);
                const twitterMessageSelectors = configuredList(platformScraperConfig.takedown_messages, [
                  '[data-testid="tweetText"] span',
                  '[data-testid="tweetText"]',
                  '[data-testid="videoPlayer"] span',
                  'article[data-testid="tweet"] span'
                ]);
                const twitterActiveMediaSelectors = configuredList(platformScraperConfig.active_media, [
                  '[data-testid="videoPlayer"] video',
                  '[data-testid="videoPlayer"]',
                  'video[aria-label="Embedded video"]',
                  'article[data-testid="tweet"] video',
                  'video'
                ]);
                const matchesTwitterDownMessage = (candidate) => {
                  const normalizedCandidate = normalizeTwitterStatusText(candidate);
                  return twitterDownMessages.some((message) => normalizedCandidate.includes(normalizeTwitterStatusText(message)));
                };
                const getTwitterSelectorText = () => twitterMessageSelectors
                  .flatMap((selector) => queryAllByPath(selector))
                  .map((element) => [
                    element.innerText || '',
                    element.textContent || '',
                    element.getAttribute?.('title') || '',
                    element.getAttribute?.('aria-label') || ''
                  ].join(' '))
                  .join(' ');
                const hasTwitterActiveMedia = () => twitterActiveMediaSelectors.some((selector) => queryAllByPath(selector).length > 0);
                const currentTwitterStatusText = [
                  title,
                  text,
                  getTwitterSelectorText()
                ].join(' ');

                if (matchesTwitterDownMessage(currentTwitterStatusText)) {
                  return resolve(true);
                }

                if (document.querySelector('article[data-testid="tweet"]') || hasTwitterActiveMedia()) {
                  setTimeout(() => {
                    const doubleCheckText = [
                      document.title || '',
                      document.body.innerText || '',
                      getTwitterSelectorText()
                    ].join(' ');

                    if (matchesTwitterDownMessage(doubleCheckText)) {
                      resolve(true);
                    } else {
                      resolve(false);
                    }
                  }, 2500);
                  return;
                }
              }

              if (targetPlatform === 'instagram' || targetPlatform === 'facebook') {
                if (text.includes("sorry, this page isn't available")) return resolve(true);
                if (text.includes('link you followed may be broken')) return resolve(true);
                if (text.includes("content isn't available")) return resolve(true);
                if (text.includes('account has been suspended')) return resolve(true);
                if (text.includes("this video isn't available")) return resolve(true);
              }

              if (targetPlatform === 'rumble') {
                if (text.includes('this video is unavailable') || text.includes('page not found')) {
                  return resolve(true);
                }
              }

              if (targetPlatform === 'discord') {
                if (text.includes('invalid message') || text.includes('message deleted')) {
                  return resolve(true);
                }
              }

              attempts++;
              if (attempts >= 30) return resolve(false);
              setTimeout(checkStatus, 500);
            };

            checkStatus();
          }),
        args: [platform, scraperConfig]
      });

      return result[0]?.result || false;
    } finally {
      if (tabId) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  }

  async function run(startRowUI = 1, maxConcurrentTabs = 4) {
    void maxConcurrentTabs;

    if (isRunning) return;

    isRunning = true;
    stopRequested = false;
    selectorConfigCache = null;
    sendProgress(`Starting from Row ${startRowUI}`, 'Fetching sheet data with formatting...');

    try {
      const rows = await getColumnHDataWithFormatting();
      let consecutiveBlanks = 0;
      const startIndex = Math.max(0, startRowUI - 1);

      if (startIndex >= rows.length) {
        sendProgress('Scanner Stopped', `Row ${startRowUI} is out of bounds. The sheet only has ${rows.length} rows.`);
        return;
      }

      for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex++) {
        if (stopRequested) {
          sendProgress('Scanner Stopped', 'User interrupted the process.');
          break;
        }

        const cellData = rows[rowIndex];
        if (!cellData || !cellData.text) {
          consecutiveBlanks++;
          if (consecutiveBlanks >= 3) {
            sendProgress('Scanner Complete', 'Hit 3 consecutive blank cells.');
            break;
          }
          continue;
        }

        consecutiveBlanks = 0;
        const cellValue = cellData.text;
        const matches = [];
        const urlRegex = /https?:\/\/[^\s,]+/g;

        let match;
        while ((match = urlRegex.exec(cellValue)) !== null) {
          matches.push({
            url: match[0],
            index: match.index,
            end: match.index + match[0].length
          });
        }

        if (matches.length === 0) continue;

        sendProgress(`Scanning Row ${rowIndex + 1}`, `Checking ${matches.length} link(s)...`);

        let newlyStruck = 0;
        let totalActive = 0;
        let previouslyDeadCount = 0;
        const deadRanges = [];

        for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
          if (stopRequested) break;

          const { url, index, end } = matches[matchIndex];
          if (isInternalManagedUrl(url)) continue;

          const isCrossedOut = isUrlCrossedOut(index, end, cellData.formatRuns, cellData.cellStrikethrough);
          if (isCrossedOut) {
            previouslyDeadCount++;
            deadRanges.push({ start: index, end, url });
            continue;
          }

          sendProgress(`Row ${rowIndex + 1}`, `Link ${matchIndex + 1}/${matches.length}: Checking availability...`);

          let platform = 'unknown';
          if (url.includes('tiktok')) platform = 'tiktok';
          else if (url.includes('youtube') || url.includes('youtu.be')) platform = 'youtube';
          else if (url.includes('twitter') || url.includes('x.com')) platform = 'twitter';
          else if (url.includes('instagram')) platform = 'instagram';
          else if (url.includes('facebook')) platform = 'facebook';
          else if (url.includes('twitch')) platform = 'twitch';

          let isDown = false;
          try {
            const scraperConfig = await getPlatformScraperConfig(platform);
            isDown = await verifyTakedownViaTab(url, platform, scraperConfig);
          } catch (error) {
            console.error('Link check failed:', error);
          }

          if (isDown) {
            newlyStruck++;
            deadRanges.push({ start: index, end, url });
            sendProgress(`Row ${rowIndex + 1}`, `Link ${matchIndex + 1}/${matches.length} is DOWN. Crossing out...`);

            const defaultStyle = {
              strikethrough: false,
              foregroundColor: { red: 0, green: 0, blue: 0 },
              underline: false
            };
            const deadStyle = {
              strikethrough: true,
              foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 },
              underline: false
            };
            const activeLinkStyle = {
              foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 },
              underline: true,
              strikethrough: false
            };

            const currentLinkRanges = matches
              .map((currentMatch) => {
                const isDead = deadRanges.some(
                  (deadRange) => deadRange.url === currentMatch.url && deadRange.start === currentMatch.index
                );

                if (isDead) {
                  return { start: currentMatch.index, end: currentMatch.end, style: deadStyle };
                }

                return {
                  start: currentMatch.index,
                  end: currentMatch.end,
                  style: { ...activeLinkStyle, link: { uri: currentMatch.url } }
                };
              })
              .sort((left, right) => left.start - right.start);

            const newRuns = [];
            let cursor = 0;

            for (const range of currentLinkRanges) {
              if (range.start > cursor) {
                newRuns.push({ startIndex: cursor, format: defaultStyle });
              }

              newRuns.push({ startIndex: range.start, format: range.style });
              cursor = range.end;
            }

            if (cursor < cellValue.length) {
              newRuns.push({ startIndex: cursor, format: defaultStyle });
            }

            await updateCellWithRichText(rowIndex, cellValue, newRuns);
          } else {
            totalActive++;
            sendProgress(`Row ${rowIndex + 1}`, `Link ${matchIndex + 1}/${matches.length} is ACTIVE.`);
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (stopRequested) break;

        const totalDead = newlyStruck + previouslyDeadCount;
        if (totalDead > 0 && totalActive === 0) {
          await updateRowStatus(rowIndex, 'Resolved');
          sendProgress(`Row ${rowIndex + 1}`, 'All links DOWN. Row resolved.');
          if (newlyStruck > 0) {
            await addEnforcerBonusPoints(rowIndex, newlyStruck * 15);
          }
        } else if (totalActive > 0) {
          await updateRowStatus(rowIndex, 'Investigating');
          sendProgress(
            `Row ${rowIndex + 1}`,
            totalDead > 0 ? 'Mixed links. Marked Investigating.' : 'Row is ACTIVE.'
          );
        }
      }

      if (!stopRequested) {
        sendProgress('Scanner Complete', 'Finished processing rows.');
      }
    } catch (error) {
      console.error('Sheet Scanner Failed:', error);
      sendProgress('Scanner Failed', error.message);
    } finally {
      isRunning = false;
    }
  }

  async function scanSheetForActiveLinks(platform, vertical, startRowUI = 1) {
    void vertical;

    stopRequested = false;
    selectorConfigCache = null;

    try {
      const scannerEmail = (await getUserEmail()) || 'Unknown';
      const rows = await getColumnHDataWithFormatting();

      if (!rows || rows.length === 0) {
        return { success: false, error: 'Failed to fetch sheet data' };
      }

      const activeLinks = [];
      const startIndex = Math.max(0, startRowUI - 1);
      const activeWorkers = [];
      const maxConcurrentTabs = 3;

      for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex++) {
        if (stopRequested || activeLinks.length >= 100) break;

        const cellData = rows[rowIndex];
        if (!cellData || !cellData.text) continue;

        const matches = [];
        const urlRegex = /https?:\/\/[^\s,]+/g;
        let match;

        while ((match = urlRegex.exec(cellData.text)) !== null) {
          matches.push({
            url: match[0],
            index: match.index,
            end: match.index + match[0].length
          });
        }

        for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
          if (stopRequested || activeLinks.length >= 100) break;

          const { url, index, end } = matches[matchIndex];
          if (isInternalManagedUrl(url)) continue;
          if (!urlMatchesPlatform(url, platform)) continue;
          if (isUrlCrossedOut(index, end, cellData.formatRuns, cellData.cellStrikethrough)) continue;

          chrome.runtime.sendMessage({
            action: 'scanProgress',
            message: `Scanning Row ${rowIndex + 1} | Link ${matchIndex + 1} of ${matches.length}`
          }).catch(() => {});

          const checkTask = (async () => {
            const scraperConfig = await getPlatformScraperConfig(platform);
            const isDown = await verifyTakedownViaTab(url, platform, scraperConfig);
            if (isDown) return;

            activeLinks.push({
              url,
              platform,
              handle: extractHandleFromUrl(url),
              views: 'N/A',
              timestamp: new Date().toISOString(),
              scoutedBy: `Auto-Scanner (${scannerEmail})`
            });
          })().catch((error) => {
            console.error('Worker Error:', error);
          });

          activeWorkers.push(checkTask);
          checkTask.finally(() => {
            const taskIndex = activeWorkers.indexOf(checkTask);
            if (taskIndex >= 0) {
              activeWorkers.splice(taskIndex, 1);
            }
          });

          if (activeWorkers.length >= maxConcurrentTabs) {
            await Promise.race(activeWorkers);
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      await Promise.all(activeWorkers);

      const storage = await chrome.storage.local.get('piracy_cart');
      const existingCart = storage.piracy_cart || [];
      let queueCount = existingCart.length;

      if (activeLinks.length > 0) {
        const uniqueCart = Array.from(
          new Map([...existingCart, ...activeLinks].map((item) => [item.url, item])).values()
        );

        await chrome.storage.local.set({ piracy_cart: uniqueCart });
        queueCount = uniqueCart.length;
      }

      return { success: true, count: activeLinks.length, queueCount };
    } catch (error) {
      console.error('Scan Sheet Error:', error);
      return { success: false, error: error.message };
    }
  }

  return {
    run,
    stop() {
      stopRequested = true;
    },
    scanSheetForActiveLinks
  };
}
