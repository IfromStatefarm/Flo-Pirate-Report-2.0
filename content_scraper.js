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
    facebook: {
      handle: 'h2 a[role="link"], strong span'
    },
    rumble: {
      handle: '.media-by-heading .ellipsis-1, a.media-by--a'
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

      // *** LAZY SCRAPING CHANGE ***
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
      
      if (viewSelector) {
          views = viewSelector.innerText.replace(' views', '');
      } else if (shortViewSelector) {
          views = shortViewSelector.innerText;
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
  // 1.5 SELECTOR TRAINING (RECORD MODE)
  // ==========================================
  let isTrainingMode = false;
  let trainingPlatform = null;
  
  function generateStableSelector(el) {
    let target = el;
    // Aggressively seek the nearest logical interactive element within or above the click
    const interactiveTarget = el.closest('button, input, textarea, select, a, label, [role="button"], [role="checkbox"]');
    if (interactiveTarget) {
        target = interactiveTarget;
    } else {
        // If they clicked near a checkbox but missed, find the nearest one inside the container
        const nearInput = el.querySelector('input, button');
        if (nearInput) target = nearInput;
    }

      // 2. Specific attributes (Best reliability)
      if (target.hasAttribute('data-e2e')) return `[data-e2e="${target.getAttribute('data-e2e')}"]`;
      if (target.id) return `#${target.id}`;
      
      if (target.name) {
          if (target.type && (target.type === 'radio' || target.type === 'checkbox') && target.value) {
              return `input[name="${target.name}"][value="${target.value}"]`;
          }
          return `[name="${target.name}"]`;
    }
    
    if (target.hasAttribute('aria-label')) return `[aria-label="${target.getAttribute('aria-label')}"]`;
    
    // --- SMART FALLBACK ---
    if (target.tagName === 'INPUT' && target.placeholder) {
        return `input[placeholder*="${target.placeholder.split(' ')[0]}"]`;
    }
    if (target.innerText && target.innerText.trim().length > 0 && target.innerText.trim().length < 50) {
        const cleanText = target.innerText.trim().toLowerCase().replace(/'/g, "\\'");
        return `//${target.tagName.toLowerCase()}[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${cleanText}')]`;
    }
    // --- ENDmps SMART FALLBACK ---
      // 3. Fallback to CSS path (Rigid but works if nothing else is available)
      let path = [];
      let current = target;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
          let selector = current.nodeName.toLowerCase();
          if (current.id) { selector += `#${current.id}`; path.unshift(selector); break; }
          let sibling = current, nth = 1;
          while (sibling = sibling.previousElementSibling) { if (sibling.nodeName.toLowerCase() === selector) nth++; }
          if (nth !== 1) selector += `:nth-of-type(${nth})`;
            path.unshift(selector);
            
          // Stop traversing up if we hit a reasonable container limit
          if (current.tagName.toLowerCase() === 'body') break;
          current = current.parentNode;
      }
      return path.join(' > ');
  }

  function handleTrainingMouseOver(e) {
      if (!isTrainingMode) return;
      e.target.style.outline = '3px dashed #ce0e2d';
      e.target.style.cursor = 'crosshair';
  }

  function handleTrainingMouseOut(e) {
      if (!isTrainingMode) return;
      e.target.style.outline = '';
      e.target.style.cursor = '';
  }

  // Inject a native UI right on the page to avoid Side Panel communication drops
  function showPatchUI(platform, selector) {
      const existing = document.getElementById('flo-patch-ui');
      if (existing) existing.remove();

      const ui = document.createElement('div');
      ui.id = 'flo-patch-ui';
      ui.style.cssText = `
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          background: white; border: 3px solid #ce0e2d; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
          z-index: 2147483647; padding: 20px; font-family: sans-serif; border-radius: 8px; width: 350px;
      `;

      const isGenericPath = selector.includes('div') || selector.includes('span');
ui.innerHTML = `
    <h3 style="margin: 0 0 10px 0; color: #ce0e2d; font-size: 18px;">Map Captured Selector</h3>
    ${isGenericPath ? `<div style="background:#fff1f2; color:#be123c; padding:8px; border-radius:4px; font-size:11px; margin-bottom:10px; font-weight:bold;">⚠️ CAUTION: This selector looks generic. Ensure it targets an actual button or input.</div>` : ''}
    <p style="font-size: 12px; color: #666; margin-bottom: 5px;">Selector captured:</p>
          <input type="text" readonly value='${selector.replace(/'/g, "&apos;")}' style="width: 100%; padding: 8px; margin-bottom: 12px; font-family: monospace; font-size: 11px; box-sizing: border-box; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px;">

          <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 5px;">Section:</label>
          <select id="flo-patch-section" style="width: 100%; padding: 8px; margin-bottom: 12px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
              <option value="autofill">Autofill (Forms, Checkboxes)</option>
              <option value="scraper">Scraper (Views, Handles)</option>
          </select>

          <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 5px;">Field Name in Config:</label>
          <input type="text" id="flo-patch-field" placeholder="e.g., agreementCheckbox" style="width: 100%; padding: 8px; margin-bottom: 15px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">

          <div style="display: flex; justify-content: space-between;">
              <button id="flo-patch-cancel" style="background: #ccc; color: #333; border: none; padding: 10px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">Cancel</button>
              <button id="flo-patch-save" style="background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; width: 48%; font-weight: bold;">Save to Cloud</button>
          </div>
          <div id="flo-patch-status" style="margin-top: 12px; font-size: 13px; font-weight: bold; text-align: center;"></div>
      `;

      document.body.appendChild(ui);

      document.getElementById('flo-patch-cancel').addEventListener('click', () => ui.remove());

      document.getElementById('flo-patch-save').addEventListener('click', () => {
          const section = document.getElementById('flo-patch-section').value;
          const field = document.getElementById('flo-patch-field').value.trim();

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
              selector: selector
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

    const targetTag = e.target.tagName;
    const isGeneric = ['DIV', 'SPAN', 'SECTION', 'MAIN', 'BODY'].includes(targetTag) && !e.target.getAttribute('role');

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

      const newSelector = generateStableSelector(e.target);
      console.log("PIRATE AI: Captured New Selector ->", newSelector);
      
      // Bring up the in-page UI so we don't rely on the side panel being open!
      showPatchUI(trainingPlatform, newSelector);
      
      // Attempt to update the side panel silently as a backup, ignoring dropped connections
      chrome.runtime.sendMessage({
          action: 'selectorTrainingComplete',
          platform: trainingPlatform,
          selector: newSelector
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
    } else if (request.action === 'startSelectorTraining') {
        startSelectorTraining(request.platform);
        sendResponse({ success: true });
    }
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
          alert("❌ Error scraping page data. See console for details.");
          return;
      }
      
      if (!data) { 
          alert("❌ No valid video detected on this page. Check Console (F12) for 'PIRATE AI' logs."); 
          return; 
      }
      
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

              if (res && res.status === 'whitelisted') {
                  alert(`⚠️ BLOCKED: @${data.handle} is on the whitelist.\n\nYou cannot report this account.`);
                  btnAdd.innerText = "Whitelisted";
                  btnAdd.style.backgroundColor = "#666"; 
                  
                  setTimeout(() => {
                      btnAdd.innerText = originalText;
                      btnAdd.disabled = false;
                      btnAdd.style.backgroundColor = "#ce0e2d"; 
                  }, 2000);
              } else if (res && res.success) {
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
    let isMinimized = isReportingPage;
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
    }
  }).observe(document, {subtree: true, childList: true});

  setTimeout(initOverlay, 1500);

})();