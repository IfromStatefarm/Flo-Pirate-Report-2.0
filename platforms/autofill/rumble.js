(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'rumble',
    label: 'Rumble',
    legacyKey: 'rumble',
    domains: ['rumble.com'],
    pagePatterns: ['rumble.com'],
    mediaTypes: ['vod', 'live']
  });
})();
