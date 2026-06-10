(() => {
  globalThis.__floRegisterScraperModule?.({
    key: 'discord',
    label: 'Discord',
    domains: ['discord.com'],
    legacyKey: 'discord',
    mediaTypes: ['messages', 'links']
  });
})();
