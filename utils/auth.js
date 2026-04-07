// utils/auth.js

export function getAuthToken() {
  return new Promise((resolve, reject) => {
    // Interactive: true allows the Google Login popup to appear if needed
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error("Auth Error:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
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
