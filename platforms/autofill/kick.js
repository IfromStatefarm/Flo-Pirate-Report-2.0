(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'kick',
    label: 'Kick',
    legacyKey: 'kick',
    domains: ['kick.com'],
    pagePatterns: ['kick.com'],
    mediaTypes: ['email-notice']
  });
})();
