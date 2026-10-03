import { getAuthToken } from '../utils/auth.js';

const signInButton = document.getElementById('google-sign-in');
const signInStatus = document.getElementById('google-sign-in-status');

signInButton.addEventListener('click', async () => {
  if (signInButton.disabled) return;
  signInButton.disabled = true;
  signInStatus.textContent = 'Signing in with Google…';
  try {
    // Start consent directly from the click, before any background work.
    await getAuthToken({ interactive: true });
    const response = await chrome.runtime.sendMessage({ action: 'bootstrapCustomerAccess' });
    if (!response?.success) {
      throw new Error(response?.error || 'Customer access could not be verified.');
    }
    // Reload the settings, permissions, and theme for the verified account.
    window.location.reload();
  } catch (error) {
    signInStatus.textContent = `Sign-in failed: ${error.message}`;
  } finally {
    signInButton.disabled = false;
  }
});
