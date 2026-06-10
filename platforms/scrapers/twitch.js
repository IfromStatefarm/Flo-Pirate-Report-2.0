(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'twitch',
    label: 'Twitch',
    domains: ['twitch.tv'],
    legacyKey: 'twitch',
    mediaTypes: ['live', 'vod', 'clip']
  });
})();
