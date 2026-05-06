import { ALLOWED_EMAIL_DOMAIN } from './extension_constants.js';

export function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

export function isAllowedUserEmail(email, requiredDomain = ALLOWED_EMAIL_DOMAIN) {
  return normalizeEmail(email).endsWith(requiredDomain);
}

export async function requestRuntimeEmail() {
  const response = await chrome.runtime.sendMessage({ action: 'checkUserIdentity' });
  return normalizeEmail(response?.email);
}

export async function requestVerifiedRuntimeIdentity({
  requiredDomain = ALLOWED_EMAIL_DOMAIN,
  timeoutMs = 0
} = {}) {
  const identityPromise = requestRuntimeEmail().then((email) => ({
    email,
    allowed: isAllowedUserEmail(email, requiredDomain)
  }));

  if (!timeoutMs) {
    return identityPromise;
  }

  return Promise.race([
    identityPromise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    })
  ]);
}

export function renderAccessRestrictedNotice(targetEl, email, requiredDomain = ALLOWED_EMAIL_DOMAIN) {
  if (!targetEl) return;

  targetEl.innerHTML = `⚠️ <strong>Access Restricted</strong><br>Logged in as: ${email || 'Unknown'}<br>Required: ${requiredDomain}`;
  targetEl.style.color = 'red';
}
