// content_autofill.js

(function() { 
    // 1. INJECTION GUARD (Fixes Duplicates)
    if (window.floAutofillRunning) return;
    window.floAutofillRunning = true;

    if (typeof AUTOFILL_CONFIG === 'undefined') {
      var AUTOFILL_CONFIG = {}; 
    }
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let configLoaded = false;
    let isAutofilling = false; 
    let lastReportData = null; // Cache data for SPA navigation
    
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
    
    async function init() {
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
            
            lastReportData = data; // Save for SPA wake-up
        
            loadConfig();
            let retries = 0;
            while (!configLoaded && retries < 20) { await sleep(100); retries++; }
        
            await sleep(500); 
            routeAutofill(data);
        } catch(e) { console.warn("Autofill Init Error:", e); }
    }
    
    async function routeAutofill(data) {
        if (isAutofilling || !data) return;
        isAutofilling = true;

        try {
            const host = window.location.hostname;
            if (host.includes('tiktok')) {
                createTikTokOverlay(data);
            } else {
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
    // 2. DISCRETE STEP FUNCTIONS
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

        fillByLabel('signature', defaults.name);

        const emailBoxAsName = document.querySelector('input[placeholder*="email" i]');
        if (emailBoxAsName && isVisible(emailBoxAsName)) {
            console.log("☑️ Filling top generic slot with Name...");
            typeValue(emailBoxAsName, defaults.name);
        }

        const radioVideo = document.querySelector('input[name="typeCopyRight"][value="1"]');
        if (radioVideo && !radioVideo.checked) checkReactCheckbox(radioVideo);

        const outsideSpan = document.evaluate(`//span[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'outside of tiktok')]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (outsideSpan && isVisible(outsideSpan)) {
            const radioSource = outsideSpan.closest('div')?.querySelector('input[type="radio"]');
            if (radioSource && !radioSource.checked) checkReactCheckbox(radioSource);
            else if (!radioSource) outsideSpan.click(); 
        }

        fillByLabel('url to the original', data.sourceUrl || "Original source not provided");
        fillByLabel('description of copyrighted work', data.eventName || "FloSports Event");
        fillByLabel('content to report', Array.isArray(data.urls) ? data.urls.join('\n') : (data.urls || ''));

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
      
        // UPDATED: Combined Step 1 and Step 2 into an Init button
        overlay.innerHTML = `
          <h3 style="margin-top:0; color:#0288d1;">FloSports TikTok Wizard ✥</h3>
          <div style="margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 13px;">
            <small>Follow the highlighted steps as you progress through the form.</small>
          </div>
          
          <div id="flo-step-container" style="display: flex; flex-direction: column; gap: 8px;">
              <button id="flo-btn-init" style="background: #0288d1; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Init TikTok Form (Boxes 1 & 2)</button>
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
  
        const btnInit = document.getElementById('flo-btn-init');
        const btn3 = document.getElementById('flo-btn-step3');
        const stepContainer = document.getElementById('flo-step-container');
        const logContainer = document.getElementById('flo-log-container');
  
        // NEW COMBINED LOGIC FOR STEP 1 & 2
        btnInit.addEventListener('click', async () => {
            btnInit.disabled = true;
            btnInit.innerText = "Filling Email (Step 1)...";
            await runStep1(data);
            
            btnInit.innerText = "Waiting for next page...";
            await sleep(2000); // Give the SPA time to transition to Box 2
            
            btnInit.innerText = "Filling Info (Step 2)...";
            await runStep2(data);
            
            btnInit.innerText = "Boxes 1 & 2 Complete";
            btnInit.style.background = "#ccc"; 
            btnInit.style.color = "#333";
            
            btn3.style.background = "#0288d1"; 
            btn3.style.color = "white";
        });
  
        btn3.addEventListener('click', async () => {
            btn3.innerText = "Running...";
            await runStep3(data);
            stepContainer.style.display = "none";
            logContainer.style.display = "block";
            overlay.style.borderColor = "#ce0e2d"; 
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
        const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
    
        async function waitAndClick(textOrSel, time=3000) {
           const btn = await waitForButton(textOrSel, time);
           if (btn) { btn.click(); return true; }
           return false;
        }
    
        const infringingUrls = data.urls || [];
        
        for (const badUrl of infringingUrls) {
            const addBtnText = conf.buttons?.add_video || "Add a video";
            await waitAndClick(addBtnText, 5000);
            await sleep(1000);
            
            const badInputSel = conf.inputs?.infringing_url?.[0] || "[aria-label=\"YouTube URL of video to be removed\"]";
            const titleInputSel = conf.inputs?.video_title?.[0] || "[aria-label=\"Title\"]";

            const fillSimple = async (sel, val) => {
                const el = document.querySelector(sel);
                if(el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); }
            };
    
            await fillSimple(titleInputSel, data.eventName || "FloSports Event");
            await fillSimple(badInputSel, badUrl);
            
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

    // 5. SPA WAKE-UP LISTENER
    // Re-triggers the script automatically if the user navigates around via React/SPA routing
    document.addEventListener('click', (e) => {
        setTimeout(() => {
            if (lastReportData && !isAutofilling && !document.getElementById("flo-upload-overlay")) {
                console.log("🖱️ User interaction detected. Waking up AutoFill script...");
                routeAutofill(lastReportData);
            }
        }, 1000); 
    }, true);

    // Call init on load
    init();

})();