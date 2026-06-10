(function initFloPlatformRegistry() {
  const globalObject = globalThis;

  if (globalObject.__floPlatformRegistry) {
    return;
  }

  const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/^x$/, 'twitter');
  const toList = (value) => (Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []));
  const includesAnyPattern = (url, patterns) => {
    const normalizedUrl = String(url || '').toLowerCase();
    return toList(patterns).some((pattern) => normalizedUrl.includes(String(pattern || '').toLowerCase()));
  };

  function buildDefinition(type, definition) {
    const normalized = {
      ...definition,
      key: normalizeKey(definition.key),
      aliases: toList(definition.aliases).map(normalizeKey),
      domains: toList(definition.domains),
      pagePatterns: toList(definition.pagePatterns)
    };

    if (!normalized.run && normalized.legacyKey) {
      if (type === 'scraper') {
        normalized.run = () => globalObject.__floLegacyScrapers?.run?.(normalized.legacyKey) || null;
      } else {
        normalized.run = (data) => globalObject.__floLegacyAutofill?.run?.(normalized.legacyKey, data) || null;
      }
    }

    return normalized;
  }

  const registry = {
    scrapers: new Map(),
    autofill: new Map(),

    registerScraper(definition) {
      if (!definition?.key) return;
      const normalized = buildDefinition('scraper', definition);
      this.scrapers.set(normalized.key, normalized);
    },

    registerAutofill(definition) {
      if (!definition?.key) return;
      const normalized = buildDefinition('autofill', definition);
      this.autofill.set(normalized.key, normalized);
    },

    getScraper(key) {
      const normalizedKey = normalizeKey(key);
      return this.scrapers.get(normalizedKey) || null;
    },

    getAutofill(key) {
      const normalizedKey = normalizeKey(key);
      return this.autofill.get(normalizedKey) || null;
    },

    findScraperByUrl(url) {
      const normalizedUrl = String(url || '').toLowerCase();
      for (const definition of this.scrapers.values()) {
        if (typeof definition.matchesUrl === 'function' && definition.matchesUrl(normalizedUrl)) {
          return definition;
        }
        if (includesAnyPattern(normalizedUrl, definition.domains)) {
          return definition;
        }
      }
      return null;
    },

    findAutofillByContext(url, data) {
      const normalizedUrl = String(url || '').toLowerCase();
      for (const definition of this.autofill.values()) {
        if (typeof definition.matchesPage === 'function' && definition.matchesPage(normalizedUrl, data)) {
          return definition;
        }
        if (includesAnyPattern(normalizedUrl, definition.pagePatterns) || includesAnyPattern(normalizedUrl, definition.domains)) {
          return definition;
        }
      }

      const requestedKey = normalizeKey(data?.platform || data?.platformKey || data?.reportPlatform);
      if (requestedKey) {
        return this.getAutofill(requestedKey);
      }

      return null;
    }
  };

  globalObject.__floPlatformRegistry = registry;
  globalObject.__floRegisterScraperModule = (definition) => registry.registerScraper(definition);
  globalObject.__floRegisterAutofillModule = (definition) => registry.registerAutofill(definition);
})();
