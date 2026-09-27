import { belongsToScope, evidenceScope } from '../../utils/evidence_scope.js';

const STORAGE_KEY = 'rumble_report_session';

function normalizeUrl(url) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || !/(^|\.)rumble\.com$/.test(parsed.hostname)) {
    throw new Error('The Rumble queue must contain only Rumble URLs.');
  }
  parsed.hash = '';
  return parsed.toString();
}

export function createRumbleWorkflow({ handleBatchReport, getCustomerProfile }) {
  let generation = 0;
  let pending = Promise.resolve();
  const serialize = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const revoked = () => new Error('The Rumble reporting session expired or the account changed. Start a new queue.');

  async function removeSession(sessionId) {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (stored?.sessionId === sessionId) await chrome.storage.local.remove(STORAGE_KEY);
  }

  // The persisted random ID is the session generation: old pages cannot adopt
  // a replacement session, including after logging back into the same account.
  async function assertSession(session, expectedGeneration, profile = null) {
    if (generation !== expectedGeneration || !session?.sessionId) throw revoked();
    const currentProfile = profile || await getCustomerProfile();
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (generation !== expectedGeneration || !session?.sessionId || !stored?.active ||
        stored.sessionId !== session.sessionId || !belongsToScope(session, currentProfile) ||
        !belongsToScope(stored, currentProfile)) throw revoked();
  }

  async function loadSession(currentUrl, sessionId) {
    const expectedGeneration = generation;
    const profile = await getCustomerProfile();
    const session = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    await assertSession(session, expectedGeneration, profile);
    if (!sessionId || session.sessionId !== sessionId ||
        session.urls?.[session.currentIndex] !== normalizeUrl(currentUrl)) throw revoked();
    return { session, expectedGeneration };
  }

  async function validate(currentUrl, sessionId) {
    await loadSession(currentUrl, sessionId);
    return { success: true };
  }

  function start(formData) {
    const requestedGeneration = generation;
    return serialize(async () => {
      const profile = await getCustomerProfile();
      // A scope change during authorization invalidates this start request.
      if (requestedGeneration !== generation) throw revoked();
      const storage = await chrome.storage.local.get('piracy_cart');
      const cart = storage.piracy_cart || [];
      if (!cart.length) throw new Error('Queue is empty. Use the Add buttons on Rumble pages first.');
      if (cart.some(item => !belongsToScope(item, profile))) throw revoked();
      const session = {
        ...evidenceScope(profile),
        sessionId: crypto.randomUUID(),
        active: true,
        startedAt: new Date().toISOString(),
        currentIndex: 0,
        urls: cart.map(item => normalizeUrl(item.url)),
        formData
      };
      if (requestedGeneration !== generation) throw revoked();
      await chrome.storage.local.set({ [STORAGE_KEY]: session });
      try {
        await assertSession(session, requestedGeneration);
        await chrome.tabs.create({ url: session.urls[0], active: true });
        await assertSession(session, requestedGeneration);
        return { success: true, total: session.urls.length, currentUrl: session.urls[0] };
      } catch (error) {
        await removeSession(session.sessionId);
        throw error;
      }
    });
  }

  function advance(currentUrl, senderTabId, sessionId) {
    return serialize(async () => {
      const { session, expectedGeneration } = await loadSession(currentUrl, sessionId);
      const nextIndex = session.currentIndex + 1;
      if (nextIndex < session.urls.length) {
        await chrome.storage.local.set({ [STORAGE_KEY]: { ...session, currentIndex: nextIndex } });
        try {
          await assertSession(session, expectedGeneration);
          const nextUrl = session.urls[nextIndex];
          await chrome.tabs.create({ url: nextUrl, active: true });
          await assertSession(session, expectedGeneration);
          if (senderTabId) chrome.tabs.remove(senderTabId).catch(() => {});
          return { success: true, done: false, nextUrl, currentIndex: nextIndex, total: session.urls.length };
        } catch (error) {
          await removeSession(session.sessionId);
          throw error;
        }
      }

      // Reporting rechecks the owning account after its own async profile load.
      // Keep the session until logging ends so cancellation also revokes logging.
      const response = await handleBatchReport(session.formData, {
        assertActive: (profile) => assertSession(session, expectedGeneration, profile)
      });
      await assertSession(session, expectedGeneration);
      await removeSession(session.sessionId);
      return { success: !!response?.success, done: true, logged: !!response?.success, error: response?.error || null };
    });
  }

  async function cancel() {
    // Synchronous invalidation also stops pending reads/writes. Do not queue this
    // behind work that may itself be refreshing (and revoking) customer access.
    generation += 1;
    await chrome.storage.local.remove(STORAGE_KEY);
    return { success: true };
  }

  return { start, advance, validate, cancel };
}
