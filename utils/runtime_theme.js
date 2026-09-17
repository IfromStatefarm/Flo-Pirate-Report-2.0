import { NEUTRAL_CUSTOMER_CONFIG } from './customer_config.js';

export const RUNTIME_THEME_SCHEMA_VERSION = 1;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function neutralTheme() {
  return {
    schemaVersion: RUNTIME_THEME_SCHEMA_VERSION,
    customerId: NEUTRAL_CUSTOMER_CONFIG.customerId,
    configVersion: NEUTRAL_CUSTOMER_CONFIG.configVersion,
    status: 'fallback',
    isFallback: true,
    product: { ...NEUTRAL_CUSTOMER_CONFIG.product },
    colors: { ...NEUTRAL_CUSTOMER_CONFIG.theme.colors },
    logoUrl: '',
    logoDataUrl: '',
    logoAltText: NEUTRAL_CUSTOMER_CONFIG.theme.logoAltText,
    assistantImageUrl: '',
    assistantImageDataUrl: '',
    easterEggImageUrl: '',
    easterEggImageDataUrl: '',
    legal: { ...NEUTRAL_CUSTOMER_CONFIG.legal }
  };
}

export function buildRuntimeTheme(profile, assetData = {}) {
  if (profile?.status !== 'ready' || profile?.verification !== 'verified' || !profile.theme) {
    return deepFreeze(neutralTheme());
  }

  const theme = profile.theme;
  const assets = typeof assetData === 'string' ? { logoDataUrl: assetData } : (assetData || {});
  return deepFreeze({
    schemaVersion: RUNTIME_THEME_SCHEMA_VERSION,
    customerId: profile.customerId,
    configVersion: profile.configVersion,
    status: 'customer',
    isFallback: false,
    product: Object.freeze({
      productName: theme.productName,
      displayName: theme.displayName,
      shortName: theme.shortName,
      assistantName: theme.assistantName,
      tagline: theme.tagline
    }),
    colors: Object.freeze({ ...theme.colors }),
    logoUrl: theme.logoUrl,
    logoDataUrl: String(assets.logoDataUrl || ''),
    logoAltText: theme.logoAltText,
    assistantImageUrl: theme.assistantImageUrl,
    assistantImageDataUrl: String(assets.assistantImageDataUrl || ''),
    easterEggImageUrl: theme.easterEggImageUrl,
    easterEggImageDataUrl: String(assets.easterEggImageDataUrl || ''),
    legal: Object.freeze({ ...(profile.legal || NEUTRAL_CUSTOMER_CONFIG.legal) })
  });
}
