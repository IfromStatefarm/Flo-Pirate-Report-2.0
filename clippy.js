// clippy.js

(function() {
    // Prevent duplicate injections
    if (window.hasClippyRun) return;
    window.hasClippyRun = true;

    let clippyHost;
    let clippyShadow;

    // 1. Inject the Modular UI
    function injectClippy() {
        if (document.getElementById('flo-clippy-host')) return;

        clippyHost = document.createElement('div');
        clippyHost.id = 'flo-clippy-host';
        clippyShadow = clippyHost.attachShadow({ mode: 'open' });
        
        const clippyContainer = document.createElement('div');
        clippyContainer.id = 'flo-clippy-container';
        
        // Use fixed positioning to float in the bottom right corner
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
            pointer-events: none; /* Let clicks pass through container */
        `;

        // URL for the image asset (Needs to be in web_accessible_resources)
        const clippyImgUrl = chrome.runtime.getURL('images/clippy.gif');

        clippyContainer.innerHTML = `
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
                pointer-events: auto; /* Re-enable clicks for the bubble */
            ">
                <span id="flo-clippy-close" title="Dismiss" style="
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
                width: 90px; 
                height: auto; 
                cursor: pointer;
                filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.3));
                display: none;
                pointer-events: auto; /* Re-enable clicks for the image */
            ">
        `;

        clippyShadow.appendChild(clippyContainer);
        document.body.appendChild(clippyHost);

        // Allow user to permanently dismiss Clippy (Skip Tutorial)
        clippyShadow.getElementById('flo-clippy-close').addEventListener('click', () => {
            // 1. Hide immediately for snappy UI response
            clippyHost.style.display = 'none';
            
            // 2. Write permanent bypass flag to Chrome storage
            chrome.storage.local.set({ onboarding_step: 'COMPLETE' }, () => {
                console.log("PIRATE AI: Tutorial permanently dismissed by user.");
            });
        });
        
        // Clicking clippy toggles the bubble
        clippyShadow.getElementById('flo-clippy-img').addEventListener('click', () => {
            const bubble = clippyShadow.getElementById('flo-clippy-bubble');
            bubble.style.display = bubble.style.display === 'none' ? 'block' : 'none';
        });
    }
    // Helper to show messages in the bubble with optional targeting
    function showMessage(text) {
        if (!clippyHost) injectClippy();
        const bubble = clippyShadow.getElementById('flo-clippy-bubble');
        const textDiv = clippyShadow.getElementById('flo-clippy-text');
        const img = clippyShadow.getElementById('flo-clippy-img');
        
        textDiv.innerHTML = text;
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
        } else {
            clippyContainer.style.top = 'auto';
            clippyContainer.style.left = 'auto';
            clippyContainer.style.bottom = '30px';
            clippyContainer.style.right = '30px';
        }
    }

    function hideClippy() {
        if (clippyHost) clippyHost.style.display = 'none';
    }

    // 2. Evaluate State and Determine Dialogue
    async function evaluateState() {
        try {
            const res = await chrome.storage.local.get(['onboarding_step']);
            const state = res.onboarding_step;
            const url = window.location.href.toLowerCase();

            if (state === 'NEEDS_CONFIG') {
                if (url.includes('options.html')) {
                    showMessage("Hi! I'm your FloSports Piracy Assistant. <br><br>Please paste your <b>Folder ID</b>, <b>Foundation Sheet ID</b>, and <b>Config Sheet ID</b> into the boxes above.<br><br>Need help finding your IDs? <a href='https://flocasts.atlassian.net/wiki/spaces/FSM/pages/5634621448/FloSports+Pirate+Reporter+3.3.1+Pirate+AI#Id-for-3-boxes' target='_blank' style='color: #ce0e2d; font-weight: bold; text-decoration: underline;'>Check out the setup guide here</a>.<br><br>When you're done, click <b>Save All Settings</b>.");
                }
            }
            else if (state === 'READY_FOR_FIRST_REPORT') {
                if (url.includes('options.html')) {
                    showMessage("Great job! 🎉 Your IDs are locked in.<br><br>Let's head over to a <b>TikTok</b> or <b>YouTube</b> video for your first hunt!");
                } 
                else if (url.includes('tiktok.com') || url.includes('youtube.com')) {
                    showMessage("You made it! 🎯<br><br>When you find pirated content, just click the <b>+ Add</b> button on my Pirate AI overlay (top right) to capture the evidence.");
                    
                    const spotlightInterval = setInterval(() => {
                        const addBtn = document.getElementById('flo-add');
                        if (addBtn) {
                            clearInterval(spotlightInterval);
                            addBtn.style.position = 'relative';
                            addBtn.style.zIndex = '2147483647'; // Ensures it sits above the new shadow
                            addBtn.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.7), 0 0 15px 2px rgba(206,14,45,0.8)';
                            
                            // Dismiss spotlight when the user clicks the button
                            addBtn.addEventListener('click', () => addBtn.style.boxShadow = 'none', { once: true });
                        }
                    }, 500);

                    // Mark onboarding complete so he doesn't show up on every video permanently
                    chrome.storage.local.set({ onboarding_step: 'COMPLETE' });
                }
            } 
            else if (state === 'COMPLETE') {
                hideClippy();
            }
        } catch (e) {
            console.warn("Clippy state check failed:", e);
        }
    }

    // 3. Listen for Live State Changes from Background.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'clippyStateChange') {
            evaluateState();
        }
    });

    // Deterministic Loading: Wait for the + Add button overlay or Options page
    const domObserver = new MutationObserver((mutations, obs) => {
        if (document.getElementById('flo-add') || window.location.href.includes('options.html')) {
            evaluateState();
            obs.disconnect(); // Stop observing once target is found
        }
    });
    
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
    
    // Fallback: If it injected before the observer attached
    if (document.getElementById('flo-add') || window.location.href.includes('options.html')) {
        evaluateState();
    }
})();