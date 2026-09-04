export const CUSTOMER_LOGO_CACHE_KEY = 'customer_logo_cache_v1';

const APPROVED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_LOGO_BYTES = 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isSafeCachedLogo(value, expected) {
  return Boolean(
    value &&
    value.customerId === expected.customerId &&
    value.configVersion === expected.configVersion &&
    value.sourceUrl === expected.sourceUrl &&
    String(value.dataUrl || '').length <= Math.ceil(MAX_LOGO_BYTES * 1.38) + 64 &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl || '')
  );
}

export function createThemeAssetService({
  storageArea = chrome.storage.local,
  fetchImpl = fetch
} = {}) {
  async function resolveLogo({ customerId, configVersion, logoUrl }) {
    if (!customerId || !logoUrl) return '';
    const expected = { customerId, configVersion, sourceUrl: logoUrl };
    const stored = await storageArea.get(CUSTOMER_LOGO_CACHE_KEY);
    const cached = stored?.[CUSTOMER_LOGO_CACHE_KEY];
    if (isSafeCachedLogo(cached, expected)) return cached.dataUrl;
    if (cached) await storageArea.remove(CUSTOMER_LOGO_CACHE_KEY);

    try {
      const response = await fetchImpl(logoUrl, {
        cache: 'force-cache',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error(`Logo request failed (${response.status}).`);
      const declaredLength = Number(response.headers?.get?.('content-length') || 0);
      if (declaredLength > MAX_LOGO_BYTES) throw new Error('Logo is too large.');
      const blob = await response.blob();
      const mimeType = String(blob.type || '').toLowerCase();
      if (!APPROVED_LOGO_TYPES.has(mimeType) || blob.size > MAX_LOGO_BYTES) {
        throw new Error('Logo must be a PNG, JPEG, WebP, or GIF no larger than 1 MB.');
      }
      const dataUrl = `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
      await storageArea.set({
        [CUSTOMER_LOGO_CACHE_KEY]: {
          ...expected,
          dataUrl,
          cachedAt: Date.now()
        }
      });
      return dataUrl;
    } catch (error) {
      console.warn('Customer logo cache unavailable:', error.message);
      return '';
    }
  }

  async function clear() {
    await storageArea.remove(CUSTOMER_LOGO_CACHE_KEY);
  }

  return { clear, resolveLogo };
}
