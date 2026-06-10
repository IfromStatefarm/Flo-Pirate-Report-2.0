(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'facebook',
    label: 'Facebook',
    legacyKey: 'facebook',
    domains: ['facebook.com'],
    pagePatterns: ['facebook.com/help/contact/copyrightform'],
    mediaTypes: ['video', 'post']
  });
})();
