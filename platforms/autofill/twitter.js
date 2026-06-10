(() => {
  globalThis.__floRegisterAutofillModule?.({
    key: 'twitter',
    label: 'X / Twitter',
    legacyKey: 'twitter',
    domains: ['x.com', 'twitter.com', 'help.x.com'],
    pagePatterns: ['help.x.com/en/forms/ipi/dmca/authorized-rep', 'help.x.com/en/forms/ipi/dmca'],
    mediaTypes: ['clips', 'live-spaces']
  });
})();
