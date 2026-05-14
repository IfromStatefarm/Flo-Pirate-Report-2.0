// clippy.js

(function() {
    if (window.self !== window.top) return;
    if (window.hasClippyRun) return;
    window.hasClippyRun = true;

    const isOptionsPage = window.location.href.toLowerCase().includes('options.html');
    const optionsPageUrl = chrome.runtime.getURL('options.html');
    const setupGuideUrl = 'https://flocasts.atlassian.net/wiki/spaces/FSM/pages/5634621448/FloSports+Pirate+Reporter+3.3.1+Pirate+AI#Options-Set-Up';

    let clippyHost;
    let clippyShadow;
    let clippyContainer;
    let currentReasonKey = null;
    let currentMessageIndex = 0;
    let contentSetupDismissed = false;
    let optionsClippyHidden = false;
    let optionsBubbleHidden = false;
    let useLiveOptionsInputs = false;

    const idlePhrases = [
        "Alright, let's make the internet a better place one report at a time.",
        "You've got this. Let's go catch some rule-breakers.",
        "Every report counts. Let's clean up the game.",
        "Time to step up and defend the sport.",
        "You're not just browsing. You're making a difference.",
        "Let's turn fair play into the only play.",
        "Eyes sharp. Pirates won't catch themselves.",
        "You're on the front lines now. Let's go.",
        "Small actions, big impact. Let's get to work.",
        "This is how we keep the game honest.",
        "Stay focused. Spot it, report it, done.",
        "You're part of the team now. Let's win this.",
        "Let's protect the streams that matter.",
        "Game face on. It's go time.",
        "You've got the tools. Now let's use them.",
        "One clean click at a time. Let's do this.",
        "Together, we shut piracy down.",
        "Let's raise the standard, starting now.",
        "Ready, set, report.",
        "Go make Clippy proud. Let's hunt."
    ];

    const stateReady = chrome.storage.local
        .get(['clippy_content_setup_dismissed'])
        .then((res) => {
            contentSetupDismissed = !!res.clippy_content_setup_dismissed;
        })
        .catch(() => {});

    function getRequiredOptionsInputValues() {
        return [
            document.getElementById('piracy_folder_id')?.value.trim() || '',
            document.getElementById('piracy_sheet_id')?.value.trim() || '',
            document.getElementById('event_sheet_id')?.value.trim() || ''
        ];
    }

    function hasMissingRequiredIds(syncData) {
        if (isOptionsPage && useLiveOptionsInputs) {
            return getRequiredOptionsInputValues().some((value) => !value);
        }

        return [
            syncData.piracy_folder_id,
            syncData.piracy_sheet_id,
            syncData.event_sheet_id
        ].some((value) => !String(value || '').trim());
    }

    function getOptionsSetupMessages() {
        return [
            `Hi! I'm your FloSports Piracy Assistant.<br><br>Please paste your <b>Folder ID</b>, <b>Foundation Sheet ID</b>, and <b>Config Sheet ID</b> into the boxes above.<br><br><a href="${setupGuideUrl}" target="_blank" style="color: #ce0e2d; font-weight: bold; text-decoration: underline;">Open the setup guide</a> if you need help finding them.`,
            `Setup is still missing one or more IDs.<br><br>Fill in the <b>three boxes above</b>, then click <b>Save Intelligence Settings</b>.<br><br>You can also <a href="${setupGuideUrl}" target="_blank" style="color: #ce0e2d; font-weight: bold; text-decoration: underline;">check the guide here</a>.`,
            `Almost there.<br><br>This page needs all <b>three Google IDs</b> before Pirate AI can fully operate.<br><br>Use the fields above, then save. If needed, <a href="${setupGuideUrl}" target="_blank" style="color: #ce0e2d; font-weight: bold; text-decoration: underline;">follow the setup instructions</a>.`
        ];
    }

    function getContentSetupMessages() {
        return [
            `Pirate AI needs its <b>three setup IDs</b> before this tab can be used.<br><br><a href="${optionsPageUrl}" target="_blank" style="color: #ce0e2d; font-weight: bold; text-decoration: underline;">Open the Enforcement Center</a> and fill in the Folder ID, Foundation Sheet ID, and Config Sheet ID.<br><br>If you need help, <a href="${setupGuideUrl}" target="_blank" style="color: #ce0e2d; font-weight: bold; text-decoration: underline;">use the setup guide</a>.`
        ];
    }

    function getMessagePool(reasonKey) {
        if (reasonKey === 'needs-config-options') {
            return getOptionsSetupMessages();
        }
        if (reasonKey === 'needs-config-content') {
            return getContentSetupMessages();
        }
        return idlePhrases.map((phrase) => `<strong>Clippy Says:</strong><br><br>${phrase}`);
    }

    function pickInitialMessageIndex(reasonKey, pool) {
        if (!pool.length) return 0;
        if (reasonKey === 'needs-config-options' || reasonKey === 'needs-config-content') {
            return 0;
        }
        return Math.floor(Math.random() * pool.length);
    }

    function resetPosition() {
        if (!clippyContainer) return;
        clippyContainer.style.top = 'auto';
        clippyContainer.style.left = 'auto';
        clippyContainer.style.bottom = '30px';
        clippyContainer.style.right = '30px';
    }

    function injectClippy() {
        if (document.getElementById('flo-clippy-host')) return;

        clippyHost = document.createElement('div');
        clippyHost.id = 'flo-clippy-host';
        clippyShadow = clippyHost.attachShadow({ mode: 'open' });

        clippyContainer = document.createElement('div');
        clippyContainer.id = 'flo-clippy-container';
        clippyContainer.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 2147483647;
            display: flex;
            align-items: flex-end;
            gap: 15px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            transition: all 0.3s ease-in-out;
            pointer-events: none;
        `;

        const clippyImgUrl = chrome.runtime.getURL('images/clippy.gif');
        clippyContainer.innerHTML = `
            <button id="flo-clippy-hide" title="Hide Clippy" style="
                position: absolute;
                top: -6px;
                right: 4px;
                width: 24px;
                height: 24px;
                border: 1px solid #d1d5db;
                border-radius: 999px;
                background: #ffffff;
                color: #666;
                font-size: 16px;
                line-height: 1;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.18);
                pointer-events: auto;
                z-index: 2;
                padding: 0;
            ">×</button>
            <div id="flo-clippy-bubble" style="
                background: #ffffff;
                border: 2px solid #ce0e2d;
                border-radius: 12px 12px 0 12px;
                padding: 15px 20px;
                box-shadow: 0 8px 25px rgba(0,0,0,0.2);
                max-width: 260px;
                position: relative;
                font-size: 14px;
                color: #333;
                line-height: 1.4;
                display: none;
                pointer-events: auto;
                cursor: pointer;
            ">
                <span id="flo-clippy-close" title="Dismiss Bubble" style="
                    position: absolute;
                    top: 5px;
                    right: 8px;
                    cursor: pointer;
                    font-weight: bold;
                    color: #999;
                    font-size: 16px;
                ">×</span>
                <div id="flo-clippy-text"></div>
            </div>
            <img id="flo-clippy-img" src="${clippyImgUrl}" alt="Helper" style="
                width: 270px;
                height: auto;
                cursor: pointer;
                filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.3));
                display: none;
                pointer-events: auto;
            ">
        `;

        clippyShadow.appendChild(clippyContainer);
        document.body.appendChild(clippyHost);

        const bubble = clippyShadow.getElementById('flo-clippy-bubble');
        const textDiv = clippyShadow.getElementById('flo-clippy-text');
        const img = clippyShadow.getElementById('flo-clippy-img');
        const bubbleClose = clippyShadow.getElementById('flo-clippy-close');
        const clippyClose = clippyShadow.getElementById('flo-clippy-hide');

        bubbleClose.addEventListener('click', (event) => {
            event.stopPropagation();
            if (isOptionsPage) {
                optionsBubbleHidden = true;
                hideBubble();
                return;
            }
            dismissContentSetupClippy();
        });

        clippyClose.addEventListener('click', (event) => {
            event.stopPropagation();
            if (isOptionsPage) {
                optionsClippyHidden = true;
                hideClippy();
                return;
            }
            dismissContentSetupClippy();
        });

        bubble.addEventListener('click', (event) => {
            if (!isOptionsPage) return;
            if (event.target.closest('a')) return;
            if (event.target.id === 'flo-clippy-close') return;
            cycleMessage();
        });

        textDiv.addEventListener('click', (event) => {
            if (!isOptionsPage) return;
            if (event.target.closest('a')) return;
            cycleMessage();
        });

        img.addEventListener('click', () => {
            if (!isOptionsPage) return;
            if (optionsClippyHidden || optionsBubbleHidden) return;
            cycleMessage();
        });
    }

    function showAvatarOnly() {
        if (!clippyHost) injectClippy();
        const bubble = clippyShadow.getElementById('flo-clippy-bubble');
        const img = clippyShadow.getElementById('flo-clippy-img');
        clippyHost.style.display = 'block';
        clippyContainer.style.display = 'flex';
        img.style.display = 'block';
        bubble.style.display = 'none';
        resetPosition();
    }

    function showMessage(text, targetSelector = null) {
        if (!clippyHost) injectClippy();
        const bubble = clippyShadow.getElementById('flo-clippy-bubble');
        const textDiv = clippyShadow.getElementById('flo-clippy-text');
        const img = clippyShadow.getElementById('flo-clippy-img');

        textDiv.innerHTML = text;
        clippyHost.style.display = 'block';
        bubble.style.display = 'block';
        img.style.display = 'block';
        clippyContainer.style.display = 'flex';

        if (targetSelector && document.querySelector(targetSelector)) {
            const rect = document.querySelector(targetSelector).getBoundingClientRect();
            const spaceAbove = rect.top;
            clippyContainer.style.bottom = spaceAbove > 250 ? `${window.innerHeight - rect.top + 20}px` : 'auto';
            clippyContainer.style.top = spaceAbove <= 250 ? `${rect.bottom + 20}px` : 'auto';
            clippyContainer.style.right = 'auto';
            clippyContainer.style.left = `${Math.min(Math.max(20, rect.left), window.innerWidth - 320)}px`;
            return;
        }

        resetPosition();
    }

    function hideBubble() {
        if (!clippyShadow) return;
        const bubble = clippyShadow.getElementById('flo-clippy-bubble');
        if (bubble) bubble.style.display = 'none';
    }

    function hideClippy() {
        if (clippyHost) clippyHost.style.display = 'none';
        hideBubble();
    }

    async function dismissContentSetupClippy() {
        contentSetupDismissed = true;
        hideClippy();
        try {
            await chrome.storage.local.set({ clippy_content_setup_dismissed: true });
        } catch (error) {
            console.warn('Unable to persist Clippy dismissal:', error);
        }
    }

    function cycleMessage() {
        if (!isOptionsPage || optionsClippyHidden || optionsBubbleHidden || !currentReasonKey) return;

        const pool = getMessagePool(currentReasonKey);
        if (pool.length <= 1) return;

        currentMessageIndex = (currentMessageIndex + 1) % pool.length;
        showMessage(pool[currentMessageIndex]);
    }

    function renderReason(reasonKey) {
        const pool = getMessagePool(reasonKey);
        if (!pool.length) {
            hideClippy();
            return;
        }

        const reasonChanged = currentReasonKey !== reasonKey;
        currentReasonKey = reasonKey;
        if (reasonChanged || currentMessageIndex >= pool.length) {
            currentMessageIndex = pickInitialMessageIndex(reasonKey, pool);
        }

        if (isOptionsPage) {
            if (optionsClippyHidden) {
                hideClippy();
                return;
            }
            showAvatarOnly();
            if (optionsBubbleHidden) {
                return;
            }
        } else if (contentSetupDismissed) {
            hideClippy();
            return;
        }

        showMessage(pool[currentMessageIndex]);
    }

    window.showClippyMessage = function(text) {
        if (isOptionsPage) {
            if (optionsClippyHidden || optionsBubbleHidden) return;
            showMessage(`⚠️ ${text}`);
            return;
        }

        if (contentSetupDismissed) return;
        showMessage(`⚠️ ${text}`);
    };

    async function evaluateState() {
        try {
            await stateReady;

            const syncData = await chrome.storage.sync.get([
                'piracy_folder_id',
                'piracy_sheet_id',
                'event_sheet_id'
            ]);

            const hasAllIds = !hasMissingRequiredIds(syncData);

            if (isOptionsPage) {
                renderReason(hasAllIds ? 'options-random' : 'needs-config-options');
                return;
            }

            if (!hasAllIds) {
                renderReason('needs-config-content');
                return;
            }

            hideClippy();
        } catch (error) {
            console.warn('Clippy state check failed:', error);
        }
    }

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'clippyStateChange') {
            evaluateState();
        }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;
        if (!(changes.piracy_folder_id || changes.piracy_sheet_id || changes.event_sheet_id)) return;
        evaluateState();
    });

    if (isOptionsPage) {
        ['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'].forEach((fieldId) => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            const recheckOptionsState = () => {
                useLiveOptionsInputs = true;
                evaluateState();
            };

            field.addEventListener('input', recheckOptionsState);
            field.addEventListener('change', recheckOptionsState);
        });
    }

    window.addEventListener('triggerClippyHype', (event) => {
        if (!clippyHost || clippyHost.style.display === 'none') return;

        const { message, isLevelUp } = event.detail;
        const img = clippyShadow?.getElementById('flo-clippy-img');
        if (img) img.src = chrome.runtime.getURL('images/clippy smrik.gif');

        showMessage(`🎉 <b>${isLevelUp ? 'LEVEL UP!' : "Rank Up! You're now a Pathfinder!"}</b><br><br>${message || ''}`);

        setTimeout(() => {
            if (img) img.src = chrome.runtime.getURL('images/clippy.gif');
        }, 5000);
    });

    const domObserver = new MutationObserver((mutations, obs) => {
        void mutations;
        if (document.getElementById('flo-add') || isOptionsPage) {
            evaluateState();
            obs.disconnect();
        }
    });

    domObserver.observe(document.documentElement, { childList: true, subtree: true });

    if (document.getElementById('flo-add') || isOptionsPage) {
        evaluateState();
    }
})();
