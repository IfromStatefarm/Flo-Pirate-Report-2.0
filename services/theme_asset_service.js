export const CUSTOMER_LOGO_CACHE_KEY = 'customer_logo_cache_v1';
export const CUSTOMER_ASSISTANT_IMAGE_CACHE_KEY = 'customer_assistant_image_cache_v1';
export const CUSTOMER_EASTER_EGG_IMAGE_CACHE_KEY = 'customer_easter_egg_image_cache_v1';

const APPROVED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 1024 * 1024;
const ASSET_CACHE_KEYS = Object.freeze({
  logo: CUSTOMER_LOGO_CACHE_KEY,
  assistant: CUSTOMER_ASSISTANT_IMAGE_CACHE_KEY,
  easterEgg: CUSTOMER_EASTER_EGG_IMAGE_CACHE_KEY
});

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isSafeCachedImage(value, expected) {
  return Boolean(
    value &&
    value.customerId === expected.customerId &&
    value.configVersion === expected.configVersion &&
    value.sourceUrl === expected.sourceUrl &&
    String(value.dataUrl || '').length <= Math.ceil(MAX_IMAGE_BYTES * 1.38) + 64 &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl || '')
  );
}

export function createThemeAssetService({
  storageArea = chrome.storage.local,
  fetchImpl = fetch
} = {}) {
  async function resolveImage({ kind, customerId, configVersion, sourceUrl }) {
    const cacheKey = ASSET_CACHE_KEYS[kind];
    if (!cacheKey || !customerId || !sourceUrl) return '';
    const expected = { customerId, configVersion, sourceUrl };
    const stored = await storageArea.get(cacheKey);
    const cached = stored?.[cacheKey];
    if (isSafeCachedImage(cached, expected)) return cached.dataUrl;
    if (cached) await storageArea.remove(cacheKey);

    try {
      const response = await fetchImpl(sourceUrl, {
        cache: 'force-cache',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error(`Theme image request failed (${response.status}).`);
      const declaredLength = Number(response.headers?.get?.('content-length') || 0);
      if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Theme image is too large.');
      const blob = await response.blob();
      const mimeType = String(blob.type || '').toLowerCase();
      if (!APPROVED_IMAGE_TYPES.has(mimeType) || blob.size > MAX_IMAGE_BYTES) {
        throw new Error('Theme images must be PNG, JPEG, WebP, or GIF files no larger than 1 MB.');
      }
      const dataUrl = `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
      await storageArea.set({
        [cacheKey]: {
          ...expected,
          dataUrl,
          cachedAt: Date.now()
        }
      });
      return dataUrl;
    } catch (error) {
      console.warn(`Customer ${kind} image cache unavailable:`, error.message);
      return '';
    }
  }

  function resolveLogo({ customerId, configVersion, logoUrl }) {
    return resolveImage({ kind: 'logo', customerId, configVersion, sourceUrl: logoUrl });
  }

  function resolveAssistantImage({ customerId, configVersion, assistantImageUrl }) {
    return resolveImage({
      kind: 'assistant', customerId, configVersion, sourceUrl: assistantImageUrl
    });
  }

  function resolveEasterEggImage({ customerId, configVersion, easterEggImageUrl }) {
    return resolveImage({
      kind: 'easterEgg', customerId, configVersion, sourceUrl: easterEggImageUrl
    });
  }

  async function resolveThemeAssets(theme) {
    const [logoDataUrl, assistantImageDataUrl, easterEggImageDataUrl] = await Promise.all([
      resolveLogo(theme),
      resolveAssistantImage(theme),
      resolveEasterEggImage(theme)
    ]);
    return { logoDataUrl, assistantImageDataUrl, easterEggImageDataUrl };
  }

  async function clear() {
    await storageArea.remove(Object.values(ASSET_CACHE_KEYS));
  }

  return { clear, resolveAssistantImage, resolveEasterEggImage, resolveLogo, resolveThemeAssets };
}
