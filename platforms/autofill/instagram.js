(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'instagram',
    label: 'Instagram',
    legacyKey: 'instagram',
    domains: ['instagram.com', 'help.instagram.com'],
    pagePatterns: ['help.instagram.com/contact/552695131608132'],
    mediaTypes: ['reels', 'stories', 'live']
  });
})();
