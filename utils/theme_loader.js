(() => {
  'use strict';

  if (globalThis.RightsReporterTheme) {
    void globalThis.RightsReporterTheme.loadTheme();
    return;
  }

  const SEMANTIC_COLOR_MAP = Object.freeze({
    primary: '--brand-primary',
    primaryHover: '--brand-primary-hover',
    accent: '--brand-accent',
    onPrimary: '--brand-on-primary',
    background: '--page-background',
    surface: '--surface',
    text: '--text-primary',
    muted: '--text-muted',
    border: '--border',
    success: '--status-success',
    warning: '--status-warning',
    danger: '--status-danger'
  });

  const FALLBACK = Object.freeze({
    schemaVersion: 1,
    customerId: 'default',
    configVersion: 1,
    status: 'fallback',
    isFallback: true,
    product: Object.freeze({
      productName: 'Rights Reporter',
      displayName: 'Rights Reporter',
      shortName: 'Reporter',
      assistantName: 'Reporting Assistant',
      tagline: 'Capture evidence, manage reports, and track outcomes.'
    }),
    colors: Object.freeze({
      primary: '#334155', primaryHover: '#1F2937', accent: '#2563EB', onPrimary: '#FFFFFF',
      background: '#F8FAFC', surface: '#FFFFFF', text: '#111827', muted: '#64748B',
      border: '#E5E7EB', success: '#166534', warning: '#B45309', danger: '#B91C1C'
    }),
    logoUrl: '', logoDataUrl: '', logoAltText: 'Rights Reporter',
    legal: Object.freeze({
      ownerName: '', companyName: '', reportingEmail: '', secondaryEmail: '', phone: '',
      addressLine1: '', city: '', region: '', postalCode: '', country: '', originalWorkUrl: ''
    })
  });

  let currentTheme = FALLBACK;
  let loadingPromise = null;

  function safeTheme(candidate) {
    if (!candidate || candidate.schemaVersion !== 1 || !candidate.product || !candidate.colors) return FALLBACK;
    return candidate;
  }

  function textValue(key, theme) {
    const values = {
      productName: theme.product.productName,
      displayName: theme.product.displayName,
      shortName: theme.product.shortName,
      assistantName: theme.product.assistantName,
      tagline: theme.product.tagline,
      documentTitle: `${theme.product.displayName} Settings`,
      logoAltText: theme.logoAltText,
      legalOwnerName: theme.legal?.ownerName || 'Rights Owner',
      legalCompanyName: theme.legal?.companyName || '',
      reportingEmail: theme.legal?.reportingEmail || '',
      secondaryEmail: theme.legal?.secondaryEmail || '',
      reportingPhone: theme.legal?.phone || '',
      originalWorkUrl: theme.legal?.originalWorkUrl || ''
    };
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] || '') : '';
  }

  function applyTheme(candidate = FALLBACK, root = document) {
    const theme = safeTheme(candidate);
    currentTheme = theme;
    const documentElement = root.documentElement || document.documentElement;
    Object.entries(SEMANTIC_COLOR_MAP).forEach(([token, property]) => {
      documentElement.style.setProperty(property, theme.colors[token]);
    });
    documentElement.style.setProperty('--surface-subtle', theme.colors.background);
    documentElement.style.setProperty('--border-strong', theme.colors.muted);
    documentElement.dataset.customerId = theme.customerId;
    documentElement.dataset.themeStatus = theme.status;

    root.querySelectorAll?.('[data-theme-text]').forEach((element) => {
      element.textContent = textValue(element.dataset.themeText, theme);
    });
    root.querySelectorAll?.('[data-theme-logo]').forEach((element) => {
      const logo = theme.logoDataUrl || chrome.runtime.getURL('images/rights-reporter-icon.svg');
      element.setAttribute('src', logo);
      element.setAttribute('alt', theme.logoAltText || theme.product.displayName);
    });
    globalThis.dispatchEvent?.(new CustomEvent('rights-reporter-theme-changed', { detail: theme }));
    return theme;
  }

  async function loadTheme() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getRuntimeTheme' });
        return applyTheme(response?.success ? response.theme : FALLBACK);
      } catch (error) {
        console.warn('Runtime theme unavailable; using neutral theme.', error?.message || error);
        return applyTheme(FALLBACK);
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  function getTheme() {
    return currentTheme;
  }

  function value(key) {
    return textValue(key, currentTheme);
  }

  globalThis.RightsReporterTheme = Object.freeze({ applyTheme, getTheme, loadTheme, value });
  applyTheme(FALLBACK);
  void loadTheme();

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.customer_access_profile_v1 || changes.customer_access_denial_v1 || changes.customer_logo_cache_v1) {
      void loadTheme({ force: true });
    }
  });
})();
