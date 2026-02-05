// content_scraper.js

(function() { // Wrap in IIFE to prevent variable leaks
  
  // Guard against re-injection
  if (window.hasFloScraperRun) return;
  window.hasFloScraperRun = true;

  let currentCount = 0;

  // DEFAULT SELECTORS (Robust Fallbacks)
  let SCRAPER_CONFIG = {
    tiktok: {
      views: [
          '[data-e2e="video-views"]',
          'strong[data-e2e="video-views"]',
          '//strong[contains(text(), "views")]'
      ],
      url_match: "@([^/]+)\\/(?:video|photo)\\/(\\d+)",
      // Config structure to match remote JSON logic
      json_data: {
          script_ids: ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"],
          fields: {
              handle: ["author.uniqueId", "author", "nickname"],
              views: ["stats.playCount", "statsV2.playCount", "playCount"]
          }
      }
    },
    youtube: {
      channel_link: '#channel-name a',
      views_std: 'span.view-count',
      views_shorts: 'span[role="text"][aria-label*="views"]'
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

  // ==========================================
  // 1. THE STRATEGY SCRAPER
  // ==========================================
  function scrapePageStrategy() {
    const host = window.location.hostname;
    const url = window.location.href;
    const timestamp = new Date().toISOString();
    let views = "N/A"; 

    console.log("PIRATE AI: Attempting scrape on", host, url);

    // --- TIKTOK ---
    if (host.includes('tiktok.com')) {
      let handle = "Unknown";
      let matched = false;

      // Extract ID explicitly from URL to ensure we grab the RIGHT data from JSON
      const idMatch = url.match(/\/video\/(\d+)/) || url.match(/\/photo\/(\d+)/);
      const videoId = idMatch ? idMatch[1] : null;

      // 1. Try JSON Scraping (Priority)
      try {
          const jsonConfig = SCRAPER_CONFIG.tiktok.json_data || { 
              script_ids: ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"],
              fields: { handle: ["author.uniqueId"], views: ["stats.playCount"] }
          };

          const scriptIds = jsonConfig.script_ids;
          let videoData = null;

          for (const id of scriptIds) {
              const el = document.getElementById(id);
              if (el && el.textContent) {
                  const json = JSON.parse(el.textContent);
                  
                  // CRITICAL FIX: Only grab data if key matches our videoId
                  if (videoId && json.ItemModule && json.ItemModule[videoId]) {
                      videoData = json.ItemModule[videoId];
                  } 
                  // Strategy B: Fallback Scope if ItemModule not found
                  else if (json.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct) {
                      videoData = json.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
                  }
                  
                  if (videoData) break;
              }
          }

          if (videoData) {
              // Helper to safely get nested values (e.g. "stats.playCount")
              const getVal = (obj, pathStr) => {
                  return pathStr.split('.').reduce((o, k) => (o || {})[k], obj);
              };

              // Resolve Handle (Dynamic from Config)
              for (const path of (jsonConfig.fields.handle || [])) {
                  const val = getVal(videoData, path);
                  if (val) { handle = val; matched = true; break; }
              }

              // Resolve Views (Dynamic from Config)
              for (const path of (jsonConfig.fields.views || [])) {
                  const val = getVal(videoData, path);
                  if (val !== undefined) { 
                      views = val.toString(); 
                      break; 
                  }
              }
              
              console.log("PIRATE AI: JSON Scrape Success", { handle, views });
          }
      } catch (e) {
          console.warn("PIRATE AI: JSON Scrape Error", e);
      }

      // 2. Fallback to Regex/DOM if JSON failed
      if (!matched && videoId) {
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

      if (!matched) {
          if (url === "https://www.tiktok.com/" || url === "https://www.tiktok.com") return null;
          console.warn("PIRATE AI: No valid video ID found in URL.");
          return null; 
      }

      // DOM fallback for views if JSON didn't catch it
      if (views === "N/A") {
          const viewSelectors = Array.isArray(SCRAPER_CONFIG.tiktok.views) 
              ? SCRAPER_CONFIG.tiktok.views 
              : [SCRAPER_CONFIG.tiktok.views];

          for (const selector of viewSelectors) {
              const viewEl = findElement(selector);
              if (viewEl) {
                  // Clean non-numeric characters (except K/M/B suffixes)
                  views = viewEl.innerText.replace(/[^0-9.KMBm]/g, '');
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
      
      if (viewSelector) {
          views = viewSelector.innerText.replace(/[^0-9,.]/g, ''); // Clean Standard
      } else if (shortViewSelector) {
          views = shortViewSelector.innerText.replace(/[^0-9.KMBm]/g, ''); // Clean Shorts
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
      if (!url.includes('/p/') && !url.includes('/reel/')) return null;
      const headerHandle = document.querySelector(SCRAPER_CONFIG.instagram.handle)?.innerText;
      
      return { 
        platform: "Instagram", 
        url, 
        handle: headerHandle || "InstagramUser", 
        views: "N/A", 
        timestamp 
      };
    }

    // --- TWITTER / X ---
    else if (host.includes('twitter.com') || host.includes('x.com')) {
      if (!url.includes('/status/')) return null;
      const pathParts = new URL(url).pathname.split('/');
      
      return { 
        platform: "Twitter", 
        url, 
        handle: pathParts[1] || "TwitterUser", 
        views: "N/A", 
        timestamp 
      };
    }

    // --- TWITCH ---
    else if (host.includes('twitch.tv')) {
      const pathParts = new URL(url).pathname.split('/');
      const handle = pathParts[1] || "TwitchUser";

      return { 
        platform: "Twitch", 
        url, 
        handle, 
        views: "N/A", 
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
  // 2. MESSAGE LISTENER
  // ==========================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'addToCart') {
      const data = scrapePageStrategy();
      if (data) {
          sendResponse({ success: true, item: data });
      } else {
          sendResponse({ success: false, error: "Not a valid content page." });
      }
    }
    return true;
  });

  // ==========================================
  // 3. OVERLAY UI LOGIC
  // ==========================================

  function handleAddToQueue(btnAdd) {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      
      let data = null;
      try {
          data = scrapePageStrategy();
      } catch(err) {
          console.error("Scraping error:", err);
          alert("❌ Error scraping page data. See console for details.");
          return;
      }
      
      if (!data) { 
          alert("❌ No valid video detected on this page. Check Console (F12) for 'PIRATE AI' logs."); 
          return; 
      }
      
      const originalText = "Add";
      btnAdd.innerText = "Checking...";
      btnAdd.disabled = true;
      btnAdd.style.backgroundColor = "#ff9800"; 

      // --- TIMEOUT PROTECTION ---
      let responseReceived = false;
      const safetyTimeout = setTimeout(() => {
          if (!responseReceived) {
              console.warn("PIRATE AI: Whitelist check timed out. Forcing save.");
              saveItem(data, originalText, btnAdd);
          }
      }, 4000);

      try {
          chrome.runtime.sendMessage({ 
              action: 'checkWhitelist', 
              platform: data.platform, 
              handle: data.handle 
          }, (response) => {
              responseReceived = true;
              clearTimeout(safetyTimeout);

              if (chrome.runtime.lastError) {
                  console.warn("Whitelist check warning/fail:", chrome.runtime.lastError);
                  if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("context invalidated")) {
                      handleContextInvalidated();
                      return;
                  }
                  saveItem(data, originalText, btnAdd);
                  return;
              }

              if (response && response.authorized) {
                  alert(`⚠️ BLOCKED: @${data.handle} is on the whitelist.\n\nYou cannot report this account.`);
                  btnAdd.innerText = "Whitelisted";
                  btnAdd.style.backgroundColor = "#666"; 
                  
                  setTimeout(() => {
                      btnAdd.innerText = "+ Add";
                      btnAdd.disabled = false;
                      btnAdd.style.backgroundColor = "#ce0e2d"; 
                  }, 2000);
              } else {
                  saveItem(data, originalText, btnAdd);
              }
          });
      } catch (e) {
          responseReceived = true;
          clearTimeout(safetyTimeout);
          console.error("PIRATE AI: Message Sending Error", e);
          handleContextInvalidated();
      }
  }

  function saveItem(data, originalText, btnAdd) {
      btnAdd.innerText = "Saving...";
      
      try {
          chrome.runtime.sendMessage({ action: 'addToCart', data: data }, (res) => {
              if (chrome.runtime.lastError) { 
                  console.error("Save error:", chrome.runtime.lastError);
                  handleContextInvalidated(); 
                  return; 
              }
              if (res && res.success) {
                  btnAdd.innerText = "Saved!"; 
                  btnAdd.style.backgroundColor = "#4CAF50";
                  setTimeout(() => { 
                      btnAdd.innerText = "+ Add"; 
                      btnAdd.disabled = false; 
                      btnAdd.style.backgroundColor = "#ce0e2d";
                  }, 1500);
              } else {
                  btnAdd.innerText = "Error";
                  console.error("Save Response Error:", res);
                  setTimeout(() => { 
                      btnAdd.innerText = "+ Add"; 
                      btnAdd.disabled = false; 
                      btnAdd.style.backgroundColor = "#ce0e2d";
                  }, 1500);
              }
          });
      } catch(e) {
          handleContextInvalidated();
      }
  }

  async function initOverlay() {
    if (document.getElementById('flo-overlay')) return;
    if (!isExtensionValid()) {
        return;
    }

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
      <div id="flo-count" style="font-size: 32px; color: #ce0e2d; font-weight: bold; margin-bottom: 15px; transition: color 0.3s; pointer-events: none;">...</div>
      
      <div style="display: flex; gap: 8px; margin-bottom: 10px;">
        <button id="flo-add" style="flex: 1; background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">+ Add</button>
        <button id="flo-report" style="flex: 1; background: #333; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">Panel</button>
      </div>

      <button id="flo-reset" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Reset Queue</button>
    `;

    document.body.appendChild(overlay);

    const btnAdd = document.getElementById('flo-add');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => handleAddToQueue(btnAdd));
    }

    document.getElementById('flo-report').addEventListener('click', () => {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      try { chrome.runtime.sendMessage({ action: 'openPopup' }); } 
      catch(e) { handleContextInvalidated(); }
    });

    document.getElementById('flo-reset').addEventListener('click', () => {
      if (!isExtensionValid()) { handleContextInvalidated(); return; }
      if (currentCount > 0 && !confirm(`Delete ${currentCount} items from cart?`)) return;
      try { chrome.runtime.sendMessage({ action: 'clearCart' }); } 
      catch(e) { handleContextInvalidated(); }
    });

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    overlay.addEventListener('mousedown', (e) => {
        if (['BUTTON', 'INPUT', 'A', 'SELECT'].includes(e.target.tagName)) return;

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
    } catch (e) {
      console.error("Storage load error:", e);
      updateCount(0); 
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

  if (isExtensionValid()) {
      try {
          chrome.storage.onChanged.addListener((changes, namespace) => {
              if (namespace === 'local' && changes.piracy_cart) {
                  const newValue = changes.piracy_cart.newValue || [];
                  updateCount(newValue.length);
              }
          });
      } catch (e) { console.warn("Could not attach storage listener"); }
  }

  let lastUrl = location.href; 
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (!document.getElementById('flo-overlay')) initOverlay();
    }
  }).observe(document, {subtree: true, childList: true});

  setTimeout(initOverlay, 1500);

})();
