/// content_autofill.js

// 1. DEFAULT CONFIGURATION (Robust Fallback)
// This mirrors your events_config.json so if Drive fails, this takes over.
if (typeof AUTOFILL_CONFIG === 'undefined') {
  var AUTOFILL_CONFIG = {
    tiktok: {
      autofill: {
        wizard_steps: ["I am the copyright owner", "Authorized representative", "Statement", "Report an infringement"],
        agreement_terms: ["I declare", "good faith", "perjury", "accurate"],
        buttons: { next: ["Next", "Continue"], send: ["Send", "Submit"] },
        field_strategies: {
          email: ["input[name=\"email\"]", "#email", "//input[@type='email']"],
          name: ["#name", "input[name=\"name\"]"],
          company: ["#nameOfOwner", "input[name=\"copyright_owner\"]"],
          phone: ["#phoneNumber", "input[type=\"tel\"]"],
          address: ["#address", "input[name=\"address\"]"],
          urls: ["textarea", "//textarea[contains(@placeholder, 'http')]"]
        }
      }
    },
    youtube: {
        autofill: {
            buttons: { add_video: "Add a video", save: "#save-button" },
            inputs: {
                source_url: ["#videoLink"],
                video_title: ["#videoTitle"],
                infringing_url: ["#targetVideo"],
                claimant_name: "#claimant-name",
                authority: "#requester-authority",
                street: '[aria-label="Street address"]',
                city: '[aria-label="City"]',
                state: "#state",
                zip: '[aria-label="Zip code"]',
                signature: '[aria-label="Signature"]'
            },
            dropdowns: {
                type_work: { label: "Type of work", value: "Video" },
                location: { label: "Location of infringing content", value: "Entire video" }
            }
        }
    }
  }; 
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- LOAD REMOTE CONFIG ---
(async function initConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success && response.config && response.config.platform_selectors) {
      console.log("✅ Remote Config Loaded");
      AUTOFILL_CONFIG = response.config.platform_selectors;
    }
  } catch(e) { 
      console.warn("⚠️ Using default local strategies (Config load failed).", e); 
  }
})();

// ==========================================
// 2. LISTENERS & AUTO-RUN
// ==========================================

if (!window.hasFloAutofillListener) {
  window.hasFloAutofillListener = true;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startFullAutomation") {
        routeAutofill(request.data)
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; 
    }
  });
}

(async function init() {
    if (window.floAutofillRunning) return;
    window.floAutofillRunning = true;

    if (document.readyState === 'loading') {
        await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
    const cart = res.piracy_cart || [];
    const info = res.reporterInfo;

    if (cart.length === 0 || !info) return;

    const host = window.location.hostname;
    const platform = cart[0].platform || "TikTok";

    if (platform === "TikTok" && !host.includes("tiktok")) return;
    if (platform === "YouTube" && !host.includes("youtube")) return;

    const data = {
        fullName: info.name,
        email: info.email || "copyright@flosports.tv",
        urls: cart.map(c => c.url),
        platform: platform,
        eventName: info.eventName,
        vertical: info.vertical,
        sourceUrl: info.sourceUrl
    };

    console.log("🚀 Starting Flo Autofill for:", platform);
    await sleep(800); 
    routeAutofill(data);
})();

async function routeAutofill(data) {
    const host = window.location.hostname;
    if (host.includes('tiktok')) await fillTikTok(data);
    else if (host.includes('youtube')) await fillYouTube(data);
    
    if(data.eventName) createUploadOverlay(data);
}

// ==========================================
// 3. TIKTOK ROBUST AUTOMATION
// ==========================================
async function fillTikTok(data) {
    const conf = AUTOFILL_CONFIG.tiktok?.autofill || {};
    const defaults = {
        company: "FloSports",
        phone: "5122702356",
        address: "301 Congress ave #1500 Austin Tx 78701",
        email: data.email || "copyright@flosports.tv",
        name: data.fullName
    };

    console.log("🎵 Running Bullet-Proof TikTok Strategy...");

    // --- HELPER: ROBUST FINDER ---
    const findElement = (selector) => {
        if (!selector) return null;
        try {
            if (selector.startsWith('//') || selector.startsWith('(')) {
                const res = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return res.singleNodeValue;
            } else {
                return document.querySelector(selector);
            }
        } catch (e) { return null; }
    };

    const typeValue = (el, val) => {
        if (!el) return false;
        el.scrollIntoView({block: "center", behavior: "smooth"});
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        return true;
    };

    const applyFieldStrategy = async (strategies, value) => {
        if (!strategies || !Array.isArray(strategies)) return false;
        for (const strat of strategies) {
            const el = findElement(strat);
            if (el) {
                console.log(`   found: ${strat}`);
                return typeValue(el, value);
            }
        }
        return false;
    };

    const clickByText = async (text) => {
        const xpath = `//*[contains(text(), '${text}')]`;
        const el = findElement(xpath);
        if (el) { el.click(); return true; }
        return false;
    };

    // --- A. WIZARD STEP DETECTION ---
    const checkState = () => {
        const nameStrat = conf.field_strategies?.name || [];
        for (const s of nameStrat) { if (findElement(s)) return 'form'; }
        
        const wizardTerms = conf.wizard_steps || ["I am the copyright owner"];
        for (const t of wizardTerms) {
            if (findElement(`//*[contains(text(), '${t}')]`)) return 'wizard';
        }
        
        if (conf.field_strategies?.email) {
            for (const s of conf.field_strategies.email) { if(findElement(s)) return 'intermediate'; }
        }
        return 'unknown';
    };

    let pageState = 'unknown';
    for (let i=0;i<10;i++) {
        const res = checkState();
        if (res !== 'unknown') { pageState = res; break; }
        await sleep(500);
    }
    console.log('PAGE STATE DETECTED:', pageState);

    // --- B. WIZARD LOGIC ---
    if (pageState === 'wizard') {
        console.log('🔹 Handling Wizard...');
        const steps = conf.wizard_steps || [];
        for (const term of steps) { await clickByText(term); await sleep(200); }
        
        const nextVariants = conf.buttons?.next || ['Next'];
        const btn = await waitForButton(nextVariants, 2000);
        if (btn) { btn.click(); await sleep(1500); }
        pageState = checkState();
    }

    // --- C. INTERMEDIATE EMAIL ---
    if (pageState === 'intermediate' || (pageState === 'unknown' && conf.field_strategies?.email)) {
        console.log('🔹 Attempting Intermediate Email...');
        const strat = conf.field_strategies?.email;
        const filled = await applyFieldStrategy(strat, defaults.email);
        
        if (filled) {
            const nextVariants = conf.buttons?.next || ['Next'];
            const btn = await waitForButton(nextVariants, 2000);
            if (btn) { btn.click(); await sleep(2500); pageState = 'form'; }
        }
    }

    // --- D. FULL FORM FILL ---
    console.log('📝 Attempting Full Form Fill...');
    
    const fieldOrder = ['email', 'name', 'company', 'phone', 'address', 'urls'];
    for (const key of fieldOrder) {
        const strategies = conf.field_strategies?.[key];
        let value = defaults[key] || "";
        if (key === 'urls') value = Array.isArray(data.urls) ? data.urls.join('\n') : (data.urls || '');

        if (strategies) {
            const success = await applyFieldStrategy(strategies, value);
            if (success) console.log(`✅ Filled ${key}`);
            else console.warn(`⚠️ Failed to fill ${key}`);
        }
    }

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { try { if (!cb.checked) cb.click(); } catch(e){} });

    const terms = conf.agreement_terms || [];
    for (const term of terms) await clickByText(term);

    const sendVariants = conf.buttons?.send || ['Send', 'Submit'];
    const sendBtn = await waitForButton(sendVariants, 2000);
    if (sendBtn) {
        sendBtn.scrollIntoView({block: 'center'});
        console.log("✅ Form Ready for Submission.");
        sendBtn.style.border = "3px solid #ce0e2d"; 
    }
}

async function fillYouTube(data) {
    const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
    console.log("📝 Running YouTube Strategy...");
    // (Legacy Youtube logic kept minimal here for brevity, assumes default working state)
}

async function waitForButton(variants, timeout) {
    const start = Date.now();
    if (!Array.isArray(variants)) variants = [variants];

    while (Date.now() - start < timeout) {
        for (const v of variants) {
            let el;
            if (v.startsWith('//')) {
                try {
                    const res = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = res.singleNodeValue;
                } catch(e){}
            } else if (v.includes('[') || v.includes('.') || v.includes('#')) {
                try { el = document.querySelector(v); } catch(e){}
            } else {
                const xpath = `//button[contains(text(), '${v}')]`;
                try {
                    const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = res.singleNodeValue;
                } catch(e){}
            }
            if (el && el.offsetParent !== null && !el.disabled) return el;
        }
        await sleep(200);
    }
    return null;
}

function createUploadOverlay(data) {
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
      <strong>Platform:</strong> ${data.platform || "TikTok"}<br>
      <small>Review fields, then click Send.</small>
    </div>
    <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
    <div id="flo-log-status" style="margin-top:8px; font-size:12px;"></div>
  `;

  document.body.appendChild(overlay);

  let isDragging = false, startX, startY, initialLeft, initialTop;
  overlay.addEventListener('mousedown', (e) => {
      if (['BUTTON'].includes(e.target.tagName)) return;
      isDragging = true; startX = e.clientX; startY = e.clientY;
      const rect = overlay.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
      overlay.style.right = 'auto'; overlay.style.left = `${initialLeft}px`; overlay.style.top = `${initialTop}px`;
  });
  document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      overlay.style.left = `${initialLeft + (e.clientX - startX)}px`;
      overlay.style.top = `${initialTop + (e.clientY - startY)}px`;
  });
  document.addEventListener('mouseup', () => isDragging = false);

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
