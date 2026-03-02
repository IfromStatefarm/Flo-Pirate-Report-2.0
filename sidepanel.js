<<<<<<< HEAD
// content_autofill.js

(function() { 

    if (typeof AUTOFILL_CONFIG === 'undefined') {
      var AUTOFILL_CONFIG = {}; 
    }
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let configLoaded = false;
    let isAutofilling = false; 
    
    async function loadConfig() {
      try {
        if (!chrome.runtime?.id) return;
        const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
        if (response && response.success && response.config && response.config.platform_selectors) {
          console.log("✅ Remote Config Loaded");
          AUTOFILL_CONFIG = response.config.platform_selectors;
          configLoaded = true;
        }
      } catch(e) { console.warn("⚠️ Config load failed.", e); }
    }
    
    (async function init() {
        window.floAutofillRunning = true;
        if (document.readyState === 'loading') {
            await new Promise(r => document.addEventListener('DOMContentLoaded', r));
        }
    
        try {
            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = res.piracy_cart || [];
            const info = res.reporterInfo;
        
            if (cart.length === 0 || !info) return;
        
            const host = window.location.hostname;
            const platform = cart[0].platform || "TikTok";
        
            const data = {
                fullName: info.name,
                email: info.email || "copyright@flosports.tv",
                urls: cart.map(c => c.url),
                platform: platform,
                eventName: info.eventName,
                vertical: info.vertical,
                sourceUrl: info.sourceUrl
            };
        
            loadConfig();
            let retries = 0;
            while (!configLoaded && retries < 20) { await sleep(100); retries++; }
        
            await sleep(500); 
            routeAutofill(data);
        } catch(e) { console.warn("Autofill Init Error:", e); }
    })();
    
    async function routeAutofill(data) {
        if (isAutofilling || !data) return;
        isAutofilling = true;

        try {
            const host = window.location.hostname;
            if (host.includes('tiktok')) {
                // TIKTOK EXCLUSIVE: Spawn the 3-Step Manual Overlay immediately
                createTikTokOverlay(data);
            } else {
                // OTHER PLATFORMS: Auto-fill and spawn standard overlay
                if (host.includes('youtube')) await fillYouTube(data);
                else if (host.includes('instagram')) await fillInstagram(data);
                else if (host.includes('twitter') || host.includes('x.com')) await fillTwitter(data);
                
                if (data.eventName) createStandardOverlay(data);
            }
        } finally {
            isAutofilling = false;
        }
    }
    
    // ==========================================
    // 1. DOM UTILITIES & SETTERS
    // ==========================================
    
    const isVisible = (elem) => {
        if (!elem) return false;
        const rect = elem.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    const setNativeValue = (element, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        
        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            element.value = value;
        }
    };

    function checkReactCheckbox(cb) {
        if (!cb || !isVisible(cb)) return;
        try {
            if (cb.tagName === 'INPUT' && (cb.type === 'checkbox' || cb.type === 'radio')) {
                if (cb.checked) return; 
                cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                cb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                cb.click(); 
                
                const nativeCheckboxSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
                if (nativeCheckboxSetter) {
                    nativeCheckboxSetter.call(cb, true);
                } else {
                    cb.checked = true;
                }
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                cb.dispatchEvent(new Event('input', { bubbles: true }));
            } 
            else if (cb.getAttribute('role') === 'checkbox' || cb.getAttribute('role') === 'radio') {
                if (cb.getAttribute('aria-checked') === 'true') return;
                cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                cb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                cb.click();
            }
        } catch (err) {}
    }

    function triggerReactUpdate(element) {
        if (!element) return;
        ['input', 'change', 'blur'].forEach(eventName => {
            element.dispatchEvent(new Event(eventName, { bubbles: true }));
        });
    }

    const typeValue = (el, val) => {
        if (!el || !isVisible(el)) return false;
        el.scrollIntoView({block: "center", behavior: "smooth"});
        el.focus();
        el.click();

        setNativeValue(el, "");
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        setNativeValue(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true })); 
        return true;
    };

    const fillByLabel = (labelText, value) => {
        if (!value) return;
        const lowerLabel = labelText.toLowerCase();
        
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        let targetInput = null;
        
        while ((textNode = walker.nextNode())) {
            if (textNode.nodeValue.toLowerCase().includes(lowerLabel)) {
                const parent = textNode.parentElement;
                if (isVisible(parent)) {
                    const xpath = `following::input[not(@type='hidden') and not(@type='radio') and not(@type='checkbox')] | following::textarea`;
                    const input = document.evaluate(xpath, parent, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    
                    if (isVisible(input)) {
                        targetInput = input;
                        break;
                    }
                }
            }
        }

        if (targetInput && targetInput.value !== value) {
            console.log(`   ✅ Found field by label: "${labelText}"`);
            typeValue(targetInput, value);
        }
    };

    async function waitForButton(variants, timeout) {
        const start = Date.now();
        if (!Array.isArray(variants)) variants = [variants];
    
        while (Date.now() - start < timeout) {
            for (const v of variants) {
                let el;
                if (v.startsWith('//')) {
                    try { el = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch(e){}
                } else if (v.includes('[') || v.includes('.') || v.includes('#')) {
                    try { el = document.querySelector(v); } catch(e){}
                } else {
                    const xpath = `//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${v.toLowerCase()}')]`;
                    try { el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch(e){}
                }
                if (el && isVisible(el) && !el.disabled) return el;
            }
            await sleep(200);
        }
        return null;
    }

    // ==========================================
    // 2. DISCRETE STEP FUNCTIONS (MANUAL TRIGGERS)
    // ==========================================

    async function runStep1(data) {
        console.log("🔹 Step 1: Email Verification");
        const email = data.email || "copyright@flosports.tv";
        
        let targetInput = document.querySelector('input[placeholder*="email" i]');
        if (!targetInput) {
            const labels = Array.from(document.querySelectorAll('p.field-title, label, .form-label'));
            const targetLabel = labels.find(l => l.innerText.toLowerCase().includes('email') && isVisible(l));
            if (targetLabel) {
                const xpath = `following::input[not(@type='hidden') and not(@type='radio') and not(@type='checkbox')]`;
                const iterator = document.evaluate(xpath, targetLabel, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                let node = iterator.iterateNext();
                while (node) { 
                    if (isVisible(node)) { targetInput = node; break; } 
                    node = iterator.iterateNext(); 
                }
            }
        }

        if (targetInput && targetInput.value !== email) {
            typeValue(targetInput, email);
        }
        
        const nextBtn = await waitForButton(['Next', 'Continue', 'button.submit-button'], 500);
        if (nextBtn && !nextBtn.disabled) {
            console.log("➡️ Clicking Next...");
            nextBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
            nextBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
            nextBtn.click();
        }
    }

    async function runStep2(data) {
        console.log("🔹 Step 2: Personal Info");
        const defaults = {
            company: "FloSports",
            phone: "5122702356",
            address: "301 Congress ave #1500 Austin Tx 78701",
            name: data.fullName
        };
        
        fillByLabel('your full name', defaults.name);
        fillByLabel('name of the copyright owner', defaults.company);
        fillByLabel('physical address', defaults.address);
        fillByLabel('phone number', defaults.phone);
        
        const nextBtn = await waitForButton(['Next', 'Continue', 'button.submit-button'], 500);
        if (nextBtn && !nextBtn.disabled) {
            console.log("➡️ Clicking Next...");
            nextBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
            nextBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
            nextBtn.click();
        }
    }

    async function runStep3(data) {
        console.log("🔹 Step 3: Infringement Details & Sign");
        const defaults = { name: data.fullName };

        // 1. Fill Signature First
        fillByLabel('signature', defaults.name);

        // 2. Fill Top "Email" placeholder with User Name (TikTok Glitch Fix)
        const emailBoxAsName = document.querySelector('input[placeholder*="email" i]');
        if (emailBoxAsName && isVisible(emailBoxAsName)) {
            console.log("☑️ Filling top generic slot with Name...");
            typeValue(emailBoxAsName, defaults.name);
        }

        // 3. Radio Buttons
        const radioVideo = document.querySelector('input[name="typeCopyRight"][value="1"]');
        if (radioVideo && !radioVideo.checked) checkReactCheckbox(radioVideo);

        const outsideSpan = document.evaluate(`//span[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'outside of tiktok')]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (outsideSpan && isVisible(outsideSpan)) {
            const radioSource = outsideSpan.closest('div')?.querySelector('input[type="radio"]');
            if (radioSource && !radioSource.checked) checkReactCheckbox(radioSource);
            else if (!radioSource) outsideSpan.click(); 
        }

        // 4. Content Strings
        fillByLabel('url to the original', data.sourceUrl || "Original source not provided");
        fillByLabel('description of copyrighted work', data.eventName || "FloSports Event");
        fillByLabel('content to report', Array.isArray(data.urls) ? data.urls.join('\n') : (data.urls || ''));

        // 5. Checkboxes
        const agreementTexts = [
            "Prevent future copies",
            "good faith belief",
            "accurate",
            "penalty of perjury"
        ];

        agreementTexts.forEach(text => {
            const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
            const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            
            if (node && isVisible(node)) {
                const container = node.parentElement;
                const hiddenInput = container ? container.querySelector('input[type="checkbox"]') : null;
                const ariaBox = container ? container.querySelector('[role="checkbox"], [role="switch"]') : null;

                if (hiddenInput) {
                    if (!hiddenInput.checked) checkReactCheckbox(hiddenInput);
                } else if (ariaBox) {
                    if (ariaBox.getAttribute('aria-checked') !== 'true') {
                        ariaBox.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                        ariaBox.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                        ariaBox.click();
                        triggerReactUpdate(ariaBox);
                    }
                } else {
                    if (!node.hasAttribute('data-flo-clicked')) {
                        node.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                        node.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                        node.click();
                        if(node.parentElement) node.parentElement.click();
                        node.setAttribute('data-flo-clicked', 'true');
                    }
                }
            }
        });
    
        // 6. Highlight Send button, wait for user.
        const sendBtn = await waitForButton(['Send', 'Submit'], 500); 
        if (sendBtn) {
            sendBtn.scrollIntoView({block: 'center'});
            sendBtn.style.border = "4px solid #ce0e2d"; 
            sendBtn.disabled = false; 
            console.log("🛑 Step 3 complete. Waiting for user to review and manually click Send.");
        }
    }


    // ==========================================
    // 3. UI OVERLAYS
    // ==========================================

    // EXCLUSIVE TIKTOK WIZARD OVERLAY
    function createTikTokOverlay(data) {
        const existing = document.getElementById("flo-upload-overlay");
        if (existing) existing.remove();
      
        const overlay = document.createElement("div");
        overlay.id = "flo-upload-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 280px;
          background: white; border: 3px solid #0288d1; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 20px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none;
        `;
      
        overlay.innerHTML = `
          <h3 style="margin-top:0; color:#0288d1;">FloSports TikTok Wizard ✥</h3>
          <div style="margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 13px;">
            <small>Follow the highlighted steps as you progress through the form.</small>
          </div>
          
          <div id="flo-step-container" style="display: flex; flex-direction: column; gap: 8px;">
              <button id="flo-btn-step1" style="background: #0288d1; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Email</button>
              <button id="flo-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Personal Info</button>
              <button id="flo-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Infringement & Sign</button>
          </div>
  
          <div id="flo-log-container" style="display: none;">
              <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                  ⚠️ Click "Send" on the page first, then log below!
              </div>
              <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
              <div id="flo-log-status" style="margin-top:8px; font-size:12px; text-align: center;"></div>
          </div>
        `;
      
        document.body.appendChild(overlay);
        setupDrag(overlay);
  
        // Button Logic
        const btn1 = document.getElementById('flo-btn-step1');
        const btn2 = document.getElementById('flo-btn-step2');
        const btn3 = document.getElementById('flo-btn-step3');
        const stepContainer = document.getElementById('flo-step-container');
        const logContainer = document.getElementById('flo-log-container');
  
        btn1.addEventListener('click', async () => {
            btn1.innerText = "Running...";
            await runStep1(data);
            btn1.innerText = "Step 1: Done";
            btn1.style.background = "#ccc"; btn1.style.color = "#333";
            btn2.style.background = "#0288d1"; btn2.style.color = "white";
        });
  
        btn2.addEventListener('click', async () => {
            btn2.innerText = "Running...";
            await runStep2(data);
            btn2.innerText = "Step 2: Done";
            btn2.style.background = "#ccc"; btn2.style.color = "#333";
            btn3.style.background = "#0288d1"; btn3.style.color = "white";
        });
  
        btn3.addEventListener('click', async () => {
            btn3.innerText = "Running...";
            await runStep3(data);
            stepContainer.style.display = "none";
            logContainer.style.display = "block";
            overlay.style.borderColor = "#ce0e2d"; // Switch color theme to Red for closing phase
        });
  
        document.getElementById("flo-log-btn").addEventListener("click", () => {
          const status = document.getElementById("flo-log-status");
          status.innerText = "Logging...";
          chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
            if (response && response.success) {
              status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
              setTimeout(() => overlay.remove(), 2000);
            } else {
              status.innerText = "❌ Failed."; status.style.color = "red";
            }
          });
        });
    }

    // STANDARD OVERLAY FOR YOUTUBE/ETC
    function createStandardOverlay(data) {
      const existing = document.getElementById("flo-upload-overlay");
      if (existing) existing.remove();
    
      const overlay = document.createElement("div");
      overlay.id = "flo-upload-overlay";
      overlay.style.cssText = `
        position: fixed; top: 80px; right: 20px; width: 300px;
        background: white; border: 3px solid #ce0e2d; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 2147483647; padding: 20px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none;
      `;
    
      overlay.innerHTML = `
        <h3 style="margin-top:0; color:#ce0e2d;">FloSports Helper ✥</h3>
        <div style="margin-bottom: 10px; border-bottom: 1px solid #eee;">
          <strong>Platform:</strong> ${data.platform || "Unknown"}<br>
          <small>Review fields, then click Send.</small>
        </div>
        <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
        <div id="flo-log-status" style="margin-top:8px; font-size:12px;"></div>
      `;
    
      document.body.appendChild(overlay);
      setupDrag(overlay);
    
      document.getElementById("flo-log-btn").addEventListener("click", () => {
        const status = document.getElementById("flo-log-status");
        status.innerText = "Logging...";
        chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
          if (response && response.success) {
            status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
            setTimeout(() => overlay.remove(), 2000);
          } else {
            status.innerText = "❌ Failed."; status.style.color = "red";
          }
        });
      });
    }

    // SHARED DRAG LOGIC
    function setupDrag(overlay) {
      let isDragging = false, startX, startY, initialLeft, initialTop;
      overlay.addEventListener('mousedown', (e) => {
          if (['BUTTON'].includes(e.target.tagName)) return;
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
    }

    // ==========================================
    // 4. LEGACY LOGIC (YOUTUBE, ETC)
    // ==========================================
    async function fillYouTube(data) {
        console.log("📝 Running YouTube Strategy...");
    
        async function waitAndClick(textOrSel, time=3000) {
           const btn = await waitForButton(textOrSel, time);
           if (btn) { btn.click(); return true; }
           return false;
        }
    
        const infringingUrls = data.urls || [];
        
        for (const [index, badUrl] of infringingUrls.entries()) {
            await waitAndClick("Add a video", 5000);
            await sleep(1000);
            
            const fillSimple = async (sel, val) => {
                const el = document.querySelector(sel);
                if(el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); }
            };
    
            await fillSimple("[aria-label=\"Title\"]", data.eventName || "FloSports Event");
            await fillSimple("[aria-label=\"YouTube URL of video to be removed\"]", badUrl);
            
            await waitAndClick("#save-button", 3000);
            await sleep(2000);
        }
    }
    
    async function fillInstagram(data) {
        const conf = AUTOFILL_CONFIG.instagram?.autofill || {};
        if(conf.name) {
            const el = document.querySelector(`[name="${conf.name}"]`);
            if(el) el.value = data.fullName;
        }
    }
    
    async function fillTwitter(data) {
        const conf = AUTOFILL_CONFIG.twitter?.autofill || {};
        if(conf.name) {
            const el = document.querySelector(`[name="${conf.name}"]`);
            if(el) el.value = data.fullName;
        }
    }

})();
=======
import { getUserEmail } from './utils/auth.js';

let configData = null;
const ALLOWED_EMAIL = "social@flosports.tv";

// --- CRAWLER STATE ---
let isCrawling = false;
let crawlQueue = [];
let consecutiveFailures = 0;

// --- GLOBAL ERROR LISTENER ---
window.addEventListener('error', function(e) {
  if (e.message && (
      e.message.includes('Extension context invalidated') || 
      e.message.includes('BLOCKED_BY_CLIENT')
  )) {
     const loading = document.getElementById('loading');
     if (loading) {
       loading.innerHTML = "⚠️ <strong>Extension Reloaded</strong><br>Please close and reopen this panel.";
       loading.style.color = "#ce0e2d";
       loading.style.border = "1px solid #ce0e2d";
       loading.style.padding = "10px";
       loading.style.background = "#fff0f0";
       loading.style.borderRadius = "4px";
     }
  }
}, true);

// --- SECURITY CHECK ---
async function verifyAccessBeforeAction() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    if (chrome.runtime.lastError) return false;
    
    const currentEmail = response && response.email ? response.email.toLowerCase().trim() : "";
    return currentEmail === ALLOWED_EMAIL;
  } catch (e) {
    console.error("Auth check failed:", e);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('loading');
  const verticalSelect = document.getElementById('verticalSelect');
  const eventInput = document.getElementById('eventInput');
  const eventList = document.getElementById('eventList');
  const startBtn = document.getElementById('startBtn');
  const grabBtn = document.getElementById('btn-grab-flo');
  const sourceDisplay = document.getElementById('sourceUrlDisplay');
  const closerBtn = document.getElementById('testCloserBtn');
  const crawlBtn = document.getElementById('autoCrawlBtn');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const searchEventBtn = document.getElementById('searchEventBtn');
  const reporterInput = document.getElementById('reporterName');
  const crawlStatusEl = document.getElementById('crawlStatus');
  const startRowInput = document.getElementById('startRowInput');
  const closerStatusEl = document.getElementById('closerStatus'); 
  
  // Create Stop Button dynamically if not present
  let stopCloserBtn = document.getElementById('stopCloserBtn');
  if (!stopCloserBtn && closerBtn) {
      stopCloserBtn = document.createElement('button');
      stopCloserBtn.id = 'stopCloserBtn';
      stopCloserBtn.className = 'btn';
      stopCloserBtn.style.backgroundColor = '#e74c3c'; // Red
      stopCloserBtn.style.marginTop = '5px';
      stopCloserBtn.style.fontSize = '11px';
      stopCloserBtn.style.padding = '8px';
      stopCloserBtn.innerText = 'Stop Scanner';
      stopCloserBtn.style.display = 'none';
      if(closerBtn.parentNode && closerBtn.parentNode.parentNode) {
          closerBtn.parentNode.parentNode.insertBefore(stopCloserBtn, closerStatusEl);
      }
  }

  // --- Message Listener for Crawler & Closer ---
  chrome.runtime.onMessage.addListener((msg) => {
    // Closer Status Update
    if (msg.action === 'closerProgress') {
        if (closerStatusEl) {
            closerStatusEl.style.display = 'block';
            closerStatusEl.innerHTML = `<strong>${msg.status}</strong><br>${msg.details || ''}`;
            
            // If running, show stop button
            if (!msg.status.includes("Complete") && !msg.status.includes("Stop") && !msg.status.includes("Failed")) {
                 if (closerBtn) closerBtn.style.display = 'none';
                 if (stopCloserBtn) stopCloserBtn.style.display = 'block';
            } else {
                 // Stopped/Done
                 if (closerBtn) {
                     closerBtn.style.display = 'block';
                     closerBtn.disabled = false;
                     closerBtn.innerText = 'Run "The Closer"';
                 }
                 if (stopCloserBtn) stopCloserBtn.style.display = 'none';
            }
        }
        return; 
    }

    if (!isCrawling) return;

    if (msg.action === 'urlFound') {
        consecutiveFailures = 0; // Reset failure count on success
        if (crawlStatusEl) crawlStatusEl.innerText = "✅ URL Found! Saving...";
        setTimeout(() => processNextCrawlItem(), 2000); 
    } 
    else if (msg.action === 'botSearchFailed') {
        consecutiveFailures++;
        if (crawlStatusEl) crawlStatusEl.innerText = `⚠️ No Result/Skipped (${consecutiveFailures}/3)`;
        
        if (consecutiveFailures >= 3) {
            stopCrawl("Stopped: 3 consecutive blank results.");
        } else {
            setTimeout(() => processNextCrawlItem(), 2000);
        }
    }
  });

  // Helper to show error
  const showInitError = (msg) => {
      if (loadingEl) {
          loadingEl.innerHTML = `⚠️ <strong>Connection Failed</strong><br>${msg}<br><button id="retryInitBtn" style="margin-top:5px;cursor:pointer;">Retry</button>`;
          loadingEl.style.color = "red";
          document.getElementById('retryInitBtn')?.addEventListener('click', () => window.location.reload());
      }
  };

  // 1. Load Config & Init
  try {
    const authPromise = chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    
    const emailRes = await Promise.race([authPromise, timeoutPromise]).catch(err => null);
    
    if (!emailRes && chrome.runtime.lastError) {
        showInitError("Extension context invalidated. Please reopen.");
        return;
    }
    
    if (!emailRes) {
         showInitError("Background script unresponsive.");
         return;
    }

    const currentEmail = emailRes && emailRes.email ? emailRes.email.toLowerCase().trim() : "";
    
    if (currentEmail !== ALLOWED_EMAIL) {
       if (loadingEl) {
           loadingEl.innerHTML = `⚠️ <strong>Access Restricted</strong><br>Logged in as: ${currentEmail || "Unknown"}<br>Required: ${ALLOWED_EMAIL}`;
           loadingEl.style.color = "red";
       }
       return; 
    }

    // Load Config
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success) {
      configData = response.config;
      populateVerticals(verticalSelect);
      if (loadingEl) loadingEl.style.display = 'none';
      if (startBtn) startBtn.disabled = false;
    } else {
      showInitError("Config Load Failed: " + (response?.error || "Unknown"));
    }
  } catch (e) {
    console.error("Init error:", e);
    showInitError(e.message || "Unknown Error");
  }

  // Load Saved State
  chrome.storage.local.get(['last_reporter', 'last_vertical'], (res) => {
      if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;
      if (res.last_vertical && verticalSelect) {
          verticalSelect.value = res.last_vertical;
          // Trigger change logic manually to load events
          verticalSelect.dispatchEvent(new Event('change'));
      }
  });

  // 2. Event Listeners
  if (verticalSelect) {
      verticalSelect.addEventListener('change', async () => {
          const vertical = verticalSelect.value;
          chrome.storage.local.set({ last_vertical: vertical });
          
          if (eventList) eventList.innerHTML = ''; // Clear current options

          if (vertical) {
              if (eventInput) eventInput.placeholder = "Loading events...";
              
              try {
                  const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
                  
                  if (response && response.success && response.data && response.data.eventMap) {
                      const events = Object.values(response.data.eventMap).map(e => e.name);
                      events.sort();
                      
                      eventList.innerHTML = '';
                      events.forEach(name => {
                          const opt = document.createElement('option');
                          opt.value = name;
                          eventList.appendChild(opt);
                      });
                      
                      if (eventInput) eventInput.placeholder = "Select or Type...";
                  }
              } catch(e) {
                  console.error("Error fetching events:", e);
                  if (eventInput) eventInput.placeholder = "Error loading events";
              }
          }
      });
  }

  const performSearch = () => {
      const vertical = verticalSelect.value;
      const eventName = eventInput.value;
      
      if (vertical && eventName) {
          if (loadingEl) {
              loadingEl.innerText = "Opening Search Page...";
              loadingEl.style.display = "block";
              loadingEl.style.color = "blue";
          }
          
          chrome.runtime.sendMessage({ 
              action: 'findEventUrl', 
              data: { eventName, vertical } 
          }, (res) => {
              if (loadingEl) loadingEl.style.display = "none";
              if (!res.success) {
                  alert("Error opening search: " + res.error);
              }
          });
      } else {
          alert("Please select a Vertical and enter an Event Name.");
      }
  };

  if (eventInput) {
      eventInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
              performSearch();
          }
      });
  }

  if (searchEventBtn) {
      searchEventBtn.addEventListener('click', performSearch);
  }

  if (reporterInput) {
      reporterInput.addEventListener('change', () => {
          chrome.storage.local.set({ last_reporter: reporterInput.value });
      });
  }

  if (grabBtn) {
      grabBtn.addEventListener('click', async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url) {
              if (sourceDisplay) sourceDisplay.value = tab.url;
          }
      });
  }

  // --- START REPORT LOGIC (UPDATED) ---
  if (startBtn) {
      startBtn.addEventListener('click', async () => {
          const reporterName = reporterInput.value;
          const vertical = verticalSelect.value;
          const eventName = eventInput.value;
          const sourceUrl = document.getElementById('sourceUrlDisplay').value;
          
          if (!reporterName || !vertical || !eventName) {
              alert("Please fill in Reporter, Vertical, and Event Name.");
              return;
          }

          startBtn.disabled = true;
          startBtn.innerText = "Checking Queue...";

          // 1. Check Cart
          const storage = await chrome.storage.local.get('piracy_cart');
          const cart = storage.piracy_cart || [];
          
          if (cart.length === 0) {
              alert("Queue is empty. Use the 'Add' buttons on video pages first.");
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              return;
          }

          // 2. Determine Platform & URL
          const firstUrl = cart[0].url;
          let reportUrl = "";
          let platform = "TikTok";

          if (firstUrl.includes("youtube") || firstUrl.includes("youtu.be")) {
              platform = "YouTube";
              reportUrl = "https://www.youtube.com/copyright_complaint_form";
          } else if (firstUrl.includes("tiktok")) {
              platform = "TikTok";
              reportUrl = "https://www.tiktok.com/legal/report/Copyright";
          } else {
              // Fallback or handle other platforms
              platform = "Other";
              alert("Auto-reporting is currently optimized for TikTok and YouTube. Please manually report other platforms.");
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
              return;
          }

          // 3. Save Context for Content Script
          const reporterInfo = {
              name: reporterName,
              email: await getUserEmail() || "copyright@flosports.tv",
              eventName: eventName,
              vertical: vertical,
              sourceUrl: sourceUrl || ""
          };

          await chrome.storage.local.set({ reporterInfo });

          // 4. Open Reporting Page
          startBtn.innerText = `Opening ${platform}...`;
          
          chrome.tabs.create({ url: reportUrl }, (tab) => {
              // For TikTok, manually inject content_autofill.js because the manifest 
              // might not match the specific legal report page URL automatically.
              if (platform === "TikTok") {
                  const listener = (tabId, changeInfo, tabInfo) => {
                      if (tabId === tab.id && changeInfo.status === 'complete') {
                          chrome.tabs.onUpdated.removeListener(listener);
                          chrome.scripting.executeScript({
                              target: { tabId: tabId },
                              files: ['content_autofill.js']
                          }).then(() => console.log("Autofill script injected for TikTok"))
                            .catch(err => console.warn("Injection failed:", err));
                      }
                  };
                  chrome.tabs.onUpdated.addListener(listener);
              }

              // Done. The content script on that page will pick up 'reporterInfo' and 'piracy_cart'.
              startBtn.disabled = false;
              startBtn.innerText = "Start Report";
          });
      });
  }

  // Copy Tool
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
       const txt = `Content stolen from ${eventInput ? eventInput.value : ""}. Original source: ${sourceDisplay ? sourceDisplay.value : ""}`;
       navigator.clipboard.writeText(txt);
       copyUrlBtn.innerText = "Copied!";
       setTimeout(() => copyUrlBtn.innerText = 'Copy "Stolen From" Text', 2000);
    });
  }

  // --- Test Closer Button ---
  if (closerBtn) {
      closerBtn.addEventListener('click', async () => {
          const startVal = startRowInput ? startRowInput.value : 1;
          const startRow = parseInt(startVal) || 1;

          closerBtn.innerText = "Starting...";
          closerBtn.disabled = true;
          if(closerStatusEl) closerStatusEl.style.display = 'block';
          if(closerStatusEl) closerStatusEl.innerText = "Initializing Scanner...";
          
          chrome.runtime.sendMessage({ action: 'triggerCloser', startRow: startRow }, (res) => {
              if (chrome.runtime.lastError) {
                  closerBtn.innerText = "Error (Reload Panel)";
                  closerBtn.disabled = false;
                  if(closerStatusEl) closerStatusEl.innerText = "Error: " + chrome.runtime.lastError.message;
                  return;
              }
          });
      });
  }

  // --- Stop Closer Button Listener ---
  if (stopCloserBtn) {
      stopCloserBtn.addEventListener('click', () => {
          stopCloserBtn.innerText = "Stopping...";
          stopCloserBtn.disabled = true;
          chrome.runtime.sendMessage({ action: 'stopSheetScanner' });
      });
  }

  // --- CRAWLER BUTTON LOGIC ---
  if (crawlBtn) {
      crawlBtn.addEventListener('click', async () => {
          if (isCrawling) {
              stopCrawl("Stopped by user.");
              return;
          }

          const vertical = verticalSelect.value;
          if (!vertical) {
              alert("Please select a Vertical first.");
              return;
          }

          crawlStatusEl.innerText = "Fetching sheet data...";
          crawlBtn.disabled = true;

          const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
          
          if (!response || !response.success) {
              crawlStatusEl.innerText = "Error fetching data.";
              crawlBtn.disabled = false;
              return;
          }

          const allEvents = Object.values(response.data.eventMap);
          allEvents.sort((a, b) => a.rowIndex - b.rowIndex);

          crawlQueue = allEvents.filter(e => !e.urls.tiktok || e.urls.tiktok.trim() === "");

          if (crawlQueue.length === 0) {
              crawlStatusEl.innerText = "No empty TikTok cells found.";
              crawlBtn.disabled = false;
              return;
          }

          isCrawling = true;
          consecutiveFailures = 0;
          crawlBtn.disabled = false;
          crawlBtn.innerText = "Stop Auto-Crawl";
          crawlBtn.style.backgroundColor = "#e74c3c";
          
          crawlStatusEl.innerText = `Queue: ${crawlQueue.length} events. Starting...`;
          
          processNextCrawlItem();
      });
  }
});

function processNextCrawlItem() {
    const statusEl = document.getElementById('crawlStatus');
    const vertical = document.getElementById('verticalSelect').value;

    if (!isCrawling) return;
    
    if (crawlQueue.length === 0) {
        stopCrawl("Done! Queue finished.");
        return;
    }

    const event = crawlQueue.shift();
    if (statusEl) statusEl.innerText = `Searching: ${event.name}...`;

    chrome.runtime.sendMessage({ 
        action: 'findEventUrl', 
        data: { 
            eventName: event.name, 
            vertical: vertical 
        } 
    });
}

function stopCrawl(reason) {
    isCrawling = false;
    const statusEl = document.getElementById('crawlStatus');
    const btn = document.getElementById('autoCrawlBtn');
    
    if (statusEl) {
        statusEl.innerText = reason;
        statusEl.style.color = reason.includes("Stopped") ? "red" : "green";
    }
    
    if (btn) {
        btn.innerText = "Start Auto-Crawl (TikTok)";
        btn.style.backgroundColor = "#f39c12"; // Restore orange
    }
}

function populateVerticals(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select Vertical...</option>';
  
  if (configData && configData.verticals) {
    configData.verticals.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.innerText = v.name;
      selectEl.appendChild(opt);
    });
  }
}
>>>>>>> 79f5cd90f1038ccca67828ebf99537cbc7b5716f
