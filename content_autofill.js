// content_autofill.js

(function() { 
    // 1. INJECTION GUARD (Fixes Duplicates)
    if (window.floAutofillRunning) return;
    window.floAutofillRunning = true;

    function updateProgressOverlay(prefix, status, percent, metaText) {
        const shellEl = document.getElementById(`flo-${prefix}-progress-shell`);
        if (shellEl && status) shellEl.style.display = 'block';

        const statusEl = document.getElementById(`flo-${prefix}-progress-status`);
        if (statusEl && status) statusEl.innerText = status;

        const metaEl = document.getElementById(`flo-${prefix}-progress-meta`);
        if (metaEl) {
            if (metaText) metaEl.innerText = metaText;
            else if (typeof percent === 'number') metaEl.innerText = `${Math.round(percent)}% complete`;
        }

        const barEl = document.getElementById(`flo-${prefix}-progress-bar`);
        if (barEl && typeof percent === 'number') {
            barEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    }

// --- Listen for live progress updates from background.js ---
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'progressUpdate') {
            const statusEl = document.getElementById("flo-log-status");
            if (statusEl) statusEl.innerText = request.status;
            if (request.workflow === 'facebook') {
                updateProgressOverlay('facebook', request.status, request.percent);
            } else {
                updateProgressOverlay('kick', request.status, request.percent);
                updateProgressOverlay('rumble', request.status, request.percent);
            }
        }
        if (request.action === 'progressComplete') {
            if (request.workflow === 'facebook') {
                const remainingText = request.remainingCount > 0 ? `${request.remainingCount} link(s) remain queued` : '100% complete';
                updateProgressOverlay('facebook', 'Facebook scrape and sheet logging complete.', 100, remainingText);
            } else {
                updateProgressOverlay('kick', 'Kick screenshots and sheet logging complete.', 100, '100% complete');
                updateProgressOverlay('rumble', 'Rumble screenshots and sheet logging complete.', 100, '100% complete');
            }
        }
        if (request.action === 'progressError') {
            if (request.workflow === 'facebook') {
                updateProgressOverlay('facebook', request.error || 'Facebook logging failed.', 100, 'Needs attention');
            } else {
                updateProgressOverlay('kick', request.error || 'Kick logging failed.', 100, 'Needs attention');
                updateProgressOverlay('rumble', request.error || 'Rumble logging failed.', 100, 'Needs attention');
            }
        }
    });

    if (typeof AUTOFILL_CONFIG === 'undefined') {
      var AUTOFILL_CONFIG = {}; 
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const COPYRIGHT_OWNER_NAME = 'FloSports';
<<<<<<< Updated upstream
=======
    const INSTAGRAM_BATCH_LIMIT = 30;
    const FACEBOOK_BATCH_LIMIT = 30;
    const KICK_DMCA_EMAIL = 'dmca@kick.com';
    const KICK_CONTACT_EMAIL = 'social@flosports.tv';
    const KICK_CONTACT_PHONE = '5122702356';
    const KICK_CONTACT_ADDRESS = '301 Congress ave #1500\nAustin Tx 78701';
    const RUMBLE_REPORT_SESSION_KEY = 'rumble_report_session';
    const TIKTOK_VERIFICATION_EMAIL = 'social@flosports.tv';
    const TWITCH_CONTACT_EMAIL = 'Social@flosports.tv';
    const TWITCH_CONTACT_PHONE = '5122702356';
    const TWITCH_STREET_ADDRESS = '301 Congress ave #1500';
    const TWITCH_CITY = 'Austin';
    const TWITCH_STATE = 'Texas';
    const TWITCH_ZIP = '78745';
>>>>>>> Stashed changes
    let configLoaded = false;
    let isAutofilling = false; 
    let lastReportData = null; // Cache data for SPA navigation
    let cachedOverlay = null;  // Caches the overlay element to preserve its state
    let hasRunAutomatedFill = false; // Prevents Youtube/Twitter loops on SPA wake-up
    let isTransitioning = false; // Prevents SPA wake-up from firing while we wait for a page transition

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'showKickDmcaComposer') {
            lastReportData = request.data || lastReportData;
            createKickOverlay(lastReportData || {});
            sendResponse?.({ success: true });
            return true;
        }
        return false;
    });

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
<<<<<<< Updated upstream
=======
            const isRumble = host.includes('rumble.com');
            const isTwitch = host.includes('twitch.tv');
>>>>>>> Stashed changes

            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = res.piracy_cart || [];
            const info = res.reporterInfo || {};
<<<<<<< Updated upstream
        
            const platform = (cart.length > 0 && cart[0].platform) ? cart[0].platform : (isTikTok ? "TikTok" : "Unknown");
=======
            const rumbleSession = res[RUMBLE_REPORT_SESSION_KEY] || null;

            const platform = (cart.length > 0 && cart[0].platform) ? cart[0].platform : (isTikTok ? "TikTok" : (isRumble ? "Rumble" : (isTwitch ? "Twitch" : "Unknown")));
>>>>>>> Stashed changes
        
            const data = {
                fullName: info.name || "",
                email: info.email || "copyright@flosports.tv",
                urls: cart.map(c => c.url),
                items: cart,
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

    function detectLegacyAutofillPlatformKey(data) {
        const host = window.location.hostname.toLowerCase();
        const currentUrl = window.location.href.toLowerCase();
        const requestedPlatform = String(data?.platform || '').toLowerCase();

        if (host.includes('tiktok.com') || host.includes('tiktokforbusiness.com')) return 'tiktok';
        if (host.includes('help.instagram.com') || currentUrl.includes('help.instagram.com/contact/552695131608132')) return 'instagram';
        if (host.includes('kick.com')) return 'kick';
        if (host.includes('rumble.com')) return 'rumble';
        if (host.includes('twitch.tv') && currentUrl.includes('/copyright-claims')) return 'twitch';
        if (host.includes('youtube.com') || host.includes('studio.youtube.com')) return 'youtube';
        if (host.includes('help.x.com') || host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
        if (host.includes('facebook.com')) return 'facebook';
        if (requestedPlatform.includes('tiktok')) return 'tiktok';
        if (requestedPlatform.includes('instagram')) return 'instagram';
        if (requestedPlatform.includes('kick')) return 'kick';
        if (requestedPlatform.includes('youtube')) return 'youtube';
        if (requestedPlatform.includes('twitter') || requestedPlatform === 'x') return 'twitter';
        if (requestedPlatform.includes('rumble')) return 'rumble';
        if (requestedPlatform.includes('twitch')) return 'twitch';
        if (requestedPlatform.includes('facebook')) return 'facebook';

        return '';
    }

    async function runLegacyAutofillRoute(platformKey, data) {
        const host = window.location.hostname.toLowerCase();
        const currentUrl = window.location.href.toLowerCase();

        if (platformKey === 'tiktok') {
            createTikTokOverlay(data);
            return;
        }

        if (platformKey === 'instagram') {
            if (host.includes('help.instagram.com') || currentUrl.includes('help.instagram.com/contact/552695131608132')) {
                createInstagramOverlay(data);
                return;
            }

            if (!hasRunAutomatedFill) {
                hasRunAutomatedFill = true;
                await fillInstagram(data);
            }
            if (data.eventName) createStandardOverlay(data);
            return;
        }

        if (platformKey === 'facebook') {
            if (host.includes('facebook.com') && currentUrl.includes('/help/contact/')) {
                createFacebookOverlay(data);
                return;
            }

            if (data.eventName) createStandardOverlay(data);
            return;
        }

        if (platformKey === 'kick') {
            createKickOverlay(data);
            return;
        }

        if (platformKey === 'rumble') {
            if (!isActiveRumbleSessionForCurrentPage(data?.rumbleSession)) return;
            createRumbleOverlay(data);
            return;
        }

        if (platformKey === 'twitch') {
            if (host.includes('twitch.tv') && currentUrl.includes('/copyright-claims')) {
                createTwitchOverlay(data);
                return;
            }

            if (data.eventName) createStandardOverlay(data);
            return;
        }

        if (platformKey === 'youtube') {
            createYouTubeOverlay(data);
            return;
        }

        if (platformKey === 'twitter') {
            createTwitterOverlay(data);
            return;
        }

        if (!hasRunAutomatedFill) {
            hasRunAutomatedFill = true;
        }

        if (data.eventName) createStandardOverlay(data);
    }

    globalThis.__floLegacyAutofill = {
        run(platformKey, data) {
            return runLegacyAutofillRoute(platformKey, data);
        }
    };

    async function routeAutofill(data) {
        if (isAutofilling || !data) return;
        isAutofilling = true;

<<<<<<< Updated upstream
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
=======
        try {
            const autofillModule = globalThis.__floPlatformRegistry?.findAutofillByContext?.(window.location.href, data);
            if (autofillModule?.run) {
                await autofillModule.run(data);
                return;
>>>>>>> Stashed changes
            }

            const fallbackPlatformKey = detectLegacyAutofillPlatformKey(data);
            await runLegacyAutofillRoute(fallbackPlatformKey, data);
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

<<<<<<< Updated upstream
=======
    function normalizeRuntimeUrl(url) {
        try {
            const parsed = new URL(String(url || ''));
            parsed.hash = '';
            return parsed.toString();
        } catch (error) {
            return String(url || '').split('#')[0];
        }
    }

    function isActiveRumbleSessionForCurrentPage(session) {
        if (!session?.active || !Array.isArray(session.urls)) return false;
        const currentUrl = normalizeRuntimeUrl(window.location.href);
        return session.urls.map(normalizeRuntimeUrl).includes(currentUrl);
    }

    function findVisibleElement(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of selectorList.filter(Boolean)) {
            try {
                const element = selector.startsWith('//')
                    ? document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                    : document.querySelector(selector);
                if (element && isVisible(element)) return element;
            } catch (error) {
                // Ignore invalid selectors and continue through fallbacks.
            }
        }
        return null;
    }

    async function waitForVisibleElement(selectors, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const element = findVisibleElement(selectors);
            if (element) return element;
            await sleep(200);
        }
        return null;
    }

    function clickElement(element) {
        if (!element) return false;
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();
        return true;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function cleanReporterNameCandidate(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';

        const normalized = normalizeText(trimmed).replace(/['’]/g, '');
        const placeholders = new Set([
            'user name',
            'users name',
            'your name',
            'reporter name',
            'name',
            'unknown',
            'unknown user',
            'e.g. john doe',
            'e.g john doe',
            'john smith'
        ]);

        if (placeholders.has(normalized) || normalized.startsWith('e.g. ')) return '';
        return trimmed;
    }

    function firstUsableReporterName(...candidates) {
        for (const candidate of candidates) {
            const name = cleanReporterNameCandidate(candidate);
            if (name) return name;
        }
        return '';
    }

    function deriveReporterNameFromEmail(email) {
        const localPart = String(email || '').split('@')[0] || '';
        if (!localPart || ['copyright', 'social', 'support', 'info'].includes(localPart.toLowerCase())) return '';
        const words = localPart.split(/[._-]+/).filter(Boolean);
        if (words.length === 0) return '';
        return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    }

    function matchesAnyText(value, candidates) {
        const normalizedValue = normalizeText(value);
        const candidateList = Array.isArray(candidates) ? candidates : [candidates];
        return candidateList.filter(Boolean).some((candidate) => normalizedValue.includes(normalizeText(candidate)));
    }

    function findControls(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        const controls = selectorList
            .filter(Boolean)
            .flatMap((selector) => {
                try {
                    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
                } catch (error) {
                    return [];
                }
            });
        return Array.from(new Set(controls));
    }

    function mergeSelectorFallbacks(primarySelectors, fallbackSelectors) {
        const primaryList = Array.isArray(primarySelectors)
            ? primarySelectors
            : (primarySelectors ? [primarySelectors] : []);
        const fallbackList = Array.isArray(fallbackSelectors)
            ? fallbackSelectors
            : (fallbackSelectors ? [fallbackSelectors] : []);
        return Array.from(new Set([...primaryList.filter(Boolean), ...fallbackList.filter(Boolean)]));
    }

    function findControlByLabelText(labelTexts, acceptedSelector = 'input, textarea, select') {
        const labels = Array.isArray(labelTexts) ? labelTexts : [labelTexts];
        if (labels.filter(Boolean).length === 0) return null;

        const labeledElements = Array.from(document.querySelectorAll('label, div, span, strong, p'));
        for (const element of labeledElements) {
            const text = element.innerText || element.textContent || '';
            if (!matchesAnyText(text, labels)) continue;

            if (element.tagName === 'LABEL') {
                const forId = element.getAttribute('for');
                if (forId) {
                    const directControl = document.getElementById(forId);
                    if (directControl?.matches?.(acceptedSelector) && isVisible(directControl)) return directControl;
                }
            }

            const nestedControl = element.querySelector?.(acceptedSelector);
            if (nestedControl && isVisible(nestedControl)) return nestedControl;

            const container = element.closest('div, label, fieldset') || element.parentElement;
            const nearbyControl = container?.querySelector?.(acceptedSelector);
            if (nearbyControl && isVisible(nearbyControl)) return nearbyControl;

            const xpath = 'following::*[self::input or self::textarea or self::select][1]';
            const followingControl = document.evaluate(
                xpath,
                element,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            if (followingControl?.matches?.(acceptedSelector) && isVisible(followingControl)) return followingControl;
        }

        return null;
    }

    function findChoiceInputByText(text, type) {
        const selector = `input[type="${type}"]`;
        const matchingByValue = Array.from(document.querySelectorAll(selector)).find((input) =>
            matchesAnyText(input.value || input.getAttribute('aria-label') || '', text)
        );
        if (matchingByValue && isVisible(matchingByValue)) return matchingByValue;

        const matchingLabel = Array.from(document.querySelectorAll('label')).find((label) =>
            matchesAnyText(label.innerText || label.textContent || '', text)
        );
        if (matchingLabel) {
            const nestedInput = matchingLabel.querySelector(selector);
            if (nestedInput) return nestedInput;

            const forId = matchingLabel.getAttribute('for');
            if (forId) {
                const directInput = document.getElementById(forId);
                if (directInput?.matches?.(selector)) return directInput;
            }
        }

        return null;
    }

    function fillFieldWithFallback(selectors, labels, value) {
        if (value == null || value === '') return false;

        const directField = findVisibleElement(selectors);
        if (directField) {
            return typeValue(directField, value);
        }

        const labelField = findControlByLabelText(labels, 'input, textarea');
        if (labelField) {
            return typeValue(labelField, value);
        }

        return false;
    }

    async function fillFieldWithFallbackWhenReady(selectors, labels, value, timeout = 2500) {
        if (value == null || value === '') return false;

        const directField = await waitForVisibleElement(selectors, timeout);
        if (directField) {
            return typeValue(directField, value);
        }

        const start = Date.now();
        while (Date.now() - start < timeout) {
            const labelField = findControlByLabelText(labels, 'input, textarea');
            if (labelField) {
                return typeValue(labelField, value);
            }
            await sleep(200);
        }

        return false;
    }

    function selectFieldOption(selectors, labels, optionText) {
        if (!optionText) return false;

        const directSelect = findVisibleElement(selectors);
        const labelSelect = directSelect || findControlByLabelText(labels, 'select');
        if (!labelSelect) return false;

        const targetOption = Array.from(labelSelect.options || []).find((option) =>
            matchesAnyText(option.textContent || option.innerText || '', optionText)
        );
        if (!targetOption) return false;

        labelSelect.value = targetOption.value;
        labelSelect.dispatchEvent(new Event('input', { bubbles: true }));
        labelSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function clickChoiceInput(choice) {
        if (!choice) return false;
        if (isVisible(choice)) {
            checkReactCheckbox(choice);
            return true;
        }

        const label = choice.closest?.('label') ||
            Array.from(document.querySelectorAll('label')).find((candidate) => candidate.getAttribute('for') === choice.id);
        if (label && isVisible(label)) {
            clickElement(label);
            if (choice.tagName === 'INPUT' && (choice.type === 'checkbox' || choice.type === 'radio')) {
                const nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
                if (nativeCheckedSetter) nativeCheckedSetter.call(choice, true);
                else choice.checked = true;
                choice.dispatchEvent(new Event('input', { bubbles: true }));
                choice.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        return false;
    }

    function checkChoiceField(selectors, labels, choiceText, type = 'checkbox') {
        const directChoice = findVisibleElement(selectors);
        if (directChoice) {
            return clickChoiceInput(directChoice);
        }

        const labeledChoice = findChoiceInputByText(choiceText || labels, type);
        if (labeledChoice) {
            return clickChoiceInput(labeledChoice);
        }

        return false;
    }

    function detectInstagramContentTypes(urls) {
        const list = Array.isArray(urls) ? urls : [];
        const hasStory = list.some((url) => String(url || '').toLowerCase().includes('/stories/'));
        const hasPostLike = list.some((url) => !String(url || '').toLowerCase().includes('/stories/'));
        return { hasStory, hasPostLike };
    }

    function buildInstagramExplanation(data) {
        const template = AUTOFILL_CONFIG.instagram?.autofill?.templates?.infringement_explanation ||
            'Unauthorized distribution of a paywalled FloSports broadcast ([Event Name] / [Vertical Name]). FloSports owns the exclusive copyright. Infringement is visually verifiable via our proprietary watermarks and broadcast graphics included in the video. No license or permission has been granted to this account.';
        const vertical = data?.vertical || 'FloSports';
        const eventName = data?.eventName || 'the event';
        return template
            .replace(/\[Event Name\]/g, eventName)
            .replace(/\[Vertical Name\]/g, vertical);
    }

    function buildFacebookExplanation(data) {
        const template = AUTOFILL_CONFIG.facebook?.autofill?.templates?.infringement_explanation ||
            AUTOFILL_CONFIG.instagram?.autofill?.templates?.infringement_explanation ||
            'Unauthorized distribution of a paywalled FloSports broadcast ([Event Name] / [Vertical Name]). FloSports owns the exclusive copyright. Infringement is visually verifiable via our proprietary watermarks and broadcast graphics included in the video. No license or permission has been granted to this account.';
        const vertical = data?.vertical || 'FloSports';
        const eventName = data?.eventName || 'the event';
        return template
            .replace(/\[Event Name\]/g, eventName)
            .replace(/\[Vertical Name\]/g, vertical);
    }

    function buildKickDmcaEmail(data, reporterFullName) {
        const conf = AUTOFILL_CONFIG.kick?.autofill || {};
        const defaults = conf.defaults || {};
        const templates = conf.templates || {};
        const recipient = defaults.recipient_email || KICK_DMCA_EMAIL;
        const contactEmail = defaults.contact_email || KICK_CONTACT_EMAIL;
        const contactPhone = defaults.phone || KICK_CONTACT_PHONE;
        const contactAddress = defaults.address || KICK_CONTACT_ADDRESS;
        const contactTitle = defaults.title || 'Authorized user';
        const eventName = data?.eventName || 'FloSports event';
        const vertical = data?.vertical || 'FloSports';
        const sourceUrl = data?.sourceUrl || 'Original FloSports URL not provided';
        const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
        const urlsList = urls.length > 0 ? urls.map((url) => `- ${url}`) : ['- URL not provided'];
        const subjectTemplate = templates.subject || 'DMCA Takedown Notice - FloSports - [Event Name]';
        const subject = subjectTemplate
            .replace(/\[Event Name\]/g, eventName)
            .replace(/\[Vertical Name\]/g, vertical);
        const greeting = templates.greeting || 'To Whom It May Concern at Kick,';
        const submissionIntro = templates.submission_intro || 'I am submitting this DMCA takedown notice on behalf of FloSports.';
        const genericDescription = templates.infringing_material_description ||
            'Unauthorized Kick-hosted or Kick-linked distribution of FloSports material appearing at the URLs listed below.';
        const ownershipEvidence = templates.ownership_evidence ||
            'The infringing material often includes FloSports, MileSplit, or Varsity TV watermarks and proprietary broadcast graphics, all of which evidence FloSports ownership.';
        const sourceUrlLabel = templates.source_url_label || 'Original FloSports URL being pirated:';
        const reportedUrlsLabel = templates.reported_urls_label || 'Reported Kick URLs:';
        const sourceLine = `${sourceUrlLabel} ${sourceUrl}`;

        const sections = [
            {
                number: 1,
                title: 'A description of the copyrighted work that I claim is being infringed:',
                lines: [eventName]
            },
            {
                number: 2,
                title: 'A description of the material I claim is infringing and that I want removed or access to which I want disabled, and the location of that material:',
                lines: [genericDescription, ownershipEvidence, sourceLine, reportedUrlsLabel, ...urlsList]
            },
            {
                number: 3,
                title: 'My contact information:',
                lines: [
                    `Name: ${reporterFullName}`,
                    `Title: ${contactTitle}`,
                    `Address: ${contactAddress}`,
                    `Telephone: ${contactPhone}`,
                    `Email: ${contactEmail}`
                ]
            },
            {
                number: 4,
                title: 'Good faith statement:',
                lines: [
                    `I, ${reporterFullName}, have a good faith belief that the use of the copyrighted material I am complaining of is not authorized by the copyright owner, its agent, or the law (e.g., as a fair use).`
                ]
            },
            {
                number: 5,
                title: 'Accuracy and authority statement:',
                lines: [
                    `The information in this notice is accurate and, under penalty of perjury, I, ${reporterFullName}, am the owner, or authorized to act on behalf of the owner, of the copyright or of an exclusive right that is allegedly infringed.`
                ]
            },
            {
                number: 6,
                title: 'Electronic signature:',
                lines: [reporterFullName]
            }
        ];

        const body = [
            greeting,
            '',
            submissionIntro,
            '',
            ...sections.flatMap((section) => [
                `${section.number}. ${section.title}`,
                ...section.lines,
                ''
            ])
        ].join('\n');

        return { recipient, subject, body, sections };
    }

>>>>>>> Stashed changes
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

    const fillByLabel = (labelTexts, value) => {
        if (!value) return;
        const labels = Array.isArray(labelTexts) ? labelTexts.map(l => l.toLowerCase()) : [labelTexts.toLowerCase()];
        
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        let targetInput = null;
        
        while ((textNode = walker.nextNode())) {
            const nodeText = textNode.nodeValue.toLowerCase();
            if (labels.some(l => nodeText.includes(l))) {
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
        console.log(`   ✅ Found field by label: "${labelTexts}"`); // ✅ FIXED
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
                await sleep(200); // Slight delay to let React update states
        }
    }
// ==========================================
//. --- MACRO PLAYBACK ENGINE ---
//===========================================

    async function executeMacro(macroSteps) {
        if (typeof macroSteps === 'string') {
            try { macroSteps = JSON.parse(macroSteps); } catch(e) { return false; }
        }
        if (!Array.isArray(macroSteps)) return false;
        
        console.log("▶️ Executing Macro Sequence...");
        for (const step of macroSteps) {
            if (step.delay) await sleep(step.delay);
            
            const el = step.selector.startsWith('//')
                ? document.evaluate(step.selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                : document.querySelector(step.selector);
                
            if (!el) {
                console.warn(`⚠️ Macro step failed: Could not find ${step.selector}`);
                continue;
            }
            
            if (step.action === 'click') {
                el.scrollIntoView({block: 'center', behavior: 'smooth'});
                el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                el.click();
            } else if (step.action === 'input' || step.action === 'type') {
                typeValue(el, step.value);
            }
        }
        return true;
    }

    // ==========================================
    // 2. DISCRETE STEP FUNCTIONS
    // ==========================================

    async function executeConfigStep(platform, stepName, mappings) {
        const conf = AUTOFILL_CONFIG[platform]?.autofill || {};
        for (const map of mappings) {
            let filled = false;
            const selectors = conf[map.section]?.[map.field];
            if (selectors) {
                const selArray = Array.isArray(selectors) ? selectors : [selectors];
                for (let sel of selArray) {
                    try {
                        // Extract string if it's an object or Macro JSON
                        if (typeof sel === 'object' && sel !== null) sel = sel.selector;
                        if (typeof sel === 'string' && sel.trim().startsWith('[{')) {
                            sel = JSON.parse(sel)[0]?.selector || sel;
                        }

                        let el = (typeof sel === 'string' && sel.startsWith('//'))
                            ? document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                            : document.querySelector(sel);
                        
                        if (el && isVisible(el)) {
                            typeValue(el, map.value);
                            filled = true;
                            break;
                        }
                    } catch(e) {}
                }
            }
            if (!filled && map.fallbackLabels) {
                fillByLabel(map.fallbackLabels, map.value);
            }
        }
    }

<<<<<<< Updated upstream
=======
    async function resolveReporterFullName(data) {
        const explicitName = firstUsableReporterName(
            data?.fullName,
            data?.reporterName,
            data?.name,
            lastReportData?.fullName,
            lastReportData?.reporterName,
            lastReportData?.name
        );
        if (explicitName) return explicitName;

        try {
            const res = await chrome.storage.local.get(['reporterInfo', 'last_reporter']);
            return firstUsableReporterName(res.reporterInfo?.name, res.last_reporter) ||
                deriveReporterNameFromEmail(data?.email || lastReportData?.email || res.reporterInfo?.email) ||
                '';
        } catch (error) {
            return '';
        }
    }

>>>>>>> Stashed changes
    async function runStep1(data) {
        console.log("🔹 Step 1: Init Form & Email Verification");

        async function selectTuxDropdown(searchText) {
            const dropdowns = document.querySelectorAll('button[aria-haspopup="listbox"]');
            for (const dd of dropdowns) {
                if (dd.innerText.toLowerCase().includes(searchText.toLowerCase())) return true;
                
                dd.click(); 
                await sleep(500); 
                
                const xpath = `//div[@role="option" or @role="menuitem"]//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${searchText.toLowerCase()}')]/parent::* | //li[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${searchText.toLowerCase()}')]`;
                const option = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                
                if (option) {
                    option.scrollIntoView({block: 'center', behavior: 'smooth'});
                    option.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                    option.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                    option.click();
                    await sleep(500); 
                    return true;
                } else {
                    dd.click(); 
                    await sleep(300);
                }
            }
            return false;
        }

        const platform = "tiktok";
        const conf = AUTOFILL_CONFIG[platform]?.autofill || {};
        
        // 1. Execute Dropdowns from Config or Fallback
        const wizardSteps = conf.wizard_steps || ["copyright infringement", "i am the copyright owner"];
        for (const stepText of wizardSteps) {
            await selectTuxDropdown(stepText);
        }

        // 2. Execute Input Mapping
        const email = data.email || "copyright@flosports.tv";
        await executeConfigStep(platform, "Step 1", [
            { section: 'field_strategies', field: 'email', value: email, fallbackLabels: ['email'] }
        ]);
        
        const nextBtn = await waitForButton(conf.buttons?.next || ['Next', 'Continue', 'button.submit-button'], 500);
        if (nextBtn && !nextBtn.disabled) {
            console.log("➡️ Clicking Next...");
            nextBtn.click();
            return true; 
        }
        return false;
    }

    async function runStep2(data) {
        const platform = "tiktok";
        const defaults = {
            company: COPYRIGHT_OWNER_NAME,
            phone: "5122702356",
            address: "301 Congress ave #1500 Austin Tx 78701",
            name: COPYRIGHT_OWNER_NAME
        };
        
        // Map logical fields to their respective sections in the config and fallback labels
        const fieldMappings = [
            { section: 'field_strategies', field: 'name', value: defaults.name, fallbackLabels: ['your full name', 'nombre completo'] },
            { section: 'field_strategies', field: 'company', value: defaults.company, fallbackLabels: ['name of the copyright owner', 'nombre del propietario'] },
            { section: 'field_strategies', field: 'address', value: defaults.address, fallbackLabels: ['physical address', 'dirección física'] },
            { section: 'field_strategies', field: 'phone', value: defaults.phone, fallbackLabels: ['phone number', 'número de teléfono'] }
        ];

        await executeConfigStep(platform, "Step 2", fieldMappings);
        
        const conf = AUTOFILL_CONFIG[platform]?.autofill || {};
        const nextBtn = await waitForButton(conf.buttons?.next || ['Next', 'Continue', 'button.submit-button'], 500);
        if (nextBtn && !nextBtn.disabled) {
            console.log("➡️ Clicking Next...");
            nextBtn.click();
            return true;
        }
        return false;
    }

    async function runStep3(data) {
        console.log("🔹 Step 3: Infringement Details & Sign");
        const defaults = { name: COPYRIGHT_OWNER_NAME };

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

        // --- 1. USE DYNAMIC CLOUD SELECTOR IF AVAILABLE ---
        const conf = AUTOFILL_CONFIG.tiktok?.autofill || {};
        if (conf.agreement) {
            console.log("☑️ Using Cloud Config Selector for Checkboxes:", conf.agreement);
            const agreements = Array.isArray(conf.agreement) ? conf.agreement : [conf.agreement];
            
            agreements.forEach(item => {
                try {
                    // Extract the string whether it's an object {selector: '...'} or a Macro JSON string
                    let selStr = (typeof item === 'object' && item !== null) ? item.selector : item;
                    if (typeof selStr === 'string' && selStr.trim().startsWith('[{')) {
                        selStr = JSON.parse(selStr)[0]?.selector || selStr;
                    }
                    
                    if (typeof selStr === 'string') {
                        document.querySelectorAll(selStr).forEach(box => checkReactCheckbox(box));
                    }
                } catch(e) {
                    console.warn("Invalid agreement config:", e);
                }
            });
        }

        // --- 2. AGGRESSIVE CHECKBOX CLICKER ---
        // Step 3 on TikTok only has the 3 agreement checkboxes. Check them all!
        document.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach(box => {
            checkReactCheckbox(box);
        });

        // --- 3. FALLBACK: DEEP TEXT MATCHING ---
        // If the checkboxes are hidden custom divs, find them by their adjacent text
        const agreementTexts = [
            "good faith",
            "perjury",
            "acknowledge"
        ];

        agreementTexts.forEach(text => {
            // Find the innermost element that contains the text
            const lower = text.toLowerCase();
            const xpath = `//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lower}') and not(*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lower}')])]`;
            const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            
            if (node && isVisible(node)) {
                let container = node.closest('label, div.form-item, div.tux-row') || node.parentElement;
                
                const hiddenInput = container ? container.querySelector('input[type="checkbox"]') : null;
                const ariaBox = container ? container.querySelector('[role="checkbox"], [role="switch"]') : null;

                if (hiddenInput) {
                    checkReactCheckbox(hiddenInput);
                } else if (ariaBox) {
                    checkReactCheckbox(ariaBox);
                } else {
                    if (!node.hasAttribute('data-flo-clicked')) {
                        node.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                        node.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                        node.click();
                        
                        // Often the custom box is the previous sibling to the text
                        if (node.previousElementSibling) {
                            node.previousElementSibling.click();
                        } else if (node.parentElement) {
                            node.parentElement.click();
                        }
                        
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

<<<<<<< Updated upstream
=======
    async function runRumbleReportSequence(data, statusEl) {
        const config = AUTOFILL_CONFIG.rumble?.autofill || {};
        const session = data?.rumbleSession || {};
        const total = Array.isArray(session.urls) ? session.urls.length : (Array.isArray(data?.urls) ? data.urls.length : 0);
        const currentNumber = Number(session.currentIndex || 0) + 1;
        const reportBasePercent = total > 0
            ? Math.max(4, Math.round(((currentNumber - 1) / total) * 30))
            : 4;
        const updateStatus = (message, color = '#333') => {
            if (!statusEl) return;
            statusEl.innerText = message;
            statusEl.style.color = color;
        };
        const updateReportProgress = (message, offset = 0, color = '#333') => {
            const percent = Math.min(34, reportBasePercent + offset);
            updateStatus(message, color);
            updateProgressOverlay(
                'rumble',
                message,
                percent,
                total > 0 ? `Report ${currentNumber}/${total}` : `${percent}% complete`
            );
        };

        const defaultMenuButtonSelectors = [
            '[data-js="video_action_sub_menu_button"]',
            '.media-by-actions-button-menu[data-js="video_action_sub_menu_button"]'
        ];
        const defaultDirectReportButtonSelectors = [
            '[data-type="report"] button[hx-get="/htmx/web-services/report-content"]',
            'button[hx-get="/htmx/web-services/report-content"][hx-ext="modal"]',
            'button.media-by-actions-button[hx-get*="/report-content"]',
            'button[hx-get*="/report-content"]'
        ];
        const defaultReportButtonSelectors = [
            '[data-type="report"] [data-js="video_action_sub_menu_button"]',
            '[data-type="report"] button[hx-get="/htmx/web-services/report-content"]',
            'button[hx-get="/htmx/web-services/report-content"][hx-ext="modal"]',
            'button.media-by-actions-button[hx-get*="/report-content"]'
        ];
        const defaultCopyrightReasonSelectors = [
            'input[type="radio"][name="reason"][value="It violates copyright"]'
        ];
        const defaultSubmitButtonSelectors = [
            'button[type="button"][hx-post="/htmx/web-services/report-content"][hx-include="[name=\'reason\']"]',
            'button[hx-post="/htmx/web-services/report-content"][hx-include="[name=\'reason\']"]',
            '#modal_body button[hx-post="/htmx/web-services/report-content"]',
            '[data-js="modal_content"] button[hx-post*="/report-content"]',
            'button.font-semibold[hx-post*="/report-content"]',
            'button[hx-post*="/report-content"]',
            '//button[contains(normalize-space(.), "Submit") and contains(@hx-post, "/report-content")]'
        ];
        const menuButtonSelectors = mergeSelectorFallbacks(config.menu_button, defaultMenuButtonSelectors);
        const directReportButtonSelectors = mergeSelectorFallbacks(config.direct_report_button, defaultDirectReportButtonSelectors);
        const reportButtonSelectors = mergeSelectorFallbacks(config.report_button, defaultReportButtonSelectors);
        const copyrightReasonSelectors = mergeSelectorFallbacks(config.copyright_reason, defaultCopyrightReasonSelectors);
        const submitButtonSelectors = mergeSelectorFallbacks(config.submit_button, defaultSubmitButtonSelectors);
        const successIndicatorSelectors = config.success_indicators || [];
        const successTextMatchers = Array.isArray(config.success_text)
            ? config.success_text
            : (config.success_text ? [config.success_text] : ['thank you', 'report submitted']);

        updateReportProgress('Opening report dialog...', 3);
        let reportButton = await waitForVisibleElement(directReportButtonSelectors, 2500);

        if (!reportButton) {
            updateReportProgress('Opening report menu...', 5);
            const menuButton = await waitForVisibleElement(menuButtonSelectors, 15000);
            if (!menuButton) {
                throw new Error('Could not find the Rumble action menu or direct report button.');
            }
            clickElement(menuButton);
            await sleep(500);

            updateReportProgress('Selecting report...', 8);
            reportButton = await waitForVisibleElement(reportButtonSelectors, 10000);
        }

        if (!reportButton) {
            throw new Error('Could not find the Rumble report button.');
        }
        clickElement(reportButton);
        await sleep(700);

        updateReportProgress('Choosing copyright violation...', 13);
        const copyrightReason = await waitForVisibleElement(copyrightReasonSelectors, 10000);
        if (!copyrightReason) {
            throw new Error('Could not find the copyright violation option.');
        }
        checkReactCheckbox(copyrightReason);
        await sleep(300);

        updateReportProgress('Submitting report...', 18);
        const submitButton = await waitForVisibleElement(submitButtonSelectors, 10000);
        if (!submitButton) {
            throw new Error('Could not find the Rumble submit button.');
        }
        clickElement(submitButton);

        const submitted = await (async () => {
            const start = Date.now();
            while (Date.now() - start < 8000) {
                const reasonStillVisible = !!findVisibleElement(copyrightReasonSelectors);
                const submitStillVisible = !!findVisibleElement(submitButtonSelectors);
                const bodyText = document.body.innerText.toLowerCase();
                const matchedSuccessText = successTextMatchers.some((text) =>
                    bodyText.includes(String(text || '').toLowerCase())
                );
                const successIndicatorVisible = successIndicatorSelectors.length > 0 && !!findVisibleElement(successIndicatorSelectors);

                if (!reasonStillVisible && !submitStillVisible) {
                    return true;
                }
                if (matchedSuccessText || successIndicatorVisible) {
                    return true;
                }
                await sleep(250);
            }
            return false;
        })();

        if (!submitted) {
            throw new Error('The Rumble report modal did not confirm submission. Please review the page.');
        }

        updateReportProgress(
            currentNumber >= total ? 'Report submitted. Logging reported URLs...' : 'Report submitted. Opening next queued URL...',
            28,
            '#0288d1'
        );
        const response = await chrome.runtime.sendMessage({
            action: 'advanceRumbleQueue',
            currentUrl: window.location.href
        });

        if (!response?.success) {
            throw new Error(response?.error || 'Failed to advance the Rumble report queue.');
        }

        if (response.done) {
            updateProgressOverlay('rumble', 'All Rumble reports submitted and logged.', 100, '100% complete');
            updateStatus('All Rumble reports submitted and logged.', 'green');
            try {
                new Audio(chrome.runtime.getURL('jingle.mp3')).play().catch(() => {});
            } catch (error) {
                // Audio is optional here.
            }
        }
    }

>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
=======
    function createTwitterOverlay(data) {
        if (cachedOverlay && cachedOverlay.id === "flo-twitter-overlay") {
            if (!document.getElementById("flo-twitter-overlay")) {
                document.body.appendChild(cachedOverlay);
            }
            return;
        }

        const existing = document.getElementById("flo-twitter-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "flo-twitter-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 320px;
          background: white; border: 3px solid #1d9bf0; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
        `;

        overlay.innerHTML = `
          <div id="flo-x-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-x-title" style="margin:0; color:#1d9bf0; font-size:16px; pointer-events:none;">X DMCA Wizard ✥</h3>
            <div>
                <button id="flo-x-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-x-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>

          <div id="flo-x-main-content">
              <div style="margin-bottom: 12px; font-size: 13px;">
                <small>Use these in order on the X authorized-rep DMCA form. Review the page before submitting.</small>
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px;">
                  <button id="flo-x-btn-step1" style="background: #1d9bf0; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Contact Info</button>
                  <button id="flo-x-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Work & Links</button>
                  <button id="flo-x-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Acknowledgments</button>
              </div>

              <div id="flo-x-log-container" style="display:none; margin-top: 15px;">
                  <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                      Click Submit on the X page first, then log below.
                  </div>
                  <button id="flo-x-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
                  <div id="flo-x-log-status" style="margin-top:8px; font-size:12px; text-align:center;"></div>
              </div>
          </div>
        `;

        cachedOverlay = overlay;
        document.body.appendChild(overlay);
        setupDrag(overlay);

        let isMinimized = false;
        const minBtn = document.getElementById('flo-x-min-btn');
        const closeBtn = document.getElementById('flo-x-close-btn');
        const mainContent = document.getElementById('flo-x-main-content');
        const title = document.getElementById('flo-x-title');
        const topBar = document.getElementById('flo-x-top-bar');

        minBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                mainContent.style.display = 'none';
                minBtn.innerHTML = '+';
                title.innerText = 'X ✥';
                overlay.style.width = 'auto';
                topBar.style.borderBottom = 'none';
                topBar.style.marginBottom = '0';
                topBar.style.paddingBottom = '0';
                overlay.style.right = '0px';
                overlay.style.left = 'auto';
                overlay.style.borderTopRightRadius = '0';
                overlay.style.borderBottomRightRadius = '0';
            } else {
                mainContent.style.display = 'block';
                minBtn.innerHTML = '−';
                title.innerText = 'X DMCA Wizard ✥';
                overlay.style.width = '320px';
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

        const btn1 = document.getElementById('flo-x-btn-step1');
        const btn2 = document.getElementById('flo-x-btn-step2');
        const btn3 = document.getElementById('flo-x-btn-step3');
        const logContainer = document.getElementById('flo-x-log-container');

        btn1.addEventListener('click', async () => {
            btn1.innerText = 'Running...';
            await runTwitterStep1(data);
            btn1.innerText = 'Step 1: Done';
            btn1.style.background = '#ccc';
            btn1.style.color = '#333';
            btn2.style.background = '#1d9bf0';
            btn2.style.color = 'white';
        });

        btn2.addEventListener('click', async () => {
            btn2.innerText = 'Running...';
            await runTwitterStep2(data);
            btn2.innerText = 'Step 2: Done';
            btn2.style.background = '#ccc';
            btn2.style.color = '#333';
            btn3.style.background = '#1d9bf0';
            btn3.style.color = 'white';
        });

        btn3.addEventListener('click', async () => {
            btn3.innerText = 'Running...';
            await runTwitterStep3(data);
            btn3.innerText = 'Step 3: Done';
            btn3.style.background = '#ccc';
            btn3.style.color = '#333';
            logContainer.style.display = 'block';
            overlay.style.borderColor = '#ce0e2d';
        });

        document.getElementById('flo-x-log-btn').addEventListener('click', async () => {
            const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
            const status = document.getElementById('flo-x-log-status');
            status.innerText = 'Logging...';
            const freshData = await getFreshTwitterReportData(data);
            chrome.runtime.sendMessage({ action: 'logToSheet', data: freshData }, (response) => {
                if (response && response.success) {
                    successAudio.play().catch(() => {});
                    status.innerText = 'Logged. Closing...';
                    status.style.color = 'green';
                    setTimeout(() => {
                        lastReportData = null;
                        cachedOverlay = null;
                        overlay.remove();
                    }, 2000);
                } else {
                    status.innerText = 'Failed.';
                    status.style.color = 'red';
                }
            });
        });
    }

    function createInstagramOverlay(data) {
        if (cachedOverlay && cachedOverlay.id === "flo-instagram-overlay") {
            if (!document.getElementById("flo-instagram-overlay")) {
                document.body.appendChild(cachedOverlay);
            }
            return;
        }

        const existing = document.getElementById("flo-instagram-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "flo-instagram-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 300px;
          background: white; border: 3px solid #c13584; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
        `;

        overlay.innerHTML = `
          <div id="flo-ig-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-ig-title" style="margin:0; color:#c13584; font-size:16px; pointer-events:none;">Instagram Wizard ✥</h3>
            <div>
                <button id="flo-ig-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-ig-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>

          <div id="flo-ig-main-content">
              <div style="margin-bottom: 12px; font-size: 13px;">
                <small>Use the 3 buttons to fill the Instagram copyright form in order, then review and click Send on the page before logging.</small>
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px;">
                  <button id="flo-ig-btn-step1" style="background: #c13584; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Contact Info</button>
                  <button id="flo-ig-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Source & Type</button>
                  <button id="flo-ig-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Report Links</button>
              </div>

              <div id="flo-ig-log-container" style="display:none; margin-top: 15px;">
                  <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                      ⚠️ Click "Send" on the Instagram page first, then log below.
                  </div>
                  <button id="flo-ig-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
                  <div id="flo-ig-log-status" style="margin-top:8px; font-size:12px; text-align:center;"></div>
              </div>
          </div>
        `;

        cachedOverlay = overlay;
        document.body.appendChild(overlay);
        setupDrag(overlay);

        let isMinimized = false;
        const minBtn = document.getElementById('flo-ig-min-btn');
        const closeBtn = document.getElementById('flo-ig-close-btn');
        const mainContent = document.getElementById('flo-ig-main-content');
        const title = document.getElementById('flo-ig-title');
        const topBar = document.getElementById('flo-ig-top-bar');

        minBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                mainContent.style.display = 'none';
                minBtn.innerHTML = '+';
                title.innerText = 'IG ✥';
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
                title.innerText = 'Instagram Wizard ✥';
                overlay.style.width = '300px';
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

        const btn1 = document.getElementById('flo-ig-btn-step1');
        const btn2 = document.getElementById('flo-ig-btn-step2');
        const btn3 = document.getElementById('flo-ig-btn-step3');
        const logContainer = document.getElementById('flo-ig-log-container');

        btn1.addEventListener('click', async () => {
            btn1.innerText = 'Running...';
            await runIgStep1(data);
            btn1.innerText = 'Step 1: Done';
            btn1.style.background = '#ccc';
            btn1.style.color = '#333';
            btn2.style.background = '#c13584';
            btn2.style.color = 'white';
        });

        btn2.addEventListener('click', async () => {
            btn2.innerText = 'Running...';
            await runIgStep2(data);
            btn2.innerText = 'Step 2: Done';
            btn2.style.background = '#ccc';
            btn2.style.color = '#333';
            btn3.style.background = '#c13584';
            btn3.style.color = 'white';
        });

        btn3.addEventListener('click', async () => {
            btn3.innerText = 'Running...';
            await runIgStep3(data);
            btn3.innerText = 'Step 3: Done';
            btn3.style.background = '#ccc';
            btn3.style.color = '#333';
            logContainer.style.display = 'block';
        });

        document.getElementById('flo-ig-log-btn').addEventListener('click', () => {
            const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
            const status = document.getElementById('flo-ig-log-status');
            status.innerText = 'Logging...';
            chrome.runtime.sendMessage({ action: 'logToSheet', data: data }, (response) => {
                if (response && response.success) {
                    successAudio.play().catch(() => {});
                    status.innerText = '✅ Logged! Closing...';
                    status.style.color = 'green';
                    setTimeout(() => {
                        lastReportData = null;
                        cachedOverlay = null;
                        overlay.remove();
                    }, 2000);
                } else {
                    status.innerText = '❌ Failed.';
                    status.style.color = 'red';
                }
            });
        });
    }

    function createFacebookOverlay(data) {
        if (cachedOverlay && cachedOverlay.id === "flo-facebook-overlay") {
            if (!document.getElementById("flo-facebook-overlay")) {
                document.body.appendChild(cachedOverlay);
            }
            return;
        }

        const existing = document.getElementById("flo-facebook-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "flo-facebook-overlay";
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 300px;
          background: white; border: 3px solid #1877f2; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
        `;

        overlay.innerHTML = `
          <div id="flo-fb-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-fb-title" style="margin:0; color:#1877f2; font-size:16px; pointer-events:none;">Facebook Wizard ✥</h3>
            <div>
                <button id="flo-fb-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-fb-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>

          <div id="flo-fb-main-content">
              <div style="margin-bottom: 12px; font-size: 13px;">
                <small>Use the 3 buttons to fill the Facebook copyright form in order, then review and click Send on the page before logging.</small>
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px;">
                  <button id="flo-fb-btn-step1" style="background: #1877f2; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 1: Contact Info</button>
                  <button id="flo-fb-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 2: Work & Links</button>
                  <button id="flo-fb-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Step 3: Signature</button>
              </div>

              <div id="flo-fb-log-container" style="display:none; margin-top: 15px;">
                  <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
                      Click "Send" on the Facebook page first, then log below.
                  </div>
                  <div id="flo-facebook-progress-shell" style="display:none; margin:10px 0 12px;">
                      <div style="height:8px; background:#e5e7eb; border-radius:999px; overflow:hidden;">
                          <div id="flo-facebook-progress-bar" style="height:100%; width:0%; background:linear-gradient(90deg, #1877f2, #52a7ff); transition:width .25s ease;"></div>
                      </div>
                      <div id="flo-facebook-progress-status" style="margin-top:8px; color:#111827; font-size:12px; font-weight:700; text-align:center;">Preparing...</div>
                      <div id="flo-facebook-progress-meta" style="margin-top:2px; color:#6b7280; font-size:11px; text-align:center;">0% complete</div>
                  </div>
                  <button id="flo-fb-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
                  <div id="flo-fb-log-status" style="margin-top:8px; font-size:12px; text-align:center;"></div>
              </div>
          </div>
        `;

        cachedOverlay = overlay;
        document.body.appendChild(overlay);
        setupDrag(overlay);

        let isMinimized = false;
        const minBtn = document.getElementById('flo-fb-min-btn');
        const closeBtn = document.getElementById('flo-fb-close-btn');
        const mainContent = document.getElementById('flo-fb-main-content');
        const title = document.getElementById('flo-fb-title');
        const topBar = document.getElementById('flo-fb-top-bar');

        minBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                mainContent.style.display = 'none';
                minBtn.innerHTML = '+';
                title.innerText = 'FB ✥';
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
                title.innerText = 'Facebook Wizard ✥';
                overlay.style.width = '300px';
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

        const btn1 = document.getElementById('flo-fb-btn-step1');
        const btn2 = document.getElementById('flo-fb-btn-step2');
        const btn3 = document.getElementById('flo-fb-btn-step3');
        const logContainer = document.getElementById('flo-fb-log-container');

        btn1.addEventListener('click', async () => {
            btn1.innerText = 'Running...';
            await runFbStep1(data);
            btn1.innerText = 'Step 1: Done';
            btn1.style.background = '#ccc';
            btn1.style.color = '#333';
            btn2.style.background = '#1877f2';
            btn2.style.color = 'white';
        });

        btn2.addEventListener('click', async () => {
            btn2.innerText = 'Running...';
            await runFbStep2(data);
            btn2.innerText = 'Step 2: Done';
            btn2.style.background = '#ccc';
            btn2.style.color = '#333';
            btn3.style.background = '#1877f2';
            btn3.style.color = 'white';
        });

        btn3.addEventListener('click', async () => {
            btn3.innerText = 'Running...';
            await runFbStep3(data);
            btn3.innerText = 'Step 3: Done';
            btn3.style.background = '#ccc';
            btn3.style.color = '#333';
            logContainer.style.display = 'block';
        });

        document.getElementById('flo-fb-log-btn').addEventListener('click', () => {
            const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
            const logBtn = document.getElementById('flo-fb-log-btn');
            const status = document.getElementById('flo-fb-log-status');
            logBtn.disabled = true;
            logBtn.style.opacity = '0.7';
            status.innerText = 'Refreshing Facebook metadata...';
            updateProgressOverlay('facebook', 'Preparing Facebook scrape tabs...', 3);
            chrome.runtime.sendMessage({ action: 'processFacebookLog', data: data }, (response) => {
                if (response && response.success) {
                    successAudio.play().catch(() => {});
                    const remainingText = response.remainingCount > 0 ? ` ${response.remainingCount} link(s) remain in the queue.` : '';
                    status.innerText = `Logged! Closing.${remainingText}`;
                    status.style.color = 'green';
                    setTimeout(() => {
                        lastReportData = null;
                        cachedOverlay = null;
                        overlay.remove();
                    }, 2000);
                } else {
                    status.innerText = response?.error || 'Failed.';
                    status.style.color = 'red';
                    logBtn.disabled = false;
                    logBtn.style.opacity = '1';
                }
            });
        });
    }

    function createRumbleOverlay(data) {
        const existing = document.getElementById('flo-rumble-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'flo-rumble-overlay';
        overlay.style.cssText = `
          position: fixed; top: 80px; right: 20px; width: 340px;
          background: white; border: 3px solid #2f855a; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none;
        `;

        const session = data?.rumbleSession || {};
        const currentIndex = Number(session.currentIndex || 0) + 1;
        const total = Array.isArray(session.urls) ? session.urls.length : (data?.urls?.length || 0);
        const initialPercent = total > 0 ? Math.max(6, Math.round(((currentIndex - 1) / total) * 30)) : 6;

        overlay.innerHTML = `
          <div id="flo-rumble-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:8px;">
            <h3 style="margin:0; color:#2f855a; font-size:16px; pointer-events:none;">Rumble Reporter ✥</h3>
            <button id="flo-rumble-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">×</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="font-size:13px;">
              <strong>Queue:</strong> ${currentIndex}/${total || '?'}<br>
              <small>Submitting reports, then reopening the reported URLs for fresh evidence and sheet logging.</small>
            </div>
            <div style="background:#e5e7eb; border-radius:999px; height:10px; overflow:hidden;">
              <div id="flo-rumble-progress-bar" style="width:${initialPercent}%; height:100%; background:linear-gradient(90deg, #166534, #53fc18); transition:width 0.3s ease;"></div>
            </div>
            <div id="flo-rumble-progress-status" style="font-size:13px; font-weight:700; color:#111; line-height:1.4;">Preparing report...</div>
            <div id="flo-rumble-progress-meta" style="font-size:11px; color:#666;">Report ${currentIndex}/${total || '?'}</div>
            <div style="padding:10px 12px; border-radius:8px; background:#f5f5f5; border:1px solid #ddd; font-size:12px; color:#222;">
              <div style="font-weight:700; margin-bottom:6px;">What happens next</div>
              <div>1. Submit each queued Rumble report</div>
              <div>2. Reopen reported URLs for fresh views and handles</div>
              <div>3. Capture evidence screenshots</div>
              <div>4. Log the finished batch to the sheet</div>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);
        setupDrag(overlay);

        const closeBtn = document.getElementById('flo-rumble-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => overlay.remove());
        }

        if (hasRunRumbleAutomation) return;
        hasRunRumbleAutomation = true;

        const statusEl = document.getElementById('flo-rumble-progress-status');
        runRumbleReportSequence(data, statusEl).catch((error) => {
            if (statusEl) {
                statusEl.innerText = `❌ ${error.message}`;
                statusEl.style.color = '#ce0e2d';
            }
            updateProgressOverlay('rumble', error.message, 100, 'Needs attention');
            hasRunRumbleAutomation = false;
        });
    }

>>>>>>> Stashed changes
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
        let isWizMinimized = sessionStorage.getItem('floWizMinimized') === 'true';
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
        // Unlock audio context instantly on click
        const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
        successAudio.play().then(() => successAudio.pause()).catch(()=>{});

        const status = document.getElementById("flo-log-status");
        status.innerText = "Logging...";
        chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
          if (response && response.success) {
            successAudio.currentTime = 0;
            successAudio.play().catch(e => console.log("Audio blocked:", e));
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

    function createKickOverlay(data) {
      if (cachedOverlay && cachedOverlay.id === "flo-kick-overlay") {
          if (!document.getElementById("flo-kick-overlay")) {
              document.body.appendChild(cachedOverlay);
          }
          return;
      }

      const existing = document.getElementById("flo-kick-overlay");
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = "flo-kick-overlay";
      overlay.style.cssText = `
        position: fixed; top: 80px; right: 20px; width: 360px;
        background: white; border: 3px solid #53fc18; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
      `;

      cachedOverlay = overlay;
      document.body.appendChild(overlay);
      setupDrag(overlay);

      resolveReporterFullName(data).then((reporterFullName) => {
        const resolvedName = reporterFullName || 'Authorized user';
        const conf = AUTOFILL_CONFIG.kick?.autofill || {};
        const labels = conf.labels || {};
        const templates = conf.templates || {};
        const { recipient, subject, body, sections } = buildKickDmcaEmail(data, resolvedName);
        const urlCount = Array.isArray(data?.urls) ? data.urls.filter(Boolean).length : 0;
        const escapeHtml = (value) => String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        const escapeHtmlWithBreaks = (value) => escapeHtml(value).replace(/\n/g, '<br>');
        const overlayTitle = labels.overlay_title || 'Kick DMCA Composer ✥';
        const platformIntro = labels.platform_intro || 'Kick uses an email-based DMCA process. Copy the fields below, send the email, then use Log to Sheet to capture evidence and finish the report.';
        const queuedUrlsLabel = labels.queued_urls_label || 'Queued URLs:';
        const recipientTitle = labels.recipient_title || 'Send To';
        const recipientHelp = labels.recipient_help || 'Copy this email address into the To field in your email client.';
        const subjectTitle = labels.subject_title || 'Email Subject';
        const subjectHelp = labels.subject_help || 'Copy this subject line into the Subject field so the Kick notice is easy to identify.';
        const bodyTitle = labels.body_title || 'DMCA Notice Body';
        const bodyHelp = labels.body_help || 'Copy this full notice into the body of your email to Kick. The rendered box below shows the numbered sections and the original FloSports URL in bold.';
        const copyButtonLabel = labels.copy_button || 'Copy';
        const copyBodyButtonLabel = labels.copy_body_button || 'Copy Email';
        const copyFullButtonLabel = labels.copy_full_button || 'Copy Full Notice';
        const logReminder = labels.log_reminder || 'Send the email manually, then log below.';
        const logButtonLabel = labels.log_button || 'Log to Sheet';
        const loadingTitle = labels.loading_title || 'Kick logging in progress';
        const loadingHelp = labels.loading_help || 'We are revisiting each queued Kick URL, capturing fresh evidence screenshots, and then logging the batch to the sheet.';
        const loadingStepsTitle = labels.loading_steps_title || 'What happens next';
        const greetingLine = templates.greeting || 'To Whom It May Concern at Kick,';
        const submissionIntroLine = templates.submission_intro || 'I am submitting this DMCA takedown notice on behalf of FloSports.';
        const sourcePrefix = templates.source_url_label || 'Original FloSports URL being pirated:';
        const renderKickLine = (line) => {
          const normalized = String(line || '');
          if (normalized.startsWith(sourcePrefix)) {
            const sourceValue = normalized.slice(sourcePrefix.length).trim();
            return `<div style="margin-top:6px;"><strong>${escapeHtml(sourcePrefix)}</strong><br><strong style="color:#111;">${escapeHtml(sourceValue)}</strong></div>`;
          }
          if (normalized.endsWith(':')) {
            return `<div style="margin-top:6px; font-weight:700; color:#111;">${escapeHtml(normalized)}</div>`;
          }
          if (normalized.startsWith('- ')) {
            return `<div style="padding-left:12px; text-indent:-10px; color:#111;">• ${escapeHtml(normalized.slice(2))}</div>`;
          }
          return `<div style="color:#111;">${escapeHtmlWithBreaks(normalized)}</div>`;
        };
        const sectionHtml = sections.map((section) => `
          <div style="margin-bottom:14px;">
            <div style="font-weight:800; color:#111; margin-bottom:6px;">${section.number}. ${escapeHtml(section.title)}</div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              ${section.lines.map(renderKickLine).join('')}
            </div>
          </div>
        `).join('');
        const renderKickLoadingState = (statusText = 'Preparing screenshots and logs...') => {
          mainContent.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div style="font-size:14px; font-weight:800; color:#0f7a2a;">${escapeHtml(loadingTitle)}</div>
              <div style="font-size:12px; color:#444;">${escapeHtml(loadingHelp)}</div>
              <div style="background:#e5e7eb; border-radius:999px; height:10px; overflow:hidden;">
                <div id="flo-kick-progress-bar" style="width:8%; height:100%; background:linear-gradient(90deg, #0f7a2a, #53fc18); transition:width 0.3s ease;"></div>
              </div>
              <div id="flo-kick-progress-status" style="font-size:13px; font-weight:700; color:#111;">${escapeHtml(statusText)}</div>
              <div id="flo-kick-progress-meta" style="font-size:11px; color:#666;">0% complete</div>
              <div style="padding:10px 12px; border-radius:8px; background:#f5f5f5; border:1px solid #ddd; font-size:12px; color:#222;">
                <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(loadingStepsTitle)}</div>
                <div>1. Open each queued Kick URL</div>
                <div>2. Capture fresh evidence screenshots</div>
                <div>3. Upload evidence and generate report links</div>
                <div>4. Log the finished batch to the sheet</div>
              </div>
            </div>
          `;
        };

        overlay.innerHTML = `
          <div id="flo-kick-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <h3 id="flo-kick-title" style="margin:0; color:#0f7a2a; font-size:16px; pointer-events:none;">${escapeHtml(overlayTitle)}</h3>
            <div>
                <button id="flo-kick-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
                <button id="flo-kick-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
            </div>
          </div>
          <div id="flo-kick-main-content">
            <div style="font-size:12px; color:#555; margin-bottom:10px;">${escapeHtml(platformIntro)} <strong>${escapeHtml(queuedUrlsLabel)}</strong> ${urlCount}</div>

            <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">${escapeHtml(recipientTitle)}</label>
            <div style="font-size:11px; color:#555; margin-bottom:6px;">${escapeHtml(recipientHelp)}</div>
            <div style="display:flex; gap:6px; margin-bottom:10px;">
              <div id="flo-kick-to" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:4px; background:#f5f5f5; color:#111; box-sizing:border-box; user-select:text; word-break:break-word;">${escapeHtml(recipient)}</div>
              <button id="flo-kick-copy-to" style="background:#0f7a2a; color:white; border:none; padding:8px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">${escapeHtml(copyButtonLabel)}</button>
            </div>

            <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">${escapeHtml(subjectTitle)}</label>
            <div style="font-size:11px; color:#555; margin-bottom:6px;">${escapeHtml(subjectHelp)}</div>
            <div style="display:flex; gap:6px; margin-bottom:10px;">
              <div id="flo-kick-subject" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:4px; background:#f5f5f5; color:#111; box-sizing:border-box; user-select:text; word-break:break-word;">${escapeHtml(subject)}</div>
              <button id="flo-kick-copy-subject" style="background:#0f7a2a; color:white; border:none; padding:8px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">${escapeHtml(copyButtonLabel)}</button>
            </div>

            <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">${escapeHtml(bodyTitle)}</label>
            <div style="font-size:11px; color:#555; margin-bottom:6px;">${escapeHtml(bodyHelp)}</div>
            <div id="flo-kick-body" style="width:100%; height:320px; overflow:auto; padding:12px; border:1px solid #ccc; border-radius:4px; background:#f5f5f5; color:#111; font-size:12px; line-height:1.45; box-sizing:border-box; user-select:text;">
              <div style="font-weight:700; color:#111; margin-bottom:8px;">${escapeHtml(greetingLine)}</div>
              <div style="margin-bottom:12px; color:#111;">${escapeHtml(submissionIntroLine)}</div>
              ${sectionHtml}
            </div>

            <div style="display:flex; gap:8px; margin-top:10px;">
              <button id="flo-kick-copy-body" style="flex:1; background:#0f7a2a; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:bold;">${escapeHtml(copyBodyButtonLabel)}</button>
              <button id="flo-kick-copy-full" style="flex:1; background:#1f2937; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:bold;">${escapeHtml(copyFullButtonLabel)}</button>
            </div>

            <div style="margin-top: 12px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
              ${escapeHtml(logReminder)}
            </div>
            <button id="flo-kick-log-btn" style="margin-top:10px; background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">${escapeHtml(logButtonLabel)}</button>
            <div id="flo-kick-log-status" style="margin-top:8px; font-size:12px; text-align:center;"></div>
          </div>
        `;

        const status = () => document.getElementById('flo-kick-log-status');
        const writeClipboard = async (value, message) => {
          try {
            await navigator.clipboard.writeText(value);
            if (status()) {
              status().innerText = message;
              status().style.color = '#0f7a2a';
              setTimeout(() => {
                if (status() && status().innerText === message) status().innerText = '';
              }, 1800);
            }
          } catch (error) {
            if (status()) {
              status().innerText = 'Clipboard copy failed. Please copy manually.';
              status().style.color = '#ce0e2d';
            }
          }
        };

        let isKickMinimized = false;
        const minBtn = document.getElementById('flo-kick-min-btn');
        const closeBtn = document.getElementById('flo-kick-close-btn');
        const mainContent = document.getElementById('flo-kick-main-content');
        const title = document.getElementById('flo-kick-title');
        const topBar = document.getElementById('flo-kick-top-bar');

        minBtn.addEventListener('click', () => {
          isKickMinimized = !isKickMinimized;
          if (isKickMinimized) {
            mainContent.style.display = 'none';
            minBtn.innerHTML = '+';
            title.innerText = '✥';
            overlay.style.width = 'auto';
            overlay.style.padding = '8px';
            topBar.style.borderBottom = 'none';
            topBar.style.marginBottom = '0';
            topBar.style.paddingBottom = '0';
            overlay.style.left = 'auto';
            overlay.style.right = '0px';
            overlay.style.borderTopRightRadius = '0';
            overlay.style.borderBottomRightRadius = '0';
          } else {
            mainContent.style.display = 'block';
            minBtn.innerHTML = '−';
            title.innerText = overlayTitle;
            overlay.style.width = '360px';
            overlay.style.padding = '15px';
            topBar.style.borderBottom = '1px solid #eee';
            topBar.style.marginBottom = '10px';
            topBar.style.paddingBottom = '8px';
            overlay.style.borderRadius = '8px';
            overlay.style.right = '20px';
          }
        });

        closeBtn.addEventListener('click', () => overlay.remove());
        document.getElementById('flo-kick-copy-to').addEventListener('click', () => void writeClipboard(recipient, 'Copied Kick DMCA address.'));
        document.getElementById('flo-kick-copy-subject').addEventListener('click', () => void writeClipboard(subject, 'Copied subject.'));
        document.getElementById('flo-kick-copy-body').addEventListener('click', () => void writeClipboard(body, 'Copied DMCA email body.'));
        document.getElementById('flo-kick-copy-full').addEventListener('click', () => void writeClipboard(`To: ${recipient}\nSubject: ${subject}\n\n${body}`, 'Copied full DMCA notice.'));
        document.getElementById('flo-kick-log-btn').addEventListener('click', () => {
          renderKickLoadingState('Opening queued Kick URLs for screenshots...');
          chrome.runtime.sendMessage({
            action: "processKickLog",
            data: {
              ...data,
              reporterName: resolvedName,
              mode: 'enforcer',
              uploadScreenshots: true
            }
          }, (response) => {
            if (response && response.success) {
              new Audio(chrome.runtime.getURL('jingle.mp3')).play().catch(()=>{});
              const kickStatus = document.getElementById('flo-kick-progress-status');
              const kickMeta = document.getElementById('flo-kick-progress-meta');
              const kickBar = document.getElementById('flo-kick-progress-bar');
              if (kickStatus) kickStatus.innerText = "✅ Logged! Closing...";
              if (kickMeta) kickMeta.innerText = '100% complete';
              if (kickBar) kickBar.style.width = '100%';
              setTimeout(() => {
                  lastReportData = null;
                  cachedOverlay = null;
                  overlay.remove();
              }, 2000);
            } else {
              const kickStatus = document.getElementById('flo-kick-progress-status');
              const kickMeta = document.getElementById('flo-kick-progress-meta');
              if (kickStatus) kickStatus.innerText = response?.error || "❌ Failed.";
              if (kickMeta) kickMeta.innerText = 'Needs attention';
            }
          });
        });
      });
    }

    function getTwitchAutofillConfig() {
      const conf = AUTOFILL_CONFIG.twitch?.autofill || {};
      const fields = conf.fields || {};
      const twitchSelectors = (configuredSelectors, fallbackSelectors) =>
        mergeSelectorFallbacks(fallbackSelectors, configuredSelectors);

      return {
        fields: {
          copyrighted_work_description: twitchSelectors(fields.copyrighted_work_description || fields.description, [
            'textarea[name="copyrightWorkAllegedlyInfringed"]',
            'textarea[data-test-selector="copyrightWorkAllegedlyInfringed"]',
            'textarea[aria-label*="Describe the copyrighted work" i]',
            'textarea[aria-labelledby*="copyrightWorkAllegedlyInfringed" i]',
            'input[name="copyrightWorkAllegedlyInfringed"]',
            'input[aria-label*="Describe the copyrighted work" i]'
          ]),
          work_type_select: twitchSelectors(fields.work_type_select, [
            'select[aria-label*="best describes the copyrighted work" i]',
            'select[name*="copyright" i]'
          ]),
          source_url: twitchSelectors(fields.source_url, [
            'input[name="copyrightWorkUrl"]',
            'input[data-test-selector="copyrightWorkUrl"]',
            'input[aria-labelledby*="copyrightWorkUrl" i]',
            'input[aria-label*="example of the copyrighted work" i]',
            'input[placeholder*="http" i][name*="copyright" i]'
          ]),
          content_type_select: fields.content_type_select || [
            'select[aria-label="Select allegedly infringing content type"]',
            'select[aria-label*="infringing content type" i]'
          ],
          full_name: twitchSelectors(fields.full_name, [
            'input[data-test-selector="claimantName"]',
            'input[name="claimantName"]',
            'input[aria-label*="Your name or organization" i]',
            'input[name*="name" i]'
          ]),
          relationship: fields.relationship || [
            'input[data-test-selector="relationship"]',
            'input[name="relationship"]',
            'select[aria-label*="Relationship to copyrighted work" i]',
            'select[name*="relationship" i]',
            'input[aria-label*="Relationship to copyrighted work" i]'
          ],
          email: fields.email || [
            'input[data-test-selector="email"]',
            'input[name="email"]',
            'input[aria-label*="Email Address" i]',
            'input[type="email"]',
            'input[name*="email" i]'
          ],
          country: fields.country || [
            'select[data-test-selector="country"]',
            'select[name="country"]',
            'select[aria-label*="Country" i]',
            'select[name*="country" i]'
          ],
          city: fields.city || [
            'input[data-test-selector="city"]',
            'input[name="city"]',
            'input[aria-label*="City" i]',
            'input[name*="city" i]'
          ],
          copyright_owner: fields.copyright_owner || [
            'input[data-test-selector="ownerName"]',
            'input[name="ownerName"]',
            'input[aria-label*="Name of copyright owner" i]',
            'input[name*="owner" i]'
          ],
          phone: fields.phone || [
            'input[data-test-selector="phoneNumber"]',
            'input[name="phoneNumber"]',
            'input[aria-label*="Phone number" i]',
            'input[type="tel"]',
            'input[name*="phone" i]'
          ],
          street: fields.street || [
            'input[data-test-selector="streetAddress"]',
            'input[name="streetAddress"]',
            'input[aria-label*="Street address" i]',
            'textarea[aria-label*="Street address" i]',
            'input[name*="address" i]'
          ],
          state: fields.state || [
            'select[data-test-selector="stateOrProvince"]',
            'select[name="stateOrProvince"]',
            'select[aria-label*="State" i]',
            'select[aria-label*="Province" i]',
            'select[name*="state" i]'
          ],
          zip: fields.zip || [
            'input[data-test-selector="postalCode"]',
            'input[data-test-selector="zipCode"]',
            'input[data-test-selector="zipPostalCode"]',
            'input[name="postalCode"]',
            'input[name="zipCode"]',
            'input[name="zipPostalCode"]',
            'input[aria-label*="Zip" i]',
            'input[aria-label*="Postal Code" i]',
            'input[name*="zip" i]',
            'input[name*="postal" i]'
          ],
          signature: fields.signature || [
            'input[data-test-selector="signature"]',
            'input[name="signature"]',
            'input[aria-label*="electronic signature" i]',
            'input[aria-label*="Typing your full name" i]',
            'input[name*="signature" i]'
          ],
          acknowledgements: fields.acknowledgements || [
            'input[name="goodFaithCheckBox"]',
            'input[data-test-selector="goodFaithCheckBox"]',
            'input[name="notificationAccurateCheckBox"]',
            'input[data-test-selector="notificationAccurateCheckBox"]',
            'input[name="underPenaltyCheckBox"]',
            'input[data-test-selector="underPenaltyCheckBox"]'
          ],
          submit_button: fields.submit_button || [
            'button[type="submit"]',
            '//button[contains(normalize-space(.), "Submit")]'
          ]
        },
        defaults: {
          work_type: 'Video',
          relationship: 'Authorized Agent',
          contact_email: TWITCH_CONTACT_EMAIL,
          country: 'United States',
          city: TWITCH_CITY,
          copyright_owner: COPYRIGHT_OWNER_NAME,
          phone: TWITCH_CONTACT_PHONE,
          street: TWITCH_STREET_ADDRESS,
          state: TWITCH_STATE,
          zip: TWITCH_ZIP,
          ...(conf.defaults || {})
        }
      };
    }

    function escapeTwitchHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function uniqueTwitchUrls(urls) {
      const seen = new Set();
      return (Array.isArray(urls) ? urls : [])
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .filter((url) => {
          const key = normalizeRuntimeUrl(url).toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }

    async function getFreshTwitchReportData(data = {}) {
      try {
        const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
        const cart = Array.isArray(res.piracy_cart) ? res.piracy_cart : [];
        const info = res.reporterInfo || {};
        const dataItems = Array.isArray(data?.items) ? data.items : [];
        const items = cart.length > 0 ? cart : dataItems;
        const cartUrls = items.map((item) => typeof item === 'string' ? item : item?.url);
        const dataUrls = Array.isArray(data?.urls) ? data.urls : [];
        const reporterName = firstUsableReporterName(info.name, data?.fullName, data?.reporterName, data?.name) ||
          deriveReporterNameFromEmail(info.email || data?.email);
        const freshData = {
          ...data,
          fullName: reporterName,
          reporterName,
          email: info.email || data?.email || 'copyright@flosports.tv',
          urls: uniqueTwitchUrls([...cartUrls, ...dataUrls]),
          items,
          platform: 'Twitch',
          eventName: info.eventName || data?.eventName || '',
          vertical: info.vertical || data?.vertical || '',
          sourceUrl: info.sourceUrl || data?.sourceUrl || ''
        };
        lastReportData = freshData;
        return freshData;
      } catch (error) {
        const reporterName = firstUsableReporterName(data?.fullName, data?.reporterName, data?.name) ||
          deriveReporterNameFromEmail(data?.email);
        return {
          ...data,
          fullName: reporterName,
          reporterName,
          urls: uniqueTwitchUrls(data?.urls || []),
          items: Array.isArray(data?.items) ? data.items : []
        };
      }
    }

    function isTwitchClipUrl(url) {
      try {
        const parsed = new URL(String(url || ''));
        const host = parsed.hostname.toLowerCase();
        const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
        const firstSegment = segments[0] || '';
        return host.includes('clips.twitch.tv') ||
          firstSegment === 'clip' ||
          segments.includes('clip');
      } catch (error) {
        return /twitch\.tv\/([^/]+\/)?clip\//i.test(String(url || '')) ||
          /clips\.twitch\.tv/i.test(String(url || ''));
      }
    }

    function isTwitchVodUrl(url) {
      if (isTwitchClipUrl(url)) return false;
      try {
        const parsed = new URL(String(url || ''));
        const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
        const firstSegment = segments[0] || '';
        return firstSegment === 'videos' ||
          firstSegment === 'collections';
      } catch (error) {
        return /twitch\.tv\/(videos|collections)\//i.test(String(url || ''));
      }
    }

    function classifyTwitchReportItems(data = {}) {
      const rawItems = Array.isArray(data.items) && data.items.length > 0
        ? data.items
        : uniqueTwitchUrls(data.urls || []).map((url) => ({ url }));
      const liveUrls = [];
      const vodUrls = [];
      const clipUrls = [];
      const seen = new Set();

      rawItems.forEach((item) => {
        const url = typeof item === 'string' ? item : item?.url;
        if (!url) return;
        const key = normalizeRuntimeUrl(url).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        const contentType = String(item?.contentType || item?.mediaType || '').toLowerCase();
        const looksClip = contentType.includes('clip') || isTwitchClipUrl(url);
        const looksVod = !looksClip && (contentType.includes('vod') ||
          contentType.includes('video') ||
          (item?.isLive === false && !!contentType) ||
          isTwitchVodUrl(url));

        if (looksClip) clipUrls.push(url);
        else if (looksVod) vodUrls.push(url);
        else liveUrls.push(url);
      });

      return { liveUrls, vodUrls, clipUrls };
    }

    function setTwitchSelectOption(select, matchers) {
      if (!select) return false;
      const matcherList = Array.isArray(matchers) ? matchers : [matchers];
      const options = Array.from(select.options || []);
      const targetOption = options.find((option) =>
        matcherList.some((matcher) => String(option.value || '').toLowerCase() === String(matcher || '').toLowerCase())
      ) || options.find((option) =>
        matcherList.some((matcher) => matchesAnyText(option.textContent || option.innerText || '', matcher))
      ) || options.find((option) =>
        matcherList.some((matcher) => matchesAnyText(option.value || '', matcher))
      );

      if (!targetOption) return false;
      select.scrollIntoView({ block: 'center', behavior: 'smooth' });
      select.focus();
      setNativeValue(select, targetOption.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }

    function selectTwitchOption(selectors, labels, matchers) {
      const select = findVisibleElement(selectors) || findControlByLabelText(labels, 'select');
      return setTwitchSelectOption(select, matchers);
    }

    function selectTwitchVisibleSelectByOption(matchers) {
      const selects = Array.from(document.querySelectorAll('select')).filter(isVisible);
      for (const select of selects) {
        if (setTwitchSelectOption(select, matchers)) return true;
      }
      return false;
    }

    function getVisibleTwitchContentSelect() {
      const { fields } = getTwitchAutofillConfig();
      const configured = findVisibleElement(fields.content_type_select);
      if (configured?.tagName === 'SELECT') return configured;

      return Array.from(document.querySelectorAll('select'))
        .filter(isVisible)
        .find((select) => Array.from(select.options || []).some((option) =>
          ['live-stream', 'vod', 'clip'].includes(String(option.value || '').toLowerCase()) ||
          matchesAnyText(option.textContent || '', ['Live Broadcast', 'VOD', 'Clip'])
        )) || null;
    }

    async function waitForTwitchContentSelect(timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const select = getVisibleTwitchContentSelect();
        if (select) return select;
        await sleep(200);
      }
      return null;
    }

    function findTwitchButtonByText(texts, allowDisabled = false) {
      const textList = Array.isArray(texts) ? texts : [texts];
      return Array.from(document.querySelectorAll('button'))
        .find((button) =>
          isVisible(button) &&
          (allowDisabled || !button.disabled) &&
          textList.some((text) => matchesAnyText(button.innerText || button.textContent || '', text))
        ) || null;
    }

    async function waitForTwitchButtonByText(texts, timeout = 5000, allowDisabled = false) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const button = findTwitchButtonByText(texts, allowDisabled);
        if (button) return button;
        await sleep(200);
      }
      return null;
    }

    function findTwitchInputAfterSelect(select) {
      if (!select) return null;
      const input = document.evaluate(
        'following::*[(self::input or self::textarea) and not(@type="hidden")][1]',
        select,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      return input && isVisible(input) ? input : null;
    }

    async function waitForTwitchUrlInput(select, labels, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const inputAfterSelect = findTwitchInputAfterSelect(select);
        if (inputAfterSelect) return inputAfterSelect;

        const labelInput = findControlByLabelText(labels, 'input, textarea');
        if (labelInput) return labelInput;

        const visibleInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea'))
          .filter(isVisible);
        if (visibleInputs.length > 0) return visibleInputs[visibleInputs.length - 1];
        await sleep(200);
      }
      return null;
    }

    async function addTwitchUrlToList(url, contentKind) {
      const twitchContentTypeConfigs = {
        live: {
          matchers: ['live-stream', 'Live Broadcast'],
          labels: ['Live URL', 'Live Broadcast URL', 'URL'],
          descriptor: 'Live Broadcast'
        },
        vod: {
          matchers: ['vod', 'VOD', 'VOD (includes Highlights, Channel Trailer, etc.)'],
          labels: ['VOD URL', 'Video URL', 'URL'],
          descriptor: 'VOD'
        },
        clip: {
          matchers: ['clip', 'Clip'],
          labels: ['Clip URL', 'URL'],
          descriptor: 'Clip'
        }
      };
      const typeConfig = twitchContentTypeConfigs[contentKind] || twitchContentTypeConfigs.live;
      const addUrlButton = await waitForTwitchButtonByText([
        'Add a URL',
        'Add another URL',
        'Add Another URL',
        'Add a new URL'
      ], 2500);

      if (addUrlButton) {
        clickElement(addUrlButton);
        await sleep(300);
      }

      const select = await waitForTwitchContentSelect(6000);
      if (!select) {
        throw new Error('Could not find Twitch content type selector.');
      }

      const selected = setTwitchSelectOption(
        select,
        typeConfig.matchers
      );
      if (!selected) {
        throw new Error(`Could not select Twitch ${typeConfig.descriptor} option.`);
      }

      await sleep(400);
      if (contentKind === 'live') {
        checkChoiceField(null, ['Broadcast is currently live'], 'Broadcast is currently live', 'checkbox');
      }

      const input = await waitForTwitchUrlInput(
        select,
        typeConfig.labels
      );
      if (!input) {
        throw new Error(`Could not find Twitch ${typeConfig.descriptor} URL field.`);
      }

      typeValue(input, url);
      await sleep(350);

      const addToListButton = await waitForTwitchButtonByText(['Add to List', 'Add to list'], 6000);
      if (!addToListButton) {
        throw new Error('Could not find enabled Twitch Add to List button.');
      }

      clickElement(addToListButton);
      await sleep(900);
    }

    async function runTwitchStep1(data) {
      const freshData = await getFreshTwitchReportData(data);
      const { fields, defaults } = getTwitchAutofillConfig();
      const eventName = freshData.eventName || 'FloSports Event';
      const sourceUrl = freshData.sourceUrl || freshData.eventUrl || freshData.originalUrl || defaults.source_url || '';

      const descriptionFilled = await fillFieldWithFallbackWhenReady(
        fields.copyrighted_work_description,
        ['Describe the copyrighted work'],
        eventName,
        3500
      );
      selectTwitchOption(
        fields.work_type_select,
        ['Which of these best describes the copyrighted work'],
        defaults.work_type || 'Video'
      ) || selectTwitchVisibleSelectByOption(defaults.work_type || 'Video');
      await sleep(350);
      const sourceFilled = await fillFieldWithFallbackWhenReady(
        fields.source_url,
        ['Link [URL] to an example of the copyrighted work', 'example of the copyrighted work'],
        sourceUrl,
        3500
      );

      if (!descriptionFilled) {
        throw new Error('Could not find Twitch "Describe the copyrighted work" field.');
      }

      if (sourceUrl && !sourceFilled) {
        throw new Error('Could not find Twitch copyrighted work URL field.');
      }
    }

    async function runTwitchStep2(data) {
      const freshData = await getFreshTwitchReportData(data);
      const { liveUrls, vodUrls, clipUrls } = classifyTwitchReportItems(freshData);

      for (const url of liveUrls) {
        await addTwitchUrlToList(url, 'live');
      }

      for (const url of vodUrls) {
        await addTwitchUrlToList(url, 'vod');
      }

      for (const url of clipUrls) {
        await addTwitchUrlToList(url, 'clip');
      }

      return { liveCount: liveUrls.length, vodCount: vodUrls.length, clipCount: clipUrls.length };
    }

    async function runTwitchStep3(data) {
      const freshData = await getFreshTwitchReportData(data);
      const reporterFullName = await resolveReporterFullName(freshData);
      const { fields, defaults } = getTwitchAutofillConfig();
      const relationshipTextFields = (Array.isArray(fields.relationship) ? fields.relationship : [fields.relationship])
        .filter((selector) => selector && !String(selector).trim().startsWith('select'));

      if (!reporterFullName) {
        throw new Error('Reporter name is missing. Enter your name in the side panel and start the Twitch report again.');
      }

      const nameFilled = await fillFieldWithFallbackWhenReady(fields.full_name, ['Your name or organization'], reporterFullName, 3500);
      if (!nameFilled) {
        throw new Error('Could not find Twitch "Your name or organization" field.');
      }
      fillFieldWithFallback(relationshipTextFields, ['Relationship to copyrighted work'], defaults.relationship) ||
        selectTwitchOption(fields.relationship, ['Relationship to copyrighted work'], defaults.relationship) ||
        selectTwitchVisibleSelectByOption(defaults.relationship);
      fillFieldWithFallback(fields.email, ['Email Address', 'Email'], defaults.contact_email || TWITCH_CONTACT_EMAIL);
      selectTwitchOption(fields.country, ['Country'], defaults.country || 'United States') ||
        selectTwitchVisibleSelectByOption([defaults.country || 'United States', 'US']);
      fillFieldWithFallback(fields.city, ['City'], defaults.city || TWITCH_CITY);
      fillFieldWithFallback(fields.copyright_owner, ['Name of copyright owner'], defaults.copyright_owner || COPYRIGHT_OWNER_NAME);
      fillFieldWithFallback(fields.phone, ['Phone number', 'Phone'], defaults.phone || TWITCH_CONTACT_PHONE);
      fillFieldWithFallback(fields.street, ['Street address'], defaults.street || TWITCH_STREET_ADDRESS);
      selectTwitchOption(fields.state, ['State/Province', 'State', 'Province'], [defaults.state || TWITCH_STATE, 'TX']) ||
        selectTwitchVisibleSelectByOption([defaults.state || TWITCH_STATE, 'TX']);
      fillFieldWithFallback(fields.zip, ['Zip/Postal Code', 'Zip', 'Postal Code'], defaults.zip || TWITCH_ZIP);

      const acknowledgementTexts = [
        'good faith belief',
        'This notification is accurate',
        'UNDER PENALTY OF PERJURY',
        'authorized to act on behalf'
      ];

      findControls(fields.acknowledgements).forEach((checkbox) => checkReactCheckbox(checkbox));
      acknowledgementTexts.forEach((text) => {
        checkChoiceField(null, [text], text, 'checkbox');
      });

      fillFieldWithFallback(
        fields.signature,
        ['Typing your full name in this box will act as your electronic signature', 'electronic signature', 'Signature'],
        reporterFullName
      );

      const submitBtn = await waitForVisibleElement(fields.submit_button, 1000);
      if (submitBtn) {
        submitBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
        submitBtn.style.border = '4px solid #ce0e2d';
        submitBtn.disabled = false;
      }
    }

    function createTwitchOverlay(data) {
      if (cachedOverlay && cachedOverlay.id === 'flo-twitch-overlay') {
        if (!document.getElementById('flo-twitch-overlay')) {
          document.body.appendChild(cachedOverlay);
        }
        return;
      }

      const existing = document.getElementById('flo-twitch-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'flo-twitch-overlay';
      overlay.style.cssText = `
        position: fixed; top: 80px; right: 20px; width: 320px;
        background: white; border: 3px solid #9146ff; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 2147483647; padding: 15px; font-family: sans-serif; border-radius: 8px; cursor: move; user-select: none; transition: all 0.3s ease;
      `;

      const initialCounts = classifyTwitchReportItems(data);
      overlay.innerHTML = `
        <div id="flo-twitch-top-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
          <h3 id="flo-twitch-title" style="margin:0; color:#9146ff; font-size:16px; pointer-events:none;">Twitch Wizard ✥</h3>
          <div>
            <button id="flo-twitch-min-btn" style="background:none; border:none; font-size:20px; cursor:pointer; color:#999; line-height:1; padding:0 5px;">−</button>
            <button id="flo-twitch-close-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999; line-height:1; padding:0 5px; margin-left: 2px;">×</button>
          </div>
        </div>

        <div id="flo-twitch-main-content">
          <div style="margin-bottom: 12px; font-size: 13px;">
            <small>Use the 3 buttons on the Twitch copyright-claims form, then review and submit on Twitch.</small>
            <div style="margin-top:6px; color:#555;">Queued: ${initialCounts.liveUrls.length} live, ${initialCounts.vodUrls.length} VOD, ${initialCounts.clipUrls.length} clip</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="flo-twitch-btn-step1" style="background: #9146ff; color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Button 1: Copyrighted Work</button>
            <button id="flo-twitch-btn-step2" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Button 2: Content To Be Removed</button>
            <button id="flo-twitch-btn-step3" style="background: #ccc; color: #333; border: none; padding: 10px; cursor: pointer; border-radius: 4px; font-weight:bold;">Button 3: Contact & Legal</button>
          </div>

          <div id="flo-twitch-status" style="margin-top:10px; font-size:12px; color:#555; min-height:16px;"></div>

          <div id="flo-twitch-log-container" style="display:none; margin-top: 15px;">
            <div style="margin-bottom: 8px; font-size: 12px; color: #ce0e2d; font-weight: bold; text-align: center;">
              Click Submit on Twitch first, then log below.
            </div>
            <button id="flo-twitch-log-btn" style="background: #ce0e2d; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-weight:bold; width:100%;">Log to Sheet</button>
            <div id="flo-twitch-log-status" style="margin-top:8px; font-size:12px; text-align:center;"></div>
          </div>
        </div>
      `;

      cachedOverlay = overlay;
      document.body.appendChild(overlay);
      setupDrag(overlay);

      let isMinimized = false;
      const minBtn = document.getElementById('flo-twitch-min-btn');
      const closeBtn = document.getElementById('flo-twitch-close-btn');
      const mainContent = document.getElementById('flo-twitch-main-content');
      const title = document.getElementById('flo-twitch-title');
      const topBar = document.getElementById('flo-twitch-top-bar');
      const status = document.getElementById('flo-twitch-status');
      const setStatus = (message, color = '#555') => {
        status.innerText = message;
        status.style.color = color;
      };

      minBtn.addEventListener('click', () => {
        isMinimized = !isMinimized;
        if (isMinimized) {
          mainContent.style.display = 'none';
          minBtn.innerHTML = '+';
          title.innerText = 'Twitch ✥';
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
          title.innerText = 'Twitch Wizard ✥';
          overlay.style.width = '320px';
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

      const btn1 = document.getElementById('flo-twitch-btn-step1');
      const btn2 = document.getElementById('flo-twitch-btn-step2');
      const btn3 = document.getElementById('flo-twitch-btn-step3');
      const logContainer = document.getElementById('flo-twitch-log-container');

      btn1.addEventListener('click', async () => {
        btn1.innerText = 'Running...';
        setStatus('Filling copyrighted work details...');
        try {
          await runTwitchStep1(data);
          btn1.innerText = 'Button 1: Done';
          btn1.style.background = '#ccc';
          btn1.style.color = '#333';
          btn2.style.background = '#9146ff';
          btn2.style.color = 'white';
          setStatus('Copyrighted work fields filled.', '#0f7a2a');
        } catch (error) {
          btn1.innerText = 'Button 1: Try Again';
          setStatus(error?.message || 'Twitch Button 1 failed.', '#ce0e2d');
        }
      });

      btn2.addEventListener('click', async () => {
        btn2.innerText = 'Running...';
        setStatus('Adding Twitch live, VOD, and clip URLs...');
        try {
          const result = await runTwitchStep2(data);
          btn2.innerText = 'Button 2: Done';
          btn2.style.background = '#ccc';
          btn2.style.color = '#333';
          btn3.style.background = '#9146ff';
          btn3.style.color = 'white';
          setStatus(`Added ${result.liveCount} live, ${result.vodCount} VOD, and ${result.clipCount} clip URL(s).`, '#0f7a2a');
        } catch (error) {
          btn2.innerText = 'Button 2: Try Again';
          setStatus(error?.message || 'Twitch Button 2 failed.', '#ce0e2d');
        }
      });

      btn3.addEventListener('click', async () => {
        btn3.innerText = 'Running...';
        setStatus('Filling contact, legal, and signature fields...');
        try {
          await runTwitchStep3(data);
          btn3.innerText = 'Button 3: Done';
          btn3.style.background = '#ccc';
          btn3.style.color = '#333';
          logContainer.style.display = 'block';
          overlay.style.borderColor = '#ce0e2d';
          setStatus('Contact and legal fields filled. Review before submitting.', '#0f7a2a');
        } catch (error) {
          btn3.innerText = 'Button 3: Try Again';
          setStatus(error?.message || 'Twitch Button 3 failed.', '#ce0e2d');
        }
      });

      document.getElementById('flo-twitch-log-btn').addEventListener('click', async () => {
        const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
        const logStatus = document.getElementById('flo-twitch-log-status');
        logStatus.innerText = 'Logging...';
        const freshData = await getFreshTwitchReportData(data);
        chrome.runtime.sendMessage({
          action: 'processTwitchLog',
          data: {
            ...freshData,
            mode: 'enforcer',
            uploadScreenshots: true
          }
        }, (response) => {
          if (response && response.success) {
            successAudio.play().catch(() => {});
            logStatus.innerText = 'Logged. Closing...';
            logStatus.style.color = 'green';
            setTimeout(() => {
              lastReportData = null;
              cachedOverlay = null;
              overlay.remove();
            }, 2000);
          } else {
            logStatus.innerText = escapeTwitchHtml(response?.error || 'Failed.');
            logStatus.style.color = 'red';
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
        let isWizMinimized = sessionStorage.getItem('floWizMinimized') === 'true';
        const minBtn = document.getElementById('flo-wiz-min-btn');
        const closeBtn = document.getElementById('flo-wiz-close-btn');
        const mainContent = document.getElementById('flo-wiz-main-content');
        const title = document.getElementById('flo-wiz-title');
        const topBar = document.getElementById('flo-wiz-top-bar');

        minBtn.addEventListener('click', () => {
            isWizMinimized = !isWizMinimized;
            sessionStorage.setItem('floWizMinimized', isWizMinimized);
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
            new Audio(chrome.runtime.getURL('jingle.mp3')).play().catch(()=>{});
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

    document.getElementById("flo-log-btn").addEventListener("click", (e) => {
        // 1. Create the audio object IMMEDIATELY on click to capture user permission
        const successAudio = new Audio(chrome.runtime.getURL('jingle.mp3'));
        
        if (e.target) e.target.disabled = true;
        const status = document.getElementById("flo-log-status");
        status.innerText = "Logging...";
        
        chrome.runtime.sendMessage({ action: "logToSheet", data: data }, (response) => {
          if (response && response.success) {
            // 2. Play the pre-authorized audio object
            successAudio.play().catch(err => console.warn("Audio blocked:", err));
            status.innerText = "✅ Logged! Closing..."; status.style.color = "green";
            setTimeout(() => {
              lastReportData = null; // Clear so the interval stops 
              cachedOverlay = null;  
              overlay.remove();
          }, 2000);
        } else {
          status.innerText = "❌ Failed."; status.style.color = "red";
          e.target.disabled = false;
          e.target.innerText = "Log to Sheet";
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
    // 4. STRATEGY LOGIC (YOUTUBE, ETC)
    // ==========================================
    async function runYtStep1(data) {
        console.log("📝 Running YouTube Step 1: Videos...");
        const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
        const defaults = conf.defaults || {};
        
        // 1. IMPOSE THE 10 VIDEO LIMIT
            const infringingUrls = data.urls || [];
            const MAX_YOUTUBE_URLS = 10;
            const urlsToReport = infringingUrls.slice(0, MAX_YOUTUBE_URLS);

            if (infringingUrls.length > MAX_YOUTUBE_URLS) {
                console.warn(`YouTube limits 10 videos per form. Only processing the first 10.`);
                alert(`YouTube Limits Reports to 10 Videos.\n\nThe first 10 videos have been loaded into this form. The remaining videos have been saved in your cart. After submitting this batch, run the reporter again to process the rest.`);
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
        const fillYtcpInput = (selectors, val) => {
            if (!selectors || !val) return;
            // Split comma-separated strings into an array to check each selector safely
            const sels = typeof selectors === 'string' ? selectors.split(',').map(s => s.trim()) : selectors;
            let found = false;
            for (const sel of sels) {
                let el = sel.startsWith('//')
                    ? document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                    : document.querySelector(sel);
                if (el) {
                    // Find inner input if targeting a wrapper
                    const innerInput = el.querySelector('input, textarea') || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : null);
                    if (innerInput) {
                        typeValue(innerInput, val);
                        found = true;
                        break;
                    }
                }
            }
            if (!found && typeof selectors === 'string' && !selectors.includes(',')) {
                // Fallback using xPath to find the input by label
                fillByLabel(selectors.replace(/[[\]'"]/g, ''), val);
            }
        };

        // 2. ADD VIDEOS LOOP
        for (const badUrl of urlsToReport) {
            const addBtnText = conf.buttons?.add_video || "Add a video";
            await waitAndClick(addBtnText, 3000);
            await sleep(1000);

            const dds = conf.dropdowns || {};
            
            // 1. Fill the infringing YouTube URL first
            const badInputSel = conf.inputs?.infringing_url || "YouTube URL of video to be removed";
            fillYtcpInput(badInputSel, badUrl);
            
            // 2. Select dropdowns to reveal the hidden fields
            await selectYtcpDropdown(dds.type_work?.label || "Type of work", dds.type_work?.value || "Video");
            await selectYtcpDropdown(dds.subcategory?.label || "Subcategory", dds.subcategory?.value || "Internet video");
            
            // CRITICAL FIX: Select 'Source' BEFORE filling the Source URL so the box actually exists!
            await selectYtcpDropdown(dds.source?.label || "Source of my content", dds.source?.value || "From outside of YouTube");
            await sleep(500); // Wait for the "My video URL" box to render on screen
            
            // 3. Now fill the FloSports source URL and Title
            const sourceUrlSel = conf.inputs?.source_url || "My video URL";
            fillYtcpInput(sourceUrlSel, data.sourceUrl || defaults.source_url);

            const videoTitleSel = conf.inputs?.video_title || "Video title";
            fillYtcpInput(videoTitleSel, data.eventName || "FloSports Event");
            const locDropdown = dds.location || { label: "Location of infringing content", value: "Entire video" };
            await selectYtcpDropdown(locDropdown.label, locDropdown.value);

            await waitAndClick(conf.buttons?.save || "Add to list", 2000);
            await sleep(1500);
        }

        // 3. FILL COPYRIGHT OWNER SECTION
        console.log("Filling copyright owner details...");
        const ownerInputs = conf.inputs || {};
        
        await selectYtcpDropdown(conf.dropdowns?.affected_party?.label || "Relationship", conf.dropdowns?.affected_party?.value || "My company, organization, or client");

        fillYtcpInput(ownerInputs.claimant_name || "Copyright owner name", COPYRIGHT_OWNER_NAME);
        fillYtcpInput(ownerInputs.phone || "Phone", defaults.phone || "5122702356"); // FloSports Default
        fillYtcpInput(ownerInputs.secondary_email || "Secondary email", defaults.secondary_email || data.email || "copyright@flosports.tv");
        fillYtcpInput(ownerInputs.authority || "Relationship", defaults.authority || "Authorized Representative");
        
        await selectYtcpDropdown(conf.dropdowns?.country?.label || "Country", conf.dropdowns?.country?.value || "United States");

        fillYtcpInput(ownerInputs.street || "Street address", defaults.street || "301 Congress Ave #1500");
        fillYtcpInput(ownerInputs.city || "City", defaults.city || "Austin");
        await sleep(1000); // Give the form time to re-render after Country selection
        fillYtcpInput(ownerInputs.state || "ytcp-form-textarea#state textarea, #state textarea", defaults.state || "TX");
        fillYtcpInput(ownerInputs.zip || "Zip code", defaults.zip || "78701");

        // 4. REMOVAL OPTIONS & AGREEMENTS
        console.log("Checking agreements...");
        const preventCopies = document.querySelector(conf.checkboxes?.prevent_copies || 'ytcp-checkbox-lit[aria-label*="Prevent future copies"]');
        if (preventCopies && preventCopies.getAttribute('aria-checked') === 'false') {
            preventCopies.click();
        }

        const agreements = conf.checkboxes?.agreements || ["good faith", "accurate", "abuse"];
        for (const text of agreements) {
            const xpath = `//ytcp-checkbox-lit[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
            const checkbox = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (checkbox && checkbox.getAttribute('aria-checked') === 'false') {
                checkbox.click();
            }
        }

        // Signature
        fillYtcpInput(ownerInputs.signature || "Signature", COPYRIGHT_OWNER_NAME);

        console.log("✅ YouTube Strategy Complete!");
    }
    
    async function runYtStep2(data) {
        console.log("📝 Running YouTube Step 2: Copyright owner...");
        const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
        const defaults = conf.defaults || {};

        // Helper for YouTube inputs (updated to handle comma-separated strings safely!)
        const fillYtcpInput = (selectors, val) => {
            if (!selectors || !val) return;
            const sels = typeof selectors === 'string' ? selectors.split(',').map(s => s.trim()) : selectors;
            let found = false;
            for (const sel of sels) {
                let el = sel.startsWith('//')
                    ? document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                    : document.querySelector(sel);
                if (el) {
                    const innerInput = el.querySelector('input, textarea') || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : null);
                    if (innerInput) {
                        typeValue(innerInput, val);
                        found = true;
                        break;
                    }
                }
            }
            if (!found && typeof selectors === 'string' && !selectors.includes(',')) {
                fillByLabel(selectors.replace(/[[\]'"]/g, ''), val);
            }
        };

        async function selectYtcpDropdown(labelText, valueText) {
            if (!labelText || !valueText) return;
            const dropdowns = Array.from(document.querySelectorAll('ytcp-form-select'));
            const targetDropdown = dropdowns.find(el => el.innerText.toLowerCase().includes(labelText.toLowerCase()));
            if (targetDropdown) {
                const trigger = targetDropdown.querySelector('#trigger');
                if (trigger) {
                    const currentVal = targetDropdown.querySelector('.dropdown-trigger-text')?.innerText || '';
                    if (currentVal.toLowerCase().includes(valueText.toLowerCase())) return;
                    trigger.click();
                    await sleep(500); 
                    const options = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-dropdown-item'));
                    const targetOption = options.find(opt => isVisible(opt) && opt.innerText.toLowerCase().includes(valueText.toLowerCase()));
                    if (targetOption) { targetOption.click(); await sleep(500); } 
                    else { trigger.click(); }
                }
            }
        }

        const dd = conf.dropdowns || {};
        await selectYtcpDropdown(dd.affected_party?.label || "Relationship", dd.affected_party?.value || "My company, organization, or client");

        const ownerInputs = conf.inputs || {};
        fillYtcpInput(ownerInputs.claimant_name || "Copyright owner name", COPYRIGHT_OWNER_NAME);
        fillYtcpInput(ownerInputs.phone || "Phone", defaults.phone || "5122702356");
        fillYtcpInput(ownerInputs.secondary_email || "Secondary email", defaults.secondary_email || data.email || "copyright@flosports.tv");
        fillYtcpInput(ownerInputs.authority || "Relationship", defaults.authority || "Authorized Representative");
        
        await selectYtcpDropdown(conf.dropdowns?.country?.label || "Country", conf.dropdowns?.country?.value || "United States");

        fillYtcpInput(ownerInputs.street || "Street address", defaults.street || "301 Congress Ave #1500");
        fillYtcpInput(ownerInputs.city || "City", defaults.city || "Austin");
        await sleep(1000); // Give the form time to re-render after Country selection
        fillYtcpInput(ownerInputs.state || "ytcp-form-textarea#state textarea, #state textarea", defaults.state || "TX");
        fillYtcpInput(ownerInputs.zip || "Zip code", defaults.zip || "78701");
    }
    
    async function fillInstagram(data) {
        const conf = AUTOFILL_CONFIG.instagram?.autofill || {};
        if(conf.name) {
            const el = document.querySelector(`[name="${conf.name}"]`);
            if(el) el.value = data.fullName;
        }
    }

    function getFacebookReportUrlFields(fields) {
        const sourceField = findVisibleElement(fields.source_url);
        const reportUrlSelectors = mergeSelectorFallbacks(fields.content_urls, [
            'textarea[name="content_urls"]',
            'textarea[name^="content_urls"]',
            'textarea[title*="facebook.com"][name^="content_urls"]'
        ]);
        let urlFields = findControls(reportUrlSelectors);

        if (urlFields.length === 0) {
            urlFields = findControls(['textarea[name^="content_urls"]']);
        }

        return urlFields.filter((field) => field !== sourceField);
    }

    async function fillFacebookReportUrlFields(fields, urlsToReport) {
        let expandedAdditionalLinks = false;

        for (let index = 0; index < urlsToReport.length; index++) {
            if (index === 10 && !expandedAdditionalLinks) {
                checkChoiceField(
                    fields.additional_links_checkbox,
                    ['I have additional links to report'],
                    'I have additional links to report',
                    'checkbox'
                );
                expandedAdditionalLinks = true;
                await sleep(700);
            }

            let urlFields = getFacebookReportUrlFields(fields);
            let targetField = urlFields[index];
            let attempts = 0;

            while (!targetField && attempts < 6) {
                await sleep(250);
                urlFields = getFacebookReportUrlFields(fields);
                targetField = urlFields[index];
                attempts++;
            }

            if (!targetField) {
                console.warn(`Could not find Facebook report URL field ${index + 1}.`);
                break;
            }

            typeValue(targetField, urlsToReport[index]);
            await sleep(150);
        }
    }

    async function runFbStep1(data) {
        console.log("📝 Running Facebook Step 1: Contact information...");
        const conf = AUTOFILL_CONFIG.facebook?.autofill || {};
        const fields = conf.fields || {};
        const defaults = conf.defaults || {};
        const reporterFullName = await resolveReporterFullName(data);
        const contactEmail = defaults.contact_email || TIKTOK_VERIFICATION_EMAIL;

        checkChoiceField(
            fields.relationship_radio,
            ['I am reporting on behalf of my organization or client'],
            defaults.relationship || 'I am reporting on behalf of my organization or client.',
            'radio'
        );
        await sleep(500);

        fillFieldWithFallback(fields.full_name, ['Your full name'], reporterFullName);
        fillFieldWithFallback(
            fields.email,
            ['Please provide a valid email address', 'Email address'],
            contactEmail
        );
        fillFieldWithFallback(
            fields.confirm_email,
            ['Confirm your email address'],
            contactEmail
        );
        selectFieldOption(
            fields.country_select,
            ['Where are you asserting rights'],
            defaults.country || 'United States'
        );
        selectFieldOption(
            fields.work_type_select,
            ['Which of these best describes the copyrighted work'],
            defaults.work_type || 'Video'
        );
        fillFieldWithFallback(
            fields.rights_owner_name,
            ['Name of the rights owner', 'This may be your full name or the name of the organization'],
            defaults.rights_owner_name || COPYRIGHT_OWNER_NAME
        );
    }

    async function runFbStep2(data) {
        console.log("📝 Running Facebook Step 2: Copyrighted work and report links...");
        const conf = AUTOFILL_CONFIG.facebook?.autofill || {};
        const fields = conf.fields || {};
        const defaults = conf.defaults || {};
        const urls = Array.isArray(data.urls) ? data.urls.filter(Boolean) : [];
        const urlsToReport = urls.slice(0, FACEBOOK_BATCH_LIMIT);

        if (urls.length > FACEBOOK_BATCH_LIMIT) {
            alert(`Facebook supports up to ${FACEBOOK_BATCH_LIMIT} links per report. The first ${FACEBOOK_BATCH_LIMIT} links have been loaded into this form. The remaining links will stay in the queue for the next report.`);
        }

        fillFieldWithFallback(
            fields.source_url,
            ['Provide a link to the copyrighted work', 'You can provide one link (URL) to examples', 'one link (URL) to examples on your website'],
            data.sourceUrl || defaults.source_url || ''
        );
        fillFieldWithFallback(
            fields.copyrighted_work_description,
            ['Describe your copyrighted work in the link you provided above', 'describe_copyrighted_work_me_URLs'],
            data.eventName || 'FloSports Event'
        );

        checkChoiceField(
            fields.content_type_post,
            ['What type of content are you reporting', 'Photo, video or post'],
            defaults.content_type_post || 'Photo, video or post',
            'checkbox'
        );
        await sleep(400);

        await fillFacebookReportUrlFields(fields, urlsToReport);
    }

    async function runFbStep3(data) {
        console.log("📝 Running Facebook Step 3: Electronic signature...");
        const conf = AUTOFILL_CONFIG.facebook?.autofill || {};
        const fields = conf.fields || {};
        const reporterFullName = await resolveReporterFullName(data);

        fillFieldWithFallback(
            fields.infringement_explanation,
            ['Describe how you believe this content infringes your intellectual property rights'],
            buildFacebookExplanation(data)
        );
        await sleep(250);

        fillFieldWithFallback(
            fields.signature,
            ['Electronic signature', 'Your electronic signature should match your full name'],
            reporterFullName
        );

        const sendBtn = await waitForVisibleElement(fields.send_button || ['button[type="submit"]', 'input[type="submit"]'], 1000);
        if (sendBtn) {
            sendBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            sendBtn.style.border = "4px solid #ce0e2d";
            sendBtn.disabled = false;
        }
    }

    async function fillFacebook(data) {
        await runFbStep1(data);
        await runFbStep2(data);
        await runFbStep3(data);
    }

    async function runYtStep3(data) {
        console.log("📝 Running YouTube Step 3: Legal agreements...");
        const conf = AUTOFILL_CONFIG.youtube?.autofill || {};
        const ownerInputs = conf.inputs || {};

        const fillYtcpInput = (selectors, val) => {
            if (!selectors || !val) return;
            const sels = typeof selectors === 'string' ? selectors.split(',').map(s => s.trim()) : selectors;
            for (const sel of sels) {
                let el = sel.startsWith('//')
                    ? document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                    : document.querySelector(sel);
                if (el) {
                    const innerInput = el.querySelector('input, textarea') || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : null);
                    if (innerInput) {
                        typeValue(innerInput, val);
                        return;
                    }
                }
            }
        };

        console.log("Selecting removal timing...");
        const timingSelector = conf.radios?.standard_timing || "tp-yt-paper-radio-button#immediate-takedown-radio-button";
        const timingRadios = timingSelector.split(',').map(s => s.trim());
        for (const sel of timingRadios) {
            const radio = document.querySelector(sel);
            if (radio) {
                if (radio.getAttribute('aria-checked') !== 'true') {
                    radio.click();
                }
                break;
            }
        }

        console.log("Checking agreements...");
        let preventCopies = document.querySelector(conf.checkboxes?.prevent_copies || '[aria-label*="Prevent future copies"]');
        if (!preventCopies) preventCopies = document.querySelector('[aria-label*="Prevent future copies"]');

        if (preventCopies && preventCopies.getAttribute('aria-checked') === 'false') {
            preventCopies.click();
            await sleep(800); // Wait for the "Worldwide exclusive rights" popup to render
        }

        const agreements = conf.checkboxes?.agreements || ["good faith", "accurate", "abuse"];
        for (const text of agreements) {
            const xpath = `//ytcp-checkbox-lit[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
            const checkbox = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (checkbox && checkbox.getAttribute('aria-checked') !== 'true') {
                checkbox.click();
            }
        }
        
        fillYtcpInput(ownerInputs.signature || "Signature", COPYRIGHT_OWNER_NAME);

        console.log("✅ YouTube Step 3 Complete!");
    }
    function getTwitterAutofillConfig() {
        const conf = AUTOFILL_CONFIG.twitter?.autofill || {};
        const fields = {
            ...(conf.fields || {}),
            copyright_owner_name: conf.fields?.copyright_owner_name || conf.copyright_owner_name,
            full_name: conf.fields?.full_name || conf.name || conf.full_name,
            email: conf.fields?.email || conf.email,
            company: conf.fields?.company || conf.company,
            job_title: conf.fields?.job_title || conf.job_title,
            street_address: conf.fields?.street_address || conf.street_address,
            city: conf.fields?.city || conf.city,
            state: conf.fields?.state || conf.state,
            postal_code: conf.fields?.postal_code || conf.postal_code,
            country: conf.fields?.country || conf.country,
            phone: conf.fields?.phone || conf.phone,
            description: conf.fields?.description || conf.description,
            original_work_url: conf.fields?.original_work_url || conf.original_work_url || conf.source_url || conf.urls,
            infringing_urls: conf.fields?.infringing_urls || conf.infringing_urls || conf.reported_urls,
            infringement_description: conf.fields?.infringement_description || conf.infringement_description,
            signature: conf.fields?.signature || conf.signature
        };

        return {
            conf,
            fields,
            radios: conf.radios || {},
            buttons: conf.buttons || {},
            checkboxes: conf.checkboxes || {},
            defaults: {
                copyright_owner_name: 'FloSports',
                company: 'FloSports',
                job_title: 'Stream Operations',
                street_address: '301 Congress ave #1500',
                city: 'Austin',
                state: 'Tx',
                postal_code: '78701',
                country: 'United States',
                phone: '5122702356',
                original_work_url: 'https://www.flosports.tv/',
                infringement_platform: 'X',
                work_type: 'Video/Audiovisual Recording',
                ...(conf.defaults || {})
            }
        };
    }

    function expandTwitterSelectorPath(selector) {
        if (!selector) return [];
        if (typeof selector === 'object') {
            return expandTwitterSelectorPath(selector.selector || selector.path || selector.value);
        }

        const trimmed = String(selector).trim();
        if (!trimmed) return [];

        if (trimmed.startsWith('[{')) {
            try {
                const parsed = JSON.parse(trimmed);
                return parsed.flatMap((entry) => expandTwitterSelectorPath(entry));
            } catch (error) {
                return [trimmed];
            }
        }

        if (/^[A-Za-z0-9_:-]+$/.test(trimmed)) {
            return [`[name="${trimmed}"]`];
        }

        return [trimmed];
    }

    function getTwitterSelectorPaths(selectors, fallbackSelectors = []) {
        const primaryList = Array.isArray(selectors) ? selectors : (selectors ? [selectors] : []);
        const fallbackList = Array.isArray(fallbackSelectors) ? fallbackSelectors : (fallbackSelectors ? [fallbackSelectors] : []);
        return Array.from(new Set([...primaryList, ...fallbackList].flatMap((selector) => expandTwitterSelectorPath(selector))));
    }

    function uniqueTwitterUrls(urls) {
        const seen = new Set();
        return (Array.isArray(urls) ? urls : [])
            .map((url) => String(url || '').trim())
            .filter(Boolean)
            .filter((url) => {
                const key = normalizeRuntimeUrl(url);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function normalizeTwitterOriginalWorkUrl(url) {
        const trimmed = String(url || '').trim();
        if (!trimmed) return '';
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
        return trimmed;
    }

    async function getFreshTwitterReportData(data = {}) {
        try {
            const res = await chrome.storage.local.get(['piracy_cart', 'reporterInfo']);
            const cart = Array.isArray(res.piracy_cart) ? res.piracy_cart : [];
            const info = res.reporterInfo || {};
            const cartUrls = cart.map((item) => typeof item === 'string' ? item : item?.url);
            const dataUrls = Array.isArray(data?.urls) ? data.urls : [];
            const freshData = {
                ...data,
                fullName: info.name || data?.fullName || data?.reporterName || data?.name || '',
                reporterName: info.name || data?.reporterName || data?.fullName || data?.name || '',
                email: info.email || data?.email || 'copyright@flosports.tv',
                urls: uniqueTwitterUrls([...cartUrls, ...dataUrls]),
                eventName: info.eventName || data?.eventName || '',
                vertical: info.vertical || data?.vertical || '',
                sourceUrl: info.sourceUrl || data?.sourceUrl || ''
            };
            lastReportData = freshData;
            return freshData;
        } catch (error) {
            return {
                ...data,
                urls: uniqueTwitterUrls(data?.urls || [])
            };
        }
    }

    function findTwitterElement(selectors, fallbackSelectors = []) {
        const selectorList = getTwitterSelectorPaths(selectors, fallbackSelectors);
        for (const selector of selectorList) {
            try {
                const element = selector.startsWith('//') || selector.startsWith('(')
                    ? document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
                    : document.querySelector(selector);
                if (element) return element;
            } catch (error) {
                // Ignore malformed selectors and try the next path.
            }
        }
        return null;
    }

    function findAllTwitterElements(selectors, fallbackSelectors = []) {
        const selectorList = getTwitterSelectorPaths(selectors, fallbackSelectors);
        const seen = new Set();
        const elements = [];
        for (const selector of selectorList) {
            try {
                const matches = selector.startsWith('//') || selector.startsWith('(')
                    ? (() => {
                        const snapshot = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                        const nodes = [];
                        for (let index = 0; index < snapshot.snapshotLength; index += 1) {
                            nodes.push(snapshot.snapshotItem(index));
                        }
                        return nodes;
                    })()
                    : Array.from(document.querySelectorAll(selector));
                matches.forEach((element) => {
                    if (element && !seen.has(element)) {
                        seen.add(element);
                        elements.push(element);
                    }
                });
            } catch (error) {
                // Ignore malformed selectors and try the next path.
            }
        }
        return elements;
    }

    function fillTwitterField(selectors, labels, value, fallbackSelectors = []) {
        if (value == null || value === '') return false;
        const element = findTwitterElement(selectors, fallbackSelectors);
        if (element) {
            const field = element.matches?.('input, textarea') ? element : element.querySelector?.('input, textarea');
            if (field) {
                if (isVisible(field)) return typeValue(field, value);
                setNativeValue(field, value);
                triggerReactUpdate(field);
                return true;
            }
        }

        if (labels) {
            const labelField = findControlByLabelText(labels, 'input, textarea');
            if (labelField) return typeValue(labelField, value);
        }
        return false;
    }

    function selectTwitterCountry(selectors, labels, country, fallbackSelectors = []) {
        const normalizedSelectors = getTwitterSelectorPaths(selectors, fallbackSelectors);
        const select = findTwitterElement(normalizedSelectors);
        if (select?.tagName === 'SELECT') {
            const options = Array.from(select.options || []);
            const targetOption = options.find((option) =>
                matchesAnyText(option.textContent || option.innerText || option.value || '', country)
            ) || options.find((option) =>
                matchesAnyText(option.value || '', ['US', 'USA', 'United States'])
            );

            if (targetOption) {
                select.value = targetOption.value;
                triggerReactUpdate(select);
                return true;
            }

            select.value = country;
            triggerReactUpdate(select);
            if (select.value === country) return true;
        }

        return selectFieldOption(normalizedSelectors, labels, country);
    }

    function activateTwitterChoice(selectors, labelTexts, fallbackSelectors = []) {
        let target = findTwitterElement(selectors, fallbackSelectors);
        if (!target && labelTexts) {
            target = findChoiceInputByText(labelTexts, 'radio') || findChoiceInputByText(labelTexts, 'checkbox');
        }
        if (!target) return false;

        const input = target.matches?.('input[type="radio"], input[type="checkbox"]')
            ? target
            : target.querySelector?.('input[type="radio"], input[type="checkbox"]');
        if (!input) return false;

        const clickable = input.closest?.('label, .FormOption') ||
            input.parentElement?.querySelector?.('.RadioButton, .Checkbox') ||
            input.parentElement ||
            input;
        try {
            clickable.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            if (!input.checked) {
                clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                clickable.click();
            }

            const nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
            if (nativeCheckedSetter) nativeCheckedSetter.call(input, true);
            else input.checked = true;
            input.setAttribute('checked', 'checked');
            input.closest?.('.FormOption')?.querySelector?.('.RadioButton, .Checkbox')?.setAttribute('aria-checked', 'true');
            triggerReactUpdate(input);
            return true;
        } catch (error) {
            return false;
        }
    }

    function isTwitterRadioChecked(radio) {
        return radio?.checked === true ||
            radio?.closest?.('.RadioButton')?.getAttribute?.('aria-checked') === 'true';
    }

    function setTwitterRadioChecked(radio) {
        const nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
        if (nativeCheckedSetter) nativeCheckedSetter.call(radio, true);
        else radio.checked = true;
        radio.setAttribute('checked', 'checked');
        radio.closest?.('.RadioButton')?.setAttribute('aria-checked', 'true');
        radio.closest?.('.FormOption')?.querySelector?.('.RadioButton, .RadioButton-uiWrapper')?.setAttribute('aria-checked', 'true');
    }

    function findTwitterRadioByTextOrValue(matchText) {
        const normalizedMatch = normalizeText(matchText);
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        return radios.find((radio) => {
            const labelId = radio.getAttribute('aria-labelledby')?.split(/\s+/).find(Boolean);
            const label = labelId ? document.getElementById(labelId) : null;
            const labelText = label?.innerText || label?.textContent || '';
            const optionText = radio.closest?.('.FormOption')?.innerText || '';
            const normalizedValue = normalizeText(radio.value || '');
            const normalizedLabel = normalizeText(labelText);
            const normalizedOption = normalizeText(optionText);
            return normalizedValue === normalizedMatch ||
                normalizedLabel === normalizedMatch ||
                normalizedOption === normalizedMatch ||
                (normalizedMatch.length > 2 && (
                    normalizedValue.includes(normalizedMatch) ||
                    normalizedLabel.includes(normalizedMatch) ||
                    normalizedOption.includes(normalizedMatch)
                ));
        }) || null;
    }

    async function forceTwitterRadio(selectors, valueText, fallbackSelectors = []) {
        const target = findTwitterElement(selectors, fallbackSelectors) || findTwitterRadioByTextOrValue(valueText);
        const radio = target?.matches?.('input[type="radio"]')
            ? target
            : target?.querySelector?.('input[type="radio"]');
        if (!radio) return false;

        try {
            radio.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            const labelId = radio.getAttribute('aria-labelledby')?.split(/\s+/).find(Boolean);
            const formOption = radio.closest?.('.FormOption');
            const clickTargets = [
                labelId ? document.getElementById(labelId) : null,
                formOption?.querySelector?.('.FormOption-label'),
                formOption,
                formOption?.querySelector?.('.RadioButton-uiWrapper'),
                formOption?.querySelector?.('.RadioButton'),
                radio.parentElement,
                radio
            ].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);

            for (const clickTarget of clickTargets) {
                if (isTwitterRadioChecked(radio)) break;
                dispatchTwitterActivation(clickTarget);
                await sleep(100);
            }

            if (!isTwitterRadioChecked(radio)) {
                radio.click();
                await sleep(100);
            }

            setTwitterRadioChecked(radio);
            triggerReactUpdate(radio);
            setTimeout(() => {
                if (!isTwitterRadioChecked(radio)) setTwitterRadioChecked(radio);
                triggerReactUpdate(radio);
            }, 100);
            return true;
        } catch (error) {
            setTwitterRadioChecked(radio);
            triggerReactUpdate(radio);
            return isTwitterRadioChecked(radio);
        }
    }

    function isTwitterCheckboxChecked(checkbox) {
        return checkbox?.checked === true ||
            checkbox?.getAttribute?.('checked') === 'checked' ||
            checkbox?.getAttribute?.('aria-checked') === 'true' ||
            checkbox?.closest?.('.Checkbox')?.getAttribute?.('aria-checked') === 'true';
    }

    function setTwitterCheckboxChecked(checkbox) {
        const nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
        if (nativeCheckedSetter) nativeCheckedSetter.call(checkbox, true);
        else checkbox.checked = true;
        checkbox.setAttribute('checked', 'checked');
        checkbox.setAttribute('aria-checked', 'true');
        checkbox.closest?.('.Checkbox')?.setAttribute('aria-checked', 'true');
        checkbox.closest?.('.FormOption')?.querySelector?.('.Checkbox, .Checkbox-uiWrapper')?.setAttribute('aria-checked', 'true');
    }

    function dispatchTwitterActivation(target) {
        if (!target) return;
        const rect = target.getBoundingClientRect?.();
        const eventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: rect ? rect.left + rect.width / 2 : 0,
            clientY: rect ? rect.top + rect.height / 2 : 0
        };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((eventName) => {
            const EventConstructor = eventName.startsWith('pointer') && window.PointerEvent
                ? window.PointerEvent
                : window.MouseEvent;
            target.dispatchEvent(new EventConstructor(eventName, eventInit));
        });
    }

    async function forceTwitterCheckbox(input) {
        if (!input) return false;
        const checkbox = input.matches?.('input[type="checkbox"]')
            ? input
            : input.querySelector?.('input[type="checkbox"]');
        if (!checkbox) return false;

        try {
            checkbox.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            if (isTwitterCheckboxChecked(checkbox)) {
                setTwitterCheckboxChecked(checkbox);
                triggerReactUpdate(checkbox);
                return true;
            }

            const labelId = checkbox.getAttribute('aria-labelledby')?.split(/\s+/).find(Boolean);
            const formOption = checkbox.closest?.('.FormOption');
            const clickTargets = [
                labelId ? document.getElementById(labelId) : null,
                formOption?.querySelector?.('.FormOption-label'),
                formOption,
                formOption?.querySelector?.('.Checkbox-uiWrapper'),
                formOption?.querySelector?.('.Checkbox'),
                checkbox.parentElement,
                checkbox
            ].filter((target, index, targets) => target && targets.indexOf(target) === index);

            for (const target of clickTargets) {
                dispatchTwitterActivation(target);
                await sleep(80);
                if (isTwitterCheckboxChecked(checkbox)) break;
            }

            if (!isTwitterCheckboxChecked(checkbox)) {
                checkbox.click();
                await sleep(80);
            }

            if (!isTwitterCheckboxChecked(checkbox)) {
                setTwitterCheckboxChecked(checkbox);
            }

            triggerReactUpdate(checkbox);
            setTimeout(() => {
                if (!isTwitterCheckboxChecked(checkbox)) setTwitterCheckboxChecked(checkbox);
                triggerReactUpdate(checkbox);
            }, 100);
            return true;
        } catch (error) {
            setTwitterCheckboxChecked(checkbox);
            triggerReactUpdate(checkbox);
            return isTwitterCheckboxChecked(checkbox);
        }
    }

    async function forceTwitterAcknowledgements(selectors) {
        const acknowledgementFields = [
            'input[type="checkbox"][name="acknowledgement"]',
            'input[type="checkbox"][name="good-faith-belief"]',
            'input[type="checkbox"][name="authority-to-act"]'
        ];
        const selectorList = Array.from(new Set([...acknowledgementFields, ...getTwitterSelectorPaths(selectors)]));
        for (const selector of selectorList) {
            const elements = findAllTwitterElements([selector]);
            for (const element of elements) {
                await forceTwitterCheckbox(element);
            }
        }
        await sleep(150);
        return acknowledgementFields.every((selector) => {
            const checkbox = findTwitterElement([selector]);
            return isTwitterCheckboxChecked(checkbox);
        });
    }

    function getTwitterFieldControls(selectors) {
        return findAllTwitterElements(selectors)
            .map((element) => element.matches?.('input, textarea') ? element : element.querySelector?.('input, textarea'))
            .filter((field, index, fields) =>
                field &&
                field.type !== 'hidden' &&
                fields.indexOf(field) === index
            );
    }

    function findTwitterScopedAddLinkButton(fields, addButtonSelectors) {
        const lastField = fields[fields.length - 1];
        if (lastField) {
            const nextAddButton = document.evaluate(
                'following::button[contains(normalize-space(.), "Add another link") or contains(@class, "f206__add-button")][1]',
                lastField,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            if (nextAddButton && isVisible(nextAddButton)) return nextAddButton;
        }

        const scopedContainers = fields
            .map((field) => field.closest?.('ul.f206__form-field, .f206__multi-input, [class*="multi-input"], fieldset, section'))
            .filter(Boolean);

        for (const container of scopedContainers) {
            const button = Array.from(container.querySelectorAll('button'))
                .find((candidate) =>
                    isVisible(candidate) &&
                    (
                        candidate.matches?.('.f206__add-button') ||
                        matchesAnyText(candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label') || '', 'add another link')
                    )
                );
            if (button) return button;
        }

        const scopedSelectorPaths = getTwitterSelectorPaths(addButtonSelectors)
            .filter((selector) => selector.includes('Infringing_Urls__c') || selector.includes(':has('));
        return findTwitterElement(scopedSelectorPaths, [
            '//input[contains(@name, "Infringing_Urls__c")]/ancestor::ul[contains(@class, "f206__form-field")][1]//button[contains(@class, "f206__add-button") or contains(normalize-space(.), "Add another link")]'
        ]);
    }

    async function waitForTwitterUrlFieldIncrease(selectors, previousCount, timeout = 2500) {
        const start = Date.now();
        let fields = getTwitterFieldControls(selectors);
        while (Date.now() - start < timeout) {
            if (fields.length > previousCount) return fields;
            await sleep(150);
            fields = getTwitterFieldControls(selectors);
        }
        return fields;
    }

    async function ensureTwitterUrlFieldCount(selectors, desiredCount, addButtonSelectors) {
        const targetCount = Math.max(0, Number(desiredCount) || 0);
        let fields = getTwitterFieldControls(selectors);
        const normalizedAddButtonSelectors = getTwitterSelectorPaths(addButtonSelectors);
        const maxClicks = Math.min(Math.max(targetCount - fields.length, 0) + 1, 10);
        let addClicks = 0;

        while (fields.length < targetCount && addClicks < maxClicks) {
            const previousCount = fields.length;
            const addButton = findTwitterScopedAddLinkButton(fields, normalizedAddButtonSelectors);
            if (!addButton) break;

            clickElement(addButton);
            addClicks += 1;
            fields = await waitForTwitterUrlFieldIncrease(selectors, previousCount);

            if (fields.length <= previousCount) {
                console.warn('Flo X DMCA: stopped adding links because the infringing URL field count did not increase.', {
                    desiredCount: targetCount,
                    currentCount: fields.length
                });
                break;
            }
        }
        return fields;
    }

    function buildTwitterInfringementDescription(data) {
        const eventName = data?.eventName || 'FloSports event';
        const sourceUrl = data?.sourceUrl || 'Original FloSports source URL provided above.';
        return `Unauthorized distribution of the FloSports broadcast for ${eventName}. FloSports owns or controls the copyrighted audiovisual work. The reported X URLs are not authorized by FloSports, its agent, or the law. Original work/source: ${sourceUrl}`;
    }

    async function runTwitterStep1(data) {
        const freshData = await getFreshTwitterReportData(data);
        const { fields, defaults } = getTwitterAutofillConfig();
        const reporterFullName = await resolveReporterFullName(freshData);

        fillTwitterField(
            fields.copyright_owner_name,
            ['Copyright owner\'s full name'],
            defaults.copyright_owner_name,
            ['input[name$="Content_Owner_Name__c"]']
        );
        fillTwitterField(fields.full_name, ['Your full name'], reporterFullName, ['input[name$="Form_Name__c"]']);
        fillTwitterField(fields.company, ['Company'], defaults.company, ['input[name$="company"]']);
        fillTwitterField(fields.job_title, ['Job title'], defaults.job_title, ['input[name$="jobTitle"]']);
        fillTwitterField(fields.street_address, ['Street address'], defaults.street_address, ['input[name$="streetAddress"]']);
        fillTwitterField(fields.city, ['City'], defaults.city, ['input[name$="city"]']);
        fillTwitterField(fields.state, ['State', 'State/Province'], defaults.state, ['input[name$="state"]']);
        fillTwitterField(fields.postal_code, ['Postal code'], defaults.postal_code, ['input[name$="postalCode"]']);
        selectTwitterCountry(fields.country, ['Country'], defaults.country, ['select[name$="country"]']);
        fillTwitterField(fields.phone, ['Phone number'], defaults.phone, [
            'input[name="phone_number"]',
            'input[name$="phone_number"]',
            'input[name$="form_number__c"]',
            'input[name*="phone" i]',
            'input[type="tel"]'
        ]);
    }

    async function runTwitterStep2(data) {
        const freshData = await getFreshTwitterReportData(data);
        const { fields, radios, buttons, defaults } = getTwitterAutofillConfig();
        const urls = uniqueTwitterUrls(freshData?.urls || []);
        const eventName = freshData?.eventName || 'FloSports Event';
        const sourceUrl = normalizeTwitterOriginalWorkUrl(freshData?.sourceUrl || defaults.original_work_url || '');
        console.log(`Flo X DMCA: filling ${urls.length} queued URL${urls.length === 1 ? '' : 's'}.`, urls);

        await forceTwitterRadio(
            radios.infringement_platform,
            defaults.infringement_platform,
            [
                'input[type="radio"][value="X"]',
                'input[type="radio"][name$="type_of_issue__c"][value="X"]',
                'input[type="radio"][name*="type_of_issue" i][value="X"]',
                'input[type="radio"][name$="Type_of_Issue__c"][value="X"]',
                '//input[@type="radio" and @value="X"]'
            ]
        );
        await sleep(200);
        await forceTwitterRadio(
            radios.work_type,
            defaults.work_type,
            [
                'input[type="radio"][value="Video/Audiovisual Recording"]',
                'input[type="radio"][name$="@type"][value="Video/Audiovisual Recording"]',
                'input[type="radio"][name$="type"][value="Video/Audiovisual Recording"]',
                '//input[@type="radio" and @value="Video/Audiovisual Recording"]'
            ]
        );

        fillTwitterField(fields.description, ['Description of the original work'], eventName, ['textarea[name$="DescriptionText"]']);
        if (sourceUrl) {
            fillTwitterField(
                fields.original_work_url,
                ['URL to the original work', 'Original work'],
                sourceUrl,
                [
                    'input[name*="originalWork"][name$=".value"]',
                    'input[name*="OriginalWork"][name$=".value"]',
                    '//input[contains(@name, "originalWork") and substring(@name, string-length(@name) - 5) = ".value"]',
                    '//input[contains(@name, "OriginalWork") and substring(@name, string-length(@name) - 5) = ".value"]'
                ]
            );
        }

        const addLinkSelectors = mergeSelectorFallbacks(buttons.add_link, [
            'ul.f206__form-field:has(input[name*="Infringing_Urls__c"]) button.f206__add-button',
            '//input[contains(@name, "Infringing_Urls__c")]/ancestor::ul[contains(@class, "f206__form-field")][1]//button[contains(@class, "f206__add-button") or contains(normalize-space(.), "Add another link")]',
            'button.f206__add-button',
            '//button[contains(normalize-space(.), "Add another link")]'
        ]);
        const urlFieldSelectors = mergeSelectorFallbacks(fields.infringing_urls, [
            'input[name*="Infringing_Urls__c"][name$=".value"]',
            'input[name*="infringing_urls" i][name$=".value"]',
            '//input[contains(@name, "Infringing_Urls__c") and substring(@name, string-length(@name) - 5) = ".value"]'
        ]);
        const urlFields = await ensureTwitterUrlFieldCount(urlFieldSelectors, urls.length, addLinkSelectors);
        urls.forEach((url, index) => {
            if (urlFields[index]) {
                typeValue(urlFields[index], url);
            }
        });

        fillTwitterField(
            fields.infringement_description,
            ['Describe the infringement', 'About the infringing material'],
            buildTwitterInfringementDescription(freshData),
            ['textarea[name$="describeInfringement"]']
        );
    }

    async function runTwitterStep3(data) {
        const freshData = await getFreshTwitterReportData(data);
        const reporterFullName = await resolveReporterFullName(freshData);
        const { fields, checkboxes } = getTwitterAutofillConfig();
        const configuredAcknowledgements = Array.isArray(checkboxes.acknowledgements)
            ? checkboxes.acknowledgements
            : (checkboxes.acknowledgements ? [checkboxes.acknowledgements] : []);
        const acknowledgementSelectors = configuredAcknowledgements.length > 0
            ? configuredAcknowledgements
            : [
                'input[type="checkbox"][name="acknowledgement"]',
                'input[type="checkbox"][name="good-faith-belief"]',
                'input[type="checkbox"][name="authority-to-act"]',
                'input[type="checkbox"][value*="17 U.S.C."]',
                'input[type="checkbox"][value*="good faith belief"]',
                'input[type="checkbox"][value*="authorized to act"]'
            ];

        await forceTwitterAcknowledgements(acknowledgementSelectors);

        for (const labelText of ['17 U.S.C.', 'good faith belief', 'authorized to act']) {
            const input = findChoiceInputByText(labelText, 'checkbox');
            if (input) await forceTwitterCheckbox(input);
            else activateTwitterChoice(null, labelText);
        }

        fillTwitterField(fields.signature, ['Signature'], reporterFullName, [
            'input[name="signature"]',
            'input[name$="signature"]'
        ]);

        const submitBtn = await waitForVisibleElement(['button[type="submit"]', 'button.Button--primary', '//button[contains(normalize-space(.), "Submit")]'], 1000);
        if (submitBtn) {
            submitBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            submitBtn.style.border = '4px solid #ce0e2d';
            submitBtn.disabled = false;
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
