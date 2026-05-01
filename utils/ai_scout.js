// utils/ai_scout.js

/**
 * Manages the connection to the Chrome built-in Gemini Nano model.
 */

let aiCapabilities = null;
let activeSession = null;

/**
 * Initializes the AI capability check.
 * Should be called when the extension loads or before a Closer run.
 * @returns {Promise<boolean>} True if ready, False if unavailable or needs download.
 */
export async function initNanoAI() {
    try {
        // 1. Check if the experimental window.ai / self.ai API is exposed
        if (!('ai' in self) || !('languageModel' in self.ai)) {
            console.warn("🤖 Nano Scout: Built-in AI not available in this browser. Please check Chrome flags.");
            return false;
        }

        // 2. Check capabilities
        aiCapabilities = await self.ai.languageModel.capabilities();
        
        if (aiCapabilities.available === 'no') {
            console.warn("Nano Scout: AI model not usable (insufficient hardware).");
            return false;
        }
        
        if (aiCapabilities.available === 'after-download') {
            console.warn("Nano Scout: AI model is downloading. Fallback logic will be used until complete.");
            // You can optionally trigger the download here by calling create() and catching the progress
            return false;
        }

        console.log("Nano Scout: Gemini Nano is ONLINE and ready for semantic verification.");
        return true;

    } catch (e) {
        console.error("Nano Scout: Initialization failed:", e);
        return false;
    }
}

/**
 * Starts a persistent session for The Closer to prevent spinning up 
 * the model for every single link.
 */
export async function startScoutSession() {
    if (activeSession) return activeSession;
    
    const isReady = await initNanoAI();
    if (!isReady) return null;

    try {
        activeSession = await self.ai.languageModel.create({
            systemPrompt: "You are a copyright enforcement agent. Analyze the provided webpage text. Determine if the video is clearly removed (e.g., copyright claim, deleted, private) or active. Reply with exactly one word: DOWN, ACTIVE, or UNCERTAIN."
        });
        return activeSession;
    } catch (e) {
        console.error("🤖 Nano Scout: Failed to create session:", e);
        return null;
    }
}

/**
 * Closes the session to free up memory when The Closer finishes.
 */
export function endScoutSession() {
    if (activeSession) {
        activeSession.destroy();
        activeSession = null;
        console.log("🤖 Nano Scout: Session destroyed. Memory freed.");
    }
}