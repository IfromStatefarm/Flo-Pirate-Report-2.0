// content_autofill.js

(function() { // 1. Wrap in IIFE to prevent 'sleep' redeclaration errors

    // 2. DEFAULT CONFIGURATION (Robust Fallback)
    if (typeof AUTOFILL_CONFIG === 'undefined') {
      var AUTOFILL_CONFIG = {}; 
    }
    
    // Define sleep inside the scope
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let configLoaded = false;
    
    // --- LOAD REMOTE CONFIG HELPER ---
    async function loadConfig() {
      try {
        // Check if extension context is valid before messaging
        if (!chrome.runtime?.id) return;
        
        const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
        if (response && response.success && response.config && response.config.platform_selectors) {
          console.log("✅ Remote Config Loaded");
          AUTOFILL_CONFIG = response.config.platform_selectors;
          configLoaded = true;
        } else {
          console.warn("⚠️ Remote Config empty or invalid.");
        }
      } catch(e) { 
          console.warn("⚠️ Using default local strategies (Config load failed).", e); 
      }
    }
    
    // ==========================================
    // 2. LISTENERS & AUTO-RUN
    // ==========================================
    
    if (!window.hasFloAutofillListener) {
      window.hasFloAutofillListener = true;
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "startFullAutomation") {
            // Force wait for config on manual trigger
            (async () => {
                if (!configLoaded) await loadConfig();
                await routeAutofill(request.data);
                sendResponse({ success: true });
            })();
            return true; 
        }
      });
    }
    
    (async function init() {
        console.log("🔄 Flo Autofill Script Injected/Re-loaded");
        
        // Always reset running flag on new injection/page load
        window.floAutofillRunning = true;
    
        if (document.readyState === 'loading') {
            await new Promise(r => document.addEventListener('DOMContentLoaded', r));
        }
    
        // Safety check for extension context
        try {
            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = res.piracy_cart || [];
            const info = res.reporterInfo;
        
            if (cart.length === 0 || !info) {
                console.log("ℹ️ No active report data found in storage.");
                return;
            }
        
            const host = window.location.hostname;
            const platform = cart[0].platform || "TikTok";
        
            // Basic Host Safety Checks
            if (platform === "TikTok" && !host.includes("tiktok")) return;
            if (platform === "YouTube" && !host.includes("youtube")) return;
            if (platform === "Instagram" && !host.includes("instagram")) return;
            if (platform === "Twitter" && !host.includes("x.com") && !host.includes("twitter")) return;
        
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
            
            // 1. Clear first (using native setter)
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, "");
            } else {
                el.value = "";
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));

            // 2. Try execCommand (Human Simulation)
            let success = false;
            try {
                success = document.execCommand('insertText', false, val);
            } catch (err) {
                // Ignore execCommand errors
            }

            // 3. Fallback if execCommand failed
            if (!success) {
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(el, val);
                } else {
                    el.value = val;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch (e) {
            console.warn("React setter hack failed, using standard value assignment:", e);
            // Absolute last resort: Standard DOM value setting
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Finalize events
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true })); 

        return true;
    };

    const typeValue = (el, val) => {
        if (!el) return false;
        
        if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
            const inner = el.querySelector('input, textarea');
            if (inner) el = inner;
        }

        if (!el) return false;

        el.scrollIntoView({block: "center", behavior: "smooth"});
        return simulateTyping(el, val);
    };

    const applyFieldStrategy = async (strategies, value) => {
        if (!strategies || !Array.isArray(strategies)) return false;
        for (const strat of strategies) {
            const el = findElement(strat);
            if (el) {
                console.log(`   ✅ Found field via: ${strat}`);
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

    // --- STEP 1: VERIFY EMAIL STEP ---
    const nameInput = findElement(conf.field_strategies?.name?.[0]);
    
    const isIntermediatePage = !nameInput && (
        document.body.innerText.includes("Verify your email") || 
        currentUrl.searchParams.has("email")
    );
    
    if (isIntermediatePage) {
        console.log("🔹 Intermediate Step Detected (Email Verification)...");
        
        const emailStrat = [
            "input[id^='tux-']", 
            ...(conf.field_strategies?.email || []),
            "input[type='text']"
        ];
        
        await applyFieldStrategy(emailStrat, defaults.email);
        await sleep(500);

        const nextVariants = conf.buttons?.next || ['Next'];
        const btn = await waitForButton(nextVariants, 2000);
        
        if (btn) {
             if (btn.disabled) {
                 console.log("⚠️ Next button disabled. Retrying input trigger...");
                 await applyFieldStrategy(emailStrat, defaults.email + " "); 
                 await sleep(200);
                 await applyFieldStrategy(emailStrat, defaults.email); 
             }
             
             if (!btn.disabled) {
                 console.log("➡️ Clicking Next...");
                 btn.click();
                 await sleep(3000); 
             } else {
                 console.warn("❌ Next button still disabled.");
             }
        }
    }

    // --- STEP 2: FULL FORM FILL ---
    console.log("📝 Filling Main Report Form...");
    
    // 1. Text Fields
    const fieldOrder = ['name', 'company', 'phone', 'address', 'urls', 'signature'];
    
    for (const key of fieldOrder) {
        const strategies = conf.field_strategies?.[key];
        let value = defaults[key] || "";
        
        if (key === 'urls') {
            value = Array.isArray(data.urls) ? data.urls.join('\n') : (data.urls || '');
        } else if (key === 'signature') {
            value = defaults.name; // Use reporter name for signature
        }

        if (strategies) {
            await applyFieldStrategy(strategies, value);
        }
    }

    // 2. Radio Buttons
    if (conf.radios) {
        // Type of Work
        if (conf.radios.typeCopyRight) {
            const el = document.querySelector(conf.radios.typeCopyRight.selector);
            if (el && !el.checked) {
                console.log("🔘 Clicking 'Type of Copyrighted Work'...");
                el.click();
            }
        }
        // Source
        if (conf.radios.copyrightedWorkSource) {
            const el = document.querySelector(conf.radios.copyrightedWorkSource.selector);
            if (el && !el.checked) {
                console.log("🔘 Clicking 'Source of Copyrighted Work'...");
                el.click();
            }
        }
    }

    // 3. Toggles
    if (conf.toggles && conf.toggles.needAddSeed) {
        const toggle = document.querySelector(conf.toggles.needAddSeed);
        if (toggle && !toggle.checked) { // Check logic may vary for toggles, assuming checkbox-like
             console.log("🎚️ Toggling 'Prevent Future Copies'...");
             toggle.click();
        }
    }

    // 4. Checkboxes (Statements)
    if (conf.checkboxes && conf.checkboxes.agreement) {
        const agreementBoxes = document.querySelectorAll(conf.checkboxes.agreement);
        agreementBoxes.forEach(cb => {
            if (!cb.checked) {
                console.log("☑️ Checking Agreement Box...");
                cb.click();
            }
        });
    }

    // Fallback Checkboxes
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    allCheckboxes.forEach(cb => { try { if (!cb.checked) cb.click(); } catch(e){} });

    // Highlight Send Button
    const sendVariants = conf.buttons?.send || ['Send', 'Submit'];
    const sendBtn = await waitForButton(sendVariants, 2000);
    if (sendBtn) {
        sendBtn.scrollIntoView({block: 'center'});
        sendBtn.style.border = "4px solid #ce0e2d"; 
    }
}

// ==========================================
// 4. YOUTUBE (Legacy Logic Preserved)
// ==========================================
async function fillYouTube(data) {
    const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
    console.log("📝 Running YouTube Strategy...");

    async function waitAndClick(textOrSel, time=3000) {
       const btn = await waitForButton(textOrSel, time);
       if (btn) { btn.click(); return true; }
       return false;
    }

    const infringingUrls = data.urls || [];
    
    for (const [index, badUrl] of infringingUrls.entries()) {
        const addBtnText = conf.buttons?.add_video || "Add a video";
        await waitAndClick(addBtnText, 5000);
        await sleep(1000);

        const badInputSel = conf.inputs.infringing_url?.[0];
        const titleInputSel = conf.inputs.video_title?.[0];
        
        const fillSimple = async (sel, val) => {
            const el = document.querySelector(sel);
            if(el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); }
        };

        if(titleInputSel) await fillSimple(titleInputSel, data.eventName || "FloSports Event");
        if(badInputSel) await fillSimple(badInputSel, badUrl);
        
        await waitAndClick(conf.buttons?.save || "#save-button", 3000);
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

async function waitForButton(variants, timeout) {
    const start = Date.now();
    if (!Array.isArray(variants)) variants = [variants];

    while (Date.now() - start < timeout) {
        for (const v of variants) {
            let el;
            if (v.startsWith('//')) {
                // XPath
                try {
                    const res = document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = res.singleNodeValue;
                } catch(e){}
            } else if (v.includes('[') || v.includes('.') || v.includes('#')) {
                // CSS
                try { el = document.querySelector(v); } catch(e){}
            } else {
                // Text Match
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

// Overlay Logic
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
      e.preventDefault();
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
