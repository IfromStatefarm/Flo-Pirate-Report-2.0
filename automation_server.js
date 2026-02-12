const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3001;

// POINT THIS TO YOUR EXTENSION FOLDER NAME
// Based on your file structure, it seems to be this:
const EXTENSION_PATH = path.resolve(__dirname, './ivanfromflo/flo-pirate-report-2.0/Flo-Pirate-Report-2.0-IvanfromFlo-config-build');

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
        headless: false, // Must be FALSE to see the browser and bypass bots
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await context.newPage();
    
    try {
        console.log(`🔗 Navigating to: ${payload.url}`);
        await page.goto(payload.url, { waitUntil: 'networkidle' });
        await humanDelay(2000, 4000);

        console.log("🚩 Initiating Report Flow...");
        // Fallback selector for report button if specific ID changes
        // TikTok usually hides report under the 'Share' arrow -> 'Report'
        // This logic handles the generic case; might need tweaking for specific UI updates
        const shareBtn = await page.waitForSelector('[data-e2e="share-icon"]', { timeout: 5000 }).catch(() => null);
        if (shareBtn) {
            await shareBtn.click();
            await humanDelay();
            await page.click('text="Report"');
        } else {
            console.log("Could not find standard share/report button");
        }

        // Example: Selecting "Intellectual Property"
        // await page.click('text="Intellectual property infringement"');
        
        console.log("✅ Automation flow finished (Submission paused for safety).");

    } catch (err) {
        console.error("❌ Automation Failed:", err);
    } finally {
        // Keep browser open for a moment so you can see what happened
        await humanDelay(5000); 
        await context.close();
    }
}

app.post('/report/tiktok', async (req, res) => {
    try {
        reportOnTikTok(req.body); // Triggers the browser
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
