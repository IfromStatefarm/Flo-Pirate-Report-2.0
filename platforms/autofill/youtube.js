(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'youtube',
    label: 'YouTube',
    legacyKey: 'youtube',
    domains: ['youtube.com', 'studio.youtube.com'],
    pagePatterns: ['youtube.com/copyright_complaint_form'],
    mediaTypes: ['long-form', 'shorts', 'live']
  });
})();
