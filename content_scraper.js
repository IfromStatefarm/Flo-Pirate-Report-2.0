// content_scraper.js

(function() { // Wrap in IIFE to prevent variable leaks
  
  // Guard against re-injection
  if (window.hasFloScraperRun) return;
  window.hasFloScraperRun = true;

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
    },
    instagram: {
      handle: 'header a'
    }
  };

  // --- CONFIG LOADER ---
  (async function loadConfig() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.success && response.config && response.config.platform_selectors) {
        console.log("✅ PIRATE AI: Remote Selectors Loaded");
        const remote = response.config.platform_selectors;
        if (remote.tiktok && remote.tiktok.scraper) SCRAPER_CONFIG.tiktok = { ...SCRAPER_CONFIG.tiktok, ...remote.tiktok.scraper };
        if (remote.youtube && remote.youtube.scraper) SCRAPER_CONFIG.youtube = { ...SCRAPER_CONFIG.youtube, ...remote.youtube.scraper };
        if (remote.instagram && remote.instagram.scraper) SCRAPER_CONFIG.instagram = { ...SCRAPER_CONFIG.instagram, ...remote.instagram.scraper };
      }
    } catch (e) {
      // Suppress heavy logging
    }
  })();

  function isExtensionValid() {
    try { return !!chrome.runtime && !!chrome.runtime.id; } 
    catch (e) { return false; }
  }

  function handleContextInvalidated() {
    const overlay = document.getElementById('flo-overlay');
    if (overlay) {
      overlay.innerHTML = `<div style="padding:15px; color:#666;">⚠️ Extension Updated<br><button style="margin-top:5px; padding:5px;" onclick="location.reload()">Refresh Page</button></div>`;
      overlay.style.border = "2px solid red";
    }
  }

<<<<<<< HEAD
  // --- ENGAGEMENT HELPERS ---
  function parseEngagement(text) {
    if (!text) return 0;
    const clean = text.toString().toUpperCase().replace(/,/g, '').trim();
    const match = clean.match(/([\d\.]+)([KMB]?)/);
    if (!match) return 0;
    
    const num = parseFloat(match[1]);
    const suffix = match[2];
    let multiplier = 1;
    
    if (suffix === 'K') multiplier = 1000;
    else if (suffix === 'M') multiplier = 1000000;
    else if (suffix === 'B') multiplier = 1000000000;
    
    return num * multiplier;
  }

  function formatEngagement(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.floor(num).toString();
  }

  function scrapeEngagement(platform) {
      let viewsStr = "";
      let likesStr = "";
      
      try {
          if (platform === "TikTok") {
              const viewEl = document.querySelector('[data-e2e="video-views"]');
              const likeEl = document.querySelector('[data-e2e="like-count"]');
              if (viewEl) viewsStr = viewEl.innerText;
              if (likeEl) likesStr = likeEl.innerText;
          } 
          else if (platform === "YouTube") {
              const viewEl = document.querySelector('yt-view-count-renderer, span.view-count, #view-count, ytd-reel-player-overlay-renderer #view-count');
              const likeEl = document.querySelector('ytd-toggle-button-renderer a[aria-label*="like"] yt-formatted-string, #top-level-buttons-computed yt-formatted-string, ytd-reel-player-overlay-renderer #like-button yt-formatted-string');
              if (viewEl) viewsStr = viewEl.innerText;
              if (likeEl) likesStr = likeEl.innerText;
          }
          else if (platform === "Instagram") {
              const viewEl = document.querySelector('svg[aria-label="Play"]')?.closest('div')?.querySelector('span'); 
              const likeEl = document.querySelector('a[href$="liked_by/"] span, section span > span, [aria-label*="Likes"]');
              if (viewEl) viewsStr = viewEl.innerText;
              if (likeEl) likesStr = likeEl.innerText;
          }
          else if (platform === "Twitter") {
              const viewEl = document.querySelector('a[href*="/analytics"] span, [data-testid="app-text-transition-container"] span');
              const likeEl = document.querySelector('[data-testid="like"] span');
              if (viewEl) viewsStr = viewEl.innerText;
              if (likeEl) likesStr = likeEl.innerText;
          }
      } catch(e) {
          console.warn("Error scraping engagement:", e);
      }
      
      return {
          viewsRaw: viewsStr || "PENDING",
          likesRaw: likesStr || "0",
          views: parseEngagement(viewsStr),
          likes: parseEngagement(likesStr)
      };
=======
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
>>>>>>> IvanfromFlo-config-build
  }

  // ==========================================
  // 1. THE STRATEGY SCRAPER (Now Async)
  // ==========================================
  async function scrapePageStrategy() {
    const host = window.location.hostname;
    const url = window.location.href;
    const timestamp = new Date().toISOString();
    
    let platform = "Unknown";
    let handle = "Unknown";

    // --- PLATFORM & HANDLE ROUTING ---
    if (host.includes('tiktok.com')) {
<<<<<<< HEAD
      platform = "TikTok";
      const videoRegex = /@([^/?]+)\/video\/(\d+)/;
      const photoRegex = /@([^/?]+)\/photo\/(\d+)/;
      let match = url.match(videoRegex) || url.match(photoRegex);

      if (match) {
          handle = match[1];
      } else {
          try {
              const pattern = SCRAPER_CONFIG.tiktok.url_match;
              const customRegex = new RegExp(pattern);
              const customMatch = url.match(customRegex);
              if (customMatch) {
                  handle = customMatch[1] || customMatch[3] || "Unknown";
=======
      let handle = "Unknown";
      let matched = false;

      // 1. Try JSON Scraping (Priority)
      try {
          const jsonConfig = SCRAPER_CONFIG.tiktok.json_data;
          if (jsonConfig) {
              const scriptIds = jsonConfig.script_ids || ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"];
              let videoData = null;

              // Extract ID from URL to find specific video object
              const idMatch = url.match(/\/video\/(\d+)/) || url.match(/\/photo\/(\d+)/);
              const videoId = idMatch ? idMatch[1] : null;

              for (const id of scriptIds) {
                  const el = document.getElementById(id);
                  if (el && el.textContent) {
                      const json = JSON.parse(el.textContent);
                      
                      // Strategy A: SIGI_STATE -> ItemModule -> [videoId]
                      if (videoId && json.ItemModule && json.ItemModule[videoId]) {
                          videoData = json.ItemModule[videoId];
                      } 
                      // Strategy B: __UNIVERSAL... -> __DEFAULT_SCOPE__ -> webapp.video-detail -> itemInfo -> itemStruct
                      else if (json.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct) {
                          videoData = json.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
                      }
                      
                      if (videoData) break;
                  }
>>>>>>> IvanfromFlo-config-build
              }

              if (videoData) {
                  // Helper to safely get nested values (e.g. "stats.playCount")
                  const getVal = (obj, pathStr) => {
                      return pathStr.split('.').reduce((o, k) => (o || {})[k], obj);
                  };

                  // Resolve Handle
                  for (const path of (jsonConfig.fields.handle || [])) {
                      const val = getVal(videoData, path);
                      if (val) { handle = val; matched = true; break; }
                  }

                  // Resolve Views
                  for (const path of (jsonConfig.fields.views || [])) {
                      const val = getVal(videoData, path);
                      if (val !== undefined) { views = val.toString(); break; }
                  }
                  
                  console.log("PIRATE AI: JSON Scrape Success", { handle, views });
              }
          }
      } catch (e) {
          console.warn("PIRATE AI: JSON Scrape Error", e);
      }

      // 2. Fallback to Regex/DOM if JSON failed
      if (!matched) {
          const videoRegex = /@([^/?]+)\/video\/(\d+)/;
          const photoRegex = /@([^/?]+)\/photo\/(\d+)/;

          let match = url.match(videoRegex) || url.match(photoRegex);

          if (match) {
              handle = match[1];
              matched = true;
          } else {
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
      }

      if (handle === "Unknown") {
          if (url === "https://www.tiktok.com/" || url === "https://www.tiktok.com") return null;
          return null; 
      }
<<<<<<< HEAD
=======

      // DOM fallback for views if JSON didn't catch it
      if (views === "N/A") {
          // Normalize to array
          const viewSelectors = Array.isArray(SCRAPER_CONFIG.tiktok.views) 
              ? SCRAPER_CONFIG.tiktok.views 
              : [SCRAPER_CONFIG.tiktok.views];

          for (const selector of viewSelectors) {
              const viewEl = findElement(selector);
              if (viewEl) {
                  views = viewEl.innerText;
                  break; 
              }
          }
      }

      console.log(`PIRATE AI: Scrape Success! Handle: ${handle}`);

      return { 
        platform: "TikTok", 
        url, 
        handle: handle, 
        views, 
        timestamp 
      };
>>>>>>> IvanfromFlo-config-build
    }
    else if (host.includes('youtube.com')) {
      platform = "YouTube";
      const params = new URLSearchParams(window.location.search);
      const videoId = params.get('v');
      
      if (!videoId && !url.includes('/shorts/') && !url.includes('/live/')) return null;

      const channelLink = document.querySelector(SCRAPER_CONFIG.youtube.channel_link);
      if (channelLink) {
          const href = channelLink.getAttribute('href') || "";
          if (href.includes('/@')) {
              handle = href.split('/@')[1]; 
          } else {
              handle = channelLink.innerText; 
          }
      }
    }
    else if (host.includes('instagram.com')) {
      platform = "Instagram";
      if (!url.includes('/p/') && !url.includes('/reel/')) return null;
      handle = document.querySelector(SCRAPER_CONFIG.instagram.handle)?.innerText || "InstagramUser";
    }
    else if (host.includes('twitter.com') || host.includes('x.com')) {
      platform = "Twitter";
      if (!url.includes('/status/')) return null;
      const match = url.match(/(?:twitter\.com|x\.com)\/([^/?]+)/);
      if (match) handle = match[1];
    }

    if (platform === "Unknown") return null;

    // --- SCRAPE ENGAGEMENT ---
    const engagement = scrapeEngagement(platform);
    let finalViews = engagement.viewsRaw;
    let finalParsedViews = engagement.views;

    // --- DEDUPLICATION FALLBACK LOGIC ---
    try {
        const storage = await chrome.storage.local.get('piracy_cart');
        const cart = storage.piracy_cart || [];
        
        // Find if this exact 'parsed' view count exists in the current session
        const isDuplicateViews = cart.some(item => {
            return item.parsedViews && item.parsedViews > 0 && item.parsedViews === engagement.views;
        });

        if (isDuplicateViews && engagement.views > 0) {
            console.log(`🔄 Duplicate ${platform} views detected (${engagement.views}). Triggering fallback calculation...`);
            
            let multiplier = 1;
            if (platform === "TikTok") multiplier = 20;
            else if (platform === "Instagram") multiplier = 25;
            else if (platform === "YouTube") multiplier = 15;
            else if (platform === "Twitter") multiplier = 75;
            
            const estimatedViews = engagement.likes * multiplier;
            
            if (estimatedViews > 0) {
                finalViews = `${formatEngagement(estimatedViews)} (Estimated)`;
                finalParsedViews = estimatedViews;
            } else {
                finalViews = "PENDING";
            }
        }
    } catch(e) {
        console.error("Cart deduplication check failed:", e);
    }

    return { 
      platform, 
      url, 
      handle, 
      views: finalViews, 
      parsedViews: finalParsedViews, // Tracked silently for future dedup checks
      timestamp 
    };
  }

  // ==========================================
  // 2. MESSAGE LISTENER
  // ==========================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'addToCart') {
      scrapePageStrategy().then(data => {
          if (data) {
              sendResponse({ success: true, item: data });
          } else {
              sendResponse({ success: false, error: "Not a valid content page." });
          }
      }).catch(err => {
          console.error("Scraping runtime error:", err);
          sendResponse({ success: false, error: "Scraping failed." });
      });
      return true; // Keep channel open for async response
    }
  });

  // ==========================================
  // 3. OVERLAY UI LOGIC
  // ==========================================

  async function handleAddToQueue(btnAdd) {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      
      btnAdd.innerText = "Checking...";
      btnAdd.disabled = true;

      let data = null;
      try {
          data = await scrapePageStrategy();
      } catch(err) {
          console.error("Scraping error:", err);
          btnAdd.innerText = "+ Add";
          btnAdd.disabled = false;
          return;
      }
      
      if (!data) { 
          btnAdd.innerText = "Invalid URL";
          setTimeout(() => { btnAdd.innerText = "+ Add"; btnAdd.disabled = false; }, 1500);
          return; 
      }

      chrome.runtime.sendMessage({ 
          action: 'checkWhitelist', 
          platform: data.platform, 
          handle: data.handle 
      }, (response) => {
          if (chrome.runtime.lastError) {
              saveItem(data, btnAdd);
              return;
          }

          if (response && response.authorized) {
              alert(`⚠️ BLOCKED: @${data.handle} is on the whitelist.`);
              btnAdd.innerText = "+ Add";
              btnAdd.disabled = false;
          } else {
              saveItem(data, btnAdd);
          }
      });
  }

  function saveItem(data, btnAdd) {
      chrome.runtime.sendMessage({ action: 'addToCart', data: data }, (res) => {
          if (res && res.success) {
              btnAdd.innerText = "Saved!"; 
              btnAdd.style.backgroundColor = "#4CAF50";
              setTimeout(() => { 
                  btnAdd.innerText = "+ Add"; 
                  btnAdd.disabled = false; 
                  btnAdd.style.backgroundColor = "#ce0e2d";
              }, 1500);
          }
      });
  }

  async function initOverlay() {
    if (document.getElementById('flo-overlay')) return;
    if (!isExtensionValid()) return;

    const overlay = document.createElement('div');
    overlay.id = 'flo-overlay';
    overlay.style.cssText = `
      position: fixed; top: 150px; right: 20px; z-index: 2147483647;
      background: white; padding: 15px; border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 220px;
      border: 1px solid #e0e0e0; text-align: center;
      font-family: sans-serif; transition: opacity 0.3s; cursor: move; user-select: none;
    `;

    overlay.innerHTML = `
      <div id="flo-drag-handle" style="font-size: 12px; color: #666; margin-bottom: 5px; cursor: move;">
        PIRATE AI HELPER ✥
      </div>
      <div id="flo-count" style="font-size: 32px; color: #ce0e2d; font-weight: bold; margin-bottom: 15px; pointer-events: none;">...</div>
      
      <div style="display: flex; gap: 8px; margin-bottom: 10px;">
        <button id="flo-add" style="flex: 1; background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">+ Add</button>
        <button id="flo-report" style="flex: 1; background: #333; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">Panel</button>
      </div>

      <button id="flo-reset" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Reset Queue</button>
    `;

    document.body.appendChild(overlay);

    document.getElementById('flo-add').addEventListener('click', (e) => handleAddToQueue(e.target));
    document.getElementById('flo-report').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'openPopup' }));
    document.getElementById('flo-reset').addEventListener('click', () => {
      if (confirm(`Clear cart?`)) chrome.runtime.sendMessage({ action: 'clearCart' });
    });

    let isDragging = false, startX, startY, initialLeft, initialTop;
    overlay.addEventListener('mousedown', (e) => {
        if (['BUTTON', 'INPUT', 'A'].includes(e.target.tagName)) return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        const rect = overlay.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
        overlay.style.right = 'auto'; overlay.style.left = `${initialLeft}px`; overlay.style.top = `${initialTop}px`;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        overlay.style.left = `${initialLeft + (e.clientX - startX)}px`;
        overlay.style.top = `${initialTop + (e.clientY - startY)}px`;
    });
    document.addEventListener('mouseup', () => isDragging = false);

    const storage = await chrome.storage.local.get('piracy_cart');
    updateCount((storage.piracy_cart || []).length);
  }

  function updateCount(n) {
    const el = document.getElementById('flo-count');
    if (el) el.innerText = n;
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.piracy_cart) {
          updateCount((changes.piracy_cart.newValue || []).length);
      }
  });

  setTimeout(initOverlay, 1500);

})();
