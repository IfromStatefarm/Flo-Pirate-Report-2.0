// content_scraper.js

(function() { // Wrap in IIFE to prevent variable leaks
  
     // Guard against IFrame/Ad injection (Only run in main window)
  if (window.self !== window.top) return;
  
  const forceOverlayRun = window.__floForceOverlay === true;

  // Guard against re-injection
  if (window.hasFloScraperRun) return;
  window.hasFloScraperRun = true;

  // --- IDENTITY ENFORCEMENT OVERLAY ---
  // This function checks if the user is logged in with a @flosports.tv email and shows an overlay if not  
  // Global Exemption List: Prevents overlay from opening and logic from running
  const EXEMPT_WEBSITES = [
    'varsity.com', 'flosports.tv', 'floracing.tv', 'milesplit.com', 'houston.flosports.net', 
    'google.com', 'amazon.com', 'flocasts.atlassian.net', 'gemini.google.com', 
    'chatgpt.com', 'fso-heatmap.vercel.app', 'gmail.com', 'app.slack.com', '10.43.29.8', 
    'flosports.okta.com', 'hockeytech.zen.zixi.com', 'workforcenow.adp.com', 'flosports.kazoohr.com', 'flosports.tv', 'go.flosports.tv', 'floracing.com', 'flocollege.com', 'flowrestling.org', 
    'arena.flowrestling.com', 'flograppling.com', 'flohockey.tv', 'flocheer.com', 'varsity.tv', 'tv.varsity.com', 'flotrack.org', 'milesplit.com', 'milesplit.live', 'flomarching.com', 'florugby.com',
    'flobikes.com', 'flofootball.com', 'flohoops.com', 'flobaseball.tv', 'flosoftball.com', 'flofc.com', 'flovolleyball.tv', 'floswimming.com', 'flolive.tv', 'flobowling.com', 'flodance.com', 'flovoice.com', 
    'florodeo.com', 'flocombat.com', 'floelite.com', 'flogymnastics.com', 'dirtondirt.com', 'trackwrestling.com', 'directathletics.com', 'tfrrs.org', 'tfmeetpro.com', 'hockeytech.com', 'hockeytv.com', 'lucasdirt.com',
    'flosports', 'app.hibob.com', 'dashboard.airbase.io', 'app.ashbyhq.com', 'flosports.ziphq.com', 'flowrestling.org', 'flograppling', 'floracing', 'flograppling', 'flocycling',  
    'sites.google.com', 'flosports.latticehq.com', 'keep.google.com', 'github.com', 'flodogs.com','drive.google.com'
  ];
  if (!forceOverlayRun && EXEMPT_WEBSITES.some(domain => window.location.hostname.toLowerCase().includes(domain))) return;

  let currentCount = 0;

  // DEFAULT SELECTORS (Robust Fallbacks)
  let SCRAPER_CONFIG = {
    tiktok: {
      views: [
          '[data-e2e="video-views"]',
          'strong[data-e2e="video-views"]'
      ],
      url_match: "@([^/]+)\\/(?:video|photo)\\/(\\d+)"
    },
    youtube: {
      channel_link: '#channel-name a',
      views_std: 'span.view-count',
      views_shorts: 'span[role="text"][aria-label*="views"]'
    },
    instagram: {
      handle: 'header a'
    },
    twitter: {
      handle_links: [
        'article[data-testid="tweet"] [data-testid="User-Name"] a[href^="/"]',
        '[data-testid="tweet"] [data-testid="User-Name"] a[href^="/"]',
        '[data-testid="User-Name"] a[href^="/"]'
      ],
      handle: [
        'article[data-testid="tweet"] [data-testid="User-Name"] a[href^="/"] span',
        '[data-testid="tweet"] [data-testid="User-Name"] a[href^="/"] span',
        '[data-testid="User-Name"] a[href^="/"] span'
      ],
      views: [
        'article[data-testid="tweet"] a[href*="/analytics"] span',
        '[data-testid="tweet"] a[href*="/analytics"] span',
        'a[href*="/analytics"] span',
        'a[aria-label*="View post analytics" i] span',
        '[data-testid="app-text-transition-container"] span'
      ],
      views_analytics: [
        'article[data-testid="tweet"] a[href*="/analytics"]',
        '[data-testid="tweet"] a[href*="/analytics"]',
        'a[href*="/analytics"]',
        'a[aria-label*="View post analytics" i]'
      ],
      takedown_messages: [
        '[data-testid="tweetText"] span',
        '[data-testid="tweetText"]',
        '[data-testid="videoPlayer"] span',
        'article[data-testid="tweet"] span'
      ],
      takedown_patterns: [
        'this media has been disabled',
        'disabled in response to a report by the copyright owner',
        'this post has been deleted',
        'tweet has been deleted',
        "this page doesn't exist",
        'account suspended'
      ],
      active_media: [
        '[data-testid="videoPlayer"] video',
        '[data-testid="videoPlayer"]',
        'video[aria-label="Embedded video"]',
        'article[data-testid="tweet"] video',
        'video'
      ]
    },
    facebook: {},
    kick: {
      handle_links: [
        'a[href^="/"] img[alt]',
        'a[href^="/"][data-testid]',
        'a[href^="/"]'
      ],
      handle_name: [
        'a[href^="/"] img[alt]',
        'img#channel-avatar',
        'img[alt]'
      ],
      live_badge: [
        'button span[class*="bg-green-500"]',
        'span[class*="bg-green-500"][class*="text-neutral-900"]',
        'span.text-green-500',
        '[data-testid="live-badge"]',
        'button span'
      ],
      live_viewer_count: [
        '[data-testid="viewer-count"]',
        '[data-testid="viewer-count"] [style*="translateY"]'
      ],
      live_viewer_digit_columns: [
        '[data-testid="viewer-count"] .flex.overflow-hidden > div[style*="height: 20px"]',
        '[data-testid="viewer-count"] div[style*="height: 20px"][style*="width:"]'
      ],
      archived_views: [
        'span[title]',
        '.text-primary-base[title]'
      ],
      archived_view_labels: [
        'views',
        'watching'
      ]
    },
    twitch: {
      live_indicators: [
        '[data-a-target="stream-live-indicator"]',
        '[data-a-target="channel-status-text-indicator"]',
        '[class*="tw-channel-status-text-indicator"]',
        '[class*="ScChannelStatusTextIndicator"]',
        '#live-channel-stream-information [class*="channel-status-text-indicator"]',
        '[aria-label="LIVE"]'
      ],
      viewer_count: [
        '[data-a-target="animated-channel-viewers-count"]',
        '[data-a-target="channel-viewers-count"]',
        '[class*="ScAnimatedNumber"]',
        'strong[aria-hidden="true"] span'
      ],
      vod_indicators: [
        '[data-a-target="video-info-game-boxart-link"]',
        '[data-test-selector="metadata-layout__split-top"]',
        '[class*="metadata-layout__split-top"]',
        '[class*="timestamp-metadata__bar"]'
      ],
      vod_views: [
        '[data-a-target="video-info-game-boxart-link"] ~ p',
        '[data-test-selector="metadata-layout__split-top"] p',
        '[class*="metadata-layout__split-top"] p'
      ],
      clip_indicators: [
        'a[href*="/clip/"]',
        'a[href*="clips.twitch.tv"]',
        '[data-test-selector="metadata-layout__split-top"] a[href*="/clip/"]',
        '[class*="metadata-layout__split-top"] a[href*="/clip/"]'
      ],
      clip_views: [
        '[data-test-selector="metadata-layout__split-top"] p',
        '[class*="metadata-layout__split-top"] p',
        'p[class*="CoreText"]'
      ],
      handle_links: [
        '[data-test-selector="metadata-layout__split-top"] a[href^="/"]',
        '[class*="metadata-layout__split-top"] a[href^="/"]',
        'a[href^="/"][class*="CoreLink"]',
        'h1 a[href^="/"]',
        'a[href^="/"][data-a-target*="channel" i]',
        'a[href^="/"] h1'
      ]
    },
    rumble: {
<<<<<<< Updated upstream
      handle: '.media-by-heading .ellipsis-1, a.media-by--a'
=======
      handle: [
        '.media-heading-name',
        '.media-by-heading .ellipsis-1',
        'a.media-by--a',
        'a.channel-header--title',
        '.channel-header--title'
      ],
      candidate_channel_links: [
        'a.media-by--a[href]',
        '.media-by-heading a[href]',
        'a.channel-header--title[href]',
        'a[href^="/c/"]',
        'a[href^="/user/"]',
        'a[href^="/channel/"]'
      ],
      views: [
        '[data-js="media_description_info_views"]',
        '.media-description-info-views',
        '[data-js="media_description_section"] [class*="views"]',
        '.media-heading-info',
        '.video-description [class*="view"]',
        '.video-meta [class*="view"]'
      ],
      live_viewer_count: [
        '.live-video-view-count-status-count[title*="users watching now" i]',
        '.live-video-view-count-status-count',
        '[class*="live-video-view-count-status"] [title*="watching now" i]'
      ],
      live_indicators: [
        '.live-video-view-count-status-count[title*="users watching now" i]',
        '[class*="live-video-view-count-status"] [title*="watching now" i]',
        '.video-status--live',
        '.media-status.live'
      ]
>>>>>>> Stashed changes
    },
    discord: {
     handle: 'div[class*="username"]'
    }
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let configLoaded = false;

  // --- CONFIG LOADER ---
  const configLoadPromise = (async function loadConfig() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.success && response.config && response.config.platform_selectors) {
        console.log("✅ PIRATE AI: Remote Selectors Loaded");
        const remote = response.config.platform_selectors;
        if (remote.tiktok && remote.tiktok.scraper) SCRAPER_CONFIG.tiktok = { ...SCRAPER_CONFIG.tiktok, ...remote.tiktok.scraper };
        if (remote.youtube && remote.youtube.scraper) SCRAPER_CONFIG.youtube = { ...SCRAPER_CONFIG.youtube, ...remote.youtube.scraper };
        if (remote.instagram && remote.instagram.scraper) SCRAPER_CONFIG.instagram = { ...SCRAPER_CONFIG.instagram, ...remote.instagram.scraper };
        if (remote.twitter && remote.twitter.scraper) SCRAPER_CONFIG.twitter = { ...SCRAPER_CONFIG.twitter, ...remote.twitter.scraper };
<<<<<<< Updated upstream
=======
        if (remote.facebook && remote.facebook.scraper) SCRAPER_CONFIG.facebook = { ...SCRAPER_CONFIG.facebook, ...remote.facebook.scraper };
        if (remote.kick && remote.kick.scraper) SCRAPER_CONFIG.kick = { ...SCRAPER_CONFIG.kick, ...remote.kick.scraper };
        if (remote.twitch && remote.twitch.scraper) SCRAPER_CONFIG.twitch = { ...SCRAPER_CONFIG.twitch, ...remote.twitch.scraper };
        if (remote.rumble && remote.rumble.scraper) SCRAPER_CONFIG.rumble = { ...SCRAPER_CONFIG.rumble, ...remote.rumble.scraper };
        configLoaded = true;
>>>>>>> Stashed changes
      }
    } catch (e) {
      // Suppress heavy logging
    }
  })();
// Utility to check if the extension context is still valid (handles cases where the page might have navigated or reloaded)
  function isExtensionValid() {
    try { return !!chrome.runtime && !!chrome.runtime.id; } 
    catch (e) { return false; }
  }

  function handleContextInvalidated() {
    const overlay = document.getElementById('flo-overlay');
    if (overlay) {
      overlay.innerHTML = `<div style="padding:15px; color:#666;">⚠️ Extension Updated<br><button style="margin-top:5px; padding:5px;" onclick="location.reload()">Refresh Page</button></div>`;
      overlay.style.border = "2px solid red";
    } else {
      const errDiv = document.createElement('div');
      errDiv.style.cssText = "position: fixed; top: 150px; right: 20px; z-index: 2147483647; background: white; border: 2px solid red; padding: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: sans-serif;";
      errDiv.innerHTML = `⚠️ Extension Context Invalidated.<br><button style="margin-top:5px; padding:5px; cursor:pointer;" onclick="location.reload()">Refresh Page</button>`;
      document.body.appendChild(errDiv);
    }
  }

  // Helper to find element by CSS or XPath
  function findElement(selector) {
      if (!selector) return null;
      try {
          if (selector.startsWith('//') || selector.startsWith('(')) {
              const res = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              return res.singleNodeValue;
          } else {
              return document.querySelector(selector);
          }
      } catch (e) { 
          // console.warn("Selector error:", e);
          return null; 
      }
  }

<<<<<<< Updated upstream
=======
  function getElementsFromSelectorList(selectors) {
      const elements = [];
      const seen = new Set();

      for (const selector of toSelectorList(selectors)) {
          try {
              let found = [];
              if (selector.startsWith('//') || selector.startsWith('(')) {
                  const snapshot = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                  for (let i = 0; i < snapshot.snapshotLength; i += 1) {
                      found.push(snapshot.snapshotItem(i));
                  }
              } else {
                  found = Array.from(document.querySelectorAll(selector));
              }

              found.forEach((element) => {
                  if (element && !seen.has(element)) {
                      seen.add(element);
                      elements.push(element);
                  }
              });
          } catch (e) {
              // Ignore malformed selectors and continue.
          }
      }

      return elements;
  }

  function toSelectorList(value) {
      if (Array.isArray(value)) return value.filter(Boolean);
      return value ? [value] : [];
  }

  function getElementReadableText(element) {
      return (
          element?.innerText ||
          element?.textContent ||
          element?.getAttribute?.('title') ||
          element?.getAttribute?.('aria-label') ||
          ''
      ).trim();
  }

  function getTextFromSelectorList(selectors) {
      for (const selector of toSelectorList(selectors)) {
          const element = findElement(selector);
          if (!element) continue;
          const text = getElementReadableText(element);
          if (text) return text;
      }
      return '';
  }

  function getTextsFromSelectorList(selectors) {
      return getElementsFromSelectorList(selectors)
          .map((element) => getElementReadableText(element))
          .filter(Boolean);
  }

  function normalizeComparableText(value) {
      return String(value || '')
          .toLowerCase()
          .replace(/[\u2018\u2019`]/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
  }

  function textIncludesAnyPattern(text, patterns) {
      const normalizedText = normalizeComparableText(text);
      if (!normalizedText) return false;

      return toSelectorList(patterns).some((pattern) => {
          const normalizedPattern = normalizeComparableText(pattern);
          return normalizedPattern && normalizedText.includes(normalizedPattern);
      });
  }

  function getMatchingTextFromSelectorList(selectors, patterns) {
      for (const text of getTextsFromSelectorList(selectors)) {
          if (textIncludesAnyPattern(text, patterns)) return text;
      }
      return '';
  }

  function getFirstElementFromSelectorList(selectors) {
      for (const selector of toSelectorList(selectors)) {
          const element = findElement(selector);
          if (element) return element;
      }
      return null;
  }

  function getHrefFromSelectorList(selectors) {
      for (const selector of toSelectorList(selectors)) {
          const element = findElement(selector);
          if (!element) continue;
          const anchor = element.matches?.('a[href]')
              ? element
              : element.closest?.('a[href]') || element.querySelector?.('a[href]');
          const href = anchor?.href || element.getAttribute?.('href') || '';
          if (href) return href;
      }
      return '';
  }

  function getAttributeFromSelectorList(selectors, attributeName) {
      for (const element of getElementsFromSelectorList(selectors)) {
          const value = element?.getAttribute?.(attributeName) || '';
          if (value) return value.trim();
      }
      return '';
  }

  function normalizeScrapedHandle(value) {
      return String(value || '')
          .trim()
          .replace(/^@/, '')
          .replace(/^\/+|\/+$/g, '')
          .replace(/\s+/g, ' ');
  }

  function extractFirstPatternMatch(text, patterns) {
      for (const pattern of toSelectorList(patterns)) {
          try {
              const match = String(text || '').match(new RegExp(pattern, 'i'));
              if (match?.[1]) return match[1].trim();
          } catch (error) {
              // Ignore malformed regex patterns from config.
          }
      }
      return '';
  }

  function extractInstagramHandleFromHref(href) {
      if (!href) return '';
      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          if (pathParts.length === 0) return '';

          const reservedSegments = new Set([
              'accounts',
              'api',
              'challenge',
              'developer',
              'direct',
              'explore',
              'legal',
              'p',
              'reel',
              'reels',
              'stories',
              'tv'
          ]);

          if (pathParts[0] === 'stories' && pathParts[1]) {
              return normalizeScrapedHandle(pathParts[1]);
          }

          if (reservedSegments.has(pathParts[0].toLowerCase())) return '';
          return normalizeScrapedHandle(pathParts[0]);
      } catch (error) {
          return '';
      }
  }

  function getInstagramHandleFromProfileLinks(selectors) {
      for (const element of getElementsFromSelectorList(selectors)) {
          const href = element?.href || element?.getAttribute?.('href') || '';
          const handle = extractInstagramHandleFromHref(href);
          if (handle) return handle;
      }
      return '';
  }

  function getInstagramEmbeddedData(instagramConfig) {
      const rawTexts = getElementsFromSelectorList(
          instagramConfig.json_scripts || ['script[type="application/json"]']
      )
          .map((element) => element?.textContent || '')
          .filter((text) => /username|video_view_count|play_count|xdt_shortcode_media/i.test(text));

      const prioritizedTexts = rawTexts.filter((text) => /xdt_shortcode_media|video_view_count|play_count/i.test(text));
      const candidateTexts = prioritizedTexts.length > 0 ? prioritizedTexts : rawTexts;

      if (candidateTexts.length === 0) {
          return { handle: '', views: '' };
      }

      const joinedText = candidateTexts.join('\n');
      const handlePatterns = instagramConfig.json_patterns?.handle || [
          '"owner"\\s*:\\s*\\{[^{}]*?"username"\\s*:\\s*"([^"]+)"',
          '"user"\\s*:\\s*\\{[^{}]*?"username"\\s*:\\s*"([^"]+)"',
          '"username"\\s*:\\s*"([^"]+)"'
      ];
      const viewPatterns = instagramConfig.json_patterns?.view_count || [
          '"video_view_count"\\s*:\\s*(\\d+)',
          '"play_count"\\s*:\\s*(\\d+)',
          '"view_count"\\s*:\\s*(\\d+)'
      ];

      return {
          handle: normalizeScrapedHandle(extractFirstPatternMatch(joinedText, handlePatterns)),
          views: extractReadableViewCount(extractFirstPatternMatch(joinedText, viewPatterns))
      };
  }

  function getInstagramViewCountFromSemanticDom() {
      const iconRoots = Array.from(document.querySelectorAll('svg[aria-label="View count"]'));
      const titleRoots = Array.from(document.querySelectorAll('svg title'))
          .filter((element) => String(element.textContent || '').trim().toLowerCase() === 'view count');
      const allRoots = [...iconRoots, ...titleRoots];

      for (const root of allRoots) {
          const containers = [
              root.closest('button'),
              root.closest('section'),
              root.closest('article'),
              root.parentElement,
              root.parentElement?.parentElement
          ].filter(Boolean);

          for (const container of containers) {
              const textCandidates = [
                  container.innerText,
                  container.textContent
              ].filter(Boolean);

              for (const text of textCandidates) {
                  const count = extractReadableViewCount(text);
                  if (count) return count;
              }
          }
      }

      return '';
  }

  function extractRumbleHandleFromHref(href) {
      if (!href) return '';
      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          const segments = parsed.pathname.split('/').filter(Boolean);
          const firstSegment = segments[0] || '';

          if (['c', 'user', 'channel'].includes(firstSegment.toLowerCase()) && segments[1]) {
              return normalizeScrapedHandle(decodeURIComponent(segments[1]).replace(/\.html$/i, ''));
          }

          if (firstSegment.startsWith('@')) {
              return normalizeScrapedHandle(decodeURIComponent(firstSegment.slice(1)));
          }
      } catch (error) {
          return '';
      }

      return '';
  }

  function getRumbleLiveViewerCount(rumbleConfig) {
      for (const element of getElementsFromSelectorList(rumbleConfig.live_viewer_count)) {
          const candidateText = [
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || ''
          ].join(' ');
          const count = extractReadableViewCount(candidateText);
          if (count && /watching\s+now/i.test(candidateText)) return count;
          if (count && element.className && String(element.className).includes('live-video-view-count-status-count')) return count;
      }

      return '';
  }

  function isRumbleLivePage(rumbleConfig) {
      const liveViewerElements = getElementsFromSelectorList(rumbleConfig.live_viewer_count);
      const hasWatchingNowViewerCount = liveViewerElements.some((element) => {
          const candidateText = [
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || ''
          ].join(' ');
          return /users?\s+watching\s+now/i.test(candidateText);
      });

      if (hasWatchingNowViewerCount) return true;

      return toSelectorList(rumbleConfig.live_indicators).some((selector) => {
          const matches = getElementsFromSelectorList([selector]);
          return matches.some((element) => {
              const candidateText = [
                  element.getAttribute?.('title') || '',
                  element.getAttribute?.('aria-label') || '',
                  element.innerText || '',
                  element.textContent || '',
                  element.className || ''
              ].join(' ');
              return /users?\s+watching\s+now|status--live|\blive\b/i.test(candidateText);
          });
      });
  }

  function extractKickHandleFromHref(href) {
      if (!href) return '';
      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          const parts = parsed.pathname.split('/').filter(Boolean);
          const first = parts[0] || '';
          const reserved = new Set([
              'categories',
              'search',
              'subscriptions',
              'video',
              'clips',
              'following'
          ]);
          if (!first || reserved.has(first.toLowerCase())) return '';
          return normalizeScrapedHandle(first);
      } catch (error) {
          return '';
      }
  }

  function getKickHandle(kickConfig) {
      for (const element of getElementsFromSelectorList(kickConfig.handle_links)) {
          const anchor = element.closest?.('a[href]') || element.querySelector?.('a[href]') || (element.matches?.('a[href]') ? element : null);
          const href = anchor?.href || anchor?.getAttribute?.('href') || element.getAttribute?.('href') || '';
          const handleFromHref = extractKickHandleFromHref(href);
          if (handleFromHref) return handleFromHref;
      }

      for (const element of getElementsFromSelectorList(kickConfig.handle_name)) {
          const alt = element?.getAttribute?.('alt') || element?.getAttribute?.('title') || '';
          if (alt) return normalizeScrapedHandle(alt);
      }

      return '';
  }

  function getKickViewerCountFromAnimatedDigits(kickConfig) {
      const root = getFirstElementFromSelectorList(kickConfig.live_viewer_count);
      if (!root) return '';

      const directTextCount = extractReadableViewCount(root.getAttribute?.('aria-label') || root.getAttribute?.('title') || '');
      if (directTextCount) return directTextCount;

      const configuredDigitColumns = getElementsFromSelectorList(kickConfig.live_viewer_digit_columns);
      const digitColumns = (configuredDigitColumns.length > 0 ? configuredDigitColumns : Array.from(root.querySelectorAll('div')))
          .filter((element) => {
              const styleText = element.getAttribute('style') || '';
              if (!/height:\s*20px/i.test(styleText) || !/width:\s*[\d.]+px/i.test(styleText)) {
                  return false;
              }
              const directDigitChildren = Array.from(element.children || [])
                  .filter((child) => /translateY/i.test(child.getAttribute?.('style') || '') && /^\d$/.test((child.textContent || '').trim()));
              return directDigitChildren.length >= 10;
          });

      if (digitColumns.length > 0) {
          return '5'.repeat(digitColumns.length);
      }

      const fallbackDigits = Array.from(root.querySelectorAll('[style*="translateY"]'))
          .filter((element) => /^\d$/.test((element.textContent || '').trim()));
      if (fallbackDigits.length > 0) {
          const estimatedDigits = Math.max(1, Math.round(fallbackDigits.length / 30));
          return '5'.repeat(estimatedDigits);
      }

      return '';
  }

  function getKickArchivedViewCount(kickConfig) {
      for (const element of getElementsFromSelectorList(kickConfig.archived_views)) {
          const candidate = element.getAttribute?.('title') || element.innerText || element.textContent || '';
          const count = extractReadableViewCount(candidate);
          if (!count) continue;

          const nearbyText = [
              element.parentElement?.innerText || '',
              element.closest?.('div, span, section')?.innerText || ''
          ].join(' ');
          if ((kickConfig.archived_view_labels || ['views']).some((label) => nearbyText.toLowerCase().includes(String(label).toLowerCase()))) {
              return count;
          }
      }
      return '';
  }

  function isKickLivePage(kickConfig) {
      const liveBadgeVisible = toSelectorList(kickConfig.live_badge).some((selector) => {
          const matches = getElementsFromSelectorList([selector]);
          return matches.some((element) => {
              const badgeText = String(element?.innerText || element?.textContent || '').trim().toLowerCase();
              return badgeText === 'live';
          });
      });

      if (liveBadgeVisible) return true;

      const viewerRoot = getFirstElementFromSelectorList(kickConfig.live_viewer_count);
      if (viewerRoot) {
          const nearbyText = String(viewerRoot.parentElement?.innerText || viewerRoot.closest?.('div, section')?.innerText || '').toLowerCase();
          if (nearbyText.includes('watching')) return true;
      }

      return false;
  }

  function normalizeFacebookProfileUrl(href) {
      if (!href) return '';

      try {
          const parsed = new URL(href, window.location.href);
          if (!parsed.hostname.toLowerCase().includes('facebook.com')) return '';

          const firstSegment = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
          const blockedSegments = new Set([
              'watch',
              'reel',
              'reels',
              'videos',
              'groups',
              'events',
              'marketplace',
              'photo',
              'photos',
              'permalink.php',
              'story.php',
              'share',
              'shares',
              'help',
              'login',
              'plugins'
          ]);
          if (blockedSegments.has(firstSegment)) return '';

          parsed.hash = '';
          if (firstSegment === 'profile.php') {
              const id = parsed.searchParams.get('id');
              parsed.search = id ? `?id=${encodeURIComponent(id)}` : '';
          } else {
              parsed.search = '';
          }

          return parsed.toString();
      } catch (error) {
          return '';
      }
  }

  function getFacebookHandleFromProfileUrl(profileUrl) {
      try {
          const parsed = new URL(profileUrl);
          if (parsed.pathname.toLowerCase() === '/profile.php') {
              return parsed.searchParams.get('id') || '';
          }
          return parsed.pathname.split('/').filter(Boolean)[0] || '';
      } catch (error) {
          return '';
      }
  }

  function isUsableFacebookProfileName(text) {
      const normalized = normalizeComparableText(text);
      if (!normalized) return false;
      if (/\bviews?\b|\bviewers?\b|\bwatching\b/.test(normalized)) return false;
      if (['like', 'follow', 'message', 'share', 'comment', 'facebook'].includes(normalized)) return false;
      return true;
  }

  function getFacebookProfileIdentity(facebookConfig) {
      for (const element of getElementsFromSelectorList(facebookConfig.profile_links || facebookConfig.handle)) {
          const anchor = element.matches?.('a[href]')
              ? element
              : element.closest?.('a[href]') || element.querySelector?.('a[href]');
          const profileUrl = normalizeFacebookProfileUrl(anchor?.href || element.getAttribute?.('href') || '');
          if (!profileUrl) continue;

          const rawName = getElementReadableText(anchor) || getElementReadableText(element);
          const handle = isUsableFacebookProfileName(rawName)
              ? normalizeScrapedHandle(rawName)
              : normalizeScrapedHandle(getFacebookHandleFromProfileUrl(profileUrl));

          return {
              handle: handle || 'FacebookUser',
              profileUrl
          };
      }

      const fallbackName = getTextsFromSelectorList(facebookConfig.profile_name || facebookConfig.handle)
          .find(isUsableFacebookProfileName);
      return {
          handle: normalizeScrapedHandle(fallbackName) || 'FacebookUser',
          profileUrl: ''
      };
  }

  function getFacebookViewCount(facebookConfig) {
      for (const text of getTextsFromSelectorList(facebookConfig.views)) {
          if (!/\bviews?\b|\bviewers?\b/i.test(text)) continue;
          const views = extractReadableViewCount(text);
          if (views) return views;
      }

      const bodyText = document.body?.innerText || '';
      const match = bodyText.match(/([\d.,]+(?:\s*[KMB])?)\s*(?:views?|viewers?)\b/i);
      return match ? match[1].replace(/\s+/g, '') : '';
  }

  function getRumbleStructuredData() {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

      for (const script of scripts) {
          try {
              const parsed = JSON.parse(script.textContent || 'null');
              const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

              while (queue.length > 0) {
                  const node = queue.shift();
                  if (!node || typeof node !== 'object') continue;

                  if (Array.isArray(node)) {
                      queue.push(...node);
                      continue;
                  }

                  if (Array.isArray(node['@graph'])) {
                      queue.push(...node['@graph']);
                  }

                  const type = Array.isArray(node['@type'])
                      ? node['@type'].join(' ')
                      : String(node['@type'] || '');

                  if (!/VideoObject|BroadcastEvent|LiveBlogPosting/i.test(type) && !node.embedUrl && !node.thumbnailUrl) {
                      continue;
                  }

                  const author = node.author || node.creator || node.publisher || {};
                  const interactionStatistic = Array.isArray(node.interactionStatistic)
                      ? node.interactionStatistic[0]
                      : node.interactionStatistic || {};

                  return {
                      authorName: author.name || author.alternateName || '',
                      authorUrl: author.url || '',
                      viewCount: interactionStatistic.userInteractionCount || node.viewCount || ''
                  };
              }
          } catch (error) {
              // Ignore malformed structured data blocks.
          }
      }

      return { authorName: '', authorUrl: '', viewCount: '' };
  }

  function extractReadableViewCount(value) {
      const text = String(value || '').trim();
      if (!text) return '';

      const descriptiveMatch = text.match(/([\d.,]+(?:\s*[KMB])?)(?=\s*(?:views?|viewers?|watching|users?\s+watching\s+now)\b)/i);
      if (descriptiveMatch) {
          return descriptiveMatch[1].replace(/\s+/g, '');
      }

      const compactOnlyMatch = text.match(/^([\d.,]+(?:\s*[KMB])?)$/i);
      if (compactOnlyMatch) {
          return compactOnlyMatch[1].replace(/\s+/g, '');
      }

      if (/^\d+$/.test(text)) return text;
      return '';
  }

  function extractTwitchHandleFromHref(href) {
      if (!href) return '';
      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          if (!parsed.hostname.toLowerCase().includes('twitch.tv')) return '';
          const parts = parsed.pathname.split('/').filter(Boolean);
          const first = parts[0] || '';
          const reserved = new Set([
              'directory',
              'downloads',
              'jobs',
              'login',
              'p',
              'settings',
              'videos',
              'collections',
              'clip',
              'clips'
          ]);
          if (!first || reserved.has(first.toLowerCase())) return '';
          return normalizeScrapedHandle(first);
      } catch (error) {
          return '';
      }
  }

  function getTwitchHandle(twitchConfig, pathParts) {
      for (const element of getElementsFromSelectorList(twitchConfig.handle_links)) {
          const anchor = element.matches?.('a[href]')
              ? element
              : element.closest?.('a[href]') || element.querySelector?.('a[href]');
          const handleFromLink = extractTwitchHandleFromHref(anchor?.href || element.getAttribute?.('href') || '');
          if (handleFromLink) return handleFromLink;
      }

      const firstSegment = pathParts?.[0] || '';
      if (firstSegment && !['videos', 'collections', 'clip', 'directory'].includes(firstSegment.toLowerCase())) {
          return normalizeScrapedHandle(firstSegment);
      }

      return 'TwitchUser';
  }

  function getTwitchLiveViewerCount(twitchConfig) {
      for (const element of getElementsFromSelectorList(twitchConfig.viewer_count)) {
          const candidateText = [
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || ''
          ].join(' ');
          const count = extractReadableViewCount(candidateText);
          if (count) return count;
      }
      return '';
  }

  function getTwitchVodViewCount(twitchConfig) {
      for (const element of getElementsFromSelectorList(twitchConfig.vod_views)) {
          const candidateText = [
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || ''
          ].join(' ');
          if (!/\bviews?\b/i.test(candidateText) || /\bviewers?\b/i.test(candidateText)) continue;
          const count = extractReadableViewCount(candidateText);
          if (count) return count;
      }
      return '';
  }

  function getTwitchClipViewCount(twitchConfig) {
      for (const element of getElementsFromSelectorList(twitchConfig.clip_views || twitchConfig.vod_views)) {
          const candidateText = [
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || ''
          ].join(' ');
          if (!/\bviews?\b/i.test(candidateText) || /\bviewers?\b/i.test(candidateText)) continue;
          const count = extractReadableViewCount(candidateText);
          if (count) return count;
      }
      return '';
  }

  function hasTwitchLiveSignal(twitchConfig) {
      return !!getMatchingTextFromSelectorList(twitchConfig.live_indicators, ['live']) ||
          getElementsFromSelectorList(twitchConfig.live_indicators).some((element) => {
              const candidateText = [
                  element.getAttribute?.('title') || '',
                  element.getAttribute?.('aria-label') || '',
                  element.innerText || '',
                  element.textContent || '',
                  element.className || ''
              ].join(' ');
              return /\blive\b|channel-status-text-indicator/i.test(candidateText);
          });
  }

  function hasTwitchClipSignal(twitchConfig) {
      return getElementsFromSelectorList(twitchConfig.clip_indicators).some((element) => {
          const candidateText = [
              element.getAttribute?.('href') || '',
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || '',
              element.className || ''
          ].join(' ');
          return /clips\.twitch\.tv|\/clip\/|\bclip\b/i.test(candidateText);
      });
  }

  function hasTwitchVodSignal(twitchConfig) {
      return getElementsFromSelectorList(twitchConfig.vod_indicators).some((element) => {
          const candidateText = [
              element.getAttribute?.('href') || '',
              element.getAttribute?.('title') || '',
              element.getAttribute?.('aria-label') || '',
              element.innerText || '',
              element.textContent || '',
              element.className || ''
          ].join(' ');
          return /video-info-game-boxart-link|metadata-layout__split-top|timestamp-metadata|views?\b|\bago\b/i.test(candidateText);
      });
  }

  function extractTwitterHandleFromHref(href) {
      if (!href) return '';
      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          if (!pathParts.length) return '';

          const reservedSegments = new Set([
              'account',
              'compose',
              'explore',
              'hashtag',
              'help',
              'home',
              'i',
              'intent',
              'login',
              'logout',
              'messages',
              'notifications',
              'privacy',
              'search',
              'settings',
              'share',
              'tos'
          ]);
          const candidate = pathParts[0];
          if (reservedSegments.has(candidate.toLowerCase())) return '';
          return normalizeScrapedHandle(candidate);
      } catch (error) {
          return '';
      }
  }

  function getTwitterHandle(twitterConfig, currentUrl) {
      const linkSelectors = twitterConfig.handle_links || twitterConfig.handle;
      for (const element of getElementsFromSelectorList(linkSelectors)) {
          const href = element?.href || element?.getAttribute?.('href') || element?.closest?.('a[href]')?.getAttribute?.('href') || '';
          const handle = extractTwitterHandleFromHref(href);
          if (handle) return handle;
      }

      for (const text of getTextsFromSelectorList(twitterConfig.handle)) {
          const trimmed = String(text || '').trim();
          if (trimmed.startsWith('@')) return normalizeScrapedHandle(trimmed);
          if (/^[A-Za-z0-9_]{1,20}$/.test(trimmed)) return normalizeScrapedHandle(trimmed);
      }

      return extractTwitterHandleFromHref(currentUrl);
  }

  function hasTwitterViewsContext(element) {
      let current = element;
      for (let depth = 0; current && depth < 8; depth += 1) {
          const href = current.getAttribute?.('href') || '';
          const ariaLabel = current.getAttribute?.('aria-label') || '';
          const text = getElementReadableText(current);
          if (href.includes('/analytics')) return true;
          if (/view post analytics|views?/i.test(ariaLabel)) return true;
          if (text.length < 120 && /\bviews?\b/i.test(text) && /\d/.test(text)) return true;
          current = current.parentElement;
      }
      return false;
  }

  function getTwitterViews(twitterConfig) {
      for (const container of getElementsFromSelectorList(twitterConfig.views_analytics)) {
          const containerText = getElementReadableText(container);
          const countFromContainer = extractReadableViewCount(containerText);
          if (countFromContainer) return countFromContainer;

          const childTexts = Array.from(container.querySelectorAll?.('span, div') || [])
              .map((element) => getElementReadableText(element))
              .filter(Boolean);
          for (const text of childTexts) {
              const count = extractReadableViewCount(text);
              if (count) return count;
          }
      }

      for (const element of getElementsFromSelectorList(twitterConfig.views)) {
          const text = getElementReadableText(element);
          const count = extractReadableViewCount(text);
          if (!count) continue;
          if (hasTwitterViewsContext(element)) return count;
      }

      return '';
  }

  function matchFirstRegexPattern(text, patterns) {
      for (const pattern of toSelectorList(patterns)) {
          try {
              const match = String(text || '').match(new RegExp(pattern));
              if (match) return match;
          } catch (error) {
              // Ignore malformed regex patterns and continue.
          }
      }
      return null;
  }

>>>>>>> Stashed changes
  // ==========================================
  // 1. THE STRATEGY SCRAPER
  // ==========================================
  function detectLegacyScraperPlatformKey(host, url) {
    const normalizedHost = String(host || '').toLowerCase();
    const normalizedUrl = String(url || '').toLowerCase();

    if (normalizedHost.includes('tiktok.com') || normalizedHost.includes('tiktokforbusiness.com')) return 'tiktok';
    if (normalizedHost.includes('youtube.com') || normalizedHost.includes('youtu.be')) return 'youtube';
    if (normalizedHost.includes('instagram.com')) return 'instagram';
    if (normalizedHost.includes('twitter.com') || normalizedHost.includes('x.com')) return 'twitter';
    if (normalizedHost.includes('kick.com')) return 'kick';
    if (normalizedHost.includes('twitch.tv')) return 'twitch';
    if (normalizedHost.includes('facebook.com')) return 'facebook';
    if (normalizedHost.includes('rumble.com')) return 'rumble';
    if (normalizedHost.includes('discord.com')) return 'discord';
    if (normalizedUrl.includes('youtu.be')) return 'youtube';

    return '';
  }

  function runLegacyScraperForPlatform(platformKey, host = window.location.hostname, url = window.location.href, timestamp = new Date().toISOString()) {
    let views = "N/A";

    console.log("PIRATE AI: Attempting scrape on", host, url, `(${platformKey || 'unknown'})`);

    if (platformKey === 'tiktok') {
      let handle = "Unknown";
      let matched = false;

      // 1. Extract Handle & ID from URL (Fastest)
      const videoRegex = /@([^/?]+)\/video\/(\d+)/;
      const photoRegex = /@([^/?]+)\/photo\/(\d+)/;

      let match = url.match(videoRegex) || url.match(photoRegex);

      if (match) {
          handle = match[1];
          matched = true;
      } else {
          // Fallback to custom regex
          try {
              const customMatch = matchFirstRegexPattern(url, SCRAPER_CONFIG.tiktok.url_match);
              if (customMatch) {
                  handle = customMatch[1] || customMatch[3] || "Unknown";
                  matched = true;
              }
          } catch(e) {
              console.warn("PIRATE AI: Custom regex failed:", e);
          }
      }

      if (!matched) {
          // Try parsing JSON mainly for Handle if URL regex failed
          try {
              const jsonConfig = SCRAPER_CONFIG.tiktok.json_data;
              const scriptIds = jsonConfig?.script_ids || ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"];
              
              for (const id of scriptIds) {
                  const el = document.getElementById(id);
                  if (el && el.textContent) {
                      const json = JSON.parse(el.textContent);
                      // Basic handle extraction attempt from deeply nested JSON
                      const getVal = (obj, path) => path.split('.').reduce((o, k) => (o || {})[k], obj);
                      const possiblePaths = jsonConfig?.fields?.handle || ["author.uniqueId", "webapp.video-detail.itemInfo.itemStruct.author.uniqueId"];
                      
                      for(const p of possiblePaths) {
                          const val = getVal(json, p) || getVal(json.__DEFAULT_SCOPE__, p);
                          if(val) { handle = val; matched = true; break; }
                      }
                  }
                  if(matched) break;
              }
          } catch(e) {}
      }

      if (!matched && (url === "https://www.tiktok.com/" || url === "https://www.tiktok.com")) return null;
      
      if (!matched) {
          console.warn("PIRATE AI: No valid video ID found in URL.");
          return null; 
      }

      // *** SCRAPING CHANGE ***
      // We do NOT scrape views here anymore to avoid stale data.
      // Background.js will perform a fresh scrape before reporting.
      views = "PENDING";

      console.log(`PIRATE AI: Scrape Success! Handle: ${handle}, Views: PENDING`);

      return { 
        platform: "TikTok", 
        url, 
        handle: handle, 
        views, 
        timestamp 
      };
    }

    // --- YOUTUBE ---
    else if (platformKey === 'youtube') {
      const params = new URLSearchParams(window.location.search);
      let videoId = params.get('v');
      if (!videoId && host.includes('youtu.be')) {
          try {
              videoId = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
          } catch (error) {
              videoId = '';
          }
      }
      
      if (!videoId && !url.includes('/shorts/') && !url.includes('/live/')) {
          return null;
      }

      const channelHref = getHrefFromSelectorList(SCRAPER_CONFIG.youtube.channel_link);
      const channelText = getTextFromSelectorList(SCRAPER_CONFIG.youtube.channel_link);
      let channel = "Unknown";
      
      if (channelHref || channelText) {
          const href = channelHref || "";
          if (href.includes('/@')) {
	              channel = href.split('/@')[1];
          } else {
	              channel = channelText;
          }
      }

      const standardViewText = getTextFromSelectorList(SCRAPER_CONFIG.youtube.views_std);
      const shortViewText = getTextFromSelectorList(SCRAPER_CONFIG.youtube.views_shorts);
      const shortDescButton = document.querySelector('button[aria-label*="views"]');
      
      if (standardViewText) {
          views = standardViewText.replace(' views', '');
      } else if (shortViewText) {
          views = shortViewText;
      } else if (shortDescButton) {
          const match = (shortDescButton.getAttribute('aria-label') || '').match(/([0-9.,KMBkmb]+)\s*views/i);
          if (match) views = match[1];
      }

      let targetId = videoId;
      if (!targetId && url.includes('/shorts/')) targetId = url.split('/shorts/')[1];
      if (!targetId && url.includes('/live/')) targetId = url.split('/live/')[1];

      
      const cleanId = targetId ? targetId.split('?')[0] : null;
      const screenshot = cleanId ? `https://img.youtube.com/vi/${cleanId}/maxresdefault.jpg` : null;

      return { 
        platform: "YouTube", 
        url, 
        handle: channel, 
        screenshot: screenshot, 
        views, 
        timestamp 
      };
    }

    // --- INSTAGRAM ---
<<<<<<< Updated upstream
    else if (host.includes('instagram.com')) {
      if (!url.includes('/p/') && !url.includes('/reel/')) return null;
      const headerHandle = document.querySelector(SCRAPER_CONFIG.instagram.handle)?.innerText;
=======
    else if (platformKey === 'instagram') {
      const isPostLikeUrl = url.includes('/p/') || url.includes('/reel/') || url.includes('/tv/');
      const isStoryUrl = url.includes('/stories/');
      if (!isPostLikeUrl && !isStoryUrl) return null;

      const instagramConfig = SCRAPER_CONFIG.instagram || {};
      const embeddedData = getInstagramEmbeddedData(instagramConfig);
      const headerHandle = normalizeScrapedHandle(getTextFromSelectorList(instagramConfig.handle));
      const profileHrefHandle = getInstagramHandleFromProfileLinks(instagramConfig.profile_links);
      const metaDescription = getAttributeFromSelectorList(instagramConfig.meta_description, 'content');
      const metaViews = extractReadableViewCount(metaDescription);
      const semanticViews = getInstagramViewCountFromSemanticDom();

      let handle = embeddedData.handle || profileHrefHandle || headerHandle || "InstagramUser";

      if ((!headerHandle || headerHandle === "InstagramUser") && isStoryUrl) {
          try {
              const pathParts = new URL(url).pathname.split('/').filter(Boolean);
              if (pathParts[0] === 'stories' && pathParts[1]) {
                  handle = pathParts[1];
              }
          } catch (error) {
              // Ignore parse failure and fall back to the DOM handle.
          }
      }

      if (!isStoryUrl) {
          views = embeddedData.views || metaViews || semanticViews || "N/A";
      }
>>>>>>> Stashed changes
      
      return { 
        platform: "Instagram", 
        url, 
        handle: headerHandle || "InstagramUser", 
        views: "N/A", 
        timestamp 
      };
    }

    // --- TWITTER / X ---
    else if (platformKey === 'twitter') {
      if (!url.includes('/status/')) return null;
      const twitterConfig = SCRAPER_CONFIG.twitter || {};
      const takedownPatterns = twitterConfig.takedown_patterns || [
        'this media has been disabled',
        'disabled in response to a report by the copyright owner',
        'this post has been deleted',
        'tweet has been deleted',
        "this page doesn't exist",
        'account suspended'
      ];
      const matchedTakedownText = getMatchingTextFromSelectorList(twitterConfig.takedown_messages, takedownPatterns);
      const pageTakedownText = [
        document.title || '',
        document.body?.innerText || ''
      ].join(' ');

      if (matchedTakedownText || textIncludesAnyPattern(pageTakedownText, takedownPatterns)) {
          console.warn('PIRATE AI: X/Twitter media appears unavailable.', matchedTakedownText || 'page text matched a takedown pattern');
          return null;
      }

      const hasTweet = !!document.querySelector('article[data-testid="tweet"], [data-testid="tweet"]');
      const hasActiveMedia = !!getFirstElementFromSelectorList(twitterConfig.active_media);
      if (!hasTweet && !hasActiveMedia) return null;

      const handle = getTwitterHandle(twitterConfig, url) || "TwitterUser";
      const views = getTwitterViews(twitterConfig) || "N/A";
      
      return { 
        platform: "Twitter", 
        url, 
        handle, 
        views, 
        contentType: hasActiveMedia ? 'media' : 'post',
        timestamp 
      };
    }

    // --- TWITCH ---
    else if (platformKey === 'kick') {
      const kickConfig = SCRAPER_CONFIG.kick || {};
      const isLive = isKickLivePage(kickConfig);
      const handle = getKickHandle(kickConfig) || extractKickHandleFromHref(window.location.pathname) || 'KickCreator';
      const views = isLive
          ? (getKickViewerCountFromAnimatedDigits(kickConfig) || "N/A")
          : (getKickArchivedViewCount(kickConfig) || "N/A");

      const title = document.title || '';
      const hasVideo = !!document.querySelector('video#video-player, video');
      if (!hasVideo && !isLive && !/kick/i.test(title)) return null;

      return {
        platform: "Kick",
        url,
        handle,
        views,
        isLive,
        contentType: isLive ? 'live' : 'vod',
        timestamp
      };
    }

    else if (platformKey === 'twitch') {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const lowerPathParts = pathParts.map((part) => part.toLowerCase());
      const firstSegment = (pathParts[0] || '').toLowerCase();
      const looksLikeClipUrl = parsedUrl.hostname.toLowerCase().includes('clips.twitch.tv') ||
        firstSegment === 'clip' ||
        lowerPathParts.includes('clip');
      const looksLikeVodUrl = !looksLikeClipUrl && (
        firstSegment === 'videos' ||
        firstSegment === 'collections'
      );
      const twitchConfig = SCRAPER_CONFIG.twitch || {};
      const hasClipMetadata = hasTwitchClipSignal(twitchConfig);
      const hasVodMetadata = hasTwitchVodSignal(twitchConfig);
      const isClip = looksLikeClipUrl || hasClipMetadata;
      const isVod = !isClip && (looksLikeVodUrl || hasVodMetadata);
      const isLive = !isClip && !isVod && hasTwitchLiveSignal(twitchConfig);
      const liveViewerCount = getTwitchLiveViewerCount(twitchConfig);
      const vodViewCount = getTwitchVodViewCount(twitchConfig);
      const clipViewCount = getTwitchClipViewCount(twitchConfig);
      const handle = getTwitchHandle(twitchConfig, pathParts);

      return {
        platform: "Twitch",
        url,
        handle,
        views: (isClip ? clipViewCount : (isVod ? vodViewCount : liveViewerCount)) ||
          liveViewerCount ||
          vodViewCount ||
          clipViewCount ||
          "N/A",
        isLive,
        contentType: isClip ? 'clip' : (isVod ? 'vod' : 'live'),
        timestamp
      };
    }

    // --- FACEBOOK ---
    else if (platformKey === 'facebook') {
      const facebookConfig = SCRAPER_CONFIG.facebook || {};
      if (!facebookConfig.profile_links && !facebookConfig.profile_name && !facebookConfig.views) {
        console.warn('PIRATE AI: Facebook scraper selectors were not loaded from events_config.json.');
        return null;
      }
      const profileIdentity = getFacebookProfileIdentity(facebookConfig);
      const views = getFacebookViewCount(facebookConfig) || "N/A";

	      return {
	        platform: "Facebook",
	        url,
        handle: profileIdentity.handle || "FacebookUser",
        profileUrl: profileIdentity.profileUrl || "",
	        views,
	        timestamp
      };
    }

<<<<<<< Updated upstream
=======
    // --- RUMBLE ---
    else if (platformKey === 'rumble') {
      const pathname = window.location.pathname || '';
      const looksLikeVideoPage = /^\/v[a-z0-9]/i.test(pathname) || pathname.includes('/embed/');
      const hasPlayableMedia = !!document.querySelector('video');

      if (!looksLikeVideoPage && !hasPlayableMedia) return null;

      const structuredData = getRumbleStructuredData();
      const rumbleConfig = SCRAPER_CONFIG.rumble || {};

      let handle = normalizeScrapedHandle(getTextFromSelectorList(rumbleConfig.handle));
      if (!handle) {
          handle = extractRumbleHandleFromHref(getHrefFromSelectorList(rumbleConfig.candidate_channel_links));
      }
      if (!handle) {
          handle = extractRumbleHandleFromHref(structuredData.authorUrl);
      }
      if (!handle) {
          handle = normalizeScrapedHandle(structuredData.authorName);
      }
      if (!handle) {
          const metaAuthor = document.querySelector('meta[name="author"], meta[property="author"]');
          handle = normalizeScrapedHandle(metaAuthor?.content || '');
      }

      const liveViewerCount = getRumbleLiveViewerCount(rumbleConfig);
      const rawViews = getTextFromSelectorList(rumbleConfig.views);
      views = liveViewerCount || extractReadableViewCount(rawViews) || extractReadableViewCount(structuredData.viewCount) || "N/A";

      const liveContextText = [
        document.title,
        document.querySelector('meta[property="og:title"]')?.content || '',
        document.querySelector('meta[name="description"]')?.content || ''
      ].join(' ');
      const isLive = isRumbleLivePage(rumbleConfig) ||
        /\busers?\s+watching\s+now\b/i.test(liveContextText);

      return {
        platform: "Rumble",
        url,
        handle: handle || "RumbleCreator",
        views,
        timestamp,
        isLive,
        contentType: isLive ? 'live' : 'vod'
      };
    }

>>>>>>> Stashed changes
    // --- DISCORD ---
    else if (platformKey === 'discord') {
      return { 
        platform: "Discord", 
        url, 
        handle: "DiscordUser", 
        views: "N/A", 
        timestamp 
      };
    }

    return null;
  }

  globalThis.__floLegacyScrapers = {
    run(platformKey) {
      return runLegacyScraperForPlatform(platformKey);
    }
  };

  function scrapePageStrategy() {
    const host = window.location.hostname;
    const url = window.location.href;
    const registryScraper = globalThis.__floPlatformRegistry?.findScraperByUrl?.(url);

    if (registryScraper?.run) {
      const result = registryScraper.run();
      if (result) return result;
    }

    const fallbackPlatformKey = registryScraper?.key || detectLegacyScraperPlatformKey(host, url);
    if (!fallbackPlatformKey) return null;
    return runLegacyScraperForPlatform(fallbackPlatformKey, host, url);
  }

    // ==========================================
    // 1.5 SELECTOR TRAINING (RECORD MODE)
    // ==========================================
    let isTrainingMode = false;
    let trainingPlatform = null;
    
    /**
 * Determines if an ID attribute is likely auto-generated or temporary.
 * Targets patterns like ":r1:", "tux-1234", or long random hashes.
 */
function isLikelyTemporaryId(id) {
    if (!id) return true;
    
    // Pattern 1: React/MUI/Next.js style colon IDs (e.g., ":r1:", ":R2:")
    if (id.includes(':')) return true;
    
    // Pattern 2: Sequential or numeric-heavy IDs (e.g., "id-12345", "button-5")
    if (/\d{4,}/.test(id)) return true;
    
    // Pattern 3: Framework prefixes known for dynamic IDs
    const tempPrefixes = ['tux-', 'ember', 'view', 'gen-', 'react-'];
    if (tempPrefixes.some(prefix => id.toLowerCase().startsWith(prefix))) return true;

    // Pattern 4: Random hashes (long strings of alphanumeric characters)
    if (id.length > 20 && /[a-z]/.test(id) && /[0-9]/.test(id)) return true;

    return false;
}

function generateStableSelector(el) {
    let target = el;
    const interactiveTarget = el.closest('button, input, textarea, select, a, label, [role="button"], [role="checkbox"]');
    if (interactiveTarget) {
        target = interactiveTarget;
    }

    let strategies = [];

    // Strategy 1: Data-Attribute Path (These are the MOST stable)
    if (target.hasAttribute('data-e2e')) {
        strategies.push(`[data-e2e="${target.getAttribute('data-e2e')}"]`);
    }
    
    // Strategy 2: ID-based Path (Filtered to ignore temporary IDs)
    if (target.id && !isLikelyTemporaryId(target.id)) {
        strategies.push(`#${target.id}`);
    }
    
    // Strategy 3: Full CSS Path (The fallback)
    let path = [];
    let current = target;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
        let selector = current.nodeName.toLowerCase();
        
        // Pierce through dynamic IDs even in the hierarchy
        if (current.id && !isLikelyTemporaryId(current.id)) { 
            selector += `#${current.id}`; 
            path.unshift(selector); 
            break; 
        }
        
        let sibling = current, nth = 1;
        while (sibling = sibling.previousElementSibling) { 
            if (sibling.nodeName.toLowerCase() === selector) nth++; 
        }
        if (nth !== 1) selector += `:nth-of-type(${nth})`;
        path.unshift(selector);
        if (current.tagName.toLowerCase() === 'body') break;
        current = current.parentNode;
    }
    strategies.push(path.join(' > '));

    return strategies.filter(Boolean);
}
  
  function handleTrainingMouseOver(e) {
      if (!isTrainingMode) return;
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        target.style.outline = '3px dashed #ce0e2d';
        target.style.cursor = 'crosshair';
    }
  
    function handleTrainingMouseOut(e) {
        if (!isTrainingMode) return;
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        target.style.outline = '';
        target.style.cursor = '';
    }
  // --- MACRO RECORDING ENGINE ---
  function handleMacroEvent(e) {
      if (!isMacroMode) return;
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      const selectors = generateStableSelector(target);
      if (!selectors || selectors.length === 0) return;
      
      const step = {
          action: e.type === 'click' ? 'click' : 'input',
          selector: selectors[0],
          value: e.type === 'input' ? target.value : undefined,
          timestamp: Date.now()
      };
      
      // Store locally instead of sending thousands of messages to background
      macroEvents.push(step);
  }

  function startMacroTraining(platform) {
      if (isMacroMode) return;
      isMacroMode = true;
      trainingPlatform = platform;
      macroEvents = []; // Reset local array on start
      
      document.addEventListener('click', handleMacroEvent, true);
      document.addEventListener('input', handleMacroEvent, true);
      console.log("PIRATE AI: Macro Recording started...");
      macroTimeout = setTimeout(() => { if (isMacroMode) finishMacroTraining(); }, 120000);
  }

  function finishMacroTraining() {
      if (!isMacroMode) return;
      isMacroMode = false;
      clearTimeout(macroTimeout);
      
      document.removeEventListener('click', handleMacroEvent, true);
      document.removeEventListener('input', handleMacroEvent, true);
      
      console.log("PIRATE AI: Macro Recording finished.");

      if (macroEvents.length === 0) {
          alert("No actions were recorded. Please interact with the page while recording.");
          chrome.runtime.sendMessage({ action: 'macroTrainingComplete' }).catch(() => {});
          return;
      }

      // Compile the macro locally
      const processedMacro = macroEvents.map((ev, i) => ({
          action: ev.action, 
          selector: ev.selector, 
          value: ev.value, 
          delay: i === 0 ? 0 : ev.timestamp - macroEvents[i-1].timestamp
      }));

      // Trigger the UI on the page immediately!
      showPatchUI(trainingPlatform, JSON.stringify(processedMacro, null, 2));

      // Notify side panel to reset its UI (turn off flashing borders)
      chrome.runtime.sendMessage({ 
          action: 'macroTrainingComplete', 
          platform: trainingPlatform, 
          macro: processedMacro 
      }).catch(() => {});
  }
    // Inject a native UI right on the page to avoid Side Panel communication drops
  function showPatchUI(platform, selector) {
      const existing = document.getElementById('flo-patch-ui');
      if (existing) existing.remove();
  
      // Setup strategies array
      const strategyList = Array.isArray(selector) ? selector : [selector];
      let currentStrategy = 0;
      const initialSelector = strategyList[0] || '';
      
      // Identify if the payload is a Macro Array
      const isMacroData = typeof initialSelector === 'string' && initialSelector.trim().startsWith('[');
  
      const ui = document.createElement('div');
      ui.id = 'flo-patch-ui';
      ui.style.cssText = `
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          background: white; border: 3px solid #ce0e2d; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
          z-index: 2147483647; padding: 20px; font-family: sans-serif; border-radius: 8px; width: 350px;
      `;

      ui.innerHTML = `
          <h3 style="margin: 0 0 10px 0; color: #ce0e2d; font-size: 18px;">Map Captured ${isMacroData ? 'Macro Sequence' : 'Selector'}</h3>
          <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${isMacroData ? 'Steps compiled:' : 'Selector captured:'}</p>
          <textarea id="flo-patch-selector-input" style="width: 100%; height: 80px; padding: 8px; margin-bottom: 6px; font-family: monospace; font-size: 11px; box-sizing: border-box; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px; resize: vertical;">${initialSelector}</textarea>
          <button id="flo-patch-test" style="background: #0288d1; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: bold; margin-bottom: 12px;">${isMacroData ? 'Verify Macro Replay' : 'Test Selection'}</button>
  
          <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 5px;">Section in Config:</label>
          <select id="flo-patch-section" style="width: 100%; padding: 8px; margin-bottom: 12px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
              <option value="autofill" ${isMacroData ? 'selected' : ''}>Autofill (Wizard Steps)</option>
              <option value="buttons">Buttons (Next, Send)</option>
              <option value="scraper">Scraper (Views, Handles)</option>
          </select>
  
          <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 5px;">Field Name:</label>
          <input type="text" id="flo-patch-field" placeholder="e.g., loginSequence, checkboxGroup" style="width: 100%; padding: 8px; margin-bottom: 15px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
          
          <div style="display: flex; justify-content: space-between;">
              <button id="flo-patch-cancel" style="background: #ccc; color: #333; border: none; padding: 10px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">Cancel</button>
              <button id="flo-patch-save" style="background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">Save to Cloud</button>
          </div>
          <div id="flo-patch-status" style="margin-top: 12px; font-size: 13px; font-weight: bold; text-align: center;"></div>
      `;
  
        document.body.appendChild(ui);
        document.getElementById('flo-patch-cancel').addEventListener('click', () => ui.remove());
  
      document.getElementById('flo-patch-test').addEventListener('click', () => {
          let testSel = document.getElementById('flo-patch-selector-input').value.trim();
          let searchSel = testSel;
          try { if (testSel.startsWith('[{')) searchSel = JSON.parse(testSel)[0]?.selector || testSel; } catch(e){}
          let el = findElement(searchSel);
          const status = document.getElementById('flo-patch-status');
  
          // Cycle through strategies if not found
          if (!el && currentStrategy < strategyList.length - 1) {
              currentStrategy++;
              testSel = strategyList[currentStrategy];
              document.getElementById('flo-patch-selector-input').value = testSel;
              
              searchSel = testSel;
              try { if (testSel.startsWith('[{')) searchSel = JSON.parse(testSel)[0]?.selector || testSel; } catch(e){}
              el = findElement(searchSel);
          }
  
          if (el) {
              const origOutline = el.style.outline;
              el.style.outline = '4px solid #ce0e2d'; // Red highlight
              console.log("PIRATE AI: Test Element Value/Text ->", el.value || el.innerText);
              status.innerText = `✅ Found Strategy ${currentStrategy + 1}! (Highlighted in red)`;
              status.style.color = "green";
              setTimeout(() => { el.style.outline = origOutline; }, 2000);
          } else {
              status.innerText = "❌ All strategies failed. Please enter manually.";
              status.style.color = "red";
          }
      });
  
      document.getElementById('flo-patch-save').addEventListener('click', () => {
          const section = document.getElementById('flo-patch-section').value;
            const field = document.getElementById('flo-patch-field').value.trim();
            const actionType = document.getElementById('flo-patch-action').value;
            const finalSelector = document.getElementById('flo-patch-selector-input').value.trim();
  
            if (!field) {
                alert("Please enter a field name (e.g., agreementCheckbox).");
                return;
            }
  
            const status = document.getElementById('flo-patch-status');
            status.innerText = "Syncing to Cloud...";
            status.style.color = "#ce0e2d";
  
            chrome.runtime.sendMessage({
                action: 'patchSelectorConfig',
                platform: platform,
                section: section,
                field: field,
                selector: finalSelector,
                actionType: actionType
            }, (res) => {
                if (res && res.success) {
                    status.innerText = "✅ Cloud Config Updated!";
                    status.style.color = "green";
                    setTimeout(() => ui.remove(), 2500);
                } else {
                    status.innerText = "❌ Failed: " + (res?.error || "Unknown error");
                    status.style.color = "red";
                }
            });
        });
    }
  
     function handleTrainingClick(e) {
      if (!isTrainingMode) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      const targetTag = target.tagName;
      const isGeneric = ['DIV', 'SPAN', 'SECTION', 'MAIN', 'BODY'].includes(targetTag) && !target.getAttribute('role');
  
      if (isGeneric) {
          const confirmNuke = confirm(`⚠️ FAT FINGER WARNING:\nYou just clicked a generic ${targetTag} element.\n\nMapping background containers usually breaks the auto-reporter for the whole team.\n\nAre you sure you want to map this?`);
          if (!confirmNuke) {
              e.target.style.outline = '';
              return; // Exit without showing the Patch UI
          }
      }
        
        e.target.style.outline = '';
        e.target.style.cursor = '';
        isTrainingMode = false;
        
        // Visual feedback flash
        const originalBg = e.target.style.backgroundColor;
        e.target.style.backgroundColor = 'rgba(206, 14, 45, 0.3)';
        setTimeout(() => e.target.style.backgroundColor = originalBg, 500);
        
         document.removeEventListener('mouseover', handleTrainingMouseOver, true);
        document.removeEventListener('mouseout', handleTrainingMouseOut, true);
        document.removeEventListener('click', handleTrainingClick, true);
  
        // Deep-scan to pierce through transparent overlays/wrappers and Shadow DOM
      const shadowTarget = (e.composedPath && e.composedPath()[0]) || e.target;
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      const actualTarget = elementsAtPoint.find(el => el.matches('input, textarea, select, button, [role="checkbox"], [role="radio"]')) || shadowTarget;
      
      const newSelectors = generateStableSelector(actualTarget);
  
      console.log("PIRATE AI: Captured New Selectors ->", newSelectors);
      
      // Bring up the in-page UI so we don't rely on the side panel being open!
      showPatchUI(trainingPlatform, newSelectors);
      
      // Attempt to update the side panel silently as a backup, ignoring dropped connections
      chrome.runtime.sendMessage({
          action: 'selectorTrainingComplete',
          platform: trainingPlatform,
          selector: newSelectors[0]
      }).catch(() => {});
  }
  
    function startSelectorTraining(platform) {
        if (isTrainingMode) return;
        isTrainingMode = true;
        trainingPlatform = platform;
        
        document.addEventListener('mouseover', handleTrainingMouseOver, true);
        document.addEventListener('mouseout', handleTrainingMouseOut, true);
        document.addEventListener('click', handleTrainingClick, true);
        console.log("PIRATE AI: Selector Training Mode ACTIVE");
    }
  
    let isMacroMode = false;
    let macroEvents = [];
    let macroEndTime = 0;
    let macroTimerInt = null;
    let macroTimeout = null;

    function handleMacroEvent(e) {
        if (!isMacroMode) return;
        const target = (e.composedPath && e.composedPath()[0]) || e.target;
        const selectors = generateStableSelector(target);
        if (!selectors || selectors.length === 0) return;
        
        const step = {
            action: e.type === 'click' ? 'click' : 'input',
            selector: selectors[0],
            value: e.type === 'input' ? target.value : undefined,
            timestamp: Date.now()
        };
        // Fire immediately to Service Worker (Dumb Sensor approach)
        chrome.runtime.sendMessage({ action: 'recordMacroStep', step: step }).catch(() => {});
    }
  
    function startMacroTraining(platform) {
    if (isMacroMode) return;
    isMacroMode = true;
    trainingPlatform = platform;
    
    // Clear old events
    chrome.runtime.sendMessage({ action: 'startMacroSession', platform: trainingPlatform }).catch(() => {});
    
    document.addEventListener('click', handleMacroEvent, true);
    document.addEventListener('input', handleMacroEvent, true);
    console.log("PIRATE AI: Macro Recording started...");

    // Safety timeout (increased to 2 minutes) in case user forgets to stop
    macroTimeout = setTimeout(() => {
        if (isMacroMode) finishMacroTraining();
    }, 120000);
}

function finishMacroTraining() {
    if (!isMacroMode) return;
    isMacroMode = false;
    clearTimeout(macroTimeout);

    document.removeEventListener('click', handleMacroEvent, true);
    document.removeEventListener('input', handleMacroEvent, true);
    
    // Tell background to compile the final macro and send to UI
    chrome.runtime.sendMessage({ action: 'compileMacro' }).catch(() => {});
    console.log("PIRATE AI: Macro Recording finished.");
}

// Add to the message listener in content_scraper.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ... existing logic ...
    if (request.action === 'stopMacroTraining') {
        finishMacroTraining();
        sendResponse({ success: true });
    }
});
  

  // ==========================================
  // 2. MESSAGE LISTENER
  // ==========================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startSelectorTraining') {
        isTrainingMode = true;
        trainingPlatform = request.platform;
        const handler = (e) => {
            e.preventDefault(); e.stopPropagation();
            document.removeEventListener('click', handler, true);
            isTrainingMode = false;
            const selectors = generateStableSelector(e.target);
            showPatchUI(trainingPlatform, selectors);
        };
        document.addEventListener('click', handler, true);
        sendResponse({ success: true });
    } else if (request.action === 'startMacroTraining') {
        startMacroTraining(request.platform);
        sendResponse({ success: true });
    } else if (request.action === 'stopMacroTraining') {
        finishMacroTraining();
        sendResponse({ success: true });
    } else if (request.action === 'showMacroConfirmation') {
        // Correctly pass the compiled macro array as a string to the UI
        showPatchUI(request.platform, JSON.stringify(request.macro, null, 2));
        sendResponse({ success: true });
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'showPirateOverlay') return false;

    showPirateOverlay(request)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'minimizePirateOverlay') return false;

    const minimized = minimizePirateOverlay();
    sendResponse({ success: true, minimized });
    return true;
  });

  // ==========================================
  // 3. OVERLAY UI LOGIC (Updated for Capture First)
  // ==========================================

  async function handleAddToQueue(btnAdd) {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      
      let data = null;
      try {
          if (!configLoaded) {
              await Promise.race([configLoadPromise, delay(1200)]);
          }
          data = scrapePageStrategy();
      } catch(err) {
          console.error("Scraping error:", err);
          if (window.showClippyMessage) window.showClippyMessage("Error scraping page data. Check the console.");
          return;
      }
      
      if (!data) { 
          if (window.showClippyMessage) window.showClippyMessage("No valid video detected on this page. Check logs.");
          return; 
      }
      
      // --- TRACK A: SCOUT SCORING ---
      data.scoutScore = 10; // Standard Find
      let parsedViews = 0;
      const vStr = String(data.views || "0").toLowerCase();
      if (vStr.includes('k')) parsedViews = parseFloat(vStr) * 1000;
      else if (vStr.includes('m')) parsedViews = parseFloat(vStr) * 1000000;
      else parsedViews = parseFloat(vStr.replace(/[^\d.]/g, '')) || 0;
      
      // --- TRACK A: SCOUT SCORING (GOLD MINE MULTIPLIER) ---
      let baseScore = 10;
      if (parsedViews >= 100000) data.scoutScore = baseScore * 5; // 5x Viral Pirate
      else if (parsedViews >= 10000) data.scoutScore = baseScore * 2; // 2x High-Impact
      else data.scoutScore = baseScore; // 1x Standard
      
      if (data.url.includes('/live/') || document.querySelector('[aria-label="LIVE"]')) data.scoutScore *= 2; // Live Event Bonus
      
      const originalText = "+ Add";
      btnAdd.innerText = "Capturing...";
      btnAdd.disabled = true;
      btnAdd.style.backgroundColor = "#ff9800"; 

      // --- TIMEOUT PROTECTION ---
      let responseReceived = false;
      const safetyTimeout = setTimeout(() => {
          if (!responseReceived) {
              console.warn("PIRATE AI: Process timed out.");
              btnAdd.innerText = "Error/Timeout";
              setTimeout(() => {
                  btnAdd.innerText = originalText;
                  btnAdd.disabled = false;
                  btnAdd.style.backgroundColor = "#ce0e2d";
              }, 2000);
          }
      }, 8000); // 8 seconds to allow background capture + Google API call

      try {
          // Tell the background script to handle capture & verification simultaneously
          chrome.runtime.sendMessage({ 
              action: 'processNewItem', 
              data: data 
          }, (res) => {
              responseReceived = true;
              clearTimeout(safetyTimeout);

              if (chrome.runtime.lastError) {
                  console.warn("Process error:", chrome.runtime.lastError);
                  if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("context invalidated")) {
                      handleContextInvalidated();
                      return;
                  }
                  
                  // Graceful failure UI update
                  btnAdd.innerText = "Error";
                  setTimeout(() => { 
                      btnAdd.innerText = originalText; 
                      btnAdd.disabled = false; 
                      btnAdd.style.backgroundColor = "#ce0e2d";
                  }, 1500);
                  return;
              }
              // --- HANDLE BACKGROUND RESPONSE ---
              if (res && res.status === 'whitelisted') {
                  // Render penalty toast directly in the DOM instead of blocking alert()
                  if (res.milestoneHit) {
                      const toast = document.createElement('div');
                      toast.style.cssText = `position:fixed; bottom:30px; right:30px; background:#ce0e2d; color:#fff; padding:15px 20px; border-radius:8px; font-weight:bold; box-shadow:0 6px 20px rgba(0,0,0,0.4); z-index:2147483647; font-family:sans-serif; pointer-events:none; transition: all 0.3s ease-in-out;`;
                      toast.innerHTML = `🚨 Penalty Applied!<br><span style="font-size:12px; font-weight:normal;">${res.milestoneMessage}</span>`;
                      document.body.appendChild(toast);
                      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 4000);
                  }
                  
                  btnAdd.innerText = "Whitelisted";
                  btnAdd.style.backgroundColor = "#666"; 
                  
                  setTimeout(() => {
                      btnAdd.innerText = originalText;
                      btnAdd.disabled = false;
                      btnAdd.style.backgroundColor = "#ce0e2d"; 
                  }, 2000);
              } else if (res && res.success) {
                  // --- MILESTONE TOAST ---
                  if (res.milestoneHit) {
                      const isLevelUp = res.milestoneMessage?.toLowerCase().includes("level");
                      
                      // Notify Clippy to act as the Hype Man
                      window.dispatchEvent(new CustomEvent('triggerClippyHype', { 
                          detail: { message: res.milestoneMessage, isLevelUp } 
                      }));
                  }
                  
                  btnAdd.innerText = "Saved!"; 
                  btnAdd.style.backgroundColor = "#4CAF50";
                  setTimeout(() => {
                      btnAdd.innerText = originalText; 
                      btnAdd.disabled = false; 
                      btnAdd.style.backgroundColor = "#ce0e2d";
                  }, 1500);
              } else {
                  btnAdd.innerText = "Error";
                  console.error("Process Response Error:", res);
                  setTimeout(() => { 
                      btnAdd.innerText = originalText; 
                      btnAdd.disabled = false; 
                      btnAdd.style.backgroundColor = "#ce0e2d";
                  }, 1500);
              }
          });
      } catch (e) {
          responseReceived = true;
          clearTimeout(safetyTimeout);
          console.error("PIRATE AI: Message Sending Error", e);
          handleContextInvalidated();
      }
  }

// Check if the extension context is still valid (handles cases where the page might have navigated or reloaded)
  async function initOverlay() {
    if (document.getElementById('flo-overlay')) return;
    if (!isExtensionValid()) return;

    // Auto-minimize if we are on a reporting/legal page
    const currentUrl = window.location.href.toLowerCase();
    const isReportingPage = currentUrl.includes('/legal/report') || 
                            currentUrl.includes('copyright_complaint_form') || 
                            currentUrl.includes('ipr.tiktokforbusiness') ||
                            currentUrl.includes('facebook.com/help/contact/copyrightform') ||
                            currentUrl.includes('twitch.tv/copyright-claims');

    const overlay = document.createElement('div');
    overlay.id = 'flo-overlay';
    overlay.style.cssText = `
      position: fixed; top: 150px; right: 20px; z-index: 2147483647;
      background: white; padding: 15px; border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 220px;
      border: 1px solid #e0e0e0; text-align: center;
      font-family: sans-serif; transition: all 0.3s ease; cursor: move; user-select: none;
    `;

    overlay.innerHTML = `
      <div id="flo-top-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
        <div id="flo-drag-handle" style="font-size: 12px; color: #666; cursor: move; flex-grow: 1; text-align: left; font-weight:bold;">PIRATE AI ✥</div>
        <button id="flo-min-btn" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; line-height: 1; padding: 0 5px;">−</button>
      </div>
      <div id="flo-main-content">
        <div id="flo-count" style="font-size: 32px; color: #ce0e2d; font-weight: bold; margin-bottom: 15px; transition: color 0.3s; pointer-events: none;">...</div>
        
        <div style="display: flex; gap: 8px; margin-bottom: 10px;">
          <button id="flo-add" style="flex: 1; background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">+ Add</button>
          <button id="flo-report" style="flex: 1; background: #333; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">Panel</button>
        </div>
        
        <!-- NUKE BUTTON (Hidden by Default) -->
        <button id="flo-nuke" style="width: 100%; background: #1a1a1a; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold; margin-bottom: 10px; display: none;">Nuke Stream</button>

        <div style="display: flex; justify-content: space-between;">
          <button id="flo-undo" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Undo Last</button>
          <button id="flo-reset" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Reset Queue</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const btnAdd = document.getElementById('flo-add');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => handleAddToQueue(btnAdd));
    }
    // 1. Panel Button Listener - Opens the side panel
    document.getElementById('flo-report').addEventListener('click', () => {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      try { chrome.runtime.sendMessage({ action: 'openPopup' }); } 
      catch(e) { handleContextInvalidated(); }
    });
    // 2. Reset Button Listener - Clears the cart with confirmation
    document.getElementById('flo-reset').addEventListener('click', () => {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      if (currentCount > 0 && !confirm(`Delete ${currentCount} items from cart?`)) return;
      try { chrome.runtime.sendMessage({ action: 'clearCart' }); } 
      catch(e) { handleContextInvalidated(); }
    });
    // 3. Undo Button Listener - Removes the most recently added item
    document.getElementById('flo-undo').addEventListener('click', () => {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      if (currentCount > 0) {
        try { chrome.runtime.sendMessage({ action: 'undoCart' }); } 
        catch(e) { handleContextInvalidated(); }
      }
    });

    // ==========================================
    // ON-PAGE NUKE BUTTON FORENSIC LOGIC
    // ==========================================
    const btnNuke = document.getElementById('flo-nuke');
    if (btnNuke) {
        // Initial state check
        chrome.storage.local.get(['showNukeButton'], (res) => {
            btnNuke.style.display = res.showNukeButton ? 'block' : 'none';
        });

        // Click handler (Forensic Scrape from the page context)
        btnNuke.addEventListener('click', () => {
            btnNuke.innerText = "Extracting IOCs...";
            btnNuke.disabled = true;

            const html = document.documentElement.innerHTML;
            const iocs = {
                configKeys: html.match(/Config Key:\s*([A-Za-z0-9]+)/i) || html.match(/['"]([A-Za-z0-9]{16,})['"]/g),
                affiliateIds: html.match(/(pub_id=\d+|cid=[a-zA-Z0-9]+)/gi) || [],
                wargaming: html.match(/10652030/g) ? "Wargaming ID 10652030" : null,
                cloudflareRum: html.match(/[a-f0-9]{32}/gi) || []
            };

            const data = {
                title: document.title,
                url: window.location.href,
                iframes: Array.from(document.querySelectorAll('iframe')).map(i => i.src).filter(Boolean),
                videos: Array.from(document.querySelectorAll('video')).map(v => v.src).filter(Boolean),
                emails: (document.body.innerText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi) || []).filter(e => e.toLowerCase().includes('abuse')),
                forensics: iocs
            };

            chrome.runtime.sendMessage({ action: 'initRogueTakedown', data: data }, () => {
                btnNuke.innerText = "Nuke Stream";
                btnNuke.disabled = false;
                
                // Pop the side panel open to show the results
                chrome.runtime.sendMessage({ action: 'openPopup' });
            });
        });
    }

    // Minimize Logic
       let storedMinState = sessionStorage.getItem('floPirateAiMinimized');
    let isMinimized = storedMinState !== null ? storedMinState === 'true' : isReportingPage;
    const minBtn = document.getElementById('flo-min-btn');
    const mainContent = document.getElementById('flo-main-content');
    const dragHandle = document.getElementById('flo-drag-handle');

    const toggleMinimize = () => {
        if (isMinimized) {
            mainContent.style.display = 'none';
            minBtn.innerHTML = '+';
            dragHandle.innerText = '✥';
            overlay.style.width = 'auto';
            overlay.style.padding = '8px';
            overlay.style.left = 'auto'; 
            overlay.style.right = '0px'; // Snap to right edge as a tab
            overlay.style.borderTopRightRadius = '0';
            overlay.style.borderBottomRightRadius = '0';
        } else {
            mainContent.style.display = 'block';
            minBtn.innerHTML = '−';
            dragHandle.innerText = 'PIRATE AI ✥';
            overlay.style.width = '220px';
            overlay.style.padding = '15px';
            overlay.style.borderRadius = '12px';
            
            // Adjust position if it was snapped to the edge
            const rect = overlay.getBoundingClientRect();
            if (window.innerWidth - rect.right < 10) {
                overlay.style.right = '20px';
                overlay.style.left = 'auto';
            }
        }
	    };

	    minBtn.addEventListener('click', () => {
	        const currentlyMinimized = sessionStorage.getItem('floPirateAiMinimized') === 'true' || mainContent.style.display === 'none';
	        isMinimized = !currentlyMinimized;
	        sessionStorage.setItem('floPirateAiMinimized', isMinimized);
	        toggleMinimize();
	    });

	    if (isMinimized) {
	        sessionStorage.setItem('floPirateAiMinimized', 'true');
	        toggleMinimize();
	    } // Enforce immediately if on reporting page

    let isDragging = false;
      let startX, startY, initialLeft, initialTop;

    overlay.addEventListener('mousedown', (e) => {
        if (['BUTTON', 'INPUT', 'A', 'SELECT'].includes(e.target.tagName)) return;
        if (e.target.id === 'flo-min-btn') return; // Prevent drag trigger on minimize btn

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = overlay.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        overlay.style.right = 'auto';
        overlay.style.left = `${initialLeft}px`;
        overlay.style.top = `${initialTop}px`;
        
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        overlay.style.left = `${initialLeft + dx}px`;
        overlay.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

   try {
        const storage = await new Promise((resolve, reject) => {
          chrome.storage.local.get('piracy_cart', (items) => {
            if (chrome.runtime.lastError) resolve({ piracy_cart: [] });
            else resolve(items);
          });
        });
        const cart = storage.piracy_cart || [];
        updateCount(cart.length);

        // Fire event to trigger Clippy's spotlight if a valid video exists
        if (scrapePageStrategy()) {
            window.dispatchEvent(new CustomEvent('validVideoFound'));
        }
      } catch (e) {
        console.error("Storage load error:", e);
        updateCount(0); 
      }
  }

  function expandOverlayPanel() {
    const overlay = document.getElementById('flo-overlay');
    const mainContent = document.getElementById('flo-main-content');
    const minBtn = document.getElementById('flo-min-btn');
    const dragHandle = document.getElementById('flo-drag-handle');

    if (!overlay || !mainContent || !minBtn || !dragHandle) return;

    mainContent.style.display = 'block';
    minBtn.innerHTML = '−';
    dragHandle.innerText = 'PIRATE AI ✥';
    overlay.style.display = 'block';
    overlay.style.width = '220px';
    overlay.style.padding = '15px';
    overlay.style.borderRadius = '12px';
    overlay.style.right = overlay.style.right || '20px';
    overlay.style.left = overlay.style.left || 'auto';
    sessionStorage.setItem('floPirateAiMinimized', 'false');
  }

  function minimizePirateOverlay() {
    sessionStorage.setItem('floPirateAiMinimized', 'true');

    const overlay = document.getElementById('flo-overlay');
    if (!overlay) return false;

    const mainContent = document.getElementById('flo-main-content');
    const minBtn = document.getElementById('flo-min-btn');
    const dragHandle = document.getElementById('flo-drag-handle');

    if (mainContent) mainContent.style.display = 'none';
    if (minBtn) minBtn.innerHTML = '+';
    if (dragHandle) dragHandle.innerText = '✥';

    overlay.style.display = 'block';
    overlay.style.width = 'auto';
    overlay.style.padding = '8px';
    overlay.style.left = 'auto';
    overlay.style.right = '0px';
    overlay.style.borderTopRightRadius = '0';
    overlay.style.borderBottomRightRadius = '0';

    return true;
  }

  async function showPirateOverlay(options = {}) {
    const { showNukeButton = false, expand = true } = options;

    if (!document.getElementById('flo-overlay')) {
      await initOverlay();
    }

    const overlay = document.getElementById('flo-overlay');
    if (!overlay) return;

    overlay.style.display = 'block';

    if (showNukeButton) {
      const nukeBtn = document.getElementById('flo-nuke');
      if (nukeBtn) nukeBtn.style.display = 'block';
    }

    if (expand) {
      expandOverlayPanel();
    }
  }

  function updateCount(n) {
    currentCount = n;
    const el = document.getElementById('flo-count');
    if (el) {
      el.innerText = n;
      if (n === 0) {
          el.style.color = "#4CAF50"; 
          setTimeout(() => el.style.color = "#ce0e2d", 1000);
      } else {
          el.style.color = "#ce0e2d"; 
      }
    }
  }
// Listen for storage changes to update count in real-time across tabs and handle Nuke Button visibility
  if (isExtensionValid()) {
      try {
          chrome.storage.onChanged.addListener((changes, namespace) => {
              if (namespace === 'local' && changes.piracy_cart) {
                  const newValue = changes.piracy_cart.newValue || [];
                  updateCount(newValue.length);
              }
              // Listen for the Nuke Button visibility toggle
              if (namespace === 'local' && changes.showNukeButton) {
                  const nukeBtn = document.getElementById('flo-nuke');
                  if (nukeBtn) {
                      nukeBtn.style.display = changes.showNukeButton.newValue ? 'block' : 'none';
                  }
              }
          });
      } catch (e) { console.warn("Could not attach storage listener"); }
  }

  let lastUrl = location.href; 
      new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          if (!document.getElementById('flo-overlay')) initOverlay();
          
          if (isMacroMode) finishMacroTraining(); // 🛑 Auto-stop on Lynx/SPA URL change
        }
      }).observe(document, {subtree: true, childList: true});
  
      // --- MACRO RECOVERY ON LOAD ---
     /* const savedState = loadMacroState();
      if (savedState && savedState.isRecording) {
          trainingPlatform = savedState.platform;
          macroEvents = savedState.events;
          finishMacroTraining(); // 🛑 Auto-stop on Hard Reload/Crash
      } */
  
      if (forceOverlayRun) {
          window.__floForceOverlay = false;
          void showPirateOverlay({ showNukeButton: true, expand: true });
      } else {
          setTimeout(initOverlay, 1500);
      }
  
  })();
