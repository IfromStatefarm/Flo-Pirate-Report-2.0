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
    assistantImageUrl: '', assistantImageDataUrl: '',
    easterEggImageUrl: '', easterEggImageDataUrl: '',
    legal: Object.freeze({
      ownerName: '', companyName: '', reportingEmail: '', secondaryEmail: '', phone: '',
      addressLine1: '', city: '', region: '', postalCode: '', country: '', originalWorkUrl: ''
    })
  });

  let currentTheme = FALLBACK;
  let loadingPromise = null;
  const THEME_REQUEST_TIMEOUT_MS = 4000;

  function requestRuntimeTheme() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => {
        finish(reject, new Error('Runtime theme request timed out.'));
      }, THEME_REQUEST_TIMEOUT_MS);

      try {
        Promise.resolve(chrome.runtime.sendMessage({ action: 'getRuntimeTheme' })).then(
          (response) => finish(resolve, response),
          (error) => finish(reject, error)
        );
      } catch (error) {
        finish(reject, error);
      }
    });
  }

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
    root.querySelectorAll?.('[data-theme-assistant]').forEach((element) => {
      const assistantImage = theme.assistantImageDataUrl || chrome.runtime.getURL('images/clippy starting postion.png');
      element.setAttribute('src', assistantImage);
      element.setAttribute('alt', theme.product.assistantName || 'Reporting Assistant');
    });
    root.querySelectorAll?.('[data-theme-easter-egg]').forEach((element) => {
      const easterEggImage = theme.easterEggImageDataUrl || chrome.runtime.getURL('images/Flopirate hunter.gif');
      element.setAttribute('src', easterEggImage);
      element.setAttribute('alt', `${theme.product.displayName} Easter egg`);
    });
    globalThis.dispatchEvent?.(new CustomEvent('rights-reporter-theme-changed', { detail: theme }));
    return theme;
  }

  async function loadTheme() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const response = await requestRuntimeTheme();
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
    if (
      changes.customer_access_profile_v1 ||
      changes.customer_access_denial_v1 ||
      changes.customer_logo_cache_v1 ||
      changes.customer_assistant_image_cache_v1 ||
      changes.customer_easter_egg_image_cache_v1
    ) {
      void loadTheme({ force: true });
    }
  });
})();
