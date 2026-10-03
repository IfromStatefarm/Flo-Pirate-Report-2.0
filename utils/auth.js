// utils/auth.js

// Only an explicit sign-in action in an extension page should opt into prompts.
export function getAuthToken({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || !token) {
        const message = lastError?.message || 'Chrome did not return a Google OAuth token.';
        console.error("Auth Error:", message);
        reject(new Error(message));
      } else {
        resolve(token);
      }
    });
  });
}

// Fetches the user's profile info to verify email
export async function getUserEmail() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to fetch user email:", chrome.runtime.lastError);
        resolve(null);
      } else {
        // Normalize: ensure lowercase and trimmed for safe comparison
        resolve(userInfo.email ? userInfo.email.toLowerCase().trim() : null);
      }
    });
  });
}
