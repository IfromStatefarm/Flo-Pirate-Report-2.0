(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com', 'youtu.be', 'studio.youtube.com'],
    legacyKey: 'youtube',
    mediaTypes: ['long-form', 'shorts', 'live']
  });
})();
