// clippy.js

(function() {
    // Prevent duplicate injections
    if (window.hasClippyRun) return;
    window.hasClippyRun = true;

    let clippyContainer;

    // 1. Inject the Modular UI
    function injectClippy() {
        if (document.getElementById('flo-clippy-container')) return;

        clippyContainer = document.createElement('div');
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

        document.body.appendChild(clippyContainer);

        // Allow user to dismiss Clippy
        document.getElementById('flo-clippy-close').addEventListener('click', () => {
            clippyContainer.style.display = 'none';
        });
        
        // Clicking clippy toggles the bubble
        document.getElementById('flo-clippy-img').addEventListener('click', () => {
            const bubble = document.getElementById('flo-clippy-bubble');
            bubble.style.display = bubble.style.display === 'none' ? 'block' : 'none';
        });
    }

    function showMessage(text) {
        if (!clippyContainer) injectClippy();
        const bubble = document.getElementById('flo-clippy-bubble');
        const textDiv = document.getElementById('flo-clippy-text');
        const img = document.getElementById('flo-clippy-img');
        
        textDiv.innerHTML = text;
        bubble.style.display = 'block';
        img.style.display = 'block';
        clippyContainer.style.display = 'flex';
    }

    function hideClippy() {
        if (clippyContainer) clippyContainer.style.display = 'none';
    }

    // 2. Evaluate State and Determine Dialogue
    async function evaluateState() {
        try {
            const res = await chrome.storage.local.get(['onboarding_step']);
            const state = res.onboarding_step;
            const url = window.location.href.toLowerCase();

            if (state === 'NEEDS_CONFIG') {
                if (url.includes('options.html')) {
                    showMessage("Hi! I'm your FloSports Piracy Assistant. 🏴‍☠️<br><br>Please paste your <b>Folder ID</b>, <b>Foundation Sheet ID</b>, and <b>Config Sheet ID</b> into the boxes above, then click <b>Save All Settings</b>.");
                }
            } 
            else if (state === 'READY_FOR_FIRST_REPORT') {
                if (url.includes('options.html')) {
                    showMessage("Great job! 🎉 Your IDs are locked in.<br><br>Let's head over to a <b>TikTok</b> or <b>YouTube</b> video for your first hunt!");
                } 
                else if (url.includes('tiktok.com') || url.includes('youtube.com')) {
                    showMessage("You made it! 🎯<br><br>When you find pirated content, just click the <b>+ Add</b> button on my Pirate AI overlay (top right) to capture the evidence.");
                    
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

    // Run automatically on page load
    setTimeout(evaluateState, 1000); // Slight delay ensures DOM is fully ready
})();