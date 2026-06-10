(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'twitch',
    label: 'Twitch',
    legacyKey: 'twitch',
    domains: ['twitch.tv'],
    pagePatterns: ['twitch.tv/copyright-claims'],
    mediaTypes: ['live', 'vod', 'clip']
  });
})();
