(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'twitter',
    label: 'X / Twitter',
    domains: ['x.com', 'twitter.com'],
    legacyKey: 'twitter',
    mediaTypes: ['clips', 'live-spaces']
  });
})();
