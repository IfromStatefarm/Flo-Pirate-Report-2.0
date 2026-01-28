// content_autofill.js

// 1. DEFAULT CONFIGURATION (Fallback if Google Drive fails)
if (typeof AUTOFILL_CONFIG === 'undefined') {
  var AUTOFILL_CONFIG = {
    tiktok: {
      autofill: {
        // These can be overridden by your events_config.json
        wizard_terms: ["I am the copyright owner", "Authorized representative", "Statement", "Report an infringement"],
        email_candidates: ['input[type="email"]', "#email", "#contact_email", "[name='email']"],
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
          source_url: ["#videoLink", '[aria-label="My video URL"]'],
          video_title: ["#videoTitle", '[aria-label="Title"]'],
          infringing_url: ["#targetVideo", '[aria-label="YouTube URL of video to be removed"]'],
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
          subcategory: { label: "Subcategory", value: "Internet video" },
          source: { label: "Source", value: "From outside of YouTube" },
          location: { label: "Location of infringing content", value: "Entire video" },
          affected_party: { label: "Affected party", value: "My company, organization, or client" },
          country: { label: "country-select", value: "United States" }
        }
      }
    },
    instagram: { autofill: { name: "your_name", email: "email", urls: ['textarea[name="content_urls"]'], signature: "electronic_signature" } },
    twitter: { autofill: { name: "reporter_name", email: "email", company: "company_name", urls: 'textarea[name="source_url"]', signature: "signature" } }
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- LOAD REMOTE CONFIG ---
(async function initConfig() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success && response.config && response.config.platform_selectors) {
      console.log("✅ Remote Config Loaded (Background)");
      const remote = response.config.platform_selectors;
      
      // Deep merge helpers for key platforms
      if (remote.tiktok?.autofill) {
          AUTOFILL_CONFIG.tiktok.autofill = { ...AUTOFILL_CONFIG.tiktok.autofill, ...remote.tiktok.autofill };
      }
      if (remote.youtube?.autofill) {
          AUTOFILL_CONFIG.youtube.autofill = { ...AUTOFILL_CONFIG.youtube.autofill, ...remote.youtube.autofill };
      }
      if (remote.instagram?.autofill) {
          AUTOFILL_CONFIG.instagram.autofill = { ...AUTOFILL_CONFIG.instagram.autofill, ...remote.instagram.autofill };
      }
      if (remote.twitter?.autofill) {
          AUTOFILL_CONFIG.twitter.autofill = { ...AUTOFILL_CONFIG.twitter.autofill, ...remote.twitter.autofill };
      }
    }
  } catch(e) { console.warn("Using default local strategies.", e); }
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

    // Wait for DOM to be reasonably ready
    if (document.readyState === 'loading') {
        await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
    const cart = res.piracy_cart || [];
    const info = res.reporterInfo;

    if (cart.length === 0 || !info) return;

    const host = window.location.hostname;
    const platform = cart[0].platform || "TikTok";

    // Basic Host Checks
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

    console.log("🚀 Starting Flo Autofill for:", platform);
    await sleep(800); 
    routeAutofill(data);
})();

async function routeAutofill(data) {
    const host = window.location.hostname;
    if (host.includes('tiktok')) await fillTikTok(data);
    else if (host.includes('youtube')) await fillYouTube(data);
    else if (host.includes('instagram')) await fillInstagram(data);
    else if (host.includes('facebook')) await fillFacebook(data);
    else if (host.includes('twitter') || host.includes('x.com')) await fillTwitter(data);
    
    createUploadOverlay(data);
}

// ==========================================
// 3. TIKTOK STRATEGY (CONFIG-DRIVEN WIZARD)
// ==========================================
async function fillTikTok(data) {
  const conf = AUTOFILL_CONFIG.tiktok.autofill;
  const defaults = {
      company: "FloSports",
      phone: "5122702356",
      address: "301 Congress ave #1500 Austin Tx 78701",
      email: data.email || "copyright@flosports.tv"
  };

  console.log("🎵 Running TikTok Strategy...");

  // --- STEP 1: HANDLE DECLARATION (WIZARD STEP) ---
  const declarationTerms = conf.wizard_terms || ["I am the copyright owner", "Authorized representative", "Statement"];
  
  // Try to click terms multiple times in case of loading lag
  let wizardSuccess = false;
  for(let i=0; i<3; i++) {
      if(wizardSuccess) break;
      for (const term of declarationTerms) {
          const clicked = await clickByText(term);
          if (clicked) {
              console.log(`✅ Selected declaration: "${term}"`);
              wizardSuccess = true;
              await sleep(1000); // Give UI time to expand
              break;
          }
      }
      if(!wizardSuccess) await sleep(500);
  }

  // --- STEP 2: HANDLE NEXT BUTTON ---
  const btnText = conf.next_button_text || "Next";
  const nextBtn = await waitForButton(btnText, 2000);
  if (nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null) {
      console.log("➡️ Clicking Next...");
      nextBtn.scrollIntoView({block: "center"});
      nextBtn.click();
      await sleep(1000);
  }

  // --- STEP 3: WAIT FOR MAIN FORM ---
  console.log("⏳ Waiting for form fields...");
  // Use a very generic selector to detect form load
  const formReady = await waitForSelector('input, textarea', 5000);
  if (!formReady) console.warn("⚠️ Main form fields not detected immediately.");

  // --- STEP 4: FILL FIELDS ---
  
  // A. EMAIL
  console.log("📧 Filling Email...");
  const emailSels = conf.email_candidates || ['input[type="email"]', "#email", "#contact_email"];
  let emailFilled = false;
  for (const sel of emailSels) {
      // fillBySelector now handles errors gracefully
      if (await fillBySelector(sel, defaults.email)) {
          emailFilled = true;
          break;
      }
  }
  if (!emailFilled && conf.email_labels) {
      for (const label of conf.email_labels) await fillInputByLabel(label, defaults.email);
  }

  // B. OTHER FIELDS
  const fillFromConfig = async (key, val) => {
      const selectors = conf.inputs[key] || [];
      for (const s of selectors) {
          // If selector looks like a name/id, we check specific logic, otherwise treat as CSS
          // The updated fillBySelector handles the logic internally now
          if (await fillBySelector(s, val)) return;
          
          // If fillBySelector failed (meaning selector wasn't found or was skipped),
          // Try assuming it's a label text if it doesn't look like code
          if (!/[#\[.]/.test(s)) {
              if (await fillInputByLabel(s, val)) return;
          }
      }
  };

  await fillFromConfig("name", data.fullName);
  await fillFromConfig("company", defaults.company);
  await fillFromConfig("phone", defaults.phone);
  await fillFromConfig("address", defaults.address);

  // C. URLS
  const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
  let urlsFilled = false;
  
  if (conf.inputs.urls) {
      for(const s of conf.inputs.urls) {
          if (s.includes("tiktok.com")) {
             if (await fillByPlaceholder(s, urlText)) urlsFilled = true;
          } else {
             // Try standard fill first
             if (await fillBySelector(s, urlText)) urlsFilled = true;
             // Try label fallback
             else if (!/[#\[.]/.test(s)) {
                 if (await fillInputByLabel(s, urlText)) urlsFilled = true;
             }
          }
          if (urlsFilled) break;
      }
  }

  // D. CHECKBOXES
  console.log("☑️ Clicking Checkboxes...");
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => { 
      if (!cb.checked && cb.offsetParent !== null) cb.click(); 
  });
  
  const agreementTerms = ["I declare", "good faith", "perjury", "accurate"];
  for (const term of agreementTerms) {
      await clickByText(term); 
  }

  console.log("✅ TikTok Automation Finished.");
}

// ==========================================
// 4. YOUTUBE STRATEGY
// ==========================================
async function fillYouTube(data) {
    const conf = AUTOFILL_CONFIG.youtube.autofill; 
    console.log("📝 Running YouTube Strategy...");

    async function waitAndClick(textOrSel, time=3000) {
       const btn = await waitForButton(textOrSel, time);
       if (btn) { btn.click(); return true; }
       return false;
    }

    const infringingUrls = data.urls || [];
    
    // 1. Add Videos
    for (const [index, badUrl] of infringingUrls.entries()) {
        const addBtnText = conf.buttons?.add_video || "Add a video";
        await waitAndClick(addBtnText, 5000);
        await sleep(1000);

        if (conf.dropdowns) {
            await selectDropdownOption(conf.dropdowns.type_work.label, conf.dropdowns.type_work.value);
            await selectDropdownOption(conf.dropdowns.subcategory.label, conf.dropdowns.subcategory.value);
            await selectDropdownOption(conf.dropdowns.source.label, conf.dropdowns.source.value);
        }

        await fillDeep(conf.inputs.source_url?.[0], data.sourceUrl);
        await fillDeep(conf.inputs.video_title?.[0], data.eventName || "FloSports Event");
        
        const badInputSel = conf.inputs.infringing_url?.[0] || conf.inputs.infringing_url?.[1];
        await fillDeep(badInputSel, badUrl);
        
        await selectDropdownOption(conf.dropdowns.location.label, conf.dropdowns.location.value);
        await waitAndClick(conf.buttons?.save || "#save-button", 3000);
        await sleep(2000);
    }

    // 2. Personal Info
    await selectDropdownOption(conf.dropdowns.affected_party.label, conf.dropdowns.affected_party.value);
    await fillDeep(conf.inputs.claimant_name, "Flosports");
    
    const phoneEl = await findElementByText("Phone", "ytcp-form-textarea"); 
    if (phoneEl) await typeInField(phoneEl, "5122702356");

    await fillDeep(conf.inputs.secondary_email, "copyright@flosports.tv");
    await fillDeep(conf.inputs.authority, "Authorized Representative");
    await selectDropdownOption(conf.dropdowns.country.label, conf.dropdowns.country.value);
    await fillDeep(conf.inputs.street, "301 Congress ave #1500");
    await fillDeep(conf.inputs.city, "Austin");
    await fillDeep(conf.inputs.state, "Texas");
    await fillDeep(conf.inputs.zip, "78701");

    // 3. Agreements
    const stdRadio = await findDeep('ytcp-radio-button[name="removal-timing-option"][aria-label*="Standard"]');
    if (stdRadio) stdRadio.click();

    const prevent = await findDeep('ytcp-checkbox-lit[aria-label*="Prevent future copies"]');
    if (prevent) prevent.click();

    const agreements = ["good faith", "accurate", "abuse"];
    for (const txt of agreements) {
        const cb = await findElementByText(txt, "ytcp-checkbox-lit");
        if (cb && cb.getAttribute('aria-checked') === 'false') cb.click();
    }
    
    await fillDeep(conf.inputs.signature, data.fullName);
}

// ... (Instagram/Twitter logic preserved) ...
async function fillInstagram(data) {
    const conf = AUTOFILL_CONFIG.instagram.autofill;
    await fillByName(conf.name, data.fullName);
    await fillByName(conf.email, data.email);
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    for(const sel of conf.urls) await fillBySelector(sel, urlText);
    await fillByName(conf.signature, data.fullName);
}
async function fillFacebook(data) { await fillInstagram(data); }
async function fillTwitter(data) {
    const conf = AUTOFILL_CONFIG.twitter.autofill;
    await fillByName(conf.name, data.fullName);
    await fillByName(conf.email, data.email);
    await fillByName(conf.company, "FloSports");
    const urlText = Array.isArray(data.urls) ? data.urls.join('\n') : data.urls;
    await fillBySelector(conf.urls, urlText);
    await fillByName(conf.signature, data.fullName);
}

// ==========================================
// 6. ROBUST HELPERS
// ==========================================

async function waitForSelector(selector, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            // Only try if selector looks valid to avoid syntax error loops
            if (document.querySelector(selector)) return true;
        } catch (e) {
            // Ignore syntax errors in selector during wait
        }
        await sleep(200);
    }
    return false;
}

async function waitForButton(textOrSel, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        let el;
        // Check if it looks like a CSS selector
        if (/[.#\[]/.test(textOrSel)) {
            try { el = document.querySelector(textOrSel); } catch(e){}
        } else {
            const xpath = `//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${textOrSel.toLowerCase()}')]`;
            try {
                const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = res.singleNodeValue;
            } catch(e){}
        }
        if (el) return el;
        await sleep(200);
    }
    return null;
}

async function fillBySelector(selector, value) {
    if (!value) return false;
    
    // HEURISTIC: Is this already a complex CSS selector?
    // Checks for space, dot, hash, brackets, colon, or greater-than
    const isComplexSelector = /[ .#\[:>]/.test(selector);

    if (!isComplexSelector) {
        // It's likely just a name "email" or ID "email-field"
        selector = `[name="${selector}"], #${selector}`;
    }
    
    try {
        const el = document.querySelector(selector);
        if (el) {
            await typeInField(el, value);
            return true;
        }
    } catch (e) {
        // Log the error but DO NOT crash the script
        console.warn(`PIRATE AI: Skipping selector "${selector}" - ${e.message}`);
    }
    return false;
}

async function fillByName(nameAttr, value) {
    // Manually constructing this is safe because we know the structure
    return fillBySelector(`[name="${nameAttr}"]`, value);
}

async function fillByPlaceholder(partialPlaceholder, value) {
    if (!value) return false;
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    const target = inputs.find(el => el.placeholder && el.placeholder.toLowerCase().includes(partialPlaceholder.toLowerCase()));
    if (target) {
        await typeInField(target, value);
        return true;
    }
    return false;
}

async function fillInputByLabel(labelText, value) {
  if (!value) return false;
  const lowerLabel = labelText.toLowerCase();
  const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lowerLabel}")]`;
  try {
      const snapshot = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      
      let targetInput = null;
      for (let i = 0; i < snapshot.snapshotLength; i++) {
          const node = snapshot.snapshotItem(i);
          if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;

          const forId = node.getAttribute('for');
          if (forId) {
              targetInput = document.getElementById(forId);
              if (targetInput) break;
          }

          let parent = node;
          for(let k=0; k<3; k++) { 
              if (!parent) break;
              const input = parent.querySelector('input:not([type="hidden"]), textarea');
              if (input) {
                  targetInput = input;
                  break;
              }
              parent = parent.parentElement;
          }
          if (targetInput) break;
      }
      
      if (targetInput) {
          await typeInField(targetInput, value);
          return true;
      }
  } catch(e) { console.warn("Label xpath failed", e); }
  return false;
}

async function clickByText(text) {
    const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
    try {
        const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el = res.singleNodeValue;
        if (el) {
            el.scrollIntoView({block: "center"});
            el.click();
            return true;
        }
    } catch(e){}
    return false;
}

async function typeInField(el, value) {
    if (!el || !value) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.blur();
}

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

async function fillDeep(selector, value) {
    const el = await findDeep(selector);
    if (el) await typeInField(el, value);
}

async function findElementByText(text, tagName = "*", root = document.body) {
    const xpath = `//${tagName}[contains(text(), '${text}')]`;
    if (root === document.body || root.nodeType === Node.DOCUMENT_NODE) {
         const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
         if (res.singleNodeValue) return res.singleNodeValue;
    }
    const elements = root.querySelectorAll('*');
    for (const el of elements) {
        if (el.shadowRoot) {
            if (el.shadowRoot.textContent.includes(text)) {
                 const candidates = el.shadowRoot.querySelectorAll(tagName);
                 for (const cand of candidates) {
                     if (cand.textContent.includes(text)) return cand;
                 }
            }
            const found = await findElementByText(text, tagName, el.shadowRoot);
            if (found) return found;
        }
    }
    return null;
}

async function selectDropdownOption(label, optionText) {
    const trigger = await findElementByText(label, "ytcp-dropdown-trigger");
    if (trigger) {
        trigger.click();
        await sleep(500);
        const option = await findElementByText(optionText, "paper-item");
        if (option) option.click();
        else document.body.click(); 
    }
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
      <strong>Status:</strong> Form Attempted.<br>
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
      isDragging = true; startX = e.clientX; startY = e.clientY;
      const rect = overlay.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
      overlay.style.right = 'auto'; overlay.style.left = `${initialLeft}px`; overlay.style.top = `${initialTop}px`;
      e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX; const dy = e.clientY - startY;
      overlay.style.left = `${initialLeft + dx}px`; overlay.style.top = `${initialTop + dy}px`;
  });

  document.addEventListener('mouseup', () => { isDragging = false; });

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
        if (width >= 90) { clearInterval(interval); } else { width += (Math.random() * 5); progressFill.style.width = width + "%"; }
    }, 200);

    chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
      clearInterval(interval); 
      if (response && response.success) {
        progressFill.style.width = "100%"; progressFill.style.backgroundColor = "#4CAF50"; 
        status.innerText = "✅ Logged Successfully! Closing..."; status.style.color = "green";
        setTimeout(() => overlay.remove(), 2500);
      } else {
        progressFill.style.backgroundColor = "red"; status.innerText = "❌ Log Failed."; status.style.color = "red";
        btn.disabled = false; btn.style.background = "#ce0e2d";
      }
    });
  });
