(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'tiktok',
    label: 'TikTok',
    legacyKey: 'tiktok',
    domains: ['tiktok.com', 'tiktokforbusiness.com'],
    pagePatterns: ['tiktok.com/legal/report', 'ipr.tiktokforbusiness.com'],
    mediaTypes: ['short-form', 'live']
  });
})();
