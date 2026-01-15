chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === "autofillForm") {
      initAutofill(request.data)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));

      return true; // IMPORTANT: keep message channel open for async sendResponse
    }
  } catch (err) {
    sendResponse({ success: false, error: String(err?.message || err) });
  }
});

async function initAutofill(data) {
  console.log("Starting Autofill with data:", data);

  // Helper: Find a text input based on the label text above it
  const fillFieldByLabel = (labelText, value) => {
    if (!value) return;

    // 1. Find all labels or field titles on the page
    const allLabels = Array.from(document.querySelectorAll('label, .field-title, .form-label, .tux-form-label'));
    
    // 2. Find the one containing our text (case-insensitive)
    const targetLabel = allLabels.find(el => el.innerText.trim().toLowerCase().includes(labelText.toLowerCase()));

    if (targetLabel) {
      // 3. Look for the input in the same container, or by 'for' attribute
      let input = null;
      
      // Try 'for' attribute match
      const forId = targetLabel.getAttribute('for');
      if (forId) {
        input = document.getElementById(forId);
      }

      // If no ID match, look inside the parent container
      if (!input) {
        // Go up 3 levels to find the "row" container, then search down for an input
        const container = targetLabel.closest('div.form-item, div.tux-row, div') || targetLabel.parentElement;
        input = container.querySelector('input:not([type="hidden"]), textarea, select');
      }

      // 4. If found, type the value
      if (input) {
        console.log(`✅ Found field for "${labelText}", filling: ${value}`);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      } else {
        console.warn(`⚠️ Found label "${labelText}" but could not find the input box next to it.`);
      }
    } else {
      console.warn(`❌ Could not find any label on the page containing text: "${labelText}"`);
    }
  };

  // --- MAPPING SECTION: Edit this if TikTok changes text ---
  
  // 1. Personal / Company Information
  // Look at the "Text Defaults" from your events_config.json
  if (data.defaults) {
     fillFieldByLabel('Copyright owner name', data.defaults.company); // Try "Copyright owner" or "Name of copyright owner"
     fillFieldByLabel('Phone', data.defaults.phone);
     fillFieldByLabel('Address', data.defaults.address);
     // Email is usually pre-filled by the link, but we try anyway
     fillFieldByLabel('Email', data.defaults.email);
  }

  // 2. The URL List
  // TikTok usually labels this "Infringing material" or "Content URL"
  fillFieldByLabel('Infringing material', data.urls.join('\n'));

  // 3. Signature
  // TikTok usually labels this "Signature" or "Full Name"
  fillFieldByLabel('Signature', data.reporterName);

  // 4. Checkboxes (Click all "I agree" boxes)
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
      if (!cb.checked) cb.click();
  });

  // --- GUIDED UPLOAD OVERLAY ---
  createUploadOverlay(data);
}

function createUploadOverlay(data) {
  // Avoid duplicates if script runs twice
  const existing = document.getElementById("flo-upload-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "flo-upload-overlay";
  overlay.innerHTML = `
    <style>
      #flo-upload-overlay {
        position: fixed; top: 20px; right: 20px; width: 350px;
        background: white; border: 2px solid #fe2c55; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 999999; padding: 20px; font-family: sans-serif; border-radius: 8px;
      }
      .flo-step { margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
      .flo-btn { background: #fe2c55; color: white; border: none; padding: 6px 10px; cursor: pointer; border-radius: 4px; }
    </style>
    <h3>FloSports Helper</h3>

    <div class="flo-step">
      <strong>Step 1: Rights Evidence</strong><br>
      Filename: <code style="background:#eee">${data?.rightsPdfName || ""}</code><br>
      <small>Select "Evidence of rights..." in the form, then upload this file.</small>
    </div>

    <div class="flo-step">
      <strong>Step 2: Additional Material</strong><br>
      Filename: <code style="background:#eee">${data?.pdfFileName || ""}</code><br>
      <small>Select "Additional materials" in the form, then upload this file.</small>
    </div>

    <div class="flo-step">
      <button class="flo-btn" id="flo-log-btn">Confirm Submission</button>
      <div id="flo-log-status" style="margin-top:6px; font-size:12px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("flo-log-btn").addEventListener("click", () => {
    const status = document.getElementById("flo-log-status");
    status.innerText = "Logging to Sheets...";

    chrome.runtime.sendMessage({ action: "logToSheet", data }, (response) => {
      if (chrome.runtime.lastError) {
        status.innerText = "Log Failed: " + chrome.runtime.lastError.message;
        status.style.color = "red";
        return;
      }

      if (response?.success) {
        status.innerText = "Log Success! You can close this tab.";
        status.style.color = "green";
      } else {
        status.innerText = "Log Failed: " + (response?.error || "Unknown error");
        status.style.color = "red";
      }
    });
  });
}

