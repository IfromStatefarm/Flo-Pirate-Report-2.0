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
      handle: [
        'header a[href^="/"]',
        'main header a[href^="/"]',
        'a[role="link"][href^="/"]'
      ],
      profile_links: [
        'header a[href^="/"]',
        'main header a[href^="/"]',
        'a[role="link"][href^="/"]'
      ],
      meta_description: [
        'meta[property="og:description"]',
        'meta[name="description"]'
      ],
      likes: [
        'a[href*="/liked_by/"]',
        '//article//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), " likes")][1]',
        '//*[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), " likes")][1]'
      ],
      json_scripts: [
        'script[type="application/json"]'
      ],
      json_patterns: {
        handle: [
          '"owner"\\s*:\\s*\\{[^{}]*?"username"\\s*:\\s*"([^"]+)"',
          '"user"\\s*:\\s*\\{[^{}]*?"username"\\s*:\\s*"([^"]+)"',
          '"username"\\s*:\\s*"([^"]+)"'
        ],
        view_count: [
          '"video_view_count"\\s*:\\s*(\\d+)',
          '"play_count"\\s*:\\s*(\\d+)',
          '"view_count"\\s*:\\s*(\\d+)'
        ],
        like_count: [
          '"edge_media_preview_like"\\s*:\\s*\\{[^{}]*?"count"\\s*:\\s*(\\d+)',
          '"edge_liked_by"\\s*:\\s*\\{[^{}]*?"count"\\s*:\\s*(\\d+)',
          '"like_count"\\s*:\\s*(\\d+)'
        ]
      }
    },
    twitter: {
      handle: '[data-testid="tweet"] [data-testid="User-Name"] a',
      views: 'a[href*="analytics"] span, [data-testid="app-text-transition-container"] span'
    },
    facebook: {
      handle: 'h2 a[role="link"], strong span'
    },
    rumble: {
      handle: [
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
        '.media-heading-info',
        '.video-description [class*="view"]',
        '.video-meta [class*="view"]'
      ],
      live_indicators: [
        '.video-status--live',
        '.media-status.live',
        '[class*="live"]'
      ]
    },
    twitch: {
      handle_links: [
        '[data-test-selector="metadata-layout__split-top"] a[href^="/"]',
        '[class*="metadata-layout__split-top"] a[href^="/"]',
        '#live-channel-stream-information a[href^="/"]',
        'a[href^="/"][class*="CoreLink"]',
        'h1 a[href^="/"]',
        'a[href^="/"] h1'
      ],
      live_indicators: [
        '[data-a-target="stream-live-indicator"]',
        '[data-a-target="channel-status-text-indicator"]',
        '[class*="tw-channel-status-text-indicator"]',
        '[class*="ScChannelStatusTextIndicator"]'
      ],
      live_viewers: [
        '[data-a-target="animated-channel-viewers-count"]',
        '[data-a-target="channel-viewers-count"]',
        '[class*="ScAnimatedNumber"]',
        'strong[aria-hidden="true"] span'
      ],
      vod_views: [
        '[data-test-selector="metadata-layout__split-top"] p',
        '[class*="metadata-layout__split-top"] p',
        'p[class*="CoreText"]'
      ],
      clip_views: [
        '[data-test-selector="metadata-layout__split-top"] p',
        '[class*="metadata-layout__split-top"] p',
        'p[class*="CoreText"]'
      ]
    },
    discord: {
     handle: 'div[class*="username"]'
    }
  };

  // --- CONFIG LOADER ---
  (async function loadConfig() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.success && response.config && response.config.platform_selectors) {
        console.log("✅ PIRATE AI: Remote Selectors Loaded");
        const remote = response.config.platform_selectors;
        Object.entries(remote).forEach(([platform, platformConfig]) => {
          if (!platformConfig?.scraper) return;
          SCRAPER_CONFIG[platform] = {
            ...(SCRAPER_CONFIG[platform] || {}),
            ...platformConfig.scraper
          };
        });
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

  function getTextFromSelectorList(selectors) {
      for (const selector of toSelectorList(selectors)) {
          const element = findElement(selector);
          if (!element) continue;
          const text = (
              element.innerText ||
              element.textContent ||
              element.getAttribute?.('title') ||
              element.getAttribute?.('aria-label') ||
              ''
          ).trim();
          if (text) return text;
      }
      return '';
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
          .filter((text) => /username|video_view_count|play_count|view_count|like_count|edge_media_preview_like|edge_liked_by|xdt_shortcode_media/i.test(text));

      const prioritizedTexts = rawTexts.filter((text) => /xdt_shortcode_media|video_view_count|play_count|view_count|like_count|edge_media_preview_like|edge_liked_by/i.test(text));
      const candidateTexts = prioritizedTexts.length > 0 ? prioritizedTexts : rawTexts;

      if (candidateTexts.length === 0) {
          return { handle: '', views: '', likes: '' };
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
      const likePatterns = instagramConfig.json_patterns?.like_count || [
          '"edge_media_preview_like"\\s*:\\s*\\{[^{}]*?"count"\\s*:\\s*(\\d+)',
          '"edge_liked_by"\\s*:\\s*\\{[^{}]*?"count"\\s*:\\s*(\\d+)',
          '"like_count"\\s*:\\s*(\\d+)'
      ];

      return {
          handle: normalizeScrapedHandle(extractFirstPatternMatch(joinedText, handlePatterns)),
          views: extractReadableViewCount(extractFirstPatternMatch(joinedText, viewPatterns)),
          likes: extractReadableLikeCount(extractFirstPatternMatch(joinedText, likePatterns), true)
      };
  }

  function getInstagramLikeCountFromTextCandidates(textCandidates, allowBareNumber = false) {
      for (const text of textCandidates) {
          const count = extractReadableLikeCount(text, allowBareNumber);
          if (count) return count;
      }
      return '';
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

  function getInstagramLikeCountFromDom(instagramConfig) {
      const configuredLikes = getElementsFromSelectorList(instagramConfig.likes);

      for (const element of configuredLikes) {
          const containers = [
              element,
              element.closest?.('a'),
              element.closest?.('section'),
              element.parentElement,
              element.parentElement?.parentElement
          ].filter(Boolean);

          for (const container of containers) {
              const count = getInstagramLikeCountFromTextCandidates([
                  container.innerText,
                  container.textContent,
                  container.getAttribute?.('aria-label'),
                  container.getAttribute?.('title')
              ].filter(Boolean), true);
              if (count) return count;
          }
      }

      const roots = [
          document.querySelector('article'),
          document.querySelector('main'),
          document.body
      ].filter(Boolean);
      const seenRoots = new Set();

      for (const root of roots) {
          if (seenRoots.has(root)) continue;
          seenRoots.add(root);

          const sections = Array.from(root.querySelectorAll?.('section') || []);
          for (const section of sections) {
              const count = getInstagramLikeCountFromTextCandidates([
                  section.innerText,
                  section.textContent
              ].filter(Boolean));
              if (count) return count;
          }
      }

      const root = roots[0];
      if (!root || !document.createTreeWalker || typeof NodeFilter === 'undefined') return '';

      const rejectedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
              const text = String(node.textContent || '');
              const parent = node.parentElement;
              if (!/\blikes?\b/i.test(text) || !parent || rejectedTags.has(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
          }
      });

      let node = walker.nextNode();
      let scanned = 0;
      while (node && scanned < 200) {
          scanned += 1;
          let element = node.parentElement;

          for (let depth = 0; element && depth < 5; depth += 1) {
              if (rejectedTags.has(element.tagName)) break;
              const count = getInstagramLikeCountFromTextCandidates([
                  element.innerText,
                  element.textContent
              ].filter(Boolean));
              if (count) return count;
              if (element.tagName === 'ARTICLE') break;
              element = element.parentElement;
          }

          node = walker.nextNode();
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

      const descriptiveMatch = text.match(/([\d.,]+(?:\s*[KMB])?)(?=\s*(?:views?|watching|viewers?)\b)/i);
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

  function extractReadableLikeCount(value, allowBareNumber = false) {
      const text = String(value || '').trim();
      if (!text) return '';

      const descriptiveMatch = text.match(/([\d.,]+(?:\s*[KMB])?)(?=\s*(?:likes?)\b)/i);
      if (descriptiveMatch) {
          return descriptiveMatch[1].replace(/\s+/g, '');
      }

      if (allowBareNumber) {
          const compactOnlyMatch = text.match(/^([\d.,]+(?:\s*[KMB])?)$/i);
          if (compactOnlyMatch) {
              return compactOnlyMatch[1].replace(/\s+/g, '');
          }

          if (/^\d+$/.test(text)) return text;
      }

      return '';
  }

  function extractTwitchHandleFromHref(href) {
      if (!href) return '';

      try {
          const parsed = href.startsWith('http') ? new URL(href) : new URL(href, window.location.origin);
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          const reservedSegments = new Set([
              'about',
              'activate',
              'bits',
              'clip',
              'clips',
              'collections',
              'directory',
              'downloads',
              'friends',
              'jobs',
              'login',
              'p',
              'settings',
              'store',
              'subscriptions',
              'videos'
          ]);

          const candidate = pathParts.find((segment) => {
              const normalized = segment.toLowerCase();
              return normalized && !reservedSegments.has(normalized);
          });

          return normalizeScrapedHandle(candidate || '');
      } catch (error) {
          return '';
      }
  }

  function getTwitchHandle(twitchConfig, pathParts) {
      for (const element of getElementsFromSelectorList(twitchConfig.handle_links)) {
          const anchor = element.matches?.('a[href]')
              ? element
              : element.closest?.('a[href]') || element.querySelector?.('a[href]');
          const handle = extractTwitchHandleFromHref(anchor?.href || element.getAttribute?.('href') || '');
          if (handle) return handle;
      }

      const pathHandle = extractTwitchHandleFromHref(`/${(pathParts || []).join('/')}`);
      return pathHandle || 'TwitchUser';
  }

  function getTwitchViewCount(selectors) {
      for (const element of getElementsFromSelectorList(selectors)) {
          const text = [
              element.innerText,
              element.textContent,
              element.getAttribute?.('aria-label'),
              element.getAttribute?.('title')
          ].filter(Boolean).join(' ');
          const views = extractReadableViewCount(text);
          if (views) return views;
      }
      return '';
  }

  function hasTwitchLiveSignal(twitchConfig) {
      const visibleLiveIndicator = toSelectorList(twitchConfig.live_indicators).some((selector) => {
          const element = findElement(selector);
          if (!element) return false;
          const text = element.innerText || element.textContent || element.getAttribute?.('aria-label') || '';
          return !text || /\blive\b/i.test(text);
      });

      if (visibleLiveIndicator) return true;

      const contextText = [
          document.title,
          document.querySelector('meta[property="og:title"]')?.content || '',
          document.querySelector('meta[name="description"]')?.content || ''
      ].join(' ');

      return /\blive\b/i.test(contextText);
  }

  // ==========================================
  // 1. THE STRATEGY SCRAPER
  // ==========================================
  function scrapePageStrategy() {
    const host = window.location.hostname;
    const url = window.location.href;
    const timestamp = new Date().toISOString();
    let views = "N/A"; 

    console.log("PIRATE AI: Attempting scrape on", host, url);

    // --- TIKTOK (LAZY LOAD UPDATE) ---
    if (host.includes('tiktok.com')) {
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
              const pattern = SCRAPER_CONFIG.tiktok.url_match;
              const customRegex = new RegExp(pattern);
              const customMatch = url.match(customRegex);
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
    else if (host.includes('youtube.com')) {
      const params = new URLSearchParams(window.location.search);
      const videoId = params.get('v');
      
      if (!videoId && !url.includes('/shorts/') && !url.includes('/live/')) {
          return null;
      }

      const channelLink = document.querySelector(SCRAPER_CONFIG.youtube.channel_link);
      let channel = "Unknown";
      
      if (channelLink) {
          const href = channelLink.getAttribute('href') || "";
          if (href.includes('/@')) {
              channel = href.split('/@')[1]; 
          } else {
              channel = channelLink.innerText; 
          }
      }

      const viewSelector = document.querySelector(SCRAPER_CONFIG.youtube.views_std); 
      const shortViewSelector = document.querySelector(SCRAPER_CONFIG.youtube.views_shorts); 
      const shortDescButton = document.querySelector('button[aria-label*="views"]');
      
      if (viewSelector && viewSelector.innerText) {
          views = viewSelector.innerText.replace(' views', '');
      } else if (shortViewSelector && shortViewSelector.innerText) {
          views = shortViewSelector.innerText;
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
    else if (host.includes('instagram.com')) {
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
      const viewCount = embeddedData.views || metaViews || semanticViews;

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
          const likeCount = viewCount
              ? ''
              : (embeddedData.likes || extractReadableLikeCount(metaDescription) || getInstagramLikeCountFromDom(instagramConfig));
          views = viewCount || likeCount || "N/A";
      }
      
      return { 
        platform: "Instagram", 
        url, 
        handle: normalizeScrapedHandle(handle) || "InstagramUser",
        views,
        contentType: url.includes('/reel/') ? 'reel' : (url.includes('/tv/') ? 'video' : (isStoryUrl ? 'story' : 'post')),
        timestamp 
      };
    }

    // --- TWITTER / X ---
    else if (host.includes('twitter.com') || host.includes('x.com')) {
      if (!url.includes('/status/')) return null;
      const pathParts = new URL(url).pathname.split('/');
      let handle = pathParts[1] || "TwitterUser";

      const domHandle = document.querySelector(SCRAPER_CONFIG.twitter.handle)?.innerText;
      if (domHandle && domHandle.startsWith('@')) handle = domHandle.substring(1);

      const viewEl = document.querySelector(SCRAPER_CONFIG.twitter.views);
      const views = viewEl ? viewEl.innerText.trim() : "N/A";
      
      return { 
        platform: "Twitter", 
        url, 
        handle, 
        views, 
        timestamp 
      };
    }

    // --- TWITCH ---
    else if (host.includes('twitch.tv')) {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const lowerPathParts = pathParts.map((part) => part.toLowerCase());
      const firstSegment = lowerPathParts[0] || '';
      const twitchConfig = SCRAPER_CONFIG.twitch || {};
      const isClip = parsedUrl.hostname.toLowerCase().includes('clips.twitch.tv') ||
        firstSegment === 'clip' ||
        lowerPathParts.includes('clip');
      const isVod = !isClip && (firstSegment === 'videos' || firstSegment === 'collections');
      const nonVideoSegments = new Set(['copyright-claims', 'directory', 'downloads', 'jobs', 'login', 'p', 'settings']);
      if (!isClip && !isVod && nonVideoSegments.has(firstSegment)) return null;

      const isLive = !isClip && !isVod && hasTwitchLiveSignal(twitchConfig);
      const handle = getTwitchHandle(twitchConfig, pathParts);
      const liveViews = getTwitchViewCount(twitchConfig.live_viewers);
      const vodViews = getTwitchViewCount(twitchConfig.vod_views);
      const clipViews = getTwitchViewCount(twitchConfig.clip_views);

      return { 
        platform: "Twitch", 
        url, 
        handle,
        views: (isClip ? clipViews : (isVod ? vodViews : liveViews)) || liveViews || vodViews || clipViews || "N/A",
        contentType: isClip ? 'clip' : (isLive ? 'live' : 'vod'),
        isLive,
        timestamp 
      };
    }

    // --- FACEBOOK ---
    else if (host.includes('facebook.com')) {
      return { 
        platform: "Facebook", 
        url, 
        handle: "FacebookUser", 
        views: "N/A", 
        timestamp 
      };
    }

    // --- RUMBLE ---
    else if (host.includes('rumble.com')) {
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

      const rawViews = getTextFromSelectorList(rumbleConfig.views);
      views = extractReadableViewCount(rawViews) || extractReadableViewCount(structuredData.viewCount) || "N/A";

      const liveContextText = [
        document.title,
        document.querySelector('meta[property="og:title"]')?.content || '',
        document.querySelector('meta[name="description"]')?.content || ''
      ].join(' ');
      const isLive = toSelectorList(rumbleConfig.live_indicators).some((selector) => !!findElement(selector)) ||
        /\blive\b/i.test(liveContextText);

      return {
        platform: "Rumble",
        url,
        handle: handle || "RumbleCreator",
        views,
        timestamp,
        isLive
      };
    }

    // --- DISCORD ---
    else if (host.includes('discord.com')) {
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
	              <option value="scraper" ${isMacroData ? '' : 'selected'}>Scraper (Views, Handles)</option>
	              <option value="autofill" ${isMacroData ? 'selected' : ''}>Autofill (Wizard Steps)</option>
	              <option value="session">Session (Account Checks)</option>
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
            const actionType = document.getElementById('flo-patch-action')?.value || '';
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
    void sender;
    if (request.action !== 'getCurrentPirateScrape') return false;

    try {
      sendResponse({ success: true, data: scrapePageStrategy() });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startSelectorTraining') {
        startSelectorTraining(request.platform);
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

  // ==========================================
  // 3. OVERLAY UI LOGIC (Updated for Capture First)
  // ==========================================

  function handleAddToQueue(btnAdd) {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      
      let data = null;
      try {
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
      
      if (data.isLive || data.url.includes('/live/') || document.querySelector('[aria-label="LIVE"]')) data.scoutScore *= 2; // Live Event Bonus
      
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
                            currentUrl.includes('ipr.tiktokforbusiness');

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
        isMinimized = !isMinimized;
        sessionStorage.setItem('floPirateAiMinimized', isMinimized);
        toggleMinimize();
    });

    if (isMinimized) toggleMinimize(); // Enforce immediately if on reporting page

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
