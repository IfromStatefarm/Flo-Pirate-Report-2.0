// sidepanel.js

let configData = null;
let eventLookup = {}; 

document.addEventListener('DOMContentLoaded', async () => {
  console.log("🚀 Sidepanel Loaded");

  // --- GET ELEMENTS ---
  const startBtn = document.getElementById('startBtn'); 
  const loadingEl = document.getElementById('loading');
  const eventInput = document.getElementById('eventInput');
  const verticalSelect = document.getElementById('verticalSelect');
  const sourceDisplay = document.getElementById('sourceUrlDisplay'); 
  const reporterInput = document.getElementById('reporterName');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  // --- ENSURE DATALIST EXISTS (For Dropdown Behavior) ---
  let dataList = document.getElementById('eventList');
  if (!dataList) {
      dataList = document.createElement('datalist');
      dataList.id = 'eventList';
      document.body.appendChild(dataList);
  }
  // Force the input to use this list
  if (eventInput) {
      eventInput.setAttribute("list", "eventList");
      eventInput.setAttribute("autocomplete", "off"); // Turn off browser history to show our list instead
  }

  // ==========================================
  // 1. LISTEN FOR MESSAGES
  // ==========================================
  chrome.runtime.onMessage.addListener((msg) => {
    // A. Found URL
    if (msg.action === 'urlFound') {
      if(sourceDisplay) {
        sourceDisplay.value = msg.url;
        sourceDisplay.style.background = "#e6fffa"; 
        sourceDisplay.placeholder = "";
      }
      if(copyUrlBtn) copyUrlBtn.innerText = "URL Found!";
    }
    
    // B. Search Failed
    if (msg.action === 'botSearchFailed') {
      if(sourceDisplay) {
        sourceDisplay.value = "";
        sourceDisplay.placeholder = "Bot failed. Search manually.";
        sourceDisplay.style.background = "#ffe6e6"; 
      }
    }

    // C. Success Sound
    if (msg.action === 'playSuccessSound') {
       const audio = new Audio('jingle.mp3');
       audio.play().catch(e => console.log("Audio play failed", e));
       
       if(sourceDisplay) sourceDisplay.value = "";
       if(eventInput) eventInput.value = "";
    }
  });

  // ==========================================
  // 2. CONFIG & SETUP
  // ==========================================
  chrome.storage.local.get(['last_reporter', 'last_vertical', 'last_event'], (res) => {
    if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;
    window.lastVertical = res.last_vertical;
    window.lastEvent = res.last_event;
  });

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (response && response.success) {
      configData = response.config;
      populateVerticals();
      if (loadingEl) loadingEl.style.display = 'none';
      if (startBtn) startBtn.disabled = false;
    } else {
      if (loadingEl) loadingEl.innerText = "Error: " + (response ? response.error : "Unknown");
    }
  } catch (e) {
    if (loadingEl) loadingEl.innerText = "Connection Failed.";
  }

  function populateVerticals() {
    if (!verticalSelect) return;
    verticalSelect.innerHTML = '<option value="">Select Vertical...</option>';
    if (configData && configData.verticals) {
      configData.verticals.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.innerText = v.name;
        verticalSelect.appendChild(opt);
      });
    }
    if (window.lastVertical) {
      verticalSelect.value = window.lastVertical;
      populateEvents(window.lastVertical); 
    }
  }

  if (verticalSelect) {
    verticalSelect.addEventListener('change', () => populateEvents(verticalSelect.value));
  }

  // Global variable for the Search URL (from Excel Cell B1)
let verticalSearchBaseUrl = ""; 

// ==========================================
// 2. POPULATE EVENTS (Reads Row 3+ and Cell B1)
// ==========================================
async function populateEvents(verticalName) {
    if (!eventInput || !sourceDisplay) return;

    // Reset UI
    if (dataList) dataList.innerHTML = ''; 
    eventInput.value = '';
    eventInput.placeholder = "Loading...";
    verticalSearchBaseUrl = ""; // Reset
    eventLookup = {};

    try {
      const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical: verticalName });
      
      if (response && response.success && response.data) {
         eventInput.placeholder = "Type Event Name...";

         // 1. CAPTURE CELL B1 (The Search URL)
         // Expecting background script to parse Cell B1 into 'searchUrl'
         if (response.data.searchUrl) {
             verticalSearchBaseUrl = response.data.searchUrl;
         }

         // 2. CAPTURE DATA (Starting Row 3)
         if (response.data.eventMap) {
             const sortedNames = Object.values(response.data.eventMap)
                 .map(item => item.name).sort();

             sortedNames.forEach(name => {
                 const item = response.data.eventMap[name.toLowerCase()];
                 // Store in local lookup
                 eventLookup[name.toLowerCase()] = item.url; 
                 // Add to Dropdown
                 const opt = document.createElement('option');
                 opt.value = name; 
                 dataList.appendChild(opt);
             });
         }
      }
    } catch (e) { console.error(e); }
}

// ==========================================
// 3. SEARCH LOGIC (Uses B1 URL for Fallback)
// ==========================================
if (eventInput) {
    // A. Check for Match as you type (Standard Dropdown)
    eventInput.addEventListener('input', (e) => {
       const key = e.target.value.trim().toLowerCase();
       if (eventLookup[key]) {
          sourceDisplay.value = eventLookup[key]; // Auto-fill URL
          sourceDisplay.style.background = "#fff";
       }
    });

    // B. Handle "Enter" -> Fallback Search
    eventInput.addEventListener('change', (e) => {
       const val = e.target.value.trim();
       const key = val.toLowerCase();
       
       // If found in lookup, do nothing (URL is already filled)
       if (eventLookup[key]) return; 

       // If NOT found, Open the Search Tab
       if (val.length > 0) {
           sourceDisplay.value = ""; 
           sourceDisplay.placeholder = "Opened Search... Please Click 'Use Flosports Event' when found.";
           sourceDisplay.style.background = "#fffde7"; // Yellow warning

           // Construct Search URL using the B1 variable
           let targetUrl = "";
           if (verticalSearchBaseUrl) {
               // Use Excel B1 URL + User Query
               targetUrl = verticalSearchBaseUrl + encodeURIComponent(val);
           } else {
               // Generic Fallback
               targetUrl = "https://www.google.com/search?q=" + encodeURIComponent(verticalSelect.value + " " + val);
           }

           chrome.tabs.create({ url: targetUrl });
       }
    });
}

  /// ==========================================
  // 4. START REPORT BUTTON (MULTI-PLATFORM)
  // ==========================================
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
       const sourceUrl = sourceDisplay ? sourceDisplay.value : ""; 
       const evt = eventInput ? eventInput.value : "";
       const vert = verticalSelect ? verticalSelect.value : "";
       const rep = reporterInput ? reporterInput.value : "";

       if (!sourceUrl || !evt || !rep) {
          alert("Please ensure you have a Reporter Name, Source URL, and Event selected.");
          return;
       }
       
       await chrome.storage.local.set({ last_reporter: rep });

       const storage = await chrome.storage.local.get('piracy_cart');
       const cart = storage.piracy_cart || [];

       if (cart.length === 0) {
           alert("Your cart is empty! Please add videos before reporting.");
           return;
       }

       // --- NEW: PLATFORM DETECTION ---
       // We detect the platform from the first item in the cart
       const platform = cart[0].platform || "TikTok"; 
       const infringingUrls = cart.map(item => item.url); 

       // A. Save Source URL to the correct Platform Column in the Sheet
       chrome.runtime.sendMessage({
          action: 'saveEventUrl',
          data: { 
              vertical: vert, 
              eventName: evt, 
              url: sourceUrl,
              platform: platform // Sends 'YouTube', 'Instagram', etc. to update the right column
          }
       });
       
       navigator.clipboard.writeText(sourceUrl); 

       // --- NEW: ROUTE TO CORRECT FORM URL ---
       let targetUrl = "";
       switch (platform) {
           case "TikTok": 
               targetUrl = "https://ipr.tiktokforbusiness.com/legal/report/Copyright?issueType=1&affected=4&behalf=2&sole=2"; 
               break;
           case "YouTube": 
               targetUrl = "https://www.youtube.com/copyright_complaint_form"; 
               break;
           case "Instagram": 
               targetUrl = "https://help.instagram.com/contact/552695131608132"; 
               break;
           case "Twitter":
           case "X":
               targetUrl = "https://help.x.com/en/forms/IP/copyright";
               break;
           default:
               alert(`Platform ${platform} not yet fully automated. Opening default form.`);
               targetUrl = sourceUrl; // Fallback
       }
       
       // B. Open the Tab
       const tabs = await chrome.tabs.query({ url: "*://" + new URL(targetUrl).hostname + "/*" });
       let tabId;

       if (tabs.length > 0) {
          tabId = tabs[0].id;
          await chrome.tabs.update(tabId, { active: true, url: targetUrl });
       } else {
          const newTab = await chrome.tabs.create({ url: targetUrl });
          tabId = newTab.id;
       }

       // C. SEND COMMAND (WITH RETRY)
       startBtn.innerText = "Connecting...";
       startBtn.disabled = true;

       const payload = {
          action: "startFullAutomation",
          data: { 
             email: "copyright@flosports.tv",
             fullName: rep, 
             urls: infringingUrls, 
             sourceUrl: sourceUrl, 
             eventName: evt,
             vertical: vert,
             platform: platform // Included so the filler knows which strategy to use
          }
       };

       let attempts = 0;
       const maxAttempts = 15; 

       const trySending = () => {
           chrome.tabs.sendMessage(tabId, payload, (response) => {
               if (chrome.runtime.lastError) {
                   attempts++;
                   console.log(`Connection attempt ${attempts} failed. Retrying...`);
                   if (attempts < maxAttempts) {
                       setTimeout(trySending, 1000);
                   } else {
                       alert(`Error: The ${platform} page isn't ready. Please wait a moment and click Start Report again.`);
                       startBtn.innerText = "Start Report";
                       startBtn.disabled = false;
                   }
               } else {
                   console.log("✅ Connected to Page!");
                   startBtn.innerText = "Running...";
                   setTimeout(() => {
                       startBtn.innerText = "Start Report";
                       startBtn.disabled = false;
                   }, 2000);
               }
           });
       };

       setTimeout(trySending, 2000); 
    }); 
  }
  
  // --- 5. Copy Text ---
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
       const txt = `Content stolen from ${eventInput ? eventInput.value : ""}. Original source: ${sourceDisplay ? sourceDisplay.value : ""}`;
       navigator.clipboard.writeText(txt);
       copyUrlBtn.innerText = "Copied!";
       setTimeout(() => copyUrlBtn.innerText = 'Copy "Stolen From" Text', 2000);
    });
  }
});
// ==========================================
// 6. SOURCE GRABBER + "AUTO-ADD TO EXCEL"
// ==========================================
const grabBtn = document.getElementById('btn-grab-flo');

if (grabBtn) {
  grabBtn.addEventListener('click', async () => {
    // 1. Get the Active Tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) return;

    // 2. Define the Standard Text (to restore later)
    const originalText = "Use Flosports Event and url";

    // 3. Visual Feedback
    grabBtn.innerText = "Scraping & Saving...";
    grabBtn.disabled = true;
    
    try {
      // 4. Inject Script to Grab Data (Title + URL)
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            let title = document.title; // Default fallback
            
            // 1. Try FloSports Specific Tag
            const floHeader = document.querySelector('h1[data-test="header-title-desktop"]');
            if (floHeader) {
                title = floHeader.innerText.trim();
            } 
            // 2. Try YouTube Specific Tag
            else if (window.location.hostname.includes('youtube.com')) {
                const ytHeader = document.querySelector('h1.style-scope.ytd-watch-metadata'); 
                if (ytHeader) title = ytHeader.innerText.trim();
            }
            // 3. Try TikTok Specific Tag
            else if (window.location.hostname.includes('tiktok.com')) {
                const tiktokDesc = document.querySelector('div[data-e2e="browse-video-desc"]');
                if (tiktokDesc) title = tiktokDesc.innerText.trim();
            }

            return {
              title: title,
              url: window.location.href
            };
        }
      });

      // 5. Process Result
      if (result && result[0] && result[0].result) {
        const data = result[0].result;
        const currentVertical = document.getElementById('verticalSelect').value;
        
        // 5a. Fill Event Name Input
        const evInput = document.getElementById('eventInput');
        if (evInput) {
          evInput.value = data.title;
          evInput.dispatchEvent(new Event('input')); 
        }
        
        // 5b. Fill Source URL Input
        const srcDisplay = document.getElementById('sourceUrlDisplay');
        if (srcDisplay) {
          srcDisplay.value = data.url;
          srcDisplay.style.backgroundColor = "#e6fffa"; 
        }
        
        // --- 5.1 NEW: THE "LEARNING" STEP ---
        // Save this new event to the Excel sheet so it is found automatically next time.
        if (currentVertical && data.title && data.url) {
            console.log("Saving new event to sheet:", data.title);
            
            // A. Update Local Memory immediately
            if (typeof eventLookup !== 'undefined') {
                eventLookup[data.title.toLowerCase()] = data.url;
            }

            // B. Send to Background to write to Google Sheet
            chrome.runtime.sendMessage({
                action: 'appendEventToSheet', 
                data: {
                    vertical: currentVertical,
                    eventName: data.title,
                    eventUrl: data.url
                }
            });
        }
        
        // 6. Success Message
        grabBtn.innerText = "Captured & Saved!"; 
      }
    } catch (err) {
      console.error("Failed to scrape:", err);
      grabBtn.innerText = "Error - Try Manual Copy";
    } finally {
      // Restore Button after 2 seconds
      setTimeout(() => { 
          grabBtn.innerText = originalText; 
          grabBtn.disabled = false;
      }, 2000);
    }
  });
}