(function initializeAssistantPreference(root) {
  if (root.RightsReporterAssistantPreference) return;

  const STORAGE_KEY = 'assistant_enabled';

  function isEnabled(value) {
    return value !== false;
  }

  async function read() {
    try {
      const values = await chrome.storage.sync.get([STORAGE_KEY]);
      return isEnabled(values?.[STORAGE_KEY]);
    } catch (error) {
      console.warn('Unable to read the assistant preference; using the enabled default.', error);
      return true;
    }
  }

  async function write(enabled) {
    const normalizedValue = isEnabled(enabled);
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalizedValue });
    return normalizedValue;
  }

  root.RightsReporterAssistantPreference = Object.freeze({
    STORAGE_KEY,
    isEnabled,
    read,
    write
  });
})(globalThis);
