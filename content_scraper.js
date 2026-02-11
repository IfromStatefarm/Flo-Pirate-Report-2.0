// content_scraper.js

(function() { // Wrap in IIFE to prevent variable leaks
  
  // Guard against re-injection
  if (window.hasFloScraperRun) return;
  window.hasFloScraperRun = true;

  let currentCount = 0;

  // DEFAULT SELECTORS (Robust Fallbacks)
  let SCRAPER_CONFIG = {
    tiktok: {
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

  // ==========================================
  // 1. THE STRATEGY SCRAPER (Simplified for Live Audit)
  // ==========================================
  function scrapePageStrategy() {
    const host = window.location.hostname;
    const url = window.location.href;
    const timestamp = new Date().toISOString();
    
    // VIEWS are now "PENDING" at capture time. 
    // They will be audited in the background during the 'Log to Sheet' phase.
    let views = "PENDING"; 

    // --- TIKTOK ---
    if (host.includes('tiktok.com')) {
      let handle = "Unknown";
      let matched = false;

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
          } catch(e) {}
      }

      if (!matched) {
          if (url === "https://www.tiktok.com/" || url === "https://www.tiktok.com") return null;
          return null; 
      }

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

      return { 
        platform: "YouTube", 
        url, 
        handle: channel, 
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
        views: "PENDING", 
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
          return;
      }
      
      if (!data) { return; }
      
      btnAdd.innerText = "Checking...";
      btnAdd.disabled = true;

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
