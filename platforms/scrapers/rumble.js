(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'rumble',
    label: 'Rumble',
    domains: ['rumble.com'],
    legacyKey: 'rumble',
    mediaTypes: ['vod', 'live']
  });
})();
