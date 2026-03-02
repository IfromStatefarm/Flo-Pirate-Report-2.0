import { getUserEmail } from './utils/auth.js';

let isCrawling = false;
let consecutiveFailures = 0;
let crawlQueue = [];
let configData = null;
let currentData = null; // Global storage for active report data
const ALLOWED_EMAIL = "social@flosports.tv";

document.addEventListener('DOMContentLoaded', async () => {
    // --- UI ELEMENTS ---
    const mainView = document.getElementById('mainView');
    const wizardView = document.getElementById('wizardView');
    const loadingEl = document.getElementById('loading');
    const verticalSelect = document.getElementById('verticalSelect');
    const eventInput = document.getElementById('eventInput');
    const eventList = document.getElementById('eventList');
    const startBtn = document.getElementById('startBtn');
    const grabBtn = document.getElementById('btn-grab-flo');
    const sourceDisplay = document.getElementById('sourceUrlDisplay');
    const closerBtn = document.getElementById('testCloserBtn');
    const crawlBtn = document.getElementById('autoCrawlBtn');
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    const searchEventBtn = document.getElementById('searchEventBtn');
    const reporterInput = document.getElementById('reporterName');
    const crawlStatusEl = document.getElementById('crawlStatus');
    const startRowInput = document.getElementById('startRowInput');
    const closerStatusEl = document.getElementById('closerStatus');

    // Wizard Elements
    const wizStep1 = document.getElementById('wiz-step1');
    const wizStep2 = document.getElementById('wiz-step2');
    const wizStep3 = document.getElementById('wiz-step3');
    const wizLogBtn = document.getElementById('wiz-log-btn');
    const logSection = document.getElementById('logSection');
    const exitWizardBtn = document.getElementById('exitWizard');

    // Create Stop Button for Closer if not present
    let stopCloserBtn = document.getElementById('stopCloserBtn');
    if (!stopCloserBtn && closerBtn) {
        stopCloserBtn = document.createElement('button');
        stopCloserBtn.id = 'stopCloserBtn';
        stopCloserBtn.className = 'btn';
        stopCloserBtn.style.backgroundColor = '#e74c3c';
        stopCloserBtn.style.marginTop = '5px';
        stopCloserBtn.style.fontSize = '11px';
        stopCloserBtn.style.padding = '8px';
        stopCloserBtn.innerText = 'Stop Scanner';
        stopCloserBtn.style.display = 'none';
        if (closerBtn.parentNode && closerBtn.parentNode.parentNode) {
            closerBtn.parentNode.parentNode.insertBefore(stopCloserBtn, closerStatusEl);
        }
    }

    // ==========================================
    // 1. WIZARD NAVIGATION LOGIC
    // ==========================================

    const checkMode = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && (tab.url.includes('tiktok.com/legal/report') || tab.url.includes('copyright_complaint_form'))) {
            switchToWizard();
        } else {
            switchToMain();
        }
    };

    const switchToWizard = async () => {
        const res = await chrome.storage.local.get(['reporterInfo', 'piracy_cart']);
        if (res.reporterInfo && res.piracy_cart && res.piracy_cart.length > 0) {
            currentData = {
                fullName: res.reporterInfo.name,
                email: res.reporterInfo.email,
                urls: res.piracy_cart.map(c => c.url),
                eventName: res.reporterInfo.eventName,
                vertical: res.reporterInfo.vertical,
                sourceUrl: res.reporterInfo.sourceUrl
            };
            if (mainView) mainView.style.display = 'none';
            if (wizardView) wizardView.style.display = 'block';
        } else {
            switchToMain();
        }
    };

    const switchToMain = () => {
        if (mainView) mainView.style.display = 'block';
        if (wizardView) wizardView.style.display = 'none';
        // Reset Wizard buttons
        [wizStep1, wizStep2, wizStep3].forEach(btn => {
            if (btn) {
                btn.classList.remove('done');
                btn.disabled = false;
            }
        });
        if (wizStep1) wizStep1.classList.add('active');
        if (logSection) logSection.style.display = 'none';
    };

    const sendToContent = (action) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action, data: currentData });
            }
        });
    };

    // Wizard Event Listeners
    if (wizStep1) {
        wizStep1.addEventListener('click', () => {
            sendToContent('runStep1');
            wizStep1.classList.add('done');
            if (wizStep2) {
                wizStep2.disabled = false;
                wizStep2.classList.add('active');
            }
        });
    }

    if (wizStep2) {
        wizStep2.addEventListener('click', () => {
            sendToContent('runStep2');
            wizStep2.classList.add('done');
            if (wizStep3) {
                wizStep3.disabled = false;
                wizStep3.classList.add('active');
            }
        });
    }

    if (wizStep3) {
        wizStep3.addEventListener('click', () => {
            sendToContent('runStep3');
            wizStep3.classList.add('done');
            if (logSection) logSection.style.display = 'block';
        });
    }

    if (wizLogBtn) {
        wizLogBtn.addEventListener('click', () => {
            const status = document.getElementById('wiz-log-status');
            status.innerText = "Logging to sheet...";
            chrome.runtime.sendMessage({ action: "logToSheet", data: currentData }, (response) => {
                if (response && response.success) {
                    status.innerText = "✅ Successfully Logged!";
                    status.style.color = "green";
                    setTimeout(() => switchToMain(), 2000);
                } else {
                    status.innerText = "❌ Logging Failed.";
                    status.style.color = "red";
                }
            });
        });
    }

    if (exitWizardBtn) {
        exitWizardBtn.addEventListener('click', switchToMain);
    }

    // Listen for tab changes to auto-switch modes
    chrome.tabs.onActivated.addListener(checkMode);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete') checkMode();
    });

    // ==========================================
    // 2. INITIALIZATION & AUTH
    // ==========================================

    const showInitError = (msg) => {
        if (loadingEl) {
            loadingEl.innerHTML = `⚠️ <strong>Connection Failed</strong><br>${msg}<br><button id="retryInitBtn" style="margin-top:5px;cursor:pointer;">Retry</button>`;
            loadingEl.style.color = "red";
            document.getElementById('retryInitBtn')?.addEventListener('click', () => window.location.reload());
        }
    };

    try {
        const authPromise = chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
        const emailRes = await Promise.race([authPromise, timeoutPromise]).catch(err => null);

        if (!emailRes) {
            showInitError("Background script unresponsive.");
            return;
        }

        const currentEmail = emailRes.email ? emailRes.email.toLowerCase().trim() : "";
        if (currentEmail !== ALLOWED_EMAIL) {
            if (loadingEl) {
                loadingEl.innerHTML = `⚠️ <strong>Access Restricted</strong><br>Logged in as: ${currentEmail || "Unknown"}<br>Required: ${ALLOWED_EMAIL}`;
                loadingEl.style.color = "red";
            }
            return;
        }

        // Load Config
        const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
        if (response && response.success) {
            configData = response.config;
            populateVerticals(verticalSelect);
            if (loadingEl) loadingEl.style.display = 'none';
            if (startBtn) startBtn.disabled = false;
        } else {
            showInitError("Config Load Failed: " + (response?.error || "Unknown"));
        }
    } catch (e) {
        console.error("Init error:", e);
        showInitError(e.message || "Unknown Error");
    }

    // Load Saved State
    chrome.storage.local.get(['last_reporter', 'last_vertical'], (res) => {
        if (res.last_reporter && reporterInput) reporterInput.value = res.last_reporter;
        if (res.last_vertical && verticalSelect) {
            verticalSelect.value = res.last_vertical;
            verticalSelect.dispatchEvent(new Event('change'));
        }
    });

    // Run initial mode check
    checkMode();

    // ==========================================
    // 3. CORE REPORTER UI LOGIC
    // ==========================================

    if (verticalSelect) {
        verticalSelect.addEventListener('change', async () => {
            const vertical = verticalSelect.value;
            chrome.storage.local.set({ last_vertical: vertical });
            if (eventList) eventList.innerHTML = '';
            if (vertical) {
                if (eventInput) eventInput.placeholder = "Loading events...";
                try {
                    const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
                    if (response && response.success && response.data && response.data.eventMap) {
                        const events = Object.values(response.data.eventMap).map(e => e.name);
                        events.sort();
                        eventList.innerHTML = '';
                        events.forEach(name => {
                            const opt = document.createElement('option');
                            opt.value = name;
                            eventList.appendChild(opt);
                        });
                        if (eventInput) eventInput.placeholder = "Select or Type...";
                    }
                } catch (e) {
                    if (eventInput) eventInput.placeholder = "Error loading events";
                }
            }
        });
    }

    const performSearch = () => {
        const vertical = verticalSelect.value;
        const eventName = eventInput.value;
        if (vertical && eventName) {
            if (loadingEl) {
                loadingEl.innerText = "Opening Search Page...";
                loadingEl.style.display = "block";
                loadingEl.style.color = "blue";
            }
            chrome.runtime.sendMessage({ action: 'findEventUrl', data: { eventName, vertical } }, (res) => {
                if (loadingEl) loadingEl.style.display = "none";
                if (!res.success) alert("Error opening search: " + res.error);
            });
        } else {
            alert("Please select a Vertical and enter an Event Name.");
        }
    };

    if (eventInput) eventInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });
    if (searchEventBtn) searchEventBtn.addEventListener('click', performSearch);
    if (reporterInput) {
        reporterInput.addEventListener('change', () => {
            chrome.storage.local.set({ last_reporter: reporterInput.value });
        });
    }

    if (grabBtn) {
        grabBtn.addEventListener('click', async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                if (sourceDisplay) sourceDisplay.value = tab.url;
            }
        });
    }

    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            const reporterName = reporterInput.value;
            const vertical = verticalSelect.value;
            const eventName = eventInput.value;
            const sourceUrl = sourceDisplay.value;
            if (!reporterName || !vertical || !eventName) {
                alert("Please fill in Reporter, Vertical, and Event Name.");
                return;
            }

            const storage = await chrome.storage.local.get('piracy_cart');
            const cart = storage.piracy_cart || [];
            if (cart.length === 0) {
                alert("Queue is empty.");
                return;
            }

            const reporterInfo = {
                name: reporterName,
                email: await getUserEmail() || "copyright@flosports.tv",
                eventName: eventName,
                vertical: vertical,
                sourceUrl: sourceUrl || ""
            };
            await chrome.storage.local.set({ reporterInfo });

            const firstUrl = cart[0].url;
            let reportUrl = (firstUrl.includes("youtube") || firstUrl.includes("youtu.be")) ? 
                "https://www.youtube.com/copyright_complaint_form" : 
                "https://www.tiktok.com/legal/report/Copyright";

            chrome.tabs.create({ url: reportUrl });
        });
    }

    // ==========================================
    // 4. AUTOMATION & SCANNER LISTENERS
    // ==========================================

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'closerProgress') {
            if (closerStatusEl) {
                closerStatusEl.style.display = 'block';
                closerStatusEl.innerHTML = `<strong>${msg.status}</strong><br>${msg.details || ''}`;
                if (!msg.status.includes("Complete") && !msg.status.includes("Stop") && !msg.status.includes("Failed")) {
                    if (closerBtn) closerBtn.style.display = 'none';
                    if (stopCloserBtn) stopCloserBtn.style.display = 'block';
                } else {
                    if (closerBtn) {
                        closerBtn.style.display = 'block';
                        closerBtn.disabled = false;
                        closerBtn.innerText = 'Run "The Closer"';
                    }
                    if (stopCloserBtn) stopCloserBtn.style.display = 'none';
                }
            }
        }
        if (!isCrawling) return;
        if (msg.action === 'urlFound') {
            consecutiveFailures = 0;
            if (crawlStatusEl) crawlStatusEl.innerText = "✅ URL Found! Saving...";
            setTimeout(() => processNextCrawlItem(), 2000);
        } else if (msg.action === 'botSearchFailed') {
            consecutiveFailures++;
            if (crawlStatusEl) crawlStatusEl.innerText = `⚠️ No Result/Skipped (${consecutiveFailures}/3)`;
            if (consecutiveFailures >= 3) stopCrawl("Stopped: 3 consecutive blank results.");
            else setTimeout(() => processNextCrawlItem(), 2000);
        }
    });

    if (closerBtn) {
        closerBtn.addEventListener('click', () => {
            const startRow = parseInt(startRowInput?.value) || 1;
            closerBtn.innerText = "Starting...";
            closerBtn.disabled = true;
            if (closerStatusEl) {
                closerStatusEl.style.display = 'block';
                closerStatusEl.innerText = "Initializing Scanner...";
            }
            chrome.runtime.sendMessage({ action: 'triggerCloser', startRow });
        });
    }

    if (stopCloserBtn) {
        stopCloserBtn.addEventListener('click', () => {
            stopCloserBtn.innerText = "Stopping...";
            stopCloserBtn.disabled = true;
            chrome.runtime.sendMessage({ action: 'stopSheetScanner' });
        });
    }

    if (crawlBtn) {
        crawlBtn.addEventListener('click', async () => {
            if (isCrawling) {
                stopCrawl("Stopped by user.");
                return;
            }
            const vertical = verticalSelect.value;
            if (!vertical) {
                alert("Please select a Vertical first.");
                return;
            }
            crawlStatusEl.innerText = "Fetching sheet data...";
            crawlBtn.disabled = true;
            const response = await chrome.runtime.sendMessage({ action: 'getVerticalData', vertical });
            if (!response || !response.success) {
                crawlStatusEl.innerText = "Error fetching data.";
                crawlBtn.disabled = false;
                return;
            }
            const allEvents = Object.values(response.data.eventMap);
            allEvents.sort((a, b) => a.rowIndex - b.rowIndex);
            crawlQueue = allEvents.filter(e => !e.urls.tiktok || e.urls.tiktok.trim() === "");
            if (crawlQueue.length === 0) {
                crawlStatusEl.innerText = "No empty TikTok cells found.";
                crawlBtn.disabled = false;
                return;
            }
            isCrawling = true;
            consecutiveFailures = 0;
            crawlBtn.disabled = false;
            crawlBtn.innerText = "Stop Auto-Crawl";
            crawlBtn.style.backgroundColor = "#e74c3c";
            crawlStatusEl.innerText = `Queue: ${crawlQueue.length} events. Starting...`;
            processNextCrawlItem();
        });
    }
});

function processNextCrawlItem() {
    const statusEl = document.getElementById('crawlStatus');
    const vertical = document.getElementById('verticalSelect').value;
    if (!isCrawling) return;
    if (crawlQueue.length === 0) {
        stopCrawl("Done! Queue finished.");
        return;
    }
    const event = crawlQueue.shift();
    if (statusEl) statusEl.innerText = `Searching: ${event.name}...`;
    chrome.runtime.sendMessage({ action: 'findEventUrl', data: { eventName: event.name, vertical } });
}

function stopCrawl(reason) {
    isCrawling = false;
    const statusEl = document.getElementById('crawlStatus');
    const btn = document.getElementById('autoCrawlBtn');
    if (statusEl) {
        statusEl.innerText = reason;
        statusEl.style.color = reason.includes("Stopped") ? "red" : "green";
    }
    if (btn) {
        btn.innerText = "Start Auto-Crawl (TikTok)";
        btn.style.backgroundColor = "#f39c12";
    }
}

function populateVerticals(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Select Vertical...</option>';
    if (configData && configData.verticals) {
        configData.verticals.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.innerText = v.name;
            selectEl.appendChild(opt);
        });
    }
}