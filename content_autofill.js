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
    let cachedOverlay = null;  // Caches the overlay element to preserve its state
    let hasRunAutomatedFill = false; // Prevents Youtube/Twitter loops on SPA wake-up
    let isTransitioning = false; // Prevents SPA wake-up from firing while we wait for a page transition
    
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
            const host = window.location.hostname;
            const isTikTok = host.includes('tiktok.com') || host.includes('tiktokforbusiness.com');

            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = res.piracy_cart || [];
            const info = res.reporterInfo || {};
        
            const platform = (cart.length > 0 && cart[0].platform) ? cart[0].platform : (isTikTok ? "TikTok" : "Unknown");
        
            const data = {
                fullName: info.name || "",
                email: info.email || "copyright@flosports.tv",
                urls: cart.map(c => c.url),
                platform: platform,
                eventName: info.eventName || "",
                vertical: info.vertical || "",
                sourceUrl: info.sourceUrl || ""
            };
            
            lastReportData = data; // Save for SPA wake-up
        
            // 🔹 Always create the Launcher Tab fallback on TikTok
            if (isTikTok) {
                createLauncherTab(data);
            }

            // Only auto-open the full wizard if we actually have data in the cart
            if (cart.length === 0 || !info.name) {
                return;
            }
        
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
            } else if (host.includes('youtube')) {
                createYouTubeOverlay(data);
            } else {
                if (!hasRunAutomatedFill) {
                    hasRunAutomatedFill = true;
                    if (host.includes('youtube')) await fillYouTube(data);
                    else if (host.includes('instagram')) await fillInstagram(data);
                    else if (host.includes('twitter') || host.includes('x.com')) await fillTwitter(data);
                }
                
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
        // Sanitize: remove newlines and hidden control characters
        const cleanVal = typeof val === 'string' ? val.replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, " ").trim() : val;
        el.scrollIntoView({block: "center", behavior: "smooth"});
        el.focus();
        el.click();

        setNativeValue(el, "");
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        setNativeValue(el, cleanVal);
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
        console.log("🔹 Step 1: Init Form & Email Verification");

        async function selectTuxDropdown(searchText) {
            // Find all listbox trigger buttons
            const dropdowns = document.querySelectorAll('button[aria-haspopup="listbox"]');
            for (const dd of dropdowns) {
                // If it already displays the value, we can skip
                if (dd.innerText.toLowerCase().includes(searchText.toLowerCase())) return true;
                
                // Open the dropdown
                dd.click(); 
                await sleep(500); // Give the React Portal time to mount in the DOM
                
                // Search for the option globally (handles Portal rendering at the bottom of <body>)
                const xpath = `//div[@role="option" or @role="menuitem"]//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${searchText.toLowerCase()}')]/parent::* | //li[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${searchText.toLowerCase()}')]`;
                const option = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                
                if (option) {
                    option.scrollIntoView({block: 'center', behavior: 'smooth'});
                    
                    // Emulate a human click explicitly on the option
                    option.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                    option.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                    option.click();
                    
                    await sleep(500); // Wait for the UI state to update and next box to appear
                    return true;
                } else {
                    // Click again to close it if the option wasn't found in this specific dropdown
                    dd.click(); 
                    await sleep(300);
                }
            }
            return false;
        }

        // Click Target 1 (Initialize dropdowns for TikTok)
        await selectTuxDropdown("copyright infringement");
        
        // Click Target 2 (The Next Box)
        await selectTuxDropdown("i am the copyright owner");

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
            return true; // Successfully moved to the next page
        }
        return false;
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
            return true; // Successfully moved to the next page
        }
        return false;
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
    // 3. UI OVERLAYS & LAUNCHER TAB
    // ==========================================

    function createLauncherTab(data) {
        if (document.getElementById('flo-wiz-launcher')) return;
        const launcher = document.createElement('div');
        launcher.id = 'flo-wiz-launcher';
        launcher.style.cssText = `
            position: fixed; top: 40%; right: -50px; transform: translateY(-50%);
            background: #0288d1; color: white; padding: 12px 6px; border-radius: 8px 0 0 8px;
            cursor: pointer; z-index: 2147483646; font-family: sans-serif; font-weight: bold; font-size: 14px;
            box-shadow: -2px 0 10px rgba(0,0,0,0.2); writing-mode: vertical-rl; text-orientation: mixed;
            transition: right 0.3s ease;
        `;
        launcher.innerText = "Wizard ✥";
        
        launcher.addEventListener('click', async () => {
            // Fetch fresh data in case the user added things while the wizard was closed
            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = res.piracy_cart || [];
            const info = res.reporterInfo || {};
            const freshData = {
                fullName: info.name || data?.fullName || "",
                email: info.email || data?.email || "copyright@flosports.tv",
                urls: cart.map(c => c.url),
                platform: cart[0]?.platform || data?.platform || "TikTok",
                eventName: info.eventName || data?.eventName || "",
                vertical: info.vertical || data?.vertical || "",
                sourceUrl: info.sourceUrl || data?.sourceUrl || ""
            };
            createTikTokOverlay(freshData);
        });
        document.body.appendChild(launcher);
    }

    function createTikTokOverlay(data) {
        // USE CACHED OVERLAY IF AVAILABLE TO PRESERVE BUTTON STATE
        if (cachedOverlay && cachedOverlay.id === "flo-upload-overlay") {
            if (!document.getElementById("flo-upload-overlay")) {
                document.body.appendChild(cachedOverlay);
            }
            return;
        }
    

        const existing = document.getElementById("flo-upload-overlay");
        if (existing) existing.remove();
      
        const overlay = document.createElement("div");
        overlay.id = "flo-upload-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 280px;
          background: white; border: 3px solid #0288d1; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
        `;
      
        overlay.innerHTML = `
          <div id="flo-wiz-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-wiz-title" style="margin:0; color:#0288d1; font-size:16px; pointer-events:none;">FloSports Wizard ✥</h3>
            <div>
                <button id="flo-wiz-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-wiz-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>
          
          <div id="flo-wiz-main-content">
              <div style="margin-bottom: 12px; font-size: 13px;">
                <small>Follow the highlighted steps as you progress through the form.</small>
              </div>
              
              <div id="flo-step-container" style="display: flex; flex-direction: column; gap: 8px;">
                  <button id="flo-btn-step1" style="background: #0288d1; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Init & Email</button>
                  <button id="flo-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Personal Info</button>
                  <button id="flo-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Infringement & Sign</button>
              </div>
      
              <div id="flo-log-container" style="display: none; margin-top: 15px;">
                  <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                      ⚠️ Click "Send" on the page first, then log below!
                  </div>
                  <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
                  <div id="flo-log-status" style="margin-top:8px; font-size:12px; text-align: center;"></div>
              </div>
          </div>
        `;
      
        cachedOverlay = overlay; // Cache it!
        document.body.appendChild(overlay);
        setupDrag(overlay);
  
        // Minimize Logic
        let isWizMinimized = false;
        const minBtn = document.getElementById('flo-wiz-min-btn');
        const closeBtn = document.getElementById('flo-wiz-close-btn');
        const mainContent = document.getElementById('flo-wiz-main-content');
        const title = document.getElementById('flo-wiz-title');
        const topBar = document.getElementById('flo-wiz-top-bar');

        minBtn.addEventListener('click', () => {
            isWizMinimized = !isWizMinimized;
            if (isWizMinimized) {
                mainContent.style.display = 'none';
                minBtn.innerHTML = '+';
                title.innerText = 'Wizard ✥';
                overlay.style.width = 'auto';
                topBar.style.borderBottom = 'none';
                topBar.style.marginBottom = '0';
                topBar.style.paddingBottom = '0';
                overlay.style.left = 'auto'; // Snap to right side
                overlay.style.right = '0px';
                overlay.style.borderTopRightRadius = '0';
                overlay.style.borderBottomRightRadius = '0';
            } else {
                mainContent.style.display = 'block';
                minBtn.innerHTML = '−';
                title.innerText = 'FloSports Wizard ✥';
                overlay.style.width = '280px';
                topBar.style.borderBottom = '1px solid #eee';
                topBar.style.marginBottom = '10px';
                topBar.style.paddingBottom = '8px';
                overlay.style.borderRadius = '8px';
                
                // Adjust position slightly to prevent overflow
                const rect = overlay.getBoundingClientRect();
                if (window.innerWidth - rect.right < 10) {
                    overlay.style.right = '20px';
                    overlay.style.left = 'auto';
                }
            }
        });

        closeBtn.addEventListener('click', () => {
            overlay.remove(); // Removing triggers the launcher tab to slide in via the interval
        });

        // Step Buttons Logic
        const btn1 = document.getElementById('flo-btn-step1');
        const btn2 = document.getElementById('flo-btn-step2');
        const btn3 = document.getElementById('flo-btn-step3');
        const stepContainer = document.getElementById('flo-step-container');
        const logContainer = document.getElementById('flo-log-container');
  
        btn1.addEventListener('click', async () => {
            btn1.innerText = "Running...";
            const transitioned = await runStep1(data);
            
            btn1.innerText = "Step 1: Done";
            btn1.style.background = "#ccc"; btn1.style.color = "#333";
            btn2.style.background = "#0288d1"; btn2.style.color = "white";
            
            if (transitioned) {
                isTransitioning = true;
                overlay.style.display = 'none';
                setTimeout(() => {
                    isTransitioning = false;
                    if (cachedOverlay) cachedOverlay.style.display = 'block';
                    if (!document.getElementById("flo-upload-overlay") && cachedOverlay) {
                        document.body.appendChild(cachedOverlay);
                    }
                }, 2500); // 2.5 second pause for the page to load
            }
        });
  
        btn2.addEventListener('click', async () => {
            btn2.innerText = "Running...";
            const transitioned = await runStep2(data);
            
            btn2.innerText = "Step 2: Done";
            btn2.style.background = "#ccc"; btn2.style.color = "#333";
            btn3.style.background = "#0288d1"; btn3.style.color = "white";

            if (transitioned) {
                isTransitioning = true;
                overlay.style.display = 'none';
                setTimeout(() => {
                    isTransitioning = false;
                    if (cachedOverlay) cachedOverlay.style.display = 'block';
                    if (!document.getElementById("flo-upload-overlay") && cachedOverlay) {
                        document.body.appendChild(cachedOverlay);
                    }
                }, 2500); // 2.5 second pause for the page to load
            }
        });
  
        btn3.addEventListener('click', async () => {
            btn3.innerText = "Running...";
            await runStep3(data);
            btn3.innerText = "Step 3: Done";
            btn3.style.background = "#ccc"; 
            btn3.style.color = "#333";
            
            // Show the log container, but DO NOT hide the step buttons
            logContainer.style.display = "block";
            overlay.style.borderColor = "#ce0e2d"; 
        });
  
        document.getElementById("flo-log-btn").addEventListener("click", () => {
          const status = document.getElementById("flo-log-status");
          status.innerText = "Logging...";
          chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
            if (response && response.success) {
              status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
              setTimeout(() => {
                  lastReportData = null; // Clear so the interval stops re-triggering
                  cachedOverlay = null;  // Clear cache memory
                  overlay.remove();
              }, 2000);
            } else {
              status.innerText = "❌ Failed."; status.style.color = "red";
            }
          });
        });
    }

    function createStandardOverlay(data) {
      if (cachedOverlay && cachedOverlay.id === "flo-upload-overlay") {
          if (!document.getElementById("flo-upload-overlay")) {
              document.body.appendChild(cachedOverlay);
          }
          return;
      }

      const existing = document.getElementById("flo-upload-overlay");
      if (existing) existing.remove();
    
      const overlay = document.createElement("div");
      overlay.id = "flo-upload-overlay";
      overlay.style.cssText = `
        position: fixed; top: 80px; right: 20px; width: 300px;
        background: white; border: 3px solid #ce0e2d; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
      `;
    
      overlay.innerHTML = `
        <div id="flo-wiz-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
          <h3 id="flo-wiz-title" style="margin:0; color:#ce0e2d; font-size:16px; pointer-events:none;">FloSports Helper ✥</h3>
          <div>
              <button id="flo-wiz-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
              <button id="flo-wiz-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
          </div>
        </div>
        
        <div id="flo-wiz-main-content">
            <div style="margin-bottom: 10px;">
              <strong>Platform:</strong> ${data.platform || "Unknown"}<br>
              <small>Review fields, then click Send.</small>
            </div>
            <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
            <div id="flo-log-status" style="margin-top:8px; font-size:12px;"></div>
        </div>
      `;
    
      cachedOverlay = overlay; // Cache it
      document.body.appendChild(overlay);
      setupDrag(overlay);

      // Minimize Logic
      let isWizMinimized = false;
      const minBtn = document.getElementById('flo-wiz-min-btn');
      const closeBtn = document.getElementById('flo-wiz-close-btn');
      const mainContent = document.getElementById('flo-wiz-main-content');
      const title = document.getElementById('flo-wiz-title');
      const topBar = document.getElementById('flo-wiz-top-bar');

      minBtn.addEventListener('click', () => {
          isWizMinimized = !isWizMinimized;
          if (isWizMinimized) {
              mainContent.style.display = 'none';
              minBtn.innerHTML = '+';
              title.innerText = 'Helper ✥';
              overlay.style.width = 'auto';
              topBar.style.borderBottom = 'none';
              topBar.style.marginBottom = '0';
              topBar.style.paddingBottom = '0';
              overlay.style.left = 'auto'; // Snap to right side
              overlay.style.right = '0px';
              overlay.style.borderTopRightRadius = '0';
              overlay.style.borderBottomRightRadius = '0';
          } else {
              mainContent.style.display = 'block';
              minBtn.innerHTML = '−';
              title.innerText = 'FloSports Helper ✥';
              overlay.style.width = '300px';
              topBar.style.borderBottom = '1px solid #eee';
              topBar.style.marginBottom = '10px';
              topBar.style.paddingBottom = '8px';
              overlay.style.borderRadius = '8px';
              
              // Adjust position slightly to prevent overflow
              const rect = overlay.getBoundingClientRect();
              if (window.innerWidth - rect.right < 10) {
                  overlay.style.right = '20px';
                  overlay.style.left = 'auto';
              }
          }
      });
      
      closeBtn.addEventListener('click', () => {
          overlay.remove();
      });
    
      document.getElementById("flo-log-btn").addEventListener("click", () => {
        const status = document.getElementById("flo-log-status");
        status.innerText = "Logging...";
        chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
          if (response && response.success) {
            status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
            setTimeout(() => {
                lastReportData = null; // Clear so the interval stops
                cachedOverlay = null;  // Clear cache memory
                overlay.remove();
            }, 2000);
          } else {
            status.innerText = "❌ Failed."; status.style.color = "red";
          }
        });
      });
    }
    function createYouTubeOverlay(data) {
        if (cachedOverlay && cachedOverlay.id === "flo-upload-overlay") {
            if (!document.getElementById("flo-upload-overlay")) {
                document.body.appendChild(cachedOverlay);
            }
            return;
        }

        const existing = document.getElementById("flo-upload-overlay");
        if (existing) existing.remove();
      
        const overlay = document.createElement("div");
        overlay.id = "flo-upload-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 280px;
          background: white; border: 3px solid #ce0e2d; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
        `;
      
        overlay.innerHTML = `
          <div id="flo-wiz-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-wiz-title" style="margin:0; color:#ce0e2d; font-size:16px; pointer-events:none;">YouTube Wizard ✥</h3>
            <div>
                <button id="flo-wiz-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-wiz-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>
          
          <div id="flo-wiz-main-content">
              <div style="margin-bottom: 12px; font-size: 13px;">
                <small>Follow the highlighted steps as you progress through the form.</small>
              </div>
              
              <div id="flo-step-container" style="display: flex; flex-direction: column; gap: 8px;">
                  <button id="flo-yt-btn-step1" style="background: #ce0e2d; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Videos to remove</button>
                  <button id="flo-yt-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Copyright owner</button>
                  <button id="flo-yt-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Removal options & Legal</button>
              </div>
      
              <div id="flo-log-container" style="display: none; margin-top: 15px;">
                  <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                      ⚠️ Ensure all fields are valid before logging!
                  </div>
                  <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
                  <div id="flo-log-status" style="margin-top:8px; font-size:12px; text-align: center;"></div>
              </div>
          </div>
        `;
      
        cachedOverlay = overlay;
        document.body.appendChild(overlay);
        setupDrag(overlay);
  
        let isWizMinimized = false;
        const minBtn = document.getElementById('flo-wiz-min-btn');
        const closeBtn = document.getElementById('flo-wiz-close-btn');
        const mainContent = document.getElementById('flo-wiz-main-content');
        const title = document.getElementById('flo-wiz-title');
        const topBar = document.getElementById('flo-wiz-top-bar');

        minBtn.addEventListener('click', () => {
            isWizMinimized = !isWizMinimized;
            if (isWizMinimized) {
                mainContent.style.display = 'none';
                minBtn.innerHTML = '+';
                title.innerText = 'Wizard ✥';
                overlay.style.width = 'auto';
                topBar.style.borderBottom = 'none';
                topBar.style.marginBottom = '0';
                topBar.style.paddingBottom = '0';
                overlay.style.right = '0px';
                overlay.style.borderTopRightRadius = '0';
                overlay.style.borderBottomRightRadius = '0';
            } else {
                mainContent.style.display = 'block';
                minBtn.innerHTML = '−';
                title.innerText = 'YouTube Wizard ✥';
                overlay.style.width = '280px';
                topBar.style.borderBottom = '1px solid #eee';
                topBar.style.marginBottom = '10px';
                topBar.style.paddingBottom = '8px';
                overlay.style.borderRadius = '8px';
                const rect = overlay.getBoundingClientRect();
                if (window.innerWidth - rect.right < 10) {
                    overlay.style.right = '20px';
                    overlay.style.left = 'auto';
                }
            }
        });

        closeBtn.addEventListener('click', () => overlay.remove());

        const btn1 = document.getElementById('flo-yt-btn-step1');
        const btn2 = document.getElementById('flo-yt-btn-step2');
        const btn3 = document.getElementById('flo-yt-btn-step3');
        const logContainer = document.getElementById('flo-log-container');
  
        btn1.addEventListener('click', async () => {
            btn1.innerText = "Running...";
            await runYtStep1(data);
            btn1.innerText = "Step 1: Done";
            btn1.style.background = "#ccc"; btn1.style.color = "#333";
            btn2.style.background = "#ce0e2d"; btn2.style.color = "white";
        });
  
        btn2.addEventListener('click', async () => {
            btn2.innerText = "Running...";
            await runYtStep2(data);
            btn2.innerText = "Step 2: Done";
            btn2.style.background = "#ccc"; btn2.style.color = "#333";
            btn3.style.background = "#ce0e2d"; btn3.style.color = "white";
        });
  
        btn3.addEventListener('click', async () => {
            btn3.innerText = "Running...";
            await runYtStep3(data);
            btn3.innerText = "Step 3: Done";
            btn3.style.background = "#ccc"; btn3.style.color = "#333";
            logContainer.style.display = "block";
        });
  
        document.getElementById("flo-log-btn").addEventListener("click", () => {
          const status = document.getElementById("flo-log-status");
          status.innerText = "Logging...";
          chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
            if (response && response.success) {
              status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
              setTimeout(() => {
                  lastReportData = null; 
                  cachedOverlay = null;  
                  overlay.remove();
              }, 2000);
            } else {
              status.innerText = "❌ Failed."; status.style.color = "red";
            }
          });
        });
    }
    function setupDrag(overlay) {
      let isDragging = false, startX, startY, initialLeft, initialTop;
      overlay.addEventListener('mousedown', (e) => {
          // Ignore drag on interactive elements to allow clicking
          if (['BUTTON', 'INPUT', 'A', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
          if (e.target.id === 'flo-wiz-min-btn' || e.target.id === 'flo-wiz-close-btn') return;

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
     async function runYtStep1(data) {
        console.log("📝 Running YouTube Step 1: Videos...");
        const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
        
        // 1. IMPOSE THE 10 VIDEO LIMIT
        const infringingUrls = data.urls || [];
        const MAX_YOUTUBE_URLS = 10;
        const urlsToReport = infringingUrls.slice(0, MAX_YOUTUBE_URLS);
        
        if (infringingUrls.length > MAX_YOUTUBE_URLS) {
            console.warn(`YouTube limits 10 videos per form. Only processing the first 10.`);
            alert(`YouTube Limits Reports to 10 Videos.\n\nOnly the first 10 videos have been loaded into this form. You will need to submit this form, clear your cart, and run the remaining videos in a new batch.`);
        }

        async function waitAndClick(textOrSel, time=3000) {
           const btn = await waitForButton(textOrSel, time);
           if (btn) { 
               btn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
               btn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
               btn.click(); 
               return true; 
           }
           return false;
        }

        // Helper for YouTube's Polymer Dropdowns
        async function selectYtcpDropdown(labelStr, valueStr) {
            const dropdowns = Array.from(document.querySelectorAll('ytcp-form-select, ytcp-text-dropdown-trigger'));
            const targetDd = dropdowns.find(el => el.innerText.toLowerCase().includes(labelStr.toLowerCase()) && isVisible(el));

            if (targetDd) {
                if (targetDd.innerText.toLowerCase().includes(valueStr.toLowerCase())) return;
                
                const trigger = targetDd.querySelector('[role="button"]') || targetDd;
                trigger.click();
                await sleep(500);

                const options = Array.from(document.querySelectorAll('tp-yt-paper-item, paper-item, .ytcp-dropdown-item'));
                const option = options.find(opt => opt.innerText.toLowerCase().trim() === valueStr.toLowerCase() && isVisible(opt));

                if (option) {
                    option.click();
                } else {
                    document.body.click(); // Close if not found
                }
                await sleep(500);
            }
        }

        // Helper for YouTube inputs
        const fillYtcpInput = (selector, val) => {
            if (!val) return;
            const el = document.querySelector(selector);
            if (el) {
                // Find inner input if targeting a wrapper
                const innerInput = el.querySelector('input, textarea') || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : null);
                if (innerInput) typeValue(innerInput, val);
            } else {
                // Fallback using xPath to find the input by label
                fillByLabel(selector.replace(/[[\]'"]/g, ''), val);
            }
        };

        // 2. ADD VIDEOS LOOP
        for (const badUrl of urlsToReport) {
            const addBtnText = conf.buttons?.add_video || "Add a video";
            await waitAndClick(addBtnText, 3000);
            await sleep(1000);

            const dds = conf.dropdowns || {};
            await selectYtcpDropdown(dds.type_work?.label || "Type of work", dds.type_work?.value || "Video");
            await selectYtcpDropdown(dds.subcategory?.label || "Subcategory", dds.subcategory?.value || "Internet video");
            await selectYtcpDropdown(dds.source?.label || "Source of my content", dds.source?.value || "From outside of YouTube");

            const videoTitleSel = conf.inputs?.video_title?.[0] || conf.inputs?.video_title || "Video title";
            fillYtcpInput(videoTitleSel, data.eventName || "FloSports Event");

            const badInputSel = conf.inputs?.infringing_url?.[0] || conf.inputs?.infringing_url || "YouTube URL of video to be removed";
            fillYtcpInput(badInputSel, badUrl);

            const locDropdown = dds.location || { label: "Location of infringing content", value: "Entire video" };
            await selectYtcpDropdown(locDropdown.label, locDropdown.value);

            await waitAndClick(conf.buttons?.save || "Add to list", 2000);
            await sleep(1500);
        }

        // 3. FILL COPYRIGHT OWNER SECTION
        console.log("Filling copyright owner details...");
        const ownerInputs = conf.inputs || {};
        
        await selectYtcpDropdown(conf.dropdowns?.affected_party?.label || "Affected party", conf.dropdowns?.affected_party?.value || "Myself");

        fillYtcpInput(ownerInputs.claimant_name || "Copyright owner name", data.fullName || "FloSports");
        fillYtcpInput(ownerInputs.phone || "Phone", "5122702356"); // FloSports Default
        fillYtcpInput(ownerInputs.secondary_email || "Secondary email", data.email || "copyright@flosports.tv");
        fillYtcpInput(ownerInputs.authority || "Relationship", "Authorized Representative");
        
        await selectYtcpDropdown(conf.dropdowns?.country?.label || "Country", conf.dropdowns?.country?.value || "United States");

        fillYtcpInput(ownerInputs.street || "Street address", "301 Congress Ave #1500");
        fillYtcpInput(ownerInputs.city || "City", "Austin");
        await selectYtcpDropdown("State", "Texas");
        fillYtcpInput(ownerInputs.zip || "Zip code", "78701");

        // 4. REMOVAL OPTIONS & AGREEMENTS
        console.log("Checking agreements...");
        const preventCopies = document.querySelector(conf.checkboxes?.prevent_copies || 'ytcp-checkbox-lit[aria-label*="Prevent future copies"]');
        if (preventCopies && preventCopies.getAttribute('aria-checked') !== 'true') preventCopies.click();

        const agreements = conf.checkboxes?.agreements || ["good faith", "accurate", "perjury"];
        for (const text of agreements) {
            const xpath = `//ytcp-checkbox-lit[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
            const checkbox = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (checkbox && checkbox.getAttribute('aria-checked') !== 'true') {
                checkbox.click();
            }
        }

        // Signature
        fillYtcpInput(ownerInputs.signature || "Signature", data.fullName);

        console.log("✅ YouTube Strategy Complete!");
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
    // Automatically re-injects the widget or toggles the launcher tab if TikTok's React routing destroys the DOM node.
    setInterval(() => {
        const isReportPage = window.location.href.toLowerCase().includes('tiktok.com/legal/report') || window.location.href.toLowerCase().includes('ipr.tiktokforbusiness');
        const launcher = document.getElementById('flo-wiz-launcher');
        const wiz = document.getElementById('flo-upload-overlay');

        if (launcher) {
            // Hide launcher if wizard is open OR we are not on the report page
            if (wiz || !isReportPage) {
                launcher.style.right = '-50px';
            } else {
                launcher.style.right = '0px';
            }
        } else if (isReportPage && !wiz && lastReportData) {
            createLauncherTab(lastReportData);
        }
    }, 1000);

    // Call init on load
    init();

})();