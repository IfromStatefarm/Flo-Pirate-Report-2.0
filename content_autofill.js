// content_autofill.js

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- CONFIG & DEFAULTS ---
// These match the structure of events_config.json
let SELECTORS = {
  tiktok: {
    autofill: {
      email_candidates: ["input[type='email']", "#email", "#contact_email", "[name='email']", "[placeholder*='email' i]", "[placeholder*='example.com' i]"],
      email_labels: ["Email address", "Verify your email", "Contact email"],
      next_button: "button",
      next_button_text: "Next",
      main_form_wait: "#name input",
      inputs: {
        name: ["#name", "Signature", "Sign your name"],
        company: ["#nameOfOwner", "Copyright owner name"],
        phone: ["#phoneNumber", "Phone number"],
        address: ["#address", "Address"],
        urls: ["tiktok.com/@tiktok/video", "Content to report", "Enter the URL(s)", "Infringing material"]
      }
    }
  },
  youtube: {
    autofill: {
      buttons: { add_video: "Add a video", save: "#save-button" },
      inputs: {
        source_url: ["#videoLink", "[aria-label='My video URL']"],
        video_title: ["#videoTitle", "[aria-label='Title']"],
        infringing_url: ["#targetVideo", "[aria-label='YouTube URL of video to be removed']"],
        claimant_name: "#claimant-name",
        phone: "//ytcp-form-textarea[.//div[contains(text(), 'Phone')]]",
        secondary_email: "[aria-label='Secondary email']",
        authority: "#requester-authority",
        street: "[aria-label='Street address']",
        city: "[aria-label='City']",
        state: "#state",
        zip: "[aria-label='Zip code']",
        signature: "[aria-label='Signature']"
      },
      dropdowns: {
        type_work: { label: "Type of work", value: "Video" },
        subcategory: { label: "Subcategory", value: "Internet video" },
        source: { label: "Source", value: "From outside of YouTube" },
        location: { label: "Location of infringing content", value: "Entire video" },
        affected_party: { label: "Affected party", value: "My company, organization, or client" },
        country: { label: "country-select", value: "United States" }
      },
      radios: { standard_timing: "ytcp-radio-button[name='removal-timing-option'][aria-label*='Standard']" },
      checkboxes: {
        prevent_copies: "ytcp-checkbox-lit[aria-label*='Prevent future copies']",
        agreements: ["good faith", "accurate", "abuse"]
      }
    }
  },
  instagram: {
    autofill: {
      name: "your_name",
      email: "email",
      urls: ["textarea[name='content_urls']", "textarea[name='links']"],
      signature: "electronic_signature"
    }
  },
  twitter: {
    autofill: {
      name: "reporter_name",
      email: "email",
      company: "company_name",
      urls: "textarea[name='source_url']",
      signature: "signature"
    }
  }
};

// --- LOAD REMOTE CONFIG ---
(async function initConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success && response.config && response.config.platform_selectors) {
      const remote = response.config.platform_selectors;
      // Deep merge logic (simplified)
      ['tiktok', 'youtube', 'instagram', 'twitter'].forEach(p => {
        if(remote[p] && remote[p].autofill) SELECTORS[p].autofill = remote[p].autofill;
      });
      console.log("✅ Remote Autofill Selectors Loaded");
    }
  } catch(e) { console.warn("Using default autofill selectors."); }
})();

// ==========================================
// 1. LISTENERS & AUTO-RUN
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startFullAutomation") {
      console.log("🤖 Received Automation Data:", request.data);
      routeAutofill(request.data)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; 
  }
});

(async function init() {
    const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
    const cart = res.piracy_cart || [];
    const info = res.reporterInfo;

    if (cart.length === 0 || !info) return;

    const host = window.location.hostname;
    const platform = cart[0].platform || "TikTok";

    if (platform === "TikTok" && !host.includes("tiktok")) return;
    if (platform === "YouTube" && !host.includes("youtube")) return;
    if (platform === "Instagram" && !host.includes("instagram") && !host.includes("facebook")) return;
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

    console.log(`🤖 Auto-Running for ${platform}...`);
    routeAutofill(data);
})();

// ==========================================
// 2. THE ROUTER
// ==========================================
async function routeAutofill(data) {
    const host = window.location.hostname;

    if (host.includes('tiktok')) {
        await fillTikTok(data);
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

    createUploadOverlay(data);
}

// ==========================================
// 3. TIKTOK STRATEGY
// ==========================================
async function fillTikTok(data) {
  const conf = SELECTORS.tiktok.autofill;
  const defaults = {
      company: "Flosports",
      phone: "5122702356",
      address: "301 Congress ave #1500 Austin Tx 78701",
      email: data.email || "copyright@flosports.tv"
  };

  console.log("📧 Attempting to fill email...");
  
  // Use candidates from config
  if(conf.email_candidates) {
      for(const sel of conf.email_candidates) {
          if(sel.startsWith("#") || sel.startsWith(".")) await fillById(sel.replace("#",""), defaults.email);
          else if(sel.includes("name=")) await fillByName("email", defaults.email); // Simplified match
          else if(sel.includes("placeholder")) await fillByPlaceholder("email", defaults.email);
          else await fillBySelector(sel, defaults.email);
      }
  }
  
  // Use Labels from config
  if(conf.email_labels) {
      for(const label of conf.email_labels) await fillInput(label, defaults.email);
  }

  // Next Button
  const nextBtn = Array.from(document.querySelectorAll(conf.next_button)).find(b => b.innerText.includes(conf.next_button_text));
  if (nextBtn && !nextBtn.disabled) {
      console.log("👉 Clicking Next...");
      nextBtn.click();
      console.log("⏳ Waiting for Main Form...");
      await waitForSelector(conf.main_form_wait, 5000); 
      await sleep(500); 
  }

  // Generic Field Filler Helper
  const fillFieldGroup = async (key, val) => {
      const selectors = conf.inputs[key];
      if(!selectors) return;
      for(const s of selectors) {
          if(s.startsWith("#")) await fillById(s.replace("#",""), val);
          else await fillInput(s, val);
      }
  };

  // Contact Info
  await fillFieldGroup("name", data.fullName);
  await fillFieldGroup("company", defaults.company);
  await fillFieldGroup("phone", defaults.phone);
  await fillFieldGroup("address", defaults.address);

  // URL List
  const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
  await fillFieldGroup("urls", urlText);

  // Checkboxes
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
}

// ==========================================
// 4. YOUTUBE STRATEGY
// ==========================================
async function fillYouTube(data) {
    const conf = SELECTORS.youtube.autofill;
    console.log("📝 Running YouTube Strategy...");

    async function waitForButton(selectorOrText, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (selectorOrText.startsWith('#')) {
                const el = await findDeep(selectorOrText);
                if (el) return el;
            } else {
                const xpath = `//ytcp-button[.//div[contains(text(), '${selectorOrText}')]] | //button[contains(text(), '${selectorOrText}')]`;
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                if (result.singleNodeValue) return result.singleNodeValue;
            }
            await sleep(500);
        }
        return null;
    }

    const infringingUrls = data.urls || [];
    
    for (const [index, badUrl] of infringingUrls.entries()) {
        console.log(`▶️ Processing Video ${index + 1}: ${badUrl}`);

        const addBtn = await waitForButton(conf.buttons.add_video, 5000);
        if (addBtn) {
            addBtn.click();
            await sleep(1500); 
        }

        // Dropdowns
        await selectDropdownOption(conf.dropdowns.type_work.label, conf.dropdowns.type_work.value);
        await selectDropdownOption(conf.dropdowns.subcategory.label, conf.dropdowns.subcategory.value);
        await selectDropdownOption(conf.dropdowns.source.label, conf.dropdowns.source.value);

        console.log("⏳ Waiting for fields...");
        await sleep(1500);

        // Inputs via Config Array
        const fillAny = async (key, val) => {
            const sels = conf.inputs[key];
            if(!sels) return;
            for(const s of sels) {
                let el = await findDeep(s);
                if(el) { await typeInField(el, val); break; }
            }
        };

        await fillAny("source_url", data.sourceUrl);
        await fillAny("video_title", data.eventName || "FloSports Event");
        
        let badInput = await findDeep(conf.inputs.infringing_url[0]) || await findDeep(conf.inputs.infringing_url[1]);
        if (badInput) {
            await typeInField(badInput, badUrl);
            console.log("   ↳ URL Filled, waiting for 'Location' dropdown...");
            await sleep(2000); 
        }

        await selectDropdownOption(conf.dropdowns.location.label, conf.dropdowns.location.value);

        const saveBtn = await waitForButton(conf.buttons.save, 3000);
        if (saveBtn) {
            saveBtn.click();
            await sleep(2500); 
        }
    }

    // Contact Info
    console.log("📝 Filling Contact Info...");
    await selectDropdownOption(conf.dropdowns.affected_party.label, conf.dropdowns.affected_party.value);
    await sleep(1500); 

    let nameInput = await findDeep(conf.inputs.claimant_name);
    if (nameInput) await typeInField(nameInput, "Flosports");
    
    // Phone via XPath in Config
    const phoneResult = document.evaluate(conf.inputs.phone, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (phoneResult.singleNodeValue) await typeInField(phoneResult.singleNodeValue, "5122702356");

    await fillDeep(conf.inputs.secondary_email, "copyright@flosports.tv");
    
    let relInput = await findDeep(conf.inputs.authority);
    if (relInput) await typeInField(relInput, "Authorized Representative");

    await selectDropdownOption(conf.dropdowns.country.label, conf.dropdowns.country.value);
    await fillDeep(conf.inputs.street, "301 Congress ave #1500");
    await fillDeep(conf.inputs.city, "Austin");
    
    let stateInput = await findDeep(conf.inputs.state);
    if (stateInput) await typeInField(stateInput, "Texas");

    await fillDeep(conf.inputs.zip, "78701");

    // Legal
    console.log("📝 Filling Legal...");
    const standardRadio = await findDeep(conf.radios.standard_timing);
    if (standardRadio) {
        standardRadio.scrollIntoView({block: "center"});
        standardRadio.click();
    }

    const preventCheck = await findDeep(conf.checkboxes.prevent_copies);
    if (preventCheck) preventCheck.click();

    for (const key of conf.checkboxes.agreements) {
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
    
    await fillDeep(conf.inputs.signature, data.fullName);
    console.log("✅ YouTube Automation Complete");
}

// ==========================================
// 5. OTHER PLATFORMS
// ==========================================
async function fillInstagram(data) {
    const conf = SELECTORS.instagram.autofill;
    await fillByName(conf.name, data.fullName);
    await fillByName(conf.email, data.email);
    
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    if(Array.isArray(conf.urls)) {
        for(const s of conf.urls) await fillBySelector(s, urlText);
    }
    
    await fillByName(conf.signature, data.fullName);
}

async function fillFacebook(data) {
    await fillInstagram(data); 
}

async function fillTwitter(data) {
    const conf = SELECTORS.twitter.autofill;
    await fillByName(conf.name, data.fullName);
    await fillByName(conf.email, data.email);
    await fillByName(conf.company, "FloSports");
    
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    await fillBySelector(conf.urls, urlText);
    await fillByName(conf.signature, data.fullName);
}

// ==========================================
// 6. HELPERS (Standard)
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
  }
}

// --- SHADOW DOM HELPERS ---

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

async function typeInField(el, value) {
    if (!el || !value) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);

    if (el.shadowRoot) {
        const inner = el.shadowRoot.querySelector('input, textarea');
        if (inner) el = inner;
    } else if (el.tagName.includes('-')) {
         const inner = el.querySelector('input, textarea');
         if (inner) el = inner;
    }

    el.focus();
    el.value = value;
    
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    el.dispatchEvent(new KeyboardEvent('keydown', { key: value[0], bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: value[0], bubbles: true, composed: true }));
    
    el.blur();
}

async function fillDeep(selector, value) {
    const el = await findDeep(selector);
    if(el) await typeInField(el, value);
}

async function selectDropdownOption(label, optionText) {
    console.log(`🔽 Selecting: ${label} -> ${optionText}`);

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
        await sleep(800); 

        const optionXpath = `
            //paper-item[contains(., '${optionText}')] | 
            //ytcp-text-menu-item[contains(., '${optionText}')] | 
            //tp-yt-paper-item[contains(., '${optionText}')]
        `;
        const optionResult = document.evaluate(optionXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const option = optionResult.singleNodeValue;

        if (option) {
            option.click();
            await sleep(1000); 
            return true;
        } else {
            document.body.click(); 
        }
    }
    return false;
}

// ==========================================
// 7. OVERLAY
// ==========================================
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
    <h3 id="flo-overlay-header" style="margin-top:0; color:#ce0e2d; cursor: move;">FloSports Helper ✥</h3>
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

  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  overlay.addEventListener('mousedown', (e) => {
      if (['BUTTON', 'INPUT', 'A'].includes(e.target.tagName)) return;

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

  document.getElementById("flo-log-btn").addEventListener("click", () => {
    const status = document.getElementById("flo-log-status");
    const btn = document.getElementById("flo-log-btn");
    const progressContainer = document.getElementById("flo-progress-container");
    const progressFill = document.getElementById("flo-progress-fill");
    
    status.innerText = "⏳ Generating PDF & Logging...";
    status.style.color = "blue";
    btn.disabled = true;
    btn.style.background = "#ccc";
    progressContainer.style.display = "block";

    let width = 0;
    const interval = setInterval(() => {
        if (width >= 90) {
            clearInterval(interval); 
        } else {
            width += (Math.random() * 5); 
            progressFill.style.width = width + "%";
        }
    }, 200);

    chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
      clearInterval(interval); 

      if (response && response.success) {
        progressFill.style.width = "100%";
        progressFill.style.backgroundColor = "#4CAF50"; 
        
        status.innerText = "✅ Logged Successfully! Closing...";
        status.style.color = "green";
        setTimeout(() => overlay.remove(), 2500);
      } else {
        progressFill.style.backgroundColor = "red";
        status.innerText = "❌ Log Failed.";
        status.style.color = "red";
        btn.disabled = false;
        btn.style.background = "#ce0e2d";
      }
    });
  });
}
