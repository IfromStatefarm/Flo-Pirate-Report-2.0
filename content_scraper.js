// content_scraper.js (Formerly content_tiktok.js)

let currentCount = 0;

function isExtensionValid() {
  try { return !!chrome.runtime && !!chrome.runtime.id; } 
  catch (e) { return false; }
}

function handleContextInvalidated() {
  const overlay = document.getElementById('flo-overlay');
  if (overlay) {
    overlay.innerHTML = `<div style="padding:15px; color:#666;">⚠️ Extension Updated<br><button onclick="location.reload()">Refresh Page</button></div>`;
    overlay.style.border = "2px solid red";
  }
}

// ==========================================
// 1. THE STRATEGY SCRAPER (7 PLATFORMS)
// ==========================================
function scrapePageStrategy() {
  const host = window.location.hostname;
  const url = window.location.href;
  const timestamp = new Date().toISOString();

  // --- TIKTOK ---
  if (host.includes('tiktok.com')) {
    const match = url.match(/@([^/]+)\/video\/(\d+)/);
    if (!match) return null; // Not a video page

    let views = "N/A";
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
    // Fallback to the display text if not found
    const channelLink = document.querySelector('#channel-name a');
    let channel = "Unknown";
    
    if (channelLink) {
        const href = channelLink.getAttribute('href') || "";
        if (href.includes('/@')) {
            channel = href.split('/@')[1]; // Returns "FloGrappling"
        } else {
            channel = channelLink.innerText; // Returns Display Name
        }
    }

    // YouTube specific: High Res Thumbnail
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
    // /p/CODE or /reel/CODE
    if (!url.includes('/p/') && !url.includes('/reel/')) return null;
    
    // Attempt to scrape handle from title or header
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
    // structure: /Handle/status/ID
    
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
    // Twitch VODs usually have /videos/ID or /clip/ID
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
    // Facebook URLs vary wildly. We permit scraping on any FB page for now.
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
    // Usually message links: discord.com/channels/GUILD/CHANNEL/MSG
    return { 
      platform: "Discord", 
      url, 
      handle: "DiscordUser", 
      views: "N/A", 
      timestamp 
    };
  }

  // Unsupported Site
  return null;
}

// ==========================================
// 2. MESSAGE LISTENER (For Background triggers)
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
// 3. OVERLAY UI
// ==========================================
async function initOverlay() {
  if (document.getElementById('flo-overlay')) return;
  if (!isExtensionValid()) return;

  try {
    const storage = await new Promise((resolve, reject) => {
      chrome.storage.local.get('piracy_cart', (items) => {
        chrome.runtime.lastError ? reject() : resolve(items);
      });
    });
    currentCount = (storage.piracy_cart || []).length;
  } catch (e) {
    handleContextInvalidated();
    return;
  }

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
    <div id="flo-count" style="font-size: 32px; color: #ce0e2d; font-weight: bold; margin-bottom: 15px; transition: color 0.3s;">${currentCount}</div>
    
    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
      <button id="flo-add" style="flex: 1; background: #ce0e2d; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">+ Add</button>
      <button id="flo-report" style="flex: 1; background: #333; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold;">Panel</button>
    </div>

    <button id="flo-reset" style="background: none; border: none; color: #999; font-size: 11px; text-decoration: underline; cursor: pointer;">Reset Queue</button>
  `;

  document.body.appendChild(overlay);

  // --- CLICK HANDLERS ---

  // "Add" Button Logic Extracted for clarity
  const btnAdd = document.getElementById('flo-add');
  btnAdd.addEventListener('click', () => handleAddToQueue(btnAdd));

  // "Panel" Button (Opens Side Panel)
  document.getElementById('flo-report').addEventListener('click', () => {
    if (!isExtensionValid()) { handleContextInvalidated(); return; }
    try { chrome.runtime.sendMessage({ action: 'openPopup' }); } catch(e) { handleContextInvalidated(); }
  });

  // "Reset" Button
  document.getElementById('flo-reset').addEventListener('click', () => {
    if (!isExtensionValid()) { handleContextInvalidated(); return; }
    if (currentCount > 0 && !confirm(`Delete ${currentCount} items from cart?`)) return;
    try { chrome.runtime.sendMessage({ action: 'clearCart' }); } catch(e) { handleContextInvalidated(); }
  });
}

// Separated function to handle the Add Button click and Whitelist check
function handleAddToQueue(btnAdd) {
    if (!isExtensionValid()) { handleContextInvalidated(); return; }
    
    const data = scrapePageStrategy();
    
    if (!data) { 
        alert("❌ No valid video detected on this page."); 
        return; 
    }
    
    const originalText = btnAdd.innerText;
    btnAdd.innerText = "Checking...";
    btnAdd.disabled = true;
    btnAdd.style.backgroundColor = "#ff9800"; // Orange while checking

    // 1. Check Whitelist in Background
    try {
        chrome.runtime.sendMessage({ 
            action: 'checkWhitelist', 
            platform: data.platform, 
            handle: data.handle 
        }, (response) => {
            if (chrome.runtime.lastError) {
                // If checking fails, proceed but warn in console
                console.warn("Whitelist check failed, proceeding to save.", chrome.runtime.lastError);
                saveItem(data, originalText, btnAdd);
                return;
            }

            // 2. If Whitelisted, Block and Alert
            if (response && response.authorized) {
                alert(`⚠️ BLOCKED: @${data.handle} is on the whitelist.\n\nYou cannot report this account.`);
                btnAdd.innerText = "Whitelisted";
                btnAdd.style.backgroundColor = "#666"; 
                
                // Reset button after 2s
                setTimeout(() => {
                    btnAdd.innerText = originalText;
                    btnAdd.disabled = false;
                    btnAdd.style.backgroundColor = "#ce0e2d"; 
                }, 2000);
            } 
            // 3. If Not Whitelisted, Save
            else {
                saveItem(data, originalText, btnAdd);
            }
        });
    } catch(e) { 
        handleContextInvalidated(); 
    }
}

// Helper: Perform the actual saving to cart
function saveItem(data, originalText, btnAdd) {
    btnAdd.innerText = "Saving...";
    chrome.runtime.sendMessage({ action: 'addToCart', data: data }, (res) => {
        if (chrome.runtime.lastError) { handleContextInvalidated(); return; }
        if (res && res.success) {
            btnAdd.innerText = `${data.platform} Saved!`; 
            btnAdd.style.backgroundColor = "#4CAF50";
            setTimeout(() => { 
                btnAdd.innerText = originalText; 
                btnAdd.disabled = false; 
                btnAdd.style.backgroundColor = "#ce0e2d";
            }, 1500);
        }
    });
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
    // Re-check if we need overlay
    if (!document.getElementById('flo-overlay')) initOverlay();
  }
}).observe(document, {subtree: true, childList: true});

setTimeout(initOverlay, 1500);
