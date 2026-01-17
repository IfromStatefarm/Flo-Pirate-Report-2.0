// content_scraper.js (Formerly content_tiktok.js)

let currentCount = 0;

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
    // If overlay doesn't exist yet, create a simple error banner
    const errDiv = document.createElement('div');
    errDiv.style.cssText = "position: fixed; top: 150px; right: 20px; z-index: 2147483647; background: white; border: 2px solid red; padding: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-family: sans-serif;";
    errDiv.innerHTML = `⚠️ Extension Context Invalidated.<br><button style="margin-top:5px; padding:5px; cursor:pointer;" onclick="location.reload()">Refresh Page</button>`;
    document.body.appendChild(errDiv);
  }
}

// ==========================================
// 1. THE STRATEGY SCRAPER (7 PLATFORMS)
// ==========================================
function scrapePageStrategy() {
  const host = window.location.hostname;
  const url = window.location.href;
  const timestamp = new Date().toISOString();
  let views = "N/A"; // Defined globally for all platforms

  // --- TIKTOK ---
  if (host.includes('tiktok.com')) {
    const match = url.match(/@([^/]+)\/video\/(\d+)/);
    if (!match) return null; // Not a video page

    const viewEl = document.querySelector('[data-e2e="video-views"]');
    if (viewEl) views = viewEl.innerText;

    return { 
      platform: "TikTok", 
      url, 
      handle: match[1], 
      views, 
      timestamp 
    };
  }

  // --- YOUTUBE ---
  else if (host.includes('youtube.com')) {
    const params = new URLSearchParams(window.location.search);
    const videoId = params.get('v');
    if (!videoId && !url.includes('/shorts/')) return null;

    // Try to get the actual handle from the href (e.g., /@FloGrappling)
    const channelLink = document.querySelector('#channel-name a');
    let channel = "Unknown";
    
    if (channelLink) {
        const href = channelLink.getAttribute('href') || "";
        if (href.includes('/@')) {
            channel = href.split('/@')[1]; 
        } else {
            channel = channelLink.innerText; 
        }
    }

    // Attempt to scrape YouTube views
    const viewSelector = document.querySelector('span.view-count'); // Standard video
    const shortViewSelector = document.querySelector('span[role="text"][aria-label*="views"]'); // Shorts often differ
    if (viewSelector) {
        views = viewSelector.innerText.replace(' views', '');
    } else if (shortViewSelector) {
        views = shortViewSelector.innerText;
    }

    const screenshot = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null;

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
    const headerHandle = document.querySelector('header a')?.innerText;
    
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

// Helper: Handle Add Button Logic
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
        alert("❌ No valid video detected on this page."); 
        return; 
    }
    
    const originalText = "Add";
    btnAdd.innerText = "Checking...";
    btnAdd.disabled = true;
    btnAdd.style.backgroundColor = "#ff9800"; // Orange while checking

    // 1. Check Whitelist in Background
    chrome.runtime.sendMessage({ 
        action: 'checkWhitelist', 
        platform: data.platform, 
        handle: data.handle 
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Whitelist check warning (proceeding anyway):", chrome.runtime.lastError);
            // Fallback: Save anyway if check fails
            saveItem(data, originalText, btnAdd);
            return;
        }

        // 2. If Whitelisted, Block
        if (response && response.authorized) {
            alert(`⚠️ BLOCKED: @${data.handle} is on the whitelist.\n\nYou cannot report this account.`);
            btnAdd.innerText = "Whitelisted";
            btnAdd.style.backgroundColor = "#666"; 
            
            setTimeout(() => {
                btnAdd.innerText = "+ Add";
                btnAdd.disabled = false;
                btnAdd.style.backgroundColor = "#ce0e2d"; 
            }, 2000);
        } 
        // 3. If Not Whitelisted (or unknown), Save
        else {
            saveItem(data, originalText, btnAdd);
        }
    });
}

function saveItem(data, originalText, btnAdd) {
    btnAdd.innerText = "Saving...";
    chrome.runtime.sendMessage({ action: 'addToCart', data: data }, (res) => {
        if (chrome.runtime.lastError) { 
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
            setTimeout(() => { 
                btnAdd.innerText = "+ Add"; 
                btnAdd.disabled = false; 
            }, 1500);
        }
    });
}

async function initOverlay() {
  if (document.getElementById('flo-overlay')) return;
  if (!isExtensionValid()) {
      handleContextInvalidated(); // Show error if invalid immediately
      return;
  }

  // 1. Create UI immediately (don't wait for storage)
  const overlay = document.createElement('div');
  overlay.id = 'flo-overlay';
  overlay.style.cssText = `
    position: fixed; top: 150px; right: 20px; z-index: 2147483647;
    background: white; padding: 15px; border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 220px;
    border: 1px solid #e0e0e0; text-align: center;
    font-family: sans-serif; transition: opacity 0.3s;
  `;

  overlay.innerHTML = `
    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">PIRATE AI HELPER</div>
    <div id="flo-count" style="font-size: 32px; color: #ce0e2d; font-weight: bold; margin-bottom: 15px; transition: color 0.3s;">...</div>
    
    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
      <button id="flo-add" style="flex: 1; background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">+ Add</button>
      <button id="flo-report" style="flex: 1; background: #333; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">Panel</button>
    </div>

    <button id="flo-reset" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Reset Queue</button>
  `;

  document.body.appendChild(overlay);

  // 2. Attach Listeners
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

  // 3. Fetch Data to update Count
  try {
    const storage = await new Promise((resolve, reject) => {
      chrome.storage.local.get('piracy_cart', (items) => {
        if (chrome.runtime.lastError) resolve({ piracy_cart: [] }); // Default to empty on error
        else resolve(items);
      });
    });
    const cart = storage.piracy_cart || [];
    updateCount(cart.length);
  } catch (e) {
    console.error("Storage load error:", e);
    updateCount(0); // Fail safe
  }
}

function updateCount(n) {
  currentCount = n;
  const el = document.getElementById('flo-count');
  if (el) {
    el.innerText = n;
    if (n === 0) {
        el.style.color = "#4CAF50"; // Green for empty/clean
        setTimeout(() => el.style.color = "#ce0e2d", 1000);
    } else {
        el.style.color = "#ce0e2d"; // Red for items pending
    }
  }
}

// 4. Init Logic
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

// Initial Run
setTimeout(initOverlay, 1500);
