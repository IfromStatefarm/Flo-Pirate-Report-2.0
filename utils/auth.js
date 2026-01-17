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

// NEW: Fetches the user's profile info to verify email
export async function getUserEmail() {
  try {
    const token = await getAuthToken();
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    return data.email;
  } catch (error) {
    console.error("Failed to fetch user email:", error);
    return null;
  }
}
