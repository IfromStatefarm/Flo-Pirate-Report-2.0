import {
  resolveCustomerConfig,
  resolveCustomerConfigFromSheetRow
} from '../utils/customer_config.js';

export const CUSTOMER_CONFIG_STORAGE_KEY = 'validated_customer_config_v1';

export function createCustomerConfigService({ storageArea = chrome.storage.local } = {}) {
  async function getCurrentConfig() {
    try {
      const stored = await storageArea.get(CUSTOMER_CONFIG_STORAGE_KEY);
      return resolveCustomerConfig(stored?.[CUSTOMER_CONFIG_STORAGE_KEY], 'validated-cache');
    } catch {
      const fallback = resolveCustomerConfig(null);
      return {
        ...fallback,
        errors: [{ path: 'storage', code: 'read_failed', message: 'Customer configuration storage is unavailable.' }]
      };
    }
  }

  async function storeCandidate(candidate) {
    const resolved = resolveCustomerConfig(candidate, 'customer');
    if (resolved.usedFallback) {
      await storageArea.remove(CUSTOMER_CONFIG_STORAGE_KEY);
      return resolved;
    }
    await storageArea.set({ [CUSTOMER_CONFIG_STORAGE_KEY]: resolved.config });
    return resolved;
  }

  async function storeSheetRow(headers, row) {
    const resolved = resolveCustomerConfigFromSheetRow(headers, row);
    if (resolved.usedFallback) {
      await storageArea.remove(CUSTOMER_CONFIG_STORAGE_KEY);
      return resolved;
    }
    await storageArea.set({ [CUSTOMER_CONFIG_STORAGE_KEY]: resolved.config });
    return resolved;
  }

  async function clear() {
    await storageArea.remove(CUSTOMER_CONFIG_STORAGE_KEY);
  }

  return { clear, getCurrentConfig, storeCandidate, storeSheetRow };
}
