// content_autofill.js

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ==========================================
// 1. LISTENERS & AUTO-RUN
// ==========================================

// A. Listener (For manual triggering from Sidepanel)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startFullAutomation") {
      console.log("🤖 Received Automation Data:", request.data);
      routeAutofill(request.data)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; 
  }
});

// B. Auto-Run on Page Load (The new "Smart" workflow)
(async function init() {
    const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
    const cart = res.piracy_cart || [];
    const info = res.reporterInfo;

    // Only run if we have data AND we are on a relevant site
    if (cart.length === 0 || !info) return;

    const host = window.location.hostname;
    const platform = cart[0].platform || "TikTok";

    // Safety checks: Ensure we don't run TikTok logic on YouTube
    if (platform === "TikTok" && !host.includes("tiktok")) return;
    if (platform === "YouTube" && !host.includes("youtube")) return;
    if (platform === "Instagram" && !host.includes("instagram") && !host.includes("facebook")) return;
    if (platform === "Twitter" && !host.includes("x.com") && !host.includes("twitter")) return;

    // Construct the data object exactly how your logic expects it
    const data = {
        fullName: info.name,
        email: info.email || "copyright@flosports.tv",
        urls: cart.map(c => c.url),
        platform: platform,
        eventName: info.eventName,
        vertical: info.vertical,
        sourceUrl: info.sourceUrl
    };

    console.log(`🤖 Auto-Running for ${platform}...`);
    routeAutofill(data);
})();

// ==========================================
// 2. THE ROUTER (Traffic Cop)
// ==========================================
async function routeAutofill(data) {
    const host = window.location.hostname;

    if (host.includes('tiktok')) {
        await fillTikTok(data); // Calls your preserved logic
    } else if (host.includes('youtube')) {
        await fillYouTube(data);
    } else if (host.includes('instagram')) {
        await fillInstagram(data);
    } else if (host.includes('facebook')) {
        await fillFacebook(data);
    } else if (host.includes('twitter') || host.includes('x.com')) {
        await fillTwitter(data);
    } else {
        console.log("No autofill strategy for this site.");
        return;
    }

    // Show YOUR Overlay (The one with the progress bar)
    createUploadOverlay(data);
}

// ==========================================
// 3. YOUR TIKTOK STRATEGY (Preserved Exactly)
// ==========================================
async function fillTikTok(data) {
  const defaults = {
      company: "Flosports",
      phone: "5122702356",
      address: "301 Congress ave #1500 Austin Tx 78701",
      email: data.email || "copyright@flosports.tv"
  };

  console.log("📧 Attempting to fill email...");
  
  // Your robust email search
  await fillBySelector('input[type="email"]', defaults.email);
  await fillById("email", defaults.email); 
  await fillById("contact_email", defaults.email);
  await fillByName("email", defaults.email);
  await fillByPlaceholder("email", defaults.email);
  await fillByPlaceholder("example.com", defaults.email);
  await fillInput("Email address", defaults.email); 
  await fillInput("Verify your email", defaults.email); 
  await fillInput("Contact email", defaults.email); 

  // Your "Next" button logic
  const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes("Next"));
  if (nextBtn && !nextBtn.disabled) {
      console.log("👉 Clicking Next...");
      nextBtn.click();
      console.log("⏳ Waiting for Main Form...");
      await waitForSelector('#name input', 5000); 
      await sleep(500); 
  }

  // Contact Info
  await fillById("name", data.fullName); 
  await fillById("nameOfOwner", defaults.company); 
  await fillById("phoneNumber", defaults.phone); 
  await fillById("address", defaults.address); 
  
  await fillInput("Copyright owner name", defaults.company); 
  await fillInput("Phone number", defaults.phone);
  await fillInput("Address", defaults.address, "email"); 

  // URL List
  const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
  await fillByPlaceholder("tiktok.com/@tiktok/video", urlText);
  await fillInput("Content to report", urlText);
  await fillInput("Enter the URL(s)", urlText);
  await fillInput("Infringing material", urlText);

  // Signature
  await fillInput("Signature", data.fullName);
  await fillInput("Sign your name", data.fullName);

  // Checkboxes
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
}

// ==========================================
// 4. NEW STRATEGIES (For the other platforms)
// ==========================================

// ==========================================
// YOUTUBE STRATEGY (FIXED WITH IDs)
// ==========================================

// REPLACE 'fillYouTube' FUNCTION

async function fillYouTube(data) {
    console.log("📝 Running YouTube Strategy (Final Fixes)...");

    // Helper: Wait for button or ID
    async function waitForButton(selectorOrText, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            // Check if it's an ID selector first
            if (selectorOrText.startsWith('#')) {
                const el = await findDeep(selectorOrText);
                if (el) return el;
            } 
            // Otherwise search by text
            else {
                const xpath = `//ytcp-button[.//div[contains(text(), '${selectorOrText}')]] | //button[contains(text(), '${selectorOrText}')]`;
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                if (result.singleNodeValue) return result.singleNodeValue;
            }
            await sleep(500);
        }
        return null;
    }

    // --- PART 1: ADD VIDEOS ---
    const infringingUrls = data.urls || [];
    
    for (const [index, badUrl] of infringingUrls.entries()) {
        console.log(`▶️ Processing Video ${index + 1}: ${badUrl}`);

        const addBtn = await waitForButton('Add a video', 5000);
        if (addBtn) {
            addBtn.click();
            await sleep(1500); 
        }

        // 1. Initial Dropdowns
        await selectDropdownOption('Type of work', 'Video');
        await selectDropdownOption('Subcategory', 'Internet video');
        await selectDropdownOption('Source', 'From outside of YouTube');

        console.log("⏳ Waiting for fields...");
        await sleep(1500);

        // 2. Fill Source Info
        let sourceInput = await findDeep('#videoLink') || await findDeep('[aria-label="My video URL"]');
        if (sourceInput && data.sourceUrl) await typeInField(sourceInput, data.sourceUrl);

        let titleInput = await findDeep('#videoTitle') || await findDeep('[aria-label="Title"]'); 
        if (titleInput) await typeInField(titleInput, data.eventName || "FloSports Event");

        // 3. Fill Infringing URL
        let badInput = await findDeep('#targetVideo') || await findDeep('[aria-label="YouTube URL of video to be removed"]');
        if (badInput) {
            await typeInField(badInput, badUrl);
            console.log("   ↳ URL Filled, waiting for 'Location' dropdown...");
            await sleep(2000); 
        }

        // 4. Select "Entire video" (Now uses updated selector)
        await selectDropdownOption('Location of infringing content', 'Entire video');

        // 5. Add to List (Using ID #save-button)
        const saveBtn = await waitForButton('#save-button', 3000);
        if (saveBtn) {
            console.log("✅ Clicking 'Add to list' (#save-button)");
            saveBtn.click();
            await sleep(2500); 
        } else {
            console.warn("❌ 'Add to list' button not found!");
        }
    }

    // --- PART 2: CONTACT INFO ---
    console.log("📝 Filling Contact Info...");
    
    await selectDropdownOption('Affected party', 'My company, organization, or client');
    await sleep(1500); 

    let nameInput = await findDeep('#claimant-name');
    if (nameInput) await typeInField(nameInput, "Flosports");
    
    // Phone
    const phoneXpath = `//ytcp-form-textarea[.//div[contains(text(), 'Phone')]]`;
    const phoneResult = document.evaluate(phoneXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (phoneResult.singleNodeValue) await typeInField(phoneResult.singleNodeValue, "5122702356");

    await fillDeep('[aria-label="Secondary email"]', "copyright@flosports.tv");
    
    // Relationship
    let relInput = await findDeep('#requester-authority');
    if (relInput) await typeInField(relInput, "Authorized Representative");

    // Address
    await selectDropdownOption('country-select', 'United States');
    await fillDeep('[aria-label="Street address"]', "301 Congress ave #1500");
    await fillDeep('[aria-label="City"]', "Austin");
    
    // State
    let stateInput = await findDeep('#state');
    if (stateInput) await typeInField(stateInput, "Texas");

    await fillDeep('[aria-label="Zip code"]', "78701");

    // --- PART 3: LEGAL CHECKBOXES ---
    console.log("📝 Filling Legal...");

    const standardRadio = await findDeep('ytcp-radio-button[name="removal-timing-option"][aria-label*="Standard"]');
    if (standardRadio) {
        standardRadio.scrollIntoView({block: "center"});
        standardRadio.click();
    }

    const preventCheck = await findDeep('ytcp-checkbox-lit[aria-label*="Prevent future copies"]');
    if (preventCheck) preventCheck.click();

    const agreements = ["good faith", "accurate", "abuse"];
    for (const key of agreements) {
        const xpath = `//ytcp-checkbox-lit//div[contains(@aria-label, '${key}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        
        if (result.singleNodeValue) {
            const wrapper = result.singleNodeValue.closest('ytcp-checkbox-lit');
            if (wrapper && wrapper.getAttribute('aria-checked') === 'false') {
                 wrapper.scrollIntoView({block: "center"});
                 wrapper.click();
                 await sleep(300);
            }
        }
    }
    
    await fillDeep('[aria-label="Signature"]', data.fullName);
    console.log("✅ YouTube Automation Complete");
}

async function fillInstagram(data) {
    console.log("📝 Running Instagram Strategy...");
    
    await fillByName("your_name", data.fullName);
    await fillByName("email", data.email);
    
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    await fillBySelector('textarea[name="content_urls"]', urlText);
    await fillBySelector('textarea[name="links"]', urlText);
    
    await fillByName("electronic_signature", data.fullName);
}

async function fillFacebook(data) {
    await fillInstagram(data); // FB is Meta, same structure usually
}

async function fillTwitter(data) {
    console.log("📝 Running Twitter Strategy...");
    await fillByName("reporter_name", data.fullName);
    await fillByName("email", data.email);
    await fillByName("company_name", "FloSports");
    
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    await fillBySelector('textarea[name="source_url"]', urlText);
    await fillByName("signature", data.fullName);
}

// ==========================================
// 5. YOUR HELPERS (Preserved exactly)
// ==========================================

async function fillBySelector(selector, value) {
    if (!value) return;
    const el = document.querySelector(selector);
    if (el) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        console.log(`✅ Filled selector: ${selector}`);
        return true;
    }
    return false;
}

async function fillByName(nameAttr, value) {
    if (!value) return;
    const el = document.querySelector(`input[name="${nameAttr}"], textarea[name="${nameAttr}"]`);
    if (el) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        console.log(`✅ Filled name="${nameAttr}"`);
        return true;
    }
    return false;
}

async function fillByPlaceholder(partialPlaceholder, value) {
    if (!value) return;
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    const target = inputs.find(el => el.placeholder && el.placeholder.toLowerCase().includes(partialPlaceholder.toLowerCase()));
    if (target) {
        target.focus();
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.blur();
        console.log(`✅ Filled field with placeholder containing "${partialPlaceholder}"`);
        return true;
    }
    return false;
}

async function fillById(containerId, value) {
    if (!value) return;
    const container = document.getElementById(containerId);
    if (container) {
        const input = container.tagName === 'INPUT' || container.tagName === 'TEXTAREA' ? container : container.querySelector('input, textarea');
        if (input) {
            input.focus();
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            console.log(`✅ Filled ID #${containerId}`);
            return true;
        }
    }
    return false;
}

async function waitForSelector(selector, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (document.querySelector(selector)) return true;
        await sleep(200);
    }
    return false;
}

async function fillInput(labelText, value, excludeTerm = null) {
  if (!value) return;
  const lowerLabel = labelText.toLowerCase();
  const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lowerLabel}")]`;
  const snapshot = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  let labelEl = null;

  for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i);
      const text = node.innerText || node.textContent || "";
      if (excludeTerm && text.toLowerCase().includes(excludeTerm.toLowerCase())) continue; 
      labelEl = node;
      break; 
  }
  
  if (!labelEl) return;
  
  let input = null;
  let parent = labelEl.parentElement; 
  for(let i=0; i<5; i++) {
    if(!parent) break;
    input = parent.querySelector('input:not([type="hidden"]), textarea');
    if(input) break;
    parent = parent.parentElement;
  }
  
  if (input) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    console.log(`✅ Filled "${labelText}"`);
  }
}
// --- SHADOW DOM HELPERS (Required for YouTube) ---

// 1. Recursively find element inside Shadow Roots
async function findDeep(selector, root = document.body) {
    let el = root.querySelector(selector);
    if (el) return el;
    const elements = root.querySelectorAll('*');
    for (const element of elements) {
        if (element.shadowRoot) {
            const found = await findDeep(selector, element.shadowRoot);
            if (found) return found;
        }
    }
    return null;
}

// 2. NEW: Robust Typer that drills into Custom Elements
// This is critical for fields like <ytcp-form-textarea>
async function typeInField(el, value) {
    if (!el || !value) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);

    // DRILL DOWN: If we found a wrapper component, find the inner input
    if (el.shadowRoot) {
        const inner = el.shadowRoot.querySelector('input, textarea');
        if (inner) el = inner;
    } else if (el.tagName.includes('-')) {
         // Fallback for custom elements without open shadow roots
         const inner = el.querySelector('input, textarea');
         if (inner) el = inner;
    }

    el.focus();
    el.value = value;
    
    // Dispatch events with 'composed: true' to penetrate Shadow DOM
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    // Simulate Keypress (Essential for YouTube validation)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: value[0], bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: value[0], bubbles: true, composed: true }));
    
    el.blur();
}

// 3. Wrapper to find deep element and fill it
async function fillDeep(selector, value) {
    const el = await findDeep(selector);
    if(el) await typeInField(el, value);
}

// 4. Find Custom Elements by their inner Text (for Dropdowns/Buttons)
async function findElementByText(text, tagName = '*', root = document.body) {
    if (root.tagName && root.tagName.toLowerCase().includes(tagName.replace('*','')) && root.innerText && root.innerText.includes(text)) {
        return root;
    }
    if (root.shadowRoot) {
        const res = await findElementByText(text, tagName, root.shadowRoot);
        if (res) return res;
    }
    const children = root.children;
    for (const child of children) {
        const res = await findElementByText(text, tagName, child);
        if (res) return res;
    }
    return null;
}

// 5. Helper specifically for YouTube Dropdowns
// REPLACE 'selectDropdownOption' IN HELPERS

async function selectDropdownOption(label, optionText) {
    console.log(`🔽 Selecting: ${label} -> ${optionText}`);

    // 1. Find the Trigger (Updated to include 'ytcp-text-dropdown-trigger')
    const triggerXpath = `
        //*[@id="${label}"]//ytcp-dropdown-trigger |
        //ytcp-dropdown-trigger[contains(@aria-label, '${label}')] |
        //ytcp-form-select[contains(@aria-label, '${label}')]//ytcp-dropdown-trigger |
        //ytcp-dropdown-trigger[.//div[contains(text(), '${label}')]] |
        //ytcp-text-dropdown-trigger[.//div[contains(text(), '${label}')]] 
    `;
    const triggerResult = document.evaluate(triggerXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const trigger = triggerResult.singleNodeValue;

    if (trigger) {
        trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
        trigger.click();
        await sleep(800); // Wait for menu to open

        // 2. Find the Option
        const optionXpath = `
            //paper-item[contains(., '${optionText}')] | 
            //ytcp-text-menu-item[contains(., '${optionText}')] | 
            //tp-yt-paper-item[contains(., '${optionText}')]
        `;
        const optionResult = document.evaluate(optionXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const option = optionResult.singleNodeValue;

        if (option) {
            console.log(`   ✅ Found option: ${optionText}`);
            option.click();
            await sleep(1000); 
            return true;
        } else {
            console.warn(`❌ Option '${optionText}' not found. Closing menu.`);
            document.body.click(); 
        }
    } else {
        console.warn(`❌ Dropdown trigger '${label}' not found.`);
    }
    return false;
}
// ==========================================
// 6. YOUR OVERLAY (Preserved exactly)
// ==========================================
function createUploadOverlay(data) {
  const existing = document.getElementById("flo-upload-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "flo-upload-overlay";
  overlay.style.cssText = `
    position: fixed; top: 80px; right: 20px; width: 300px;
    background: white; border: 3px solid #ce0e2d; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    z-index: 2147483647; padding: 20px; font-family: sans-serif; border-radius: 8px;
  `;

  // --- UPDATED HTML WITH DRAG HEADER ---
  overlay.innerHTML = `
    <h3 id="flo-overlay-header" style="margin-top:0; color:#ce0e2d; cursor: move; user-select: none;">FloSports Helper ✥</h3>
    <div style="margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
      <strong>Platform:</strong> ${data.platform || "TikTok"}<br>
      <strong>Status:</strong> Form Filled.<br>
      <small style="color:#666;">Double check all fields.</small>
    </div>
    <div style="margin-bottom: 15px;">
      <strong>Step 2:</strong> Submit Report<br>
      <small>Click "Send" on the form.</small>
    </div>
    <div>
      <strong>Step 3:</strong> Log to Sheet<br>
      <button id="flo-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%; margin-top:5px;">Log & Finish</button>
      
      <div id="flo-progress-container" style="display:none; width: 100%; background-color: #f1f1f1; border-radius: 4px; margin-top: 10px; overflow: hidden;">
        <div id="flo-progress-fill" style="width: 0%; height: 8px; background-color: #ce0e2d; border-radius: 4px; transition: width 0.3s ease-in-out;"></div>
      </div>
      
      <div id="flo-log-status" style="margin-top:8px; font-size:12px; font-weight:bold;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  // --- DRAG LOGIC ---
  const header = document.getElementById("flo-overlay-header");
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = overlay.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      // Fix position from 'right' to 'left' for consistency during drag
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

  document.getElementById("flo-log-btn").addEventListener("click", () => {
    const status = document.getElementById("flo-log-status");
    const btn = document.getElementById("flo-log-btn");
    const progressContainer = document.getElementById("flo-progress-container");
    const progressFill = document.getElementById("flo-progress-fill");
    
    // 1. Setup UI for Loading
    status.innerText = "⏳ Generating PDF & Logging...";
    status.style.color = "blue";
    btn.disabled = true;
    btn.style.background = "#ccc";
    progressContainer.style.display = "block";

    // 2. Start Fake Progress Animation (Simulates up to 90%)
    let width = 0;
    const interval = setInterval(() => {
        if (width >= 90) {
            clearInterval(interval); // Stop at 90% and wait for actual response
        } else {
            width += (Math.random() * 5); // Increment randomly
            progressFill.style.width = width + "%";
        }
    }, 200);

    // 3. Send Message to Background
    chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
      clearInterval(interval); // Stop the animation logic

      if (response && response.success) {
        // Success! Jump to 100%
        progressFill.style.width = "100%";
        progressFill.style.backgroundColor = "#4CAF50"; // Turn Green
        
        status.innerText = "✅ Logged Successfully! Closing...";
        status.style.color = "green";
        setTimeout(() => overlay.remove(), 2500);
      } else {
        // Failure
        progressFill.style.backgroundColor = "red";
        status.innerText = "❌ Log Failed.";
        status.style.color = "red";
        btn.disabled = false;
        btn.style.background = "#ce0e2d";
      }
    });
  });
}
