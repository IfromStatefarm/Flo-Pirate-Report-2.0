export function evidenceScope(profile) {
  if (!profile?.customerId || !profile?.userId) throw new Error('A verified evidence scope is required.');
  return { customerId: profile.customerId, userId: profile.userId };
}

export function belongsToScope(value, profile) {
  return Boolean(value && profile && value.customerId === profile.customerId && value.userId === profile.userId);
}

export function imageStorageKey(id, profile) {
  const scope = evidenceScope(profile);
  return JSON.stringify([scope.customerId, scope.userId, id]);
}

// Never substitute the user's unrelated active tab for the requesting tab.
export async function captureForTab(tab, { tabs = chrome.tabs } = {}) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) return null;
  const current = await tabs.get(tab.id);
  const active = await tabs.query({ active: true, windowId: tab.windowId });
  if (!current.active || active[0]?.id !== tab.id || current.url !== tab.url) return null;
  const image = await tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
  const after = await tabs.query({ active: true, windowId: tab.windowId });
  return after[0]?.id === tab.id && after[0]?.url === current.url ? image : null;
}

export function redactObservationUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'wss:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return ''; }
}
