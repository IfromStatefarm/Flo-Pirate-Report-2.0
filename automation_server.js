/**
 * Flo Pirate Report - Playwright Automation Server
 * This script runs locally (Node.js) and automates the reporting flow.
 */

const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3001;

// Path to your extension folder (ensure this is correct relative to where you run node)
const EXTENSION_PATH = path.resolve(__dirname, './Flo-Pirate-Report-2.0-IvanfromFlo-config-build');

app.use(bodyParser.json());

const humanDelay = async (min = 1000, max = 3000) => {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, delay));
};

async function reportOnTikTok(payload) {
    console.log(`🚀 Starting Automation for Handle: @${payload.handle}`);
    
    // Launching with persistent context to keep logins/cookies active
    const userDataDir = './playwright-user-data';
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Headed mode is required for extension & anti-bot
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await context.newPage();
    
    try {
        // 1. Navigate to the infringing video
        console.log(`🔗 Navigating to: ${payload.url}`);
        await page.goto(payload.url, { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        // 2. Extract Data (Hydration Check)
        console.log("🧬 Extracting Engagement Data...");
        await page.waitForSelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__', { timeout: 10000 });
        
        const playCount = await page.evaluate(() => {
            try {
                const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
                const data = JSON.parse(script.textContent);
                // Navigating the JSON tree as requested
                return data.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemStruct?.stats?.playCount || "N/A";
            } catch (e) {
                // HTML Fallback if JSON fails
                const viewsEl = document.querySelector('[data-e2e="video-views"]');
                return viewsEl ? viewsEl.innerText : "N/A";
            }
        });
        
        console.log(`📊 Play Count Extracted: ${playCount}`);
        payload.playCount = playCount;

        // 3. Initiate Reporting Flow
        console.log("🚩 Initiating Report Flow...");
        // TikTok Reporting URLs usually follow a specific pattern or need to be clicked via UI
        const reportBtn = await page.waitForSelector('[data-e2e="report-button"]');
        await humanDelay();
        await reportBtn.click();

        // 4. Fill Form (Simulating human interaction)
        // Note: The specific selectors for TikTok's report reason tree change frequently
        // This is a generalized flow based on standard platform UX
        console.log("📝 Filling out report reasons...");
        await page.click('text="Intellectual property infringement"');
        await humanDelay(1500, 2500);
        
        await page.click('text="Copyright infringement"');
        await humanDelay();

        // Use the extension ID dynamically for any cross-talk if needed
        const extensionId = await page.evaluate(async () => {
            // Service worker URL check
            const res = await fetch('chrome-extension://'); // Placeholder to trigger id extraction in actual browser
            return "dynamic-id-check"; 
        });

        // Final Submission (Safety: Commented out for initial testing)
        // await page.click('button:has-text("Submit")');
        console.log("✅ Automation reached the submission step.");

    } catch (err) {
        console.error("❌ Automation Failed:", err);
    } finally {
        await humanDelay(5000); // Leave open for inspection
        await context.close();
    }
}

// REST API for the Extension to trigger
app.post('/report/tiktok', async (req, res) => {
    try {
        // Trigger non-blocking automation
        reportOnTikTok(req.body);
        res.json({ success: true, message: "Automation started" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`-----------------------------------------`);
    console.log(`🏴‍☠️ Flo Piracy Automation Backend Active`);
    console.log(`📍 Listening on http://localhost:${PORT}`);
    console.log(`-----------------------------------------`);
});
