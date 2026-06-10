(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'kick',
    label: 'Kick',
    domains: ['kick.com'],
    legacyKey: 'kick',
    mediaTypes: ['vod', 'live']
  });
})();
