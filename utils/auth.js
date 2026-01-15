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