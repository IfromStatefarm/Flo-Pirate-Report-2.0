// content_autofill.js

(function() { // 1. Wrap in IIFE to prevent 'sleep' redeclaration errors

    // 2. DEFAULT CONFIGURATION (Robust Fallback)
    if (typeof AUTOFILL_CONFIG === 'undefined') {
      var AUTOFILL_CONFIG = {}; 
<<<<<<< HEAD
    }
    
    // Define sleep inside the scope
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let configLoaded = false;
    let lastReportData = null; // Store data to re-use on clicks
    let isAutofilling = false; // Prevent overlapping runs
    
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
                if (request.data) lastReportData = request.data;
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
        
            lastReportData = data; // Save for the click listener
            console.log("🚀 Starting Flo Autofill for:", platform);
            
            // START CONFIG LOAD
            loadConfig();
        
            // STRICT WAIT LOOP
            let retries = 0;
            while (!configLoaded && retries < 50) { 
                if (retries % 10 === 0) console.log("⏳ Waiting for config...");
                await sleep(100);
                retries++;
            }
        
            if (!configLoaded) console.warn("⚠️ Timed out waiting for config. Strategies may fail.");
        
            await sleep(500); 
            routeAutofill(data);
        } catch(e) {
            console.warn("Autofill Init Error (Context likely invalidated):", e);
        }
    })();
    
    async function routeAutofill(data) {
        if (isAutofilling || !data) return;
        isAutofilling = true;

        try {
            const host = window.location.hostname;
            if (host.includes('tiktok')) await fillTikTok(data);
            else if (host.includes('youtube')) await fillYouTube(data);
            else if (host.includes('instagram')) await fillInstagram(data);
            else if (host.includes('twitter') || host.includes('x.com')) await fillTwitter(data);
            
        } finally {
            isAutofilling = false;
        }
    }
    
    // --- HELPER: DOM VISIBILITY CHECK ---
    const isVisible = (elem) => {
        if (!elem) return false;
        const rect = elem.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    // --- HELPER: BULLETPROOF REACT SETTER ---
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

    // --- HELPER: REACT CHECKBOX HACKER ---
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
        } catch (err) {
            console.warn("PIRATE AI: Error checking box:", err);
        }
=======
>>>>>>> 79f5cd90f1038ccca67828ebf99537cbc7b5716f
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
            
            // START CONFIG LOAD
            loadConfig();
        
            // STRICT WAIT LOOP
            let retries = 0;
            while (!configLoaded && retries < 50) { 
                if (retries % 10 === 0) console.log("⏳ Waiting for config...");
                await sleep(100);
                retries++;
            }
        
            if (!configLoaded) console.warn("⚠️ Timed out waiting for config. Strategies may fail.");
        
            await sleep(500); 
            routeAutofill(data);
        } catch(e) {
            console.warn("Autofill Init Error (Context likely invalidated):", e);
        }
    })();
    
    async function routeAutofill(data) {
        const host = window.location.hostname;
        let success = true;

<<<<<<< HEAD
    function triggerReactUpdate(element) {
        if (!element) return;
        ['input', 'change', 'blur'].forEach(eventName => {
            element.dispatchEvent(new Event(eventName, { bubbles: true }));
        });
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
    
        const typeValue = (el, val) => {
            if (!el || !isVisible(el)) return false;

            el.scrollIntoView({block: "center", behavior: "smooth"});
            el.focus();
            el.click();

            // Use the bulletproof native setter
            setNativeValue(el, "");
            el.dispatchEvent(new Event('input', { bubbles: true }));
            
            setNativeValue(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true })); 
            
            return true;
        };
    
        // 1. Precise Field Finder (Anchor to Label -> Find Next Input)
        const fillByLabel = (labelText, value) => {
            if (!value) return;
            const lowerLabel = labelText.toLowerCase();
            
            // Find all visible text nodes/labels that might be field titles
            const labels = Array.from(document.querySelectorAll('p.field-title, label, .form-label, .tux-form-label, span'));
            const targetLabel = labels.find(l => l.innerText.toLowerCase().includes(lowerLabel) && isVisible(l));
            
            let targetInput = null;
            if (targetLabel) {
                // Find the very next input/textarea physically following the label in the DOM
                const xpath = `following::input[not(@type='hidden') and not(@type='radio') and not(@type='checkbox')] | following::textarea`;
                const iterator = document.evaluate(xpath, targetLabel, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                
                let node = iterator.iterateNext();
                while (node) {
                    if (isVisible(node)) {
                        targetInput = node;
                        break;
                    }
                    node = iterator.iterateNext();
                }
=======
        if (host.includes('tiktok')) success = await fillTikTok(data);
        else if (host.includes('youtube')) success = await fillYouTube(data);
        else if (host.includes('instagram')) success = await fillInstagram(data);
        else if (host.includes('twitter') || host.includes('x.com')) success = await fillTwitter(data);
        
        // ONLY spawn the log sheet if the script successfully completed its forms
        if(success !== false && data.eventName) {
            createUploadOverlay(data);
        }
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

        // --- HELPER: PAGE IDENTIFICATION ---
        const isMainFormPage = () => {
            return !!findElement(conf.field_strategies?.name?.[0] || "input[name='i.EP.name']") || !!document.querySelector("input[name='name']");
        };

        const isEmailPage = () => {
            const text = document.body.textContent.toLowerCase();
            return text.includes("verify your email") || 
                   text.includes("email address before you make a report") || 
                   !!document.getElementById('email') || 
                   new URL(window.location.href).searchParams.has("email");
        };

        // --- STEP 0: PROGRESS THROUGH WIZARD NATURALLY ---
        console.log("⏳ Checking for wizard steps...");
        
        for (let stepAttempt = 0; stepAttempt < 10; stepAttempt++) {
            // If we've reached the email page or the main form, break out of the wizard loop
            if (isMainFormPage() || isEmailPage()) {
                console.log("✅ Target form page reached. Exiting wizard navigation.");
                break; 
            }

            let clickedOption = false;
            // Use config wizard steps or reliable fallbacks
            const wizardOptions = conf.wizard_steps || [
                "Copyright",
                "I am the copyright owner",
                "Authorized representative"
            ];

            for (const optionText of wizardOptions) {
                // Find element by exact or partial text match
                const xpath = `//span[contains(text(), '${optionText}')] | //div[contains(text(), '${optionText}')]`;
                const el = findElement(xpath);
                
                if (el && el.offsetParent !== null) {
                    console.log(`🔘 Clicking wizard option: "${optionText}"`);
                    // Try to click the label or container wrapping the radio button
                    const clickableTarget = el.closest('label') || el.closest('[role="radio"]') || el;
                    clickableTarget.click();
                    
                    // Also try to check the raw radio button if available
                    const radio = clickableTarget.querySelector('input[type="radio"]');
                    if (radio && !radio.checked) radio.click();
                    
                    clickedOption = true;
                    await sleep(500);
                    break; // Only click one option per page/step
                }
            }

            const nextBtn = await waitForButton(conf.buttons?.next || ['Next', 'Continue'], 1000);
            if (nextBtn && !nextBtn.disabled) {
                console.log("➡️ Clicking Next to progress wizard...");
                nextBtn.click();
                await sleep(2000); // Wait for React to transition to the next step
            } else if (!clickedOption) {
                // Couldn't find anything to click and no active Next button, pause and wait for user
                await sleep(1000);
            } else {
                // Option clicked but Next button not ready, wait a bit
                await sleep(1000);
            }
        }
    
        // --- HELPER: SIMULATE HUMAN TYPING (REACT BYPASS) ---
        const simulateTyping = async (el, val) => {
            if (!el) return false;
    
            el.focus();
            el.click();
            await sleep(100);
    
            try {
                el.select();
                
                let execSuccess = false;
                try { execSuccess = document.execCommand('insertText', false, val); } catch(e) {}

                // Fallback: React 16+ Value Setter Bypass
                if (!execSuccess || el.value !== val) {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    const setter = el.tagName === 'TEXTAREA' ? nativeTextAreaValueSetter : nativeInputValueSetter;

                    if (setter) {
                        setter.call(el, val);
                    } else {
                        el.value = val;
                    }
                }

                // Fire comprehensive event chain
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
                el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    
            } catch (e) {
                console.warn("React setter hack failed, using standard value assignment:", e);
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return true;
        };
    
        const typeValue = async (el, val) => {
            if (!el) return false;
            if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                const inner = el.querySelector('input, textarea');
                if (inner) el = inner;
            }
            if (!el) return false;
    
            el.scrollIntoView({block: "center", behavior: "smooth"});
            return await simulateTyping(el, val);
        };
    
        const applyFieldStrategy = async (strategies, value) => {
            if (!strategies || !Array.isArray(strategies)) return false;
            for (const strat of strategies) {
                const el = findElement(strat);
                if (el) {
                    console.log(`   ✅ Found field via: ${strat}`);
                    return await typeValue(el, value);
                }
            }
            return false;
        };

        // --- DOM RENDER WAIT LOOP ---
        console.log("⏳ Waiting for TikTok form to render...");
        let formType = "none"; 

        for (let i = 0; i < 40; i++) { // Wait up to 20 seconds for the DOM
            if (isMainFormPage()) {
                formType = "main";
                break;
            }
            if (isEmailPage()) {
                formType = "email";
                break;
>>>>>>> 79f5cd90f1038ccca67828ebf99537cbc7b5716f
            }
    
            if (targetInput && targetInput.value !== value) {
                console.log(`   ✅ Found field by label: "${labelText}"`);
                typeValue(targetInput, value);
            }
        };

        // --- PAGE DETECTION VIA VISIBLE BUTTONS & LABELS ---
        const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
        const hasSendButton = buttons.some(b => b.innerText.toLowerCase().includes('send') || b.innerText.toLowerCase().includes('submit'));
        const hasNextButton = buttons.some(b => b.innerText.toLowerCase().includes('next') || b.innerText.toLowerCase().includes('continue'));
        
        const labelsText = Array.from(document.querySelectorAll('p.field-title, label')).filter(isVisible).map(l => l.innerText.toLowerCase());
        const hasSignature = labelsText.some(t => t.includes('signature'));
        const hasEmail = labelsText.some(t => t.includes('email address')) || !!document.querySelector('input[placeholder*="email" i]');

        // --- STEP 3: MAIN FORM (SIGNATURE & SEND) ---
        if (hasSendButton && hasSignature) {
            console.log("🔹 STEP 3: Main Form Detected...");
            
            // Execute in the exact order requested: Signature -> Name -> Scroll down through the rest
            fillByLabel('signature', defaults.name);
            fillByLabel('your full name', defaults.name);
            fillByLabel('name of the copyright owner', defaults.company);
            fillByLabel('physical address', defaults.address);
            fillByLabel('phone number', defaults.phone);
            
            // Exact Match Radio Buttons
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

            // Toggles and Checkboxes by Text Matching
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
                            console.log(`☑️ Clicking ARIA box for: ${text}`);
                            ariaBox.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                            ariaBox.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                            ariaBox.click();
                            triggerReactUpdate(ariaBox);
                        }
                    } else {
                        if (!node.hasAttribute('data-flo-clicked')) {
                            console.log(`☑️ Clicking text node for custom checkbox: ${text}`);
                            node.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                            node.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                            node.click();
                            if(node.parentElement) node.parentElement.click();
                            node.setAttribute('data-flo-clicked', 'true');
                        }
                    }
                }
            });
        
            createUploadOverlay(data);

            // Highlight Send Button and WAIT for User.
            const sendBtn = buttons.find(b => b.innerText.toLowerCase().includes('send') || b.innerText.toLowerCase().includes('submit'));
            if (sendBtn) {
                sendBtn.scrollIntoView({block: 'center'});
                sendBtn.style.border = "4px solid #ce0e2d"; 
                sendBtn.disabled = false; 
                console.log("🛑 Step 3 complete. Waiting for user to review and manually click Send.");
            }
            return;
        }

        // --- STEP 2: EMAIL VERIFICATION ---
        if (hasNextButton && hasEmail && !hasSignature) {
            console.log("🔹 STEP 2: Email Verification Detected...");
            
            // Find Email Input safely
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

            if (targetInput && targetInput.value !== defaults.email) {
                typeValue(targetInput, defaults.email);
            }
            
            const nextBtn = buttons.find(b => b.innerText.toLowerCase().includes('next') || b.innerText.toLowerCase().includes('continue'));
            if (nextBtn && !nextBtn.disabled) {
                console.log("➡️ Clicking Next to proceed...");
                nextBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                nextBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                nextBtn.click();
            }
            return;
        }

        // --- STEP 1: ISSUE SELECTION ---
        if (hasNextButton && !hasEmail && !hasSignature) {
            console.log("🔹 STEP 1: Initial Issue Selection Detected. Waiting for user or auto-skipping via URL...");
            // Let the user fill out the dropdowns manually or bypass via URL params.
            return;
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
    
                if (el && isVisible(el) && !el.disabled) return el;
            }
            await sleep(200);
        }
<<<<<<< HEAD
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

    // ==========================================
    // NEW TRIGGER: GLOBAL CLICK LISTENER
    // ==========================================
    // This allows the extension to "wake up" when the user clicks 'Next'
    // or clicks anywhere on Page 3.
    document.addEventListener('click', (e) => {
        // By removing the tagName restriction, we catch clicks on SVGs and Spans inside buttons
        setTimeout(() => {
            if (lastReportData && !isAutofilling) {
                console.log("🖱️ User interaction detected. Scanning for missing boxes/fields...");
                routeAutofill(lastReportData);
            }
        }, 800); // Wait 800ms for TikTok's React animations to finish loading the next page
    }, true);

})();
=======

        if (formType === "none") {
            console.warn("❌ TikTok form never rendered. Halting autofill.");
            return false; // Return false to abort log sheet
        }
    
        // --- STEP 1: VERIFY EMAIL STEP ---
        if (formType === "email") {
            console.log("🔹 Intermediate Step Detected (Email Verification)...");
            
            await new Promise((resolve) => {
                console.log("⏳ Waiting for user to click the email box...");
                
                // Visual prompt loop (keeps re-applying if React erases it)
                const promptInterval = setInterval(() => {
                    const emailInput = document.querySelector('input[placeholder*="email" i], input[id^="tux-"], #email input');
                    if (emailInput && (!emailInput.placeholder || !emailInput.placeholder.includes("CLICK"))) {
                        emailInput.style.border = "3px solid #ce0e2d";
                        emailInput.style.backgroundColor = "#ffeaee";
                        emailInput.placeholder = "👉 CLICK TO AUTOFILL 👈";
                    }
                }, 1000);

                // Global event listener to catch the interaction
                const interactionHandler = async (e) => {
                    const target = e.target;
                    // Verify they clicked our input box or the wrapper
                    if (target.tagName === 'INPUT' && (target.id.startsWith('tux-') || target.closest('#email') || (target.placeholder && target.placeholder.includes('CLICK')))) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Remove listeners immediately so it doesn't fire twice
                        document.removeEventListener('focusin', interactionHandler, true);
                        document.removeEventListener('click', interactionHandler, true);
                        clearInterval(promptInterval);
                        
                        console.log("🖱️ User interacted! Autofilling email...");
                        
                        // Revert visual styles
                        target.style.border = "";
                        target.style.backgroundColor = "";
                        target.placeholder = "Enter your email address";
                        
                        // Fill the email
                        await typeValue(target, defaults.email);
                        await sleep(1000); // Give React state time to catch up
                
                        const nextVariants = conf.buttons?.next || ['Next', 'Continue'];
                        let btn = await waitForButton(nextVariants, 2000);
                        
                        // If standard flow didn't unlock button, try robust retry
                        if (btn && btn.disabled) {
                             console.log("⚠️ Next button disabled. Retrying robust input trigger...");
                             await typeValue(target, " "); // trigger change
                             await sleep(200);
                             await typeValue(target, defaults.email); // re-type
                             await sleep(1000);
                             btn = await waitForButton(nextVariants, 1000);
                        }
                        
                        if (btn && !btn.disabled) {
                             console.log("➡️ Clicking Next...");
                             btn.click();
                        } else {
                             console.warn("❌ Next button still disabled. You may need to click it manually.");
                        }
                        resolve();
                    }
                };

                // Listen in the capture phase (true) so React doesn't swallow the event!
                document.addEventListener('focusin', interactionHandler, true);
                document.addEventListener('click', interactionHandler, true);
            });

            // --- HARD GATE ---
            console.log("⏳ Waiting for main form to load...");
            let mainLoaded = false;
            for (let i = 0; i < 30; i++) { // Wait up to 15s for the next page
                if (isMainFormPage()) {
                    mainLoaded = true;
                    break;
                }
                await sleep(500);
            }
            
            if (!mainLoaded) {
                console.error("❌ Main form never loaded. Halting autofill.");
                return false; // Return false to abort log sheet
            }
            
            console.log("✅ Main form loaded!");
            await sleep(1000); // Brief pause before continuing
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
                await sleep(200); // Brief pause between fields to avoid overwhelming the DOM
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
            if (toggle && !toggle.checked) { 
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

        return true; // Successfully finished
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

        return true;
    }
    
    async function fillInstagram(data) {
        const conf = AUTOFILL_CONFIG.instagram?.autofill || {};
        if(conf.name) {
            const el = document.querySelector(`[name="${conf.name}"]`);
            if(el) el.value = data.fullName;
        }
        return true;
    }
    
    async function fillTwitter(data) {
        const conf = AUTOFILL_CONFIG.twitter?.autofill || {};
        if(conf.name) {
            const el = document.querySelector(`[name="${conf.name}"]`);
            if(el) el.value = data.fullName;
        }
        return true;
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

})();
>>>>>>> 79f5cd90f1038ccca67828ebf99537cbc7b5716f
