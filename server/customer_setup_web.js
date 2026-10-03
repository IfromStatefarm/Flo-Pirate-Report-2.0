import crypto from 'node:crypto';
import { saveBillingMapping } from './billing_service.js';
import { createSellerAuth } from './seller_auth.js';
import { subscriptionFields, subscriptionFromForm, renderSubscription } from './subscription_web.js';
import { loadSubscription, applySubscriptionChange, setAdministrativeStatus } from './subscription_service.js';
import http from 'node:http';
import { ApiError } from './api_error.js';
import { provisionCustomer, validateCustomerProvisioningRequest } from './customer_provisioning.js';
import {
  listCustomers,
  loadCustomerForEdit,
  updateCustomer,
  validateCustomerUpdateRequest
} from './customer_management.js';
import {
  cloneNeutralCustomerConfig,
  CUSTOMER_COLOR_TOKENS,
  CUSTOMER_FEATURES,
  CUSTOMER_ROLES
} from '../utils/customer_config.js';
import { PLATFORM_CATALOG } from '../utils/platform_catalog.js';

const MAX_BODY_BYTES = 64 * 1024;
const REVIEW_TTL_MS = 10 * 60 * 1000;

const STYLE = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #f8fafc; color: #111827; }
header { background: #1f2937; color: white; padding: 24px max(24px, calc((100vw - 1440px) / 2)); }
header h1 { margin: 0 0 6px; font-size: 26px; }
header p { margin: 0; color: #cbd5e1; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.header-nav { display: flex; flex-wrap: wrap; gap: 8px; }
.header-nav a { padding: 8px 11px; border: 1px solid #64748b; border-radius: 8px; color: white; font-size: 13px; font-weight: 750; text-decoration: none; }
.header-nav a:hover, .header-nav a:focus { background: #334155; }
main { max-width: 1440px; margin: 0 auto; padding: 24px; }
.notice, .errors, .success { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; background: white; }
.notice { border-left: 5px solid #2563eb; }
.errors { border-left: 5px solid #b91c1c; color: #7f1d1d; }
.success { border-left: 5px solid #166534; }
.errors ul { margin: 8px 0 0; }
fieldset { border: 1px solid #cbd5e1; border-radius: 14px; margin: 0 0 18px; padding: 18px; background: white; }
legend { font-weight: 750; padding: 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
.wide { grid-column: 1 / -1; }
label { display: grid; gap: 6px; font-size: 13px; font-weight: 650; color: #334155; }
input, textarea { width: 100%; border: 1px solid #94a3b8; border-radius: 8px; padding: 10px 11px; font: inherit; color: #111827; background: white; }
input[readonly] { color: #475569; background: #e2e8f0; cursor: not-allowed; }
.section-help { margin: -4px 0 14px; color: #475569; font-size: 13px; line-height: 1.45; }
.color-field { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #f8fafc; }
.color-controls { display: flex; gap: 8px; align-items: center; }
.color-controls input[type="text"] { min-width: 0; }
.color-controls input[type="color"] { width: 48px; height: 42px; padding: 3px; flex-shrink: 0; cursor: pointer; }
.image-config { display: grid; gap: 6px; }
.image-link-row { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 12px; align-items: stretch; }
.image-link-field { display: grid; align-content: start; gap: 6px; }
.image-thumbnail-button { display: grid; gap: 6px; min-height: 108px; padding: 8px; border: 1px solid #94a3b8; border-radius: 10px; background: #f8fafc; color: #334155; cursor: pointer; }
.image-thumbnail-button:disabled { cursor: not-allowed; opacity: 0.72; }
.image-thumbnail-frame { position: relative; display: grid; place-items: center; min-height: 70px; overflow: hidden; border: 1px dashed #cbd5e1; border-radius: 7px; background: white; }
.image-thumbnail-frame img { width: 100%; height: 70px; object-fit: contain; }
.image-thumbnail-placeholder { padding: 8px; color: #64748b; font-size: 11px; text-align: center; }
.image-thumbnail-label { font-size: 11px; font-weight: 750; }
.image-preview-status[data-state="ready"] { color: #166534; }
.image-preview-status[data-state="error"] { color: #b91c1c; }
.image-preview-modal { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; background: rgba(15, 23, 42, 0.82); }
.image-preview-modal[hidden], [data-preview-context][hidden] { display: none; }
.image-preview-dialog { width: min(720px, 100%); max-height: calc(100vh - 48px); overflow: auto; border-radius: 16px; background: white; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35); }
.image-preview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #e2e8f0; }
.image-preview-heading h2 { margin: 0 0 4px; font-size: 20px; }
.image-preview-heading p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.4; }
.image-preview-close { flex: 0 0 auto; width: 34px; height: 34px; padding: 0; border-radius: 999px; background: #e2e8f0; color: #334155; font-size: 20px; line-height: 1; }
.image-preview-canvas { padding: 22px; background: #e2e8f0; }
.mock-sidepanel { width: min(360px, 100%); margin: auto; padding: 12px; border: 1px solid var(--preview-border, #e5e7eb); background: var(--preview-background, #f8fafc); color: var(--preview-text, #111827); }
.mock-brand-row { display: flex; align-items: flex-start; gap: 9px; }
.mock-logo { width: 32px; height: 32px; flex: 0 0 auto; border-radius: 8px; object-fit: cover; }
.mock-brand-copy { min-width: 0; flex: 1 1 auto; }
.mock-brand-title { font-size: 16px; font-weight: 800; line-height: 1.15; overflow-wrap: anywhere; }
.mock-brand-tagline { margin-top: 2px; color: var(--preview-muted, #64748b); font-size: 11px; line-height: 1.3; }
.mock-gear { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--preview-border, #e5e7eb); border-radius: 8px; background: var(--preview-surface, white); }
.mock-chip { display: inline-block; margin-top: 9px; padding: 5px 8px; border-radius: 999px; background: color-mix(in srgb, var(--preview-success, #166534) 12%, white); color: var(--preview-success, #166534); font-size: 11px; font-weight: 750; }
.mock-settings { padding: 18px; border: 1px solid var(--preview-border, #e5e7eb); border-radius: 12px; background: var(--preview-background, #f8fafc); color: var(--preview-text, #111827); }
.mock-settings-header { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; padding-bottom: 18px; }
.mock-settings-header img { width: 76px; height: 76px; object-fit: contain; }
.mock-eyebrow { color: var(--preview-muted, #64748b); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.mock-settings-title { margin-top: 3px; color: var(--preview-primary, #334155); font-size: 26px; font-weight: 850; }
.mock-assistant-strip { display: flex; align-items: center; gap: 9px; padding: 9px 34px 9px 9px; border: 1px solid var(--preview-border, #e5e7eb); border-radius: 8px; background: var(--preview-surface, white); }
.mock-assistant-strip img { width: 34px; height: 34px; flex: 0 0 auto; object-fit: contain; }
.mock-assistant-name { color: var(--preview-primary, #334155); font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.mock-assistant-copy { color: var(--preview-muted, #64748b); font-size: 12px; }
.mock-easter-stage { position: relative; display: grid; min-height: 390px; place-items: center; padding: 24px; overflow: hidden; border-radius: 10px; background: rgba(0, 0, 0, 0.9); }
.mock-easter-stage img { max-width: 92%; max-height: 320px; border: 4px solid var(--preview-primary, #334155); border-radius: 8px; object-fit: contain; }
.mock-easter-label { position: absolute; bottom: 12px; color: white; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
textarea { min-height: 86px; resize: vertical; }
input:focus, textarea:focus { outline: 3px solid #bfdbfe; border-color: #2563eb; }
.checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.check { display: flex; gap: 8px; align-items: flex-start; font-weight: 500; }
.check input { width: auto; }
.check-copy { display: grid; gap: 2px; }
.check-name { font-weight: 650; }
.help { display: block; color: #64748b; font-size: 12px; font-weight: 400; }
.actions { display: flex; gap: 12px; align-items: center; margin: 20px 0 40px; }
button, .button { appearance: none; border: 0; border-radius: 9px; padding: 11px 18px; background: #2563eb; color: white; font: inherit; font-weight: 750; cursor: pointer; text-decoration: none; }
.secondary { background: #475569; }
.danger { background: #b91c1c; }
dl { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 10px 18px; background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; }
dt { font-weight: 750; color: #475569; }
dd { margin: 0; overflow-wrap: anywhere; }
code { background: #e2e8f0; border-radius: 5px; padding: 2px 5px; }
.directory-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
.directory-heading h2 { margin: 0 0 5px; }
.directory-heading p { margin: 0; color: #64748b; }
.customer-search { display: flex; align-items: end; gap: 10px; margin-bottom: 18px; }
.customer-search label { flex: 1; max-width: 640px; }
.customer-search .button { margin: 0; }
.subscription-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.subscription-heading h2 { margin: 0; }
.customer-grid { display: grid; gap: 14px; }
.customer-card { display: grid; grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(110px, 0.55fr)) auto; gap: 16px; align-items: center; padding: 17px; border: 1px solid #cbd5e1; border-radius: 12px; background: white; }
.customer-name { min-width: 0; }
.customer-name strong { display: block; overflow-wrap: anywhere; font-size: 17px; }
.customer-name code { display: inline-block; margin-top: 5px; }
.customer-stat { color: #475569; font-size: 12px; }
.customer-stat strong { display: block; margin-top: 3px; color: #111827; font-size: 14px; }
.status-badge { display: inline-block; margin-top: 7px; padding: 3px 7px; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 800; }
.status-badge.inactive, .status-badge.invalid { background: #fee2e2; color: #991b1b; }
.customer-card .actions { margin: 0; }
.empty-state { padding: 36px; border: 1px dashed #94a3b8; border-radius: 12px; background: white; color: #475569; text-align: center; }
.customer-config-layout { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 24px; align-items: start; }
.customer-config-form { min-width: 0; }
.live-preview-shell { position: sticky; top: 20px; min-width: 0; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 16px; background: white; box-shadow: 0 14px 35px rgba(15, 23, 42, 0.11); }
.live-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.live-preview-toolbar strong { display: block; font-size: 14px; }
.live-preview-toolbar span { color: #64748b; font-size: 11px; }
.live-preview-canvas { padding: 16px; background: #e2e8f0; }
.live-preview-device { min-height: 520px; overflow: hidden; border: 1px solid var(--live-border, #e5e7eb); border-radius: 13px; background: var(--live-background, #f8fafc); color: var(--live-text, #111827); box-shadow: 0 12px 26px rgba(15, 23, 42, 0.16); }
.live-preview-view[hidden] { display: none; }
.live-sidepanel-top { padding: 12px; border-bottom: 1px solid var(--live-border, #e5e7eb); background: var(--live-surface, #fff); }
.live-brand-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) 34px; gap: 9px; align-items: start; }
.live-image-frame { position: relative; display: grid; place-items: center; overflow: hidden; background: color-mix(in srgb, var(--live-primary, #334155) 12%, var(--live-surface, #fff)); color: var(--live-primary, #334155); font-weight: 900; }
.live-logo-frame { width: 38px; height: 38px; border-radius: 10px; }
.live-image-frame img { width: 100%; height: 100%; object-fit: contain; }
.live-logo-frame img { object-fit: cover; }
.live-image-frame img[hidden] { display: none; }
.live-image-fallback[hidden] { display: none; }
.live-brand-title { overflow-wrap: anywhere; font-size: 16px; font-weight: 850; line-height: 1.15; }
.live-brand-tagline { margin-top: 3px; color: var(--live-muted, #64748b); font-size: 10px; line-height: 1.35; }
.live-gear { display: grid; width: 34px; height: 34px; place-items: center; padding: 0; border: 1px solid var(--live-border, #e5e7eb); border-radius: 8px; background: var(--live-surface, #fff); color: var(--live-text, #111827); font-size: 17px; }
.live-status-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.live-status-chip { padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--live-success, #166534) 24%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--live-success, #166534) 10%, var(--live-surface, #fff)); color: var(--live-success, #166534); font-size: 10px; font-weight: 800; }
.live-status-chip.accent { border-color: color-mix(in srgb, var(--live-accent, #2563eb) 28%, transparent); background: color-mix(in srgb, var(--live-accent, #2563eb) 9%, var(--live-surface, #fff)); color: var(--live-accent, #2563eb); }
.live-sidepanel-body { display: grid; gap: 10px; padding: 12px; }
.live-assistant { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 9px; align-items: center; padding: 9px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 9px; background: var(--live-surface, #fff); }
.live-assistant .live-image-frame { width: 34px; height: 34px; border-radius: 8px; }
.live-assistant-name { color: var(--live-primary, #334155); font-size: 10px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
.live-assistant-copy { margin-top: 2px; color: var(--live-muted, #64748b); font-size: 10px; line-height: 1.3; }
.live-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 4px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 9px; background: var(--live-surface, #fff); }
.live-tab { padding: 6px 4px; border-radius: 6px; color: var(--live-muted, #64748b); font-size: 10px; font-weight: 800; text-align: center; }
.live-tab.active { background: var(--live-primary, #334155); color: var(--live-on-primary, #fff); }
.live-card { padding: 12px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 10px; background: var(--live-surface, #fff); }
.live-card-title { font-size: 12px; font-weight: 850; }
.live-card-copy { margin-top: 3px; color: var(--live-muted, #64748b); font-size: 10px; line-height: 1.4; }
.live-mock-field { margin-top: 9px; padding: 8px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 7px; background: var(--live-background, #f8fafc); color: var(--live-muted, #64748b); font-size: 10px; }
.live-primary-button { width: 100%; margin-top: 10px; padding: 9px; border-radius: 8px; background: var(--live-primary, #334155); color: var(--live-on-primary, #fff); font-size: 11px; }
.live-settings-view { min-height: 520px; padding: 14px; background: var(--live-background, #f8fafc); }
.live-settings-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.live-back-button { padding: 6px 9px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 7px; background: var(--live-surface, #fff); color: var(--live-text, #111827); font-size: 10px; }
.live-settings-nav span { color: var(--live-muted, #64748b); font-size: 10px; font-weight: 800; }
.live-settings-header { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 12px; }
.live-settings-header .live-image-frame { width: 58px; height: 58px; border-radius: 12px; }
.live-settings-eyebrow { color: var(--live-muted, #64748b); font-size: 9px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
.live-settings-title { margin-top: 2px; color: var(--live-primary, #334155); font-size: 20px; font-weight: 900; line-height: 1.1; }
.live-settings-grid { display: grid; gap: 9px; }
.live-settings-panel { padding: 11px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 9px; background: var(--live-surface, #fff); }
.live-settings-panel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.live-settings-panel strong { font-size: 11px; }
.live-settings-panel p { margin: 3px 0 0; color: var(--live-muted, #64748b); font-size: 9px; line-height: 1.35; }
.live-complete { color: var(--live-success, #166534); font-size: 9px; font-weight: 850; }
.live-accent-button { padding: 7px 9px; border-radius: 7px; background: var(--live-accent, #2563eb); color: #fff; font-size: 9px; }
.live-theme-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-top: 9px; }
.live-theme-swatch { height: 20px; border: 1px solid var(--live-border, #e5e7eb); border-radius: 5px; }
.live-easter-thumb { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 9px; align-items: center; margin-top: 9px; }
.live-easter-thumb .live-image-frame { width: 42px; height: 42px; border-radius: 7px; }
.live-preview-help { margin: 0; padding: 11px 16px 14px; color: #64748b; font-size: 11px; line-height: 1.4; }
@media (max-width: 1120px) {
  .customer-config-layout { grid-template-columns: 1fr; }
  .live-preview-shell { position: static; order: -1; }
  .live-preview-device { width: min(380px, 100%); margin: auto; }
}
@media (max-width: 620px) {
  dl { grid-template-columns: 1fr; }
  dd { margin-bottom: 8px; }
  .image-link-row { grid-template-columns: 1fr; }
  .image-thumbnail-button { min-height: 96px; }
  .mock-settings-header { grid-template-columns: 1fr; }
  .header-row, .directory-heading { display: grid; }
  .customer-search, .subscription-heading { flex-wrap: wrap; }
  .customer-card { grid-template-columns: 1fr 1fr; }
  .customer-name, .customer-card .actions { grid-column: 1 / -1; }
}
`;

const COLOR_SCRIPT = `
for (const controls of document.querySelectorAll('.color-controls')) {
  const text = controls.querySelector('input[type="text"]');
  const picker = controls.querySelector('input[type="color"]');
  text.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
  });
  picker.addEventListener('input', () => { text.value = picker.value; });
}
`;

const IMAGE_PREVIEW_SCRIPT = `
(() => {
  const modal = document.getElementById('image-preview-modal');
  const modalTitle = document.getElementById('image-preview-title');
  const modalDescription = document.getElementById('image-preview-description');
  const closeButton = document.getElementById('image-preview-close');
  if (!modal || !modalTitle || !modalDescription || !closeButton) return;
  let returnFocus = null;

  const contextDetails = {
    logo: {
      title: 'Logo placement preview',
      description: 'Side panel header at 32 × 32 pixels. The image is cropped to a rounded square, so keep important artwork centered.'
    },
    assistant: {
      title: 'Assistant placement preview',
      description: 'Settings header at 76 × 76 pixels and Side panel assistant strip at 34 × 34 pixels. The complete image is contained without cropping.'
    },
    easterEgg: {
      title: 'Easter egg placement preview',
      description: 'Settings overlay after five heading clicks. The image scales to fit the available window without cropping.'
    }
  };

  const valueOf = (name, fallback = '') => document.querySelector('[name="' + name + '"]')?.value.trim() || fallback;
  const safeHttpsUrl = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
    } catch {
      return '';
    }
  };

  const applyPreviewTheme = () => {
    const tokens = {
      primary: '#334155', background: '#F8FAFC', surface: '#FFFFFF', text: '#111827',
      muted: '#64748B', border: '#E5E7EB', success: '#166534'
    };
    for (const [token, fallback] of Object.entries(tokens)) {
      const candidate = valueOf('theme.' + token, fallback);
      modal.style.setProperty('--preview-' + token, /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback);
    }
  };

  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = '';
    returnFocus?.focus();
    returnFocus = null;
  };

  const openModal = (kind, imageUrl, trigger) => {
    const details = contextDetails[kind];
    if (!details || !imageUrl) return;
    applyPreviewTheme();
    modalTitle.textContent = details.title;
    modalDescription.textContent = details.description;
    for (const context of modal.querySelectorAll('[data-preview-context]')) {
      const active = context.dataset.previewContext === kind;
      context.hidden = !active;
      if (!active) continue;
      for (const image of context.querySelectorAll('[data-context-image]')) image.src = imageUrl;
    }
    for (const element of modal.querySelectorAll('[data-context-display-name]')) {
      element.textContent = valueOf('product.displayName', 'Rights Reporter');
    }
    for (const element of modal.querySelectorAll('[data-context-product-name]')) {
      element.textContent = valueOf('product.productName', 'Rights Reporter');
    }
    for (const element of modal.querySelectorAll('[data-context-tagline]')) {
      element.textContent = valueOf('product.tagline', 'Capture evidence, manage reports, and track outcomes.');
    }
    for (const element of modal.querySelectorAll('[data-context-assistant-name]')) {
      element.textContent = valueOf('product.assistantName', 'Reporting Assistant');
    }
    returnFocus = trigger;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    closeButton.focus();
  };

  for (const group of document.querySelectorAll('[data-image-preview]')) {
    const kind = group.dataset.imagePreview;
    const input = group.querySelector('[data-image-url]');
    const thumbnail = group.querySelector('[data-image-thumbnail]');
    const placeholder = group.querySelector('[data-image-placeholder]');
    const openButton = group.querySelector('[data-image-preview-open]');
    const status = group.querySelector('[data-image-status]');
    if (!input || !thumbnail || !placeholder || !openButton || !status) continue;
    let requestNumber = 0;

    const reset = (message, state = '') => {
      requestNumber += 1;
      thumbnail.hidden = true;
      thumbnail.removeAttribute('src');
      placeholder.hidden = false;
      placeholder.textContent = message;
      openButton.disabled = true;
      openButton.dataset.previewUrl = '';
      status.textContent = state === 'error' ? message : 'Paste an HTTPS image URL to create a thumbnail.';
      status.dataset.state = state;
    };

    const refresh = () => {
      const raw = input.value.trim();
      if (!raw) {
        reset('No image');
        return;
      }
      const imageUrl = safeHttpsUrl(raw);
      if (!imageUrl) {
        reset('HTTPS URL required', 'error');
        status.textContent = 'Preview requires a credential-free HTTPS image URL.';
        return;
      }
      const currentRequest = ++requestNumber;
      placeholder.hidden = false;
      placeholder.textContent = 'Loading…';
      thumbnail.hidden = true;
      openButton.disabled = true;
      status.textContent = 'Loading thumbnail…';
      status.dataset.state = '';
      thumbnail.onload = () => {
        if (currentRequest !== requestNumber) return;
        thumbnail.hidden = false;
        placeholder.hidden = true;
        openButton.disabled = false;
        openButton.dataset.previewUrl = imageUrl;
        status.textContent = 'Thumbnail ready. Select it to preview the image in the extension.';
        status.dataset.state = 'ready';
      };
      thumbnail.onerror = () => {
        if (currentRequest !== requestNumber) return;
        reset('Image unavailable', 'error');
        status.textContent = 'The image could not be loaded. Confirm that the HTTPS URL is public and points directly to an image.';
      };
      thumbnail.referrerPolicy = 'no-referrer';
      thumbnail.src = imageUrl;
    };

    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    openButton.addEventListener('click', () => openModal(kind, openButton.dataset.previewUrl, openButton));
    refresh();
  }

  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });
})();
`;

const CUSTOMER_CONFIG_PREVIEW_SCRIPT = `
(() => {
  const root = document.getElementById('customer-live-preview');
  const form = document.querySelector('[data-customer-config-form]');
  if (!root || !form) return;

  const colorDefaults = {
    primary: '#334155', primaryHover: '#1E293B', accent: '#2563EB', onPrimary: '#FFFFFF',
    background: '#F8FAFC', surface: '#FFFFFF', text: '#111827', muted: '#64748B',
    border: '#E5E7EB', success: '#166534', warning: '#B45309', danger: '#B91C1C'
  };

  const valueOf = (name, fallback = '') => form.querySelector('[name="' + name + '"]')?.value.trim() || fallback;
  const safeHttpsUrl = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
    } catch {
      return '';
    }
  };
  const initials = (value, fallback) => {
    const words = String(value || '').trim().split(/\\s+/).filter(Boolean);
    const result = words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
    return result || fallback;
  };
  const setText = (key, value) => {
    for (const element of root.querySelectorAll('[data-live-text="' + key + '"]')) element.textContent = value;
  };
  const setImage = (kind, rawUrl, fallbackText, altText) => {
    const imageUrl = safeHttpsUrl(rawUrl);
    for (const frame of root.querySelectorAll('[data-live-image-frame="' + kind + '"]')) {
      const image = frame.querySelector('[data-live-image]');
      const fallback = frame.querySelector('[data-live-image-fallback]');
      if (!image || !fallback) continue;
      fallback.textContent = fallbackText;
      if (!imageUrl) {
        image.hidden = true;
        image.removeAttribute('src');
        image.dataset.previewSource = '';
        fallback.hidden = false;
        continue;
      }
      image.alt = altText;
      image.referrerPolicy = 'no-referrer';
      image.onload = () => {
        if (image.dataset.previewSource !== imageUrl) return;
        image.hidden = false;
        fallback.hidden = true;
      };
      image.onerror = () => {
        if (image.dataset.previewSource !== imageUrl) return;
        image.hidden = true;
        fallback.hidden = false;
      };
      if (image.dataset.previewSource !== imageUrl) {
        image.dataset.previewSource = imageUrl;
        image.hidden = true;
        fallback.hidden = false;
        image.src = imageUrl;
      }
    }
  };

  const syncPreview = () => {
    for (const [token, fallback] of Object.entries(colorDefaults)) {
      const candidate = valueOf('theme.' + token, fallback);
      const color = /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
      root.style.setProperty('--live-' + token.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), color);
      for (const swatch of root.querySelectorAll('[data-live-swatch="' + token + '"]')) swatch.style.background = color;
    }

    const productName = valueOf('product.productName', 'Rights Reporter');
    const displayName = valueOf('product.displayName', 'Rights Reporter');
    const shortName = valueOf('product.shortName', displayName);
    const assistantName = valueOf('product.assistantName', 'Assistant');
    const tagline = valueOf('product.tagline', 'Capture evidence, manage reports, and track outcomes.');
    const logoAlt = valueOf('theme.logoAltText', displayName + ' logo');

    setText('productName', productName);
    setText('displayName', displayName);
    setText('shortName', shortName);
    setText('assistantName', assistantName);
    setText('tagline', tagline);

    setImage('logo', valueOf('theme.logoUrl'), initials(displayName, 'RR'), logoAlt);
    setImage('assistant', valueOf('theme.assistantImageUrl'), 'A', assistantName);
    setImage('easterEgg', valueOf('theme.easterEggImageUrl'), '5×', 'Easter egg preview');
  };

  const sidePanelView = root.querySelector('[data-live-preview-view="sidepanel"]');
  const settingsView = root.querySelector('[data-live-preview-view="settings"]');
  const viewName = root.querySelector('[data-live-preview-view-name]');
  const showView = (name) => {
    const showSettings = name === 'settings';
    sidePanelView.hidden = showSettings;
    settingsView.hidden = !showSettings;
    if (viewName) viewName.textContent = showSettings ? 'Mock Settings' : 'Mock Side Panel';
  };

  root.querySelector('[data-open-live-settings]')?.addEventListener('click', () => showView('settings'));
  root.querySelector('[data-close-live-settings]')?.addEventListener('click', () => showView('sidepanel'));
  form.addEventListener('input', syncPreview);
  form.addEventListener('change', syncPreview);
  syncPreview();
  showView('sidepanel');
})();
`;

const COLOR_GUIDANCE = Object.freeze({
  primary: Object.freeze({
    label: 'Primary brand',
    help: 'Appears in: primary buttons, active tabs, headings, focus rings, PDF accents, and reporting overlays.'
  }),
  primaryHover: Object.freeze({
    label: 'Primary hover',
    help: 'Appears in: primary buttons when the pointer is over them, including Settings save actions and side-panel controls.'
  }),
  accent: Object.freeze({
    label: 'Accent',
    help: 'Appears in: secondary action buttons, informational links, selected fields, and Settings feedback controls.'
  }),
  onPrimary: Object.freeze({
    label: 'Text on primary',
    help: 'Appears in: text and icons placed on top of the primary brand color. Choose a high-contrast light or dark color.'
  }),
  background: Object.freeze({
    label: 'Page background',
    help: 'Appears in: the main canvas behind cards in the side panel, Settings page, popup, and generated report surfaces.'
  }),
  surface: Object.freeze({
    label: 'Card surface',
    help: 'Appears in: cards, panels, form controls, information bars, and modal content throughout the extension.'
  }),
  text: Object.freeze({
    label: 'Primary text',
    help: 'Appears in: main headings, field values, report content, and normal body copy.'
  }),
  muted: Object.freeze({
    label: 'Muted text',
    help: 'Appears in: taglines, field descriptions, helper text, metric labels, and secondary information.'
  }),
  border: Object.freeze({
    label: 'Borders and dividers',
    help: 'Appears in: card outlines, input borders, separators, tabs, and information panels.'
  }),
  success: Object.freeze({
    label: 'Success status',
    help: 'Appears in: Ready/complete states, successful actions, enabled switches, and positive progress indicators.'
  }),
  warning: Object.freeze({
    label: 'Warning status',
    help: 'Appears in: caution messages, warning buttons, intelligence notices, and highlighted progress states.'
  }),
  danger: Object.freeze({
    label: 'Danger status',
    help: 'Appears in: errors, destructive actions, urgent report controls, and failed validation states.'
  })
});

const ROLE_GUIDANCE = Object.freeze({
  employee: 'Used for daily reporting and Scoreboard access, plus basic Settings connectivity and feedback.',
  manager: 'Adds Side panel Automate and Intelligence plus Settings briefing and shared content tools.',
  admin: 'Adds Repair, selector editing, customer access management, and all manager permissions.'
});

const FEATURE_GUIDANCE = Object.freeze({
  report: Object.freeze({ label: 'Report', help: 'Shows the Side panel Report tab and report submission workflow.' }),
  scoreboard: Object.freeze({ label: 'Scoreboard', help: 'Shows the Side panel Scoreboard tab and customer-scoped performance statistics.' }),
  automate: Object.freeze({ label: 'Automate', help: 'Shows the Side panel Automate tab for scanner and bulk-processing workflows.' }),
  intel: Object.freeze({ label: 'Intelligence', help: 'Shows the Side panel Intelligence tab and intelligence results.' }),
  repair: Object.freeze({ label: 'Repair', help: 'Shows the Side panel Repair tab for selector and platform-recovery tools.' }),
  feedback: Object.freeze({ label: 'Feedback', help: 'Shows Feedback Comms on the Settings page.' }),
  gamification: Object.freeze({ label: 'Gamification', help: 'Shows Squad Snapshot, levels, goals, and progress in the Side panel.' }),
  briefing: Object.freeze({ label: 'Intelligence briefing', help: 'Enables Settings page briefing controls and Intelligence Briefing PDF content.' }),
  selector_editor: Object.freeze({ label: 'Selector editor', help: 'Shows Edit Selector Paths on the Settings page for authorized administrators.' })
});

function colorInput(token, value) {
  const id = 'color-' + token;
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  const guidance = COLOR_GUIDANCE[token] || { label: token, help: 'Applies to themed extension surfaces.' };
  return `<div class="color-field"><label for="${escapeHtml(id)}">${escapeHtml(guidance.label)}</label>
    <div class="color-controls">
      <input id="${escapeHtml(id)}" name="theme.${escapeHtml(token)}" type="text" value="${escapeHtml(value)}" pattern="#[0-9A-Fa-f]{6}" required>
      <input type="color" value="${escapeHtml(color)}" aria-label="Choose ${escapeHtml(guidance.label)} color" title="Choose ${escapeHtml(guidance.label)} color">
    </div><span class="help">${escapeHtml(guidance.help)} Enter a hex code or click the color box.</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Rights Reporter Customer Setup</title>
  <link rel="stylesheet" href="/style.css">
  ${['Seller sign in', 'Replace password', 'Sign out', 'Setup error'].includes(title) ? '' : '<script src="/colors.js" defer></script><script src="/preview.js" defer></script><script src="/customer-preview.js" defer></script>'}
</head>
<body>
  <header><div class="header-row"><div><h1>Rights Reporter Customer Setup</h1><p>Local operator tool · credentials stay on this computer</p></div>
    <nav class="header-nav" aria-label="Customer setup"><a href="/customers">View customers</a><a href="/">Create customer</a><a href="/password">Password</a><a href="/logout">Sign out</a></nav>
  </div></header>
  <main>${content}</main>
</body>
</html>`;
}

function input(name, label, value, {
  type = 'text', required = true, help = '', min = '', max = '', pattern = '', wide = false, readonly = false
} = {}) {
  return `<label class="${wide ? 'wide' : ''}">${escapeHtml(label)}
    <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"
      ${required ? 'required' : ''} ${min !== '' ? `min="${escapeHtml(min)}"` : ''}
      ${max !== '' ? `max="${escapeHtml(max)}"` : ''} ${pattern ? `pattern="${escapeHtml(pattern)}"` : ''} ${readonly ? 'readonly' : ''}>
    ${help ? `<span class="help">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

function imageUrlInput(name, label, value, { kind, help }) {
  const id = `image-${kind}-url`;
  const statusId = `${id}-status`;
  return `<div class="image-config wide" data-image-preview="${escapeHtml(kind)}">
    <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
    <div class="image-link-row">
      <div class="image-link-field">
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="url" value="${escapeHtml(value)}"
          inputmode="url" aria-describedby="${escapeHtml(statusId)}" data-image-url>
        <span class="help">${escapeHtml(help)}</span>
        <span id="${escapeHtml(statusId)}" class="help image-preview-status" data-image-status aria-live="polite">Paste an HTTPS image URL to create a thumbnail.</span>
      </div>
      <button type="button" class="image-thumbnail-button" data-image-preview-open
        aria-label="Preview ${escapeHtml(label)} placement" disabled>
        <span class="image-thumbnail-frame">
          <img data-image-thumbnail alt="" hidden>
          <span class="image-thumbnail-placeholder" data-image-placeholder>No image</span>
        </span>
        <span class="image-thumbnail-label">Preview placement</span>
      </button>
    </div>
  </div>`;
}

function textarea(name, label, value, help = '') {
  return `<label class="wide">${escapeHtml(label)}
    <textarea name="${escapeHtml(name)}" required>${escapeHtml(value)}</textarea>
    ${help ? `<span class="help">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

function checkboxGroup(name, values, selected, labelFor, descriptionFor = () => '') {
  const chosen = new Set(selected);
  return `<div class="checks">${values.map((value) => {
    const label = labelFor(value);
    const description = descriptionFor(value);
    return `<label class="check">
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${chosen.has(value) ? 'checked' : ''}>
      <span class="check-copy"><span class="check-name">${escapeHtml(label)}</span>${description ? `<span class="help">${escapeHtml(description)}</span>` : ''}</span>
    </label>`;
  }).join('')}</div>`;
}

function newDraft(operatorEmail = '') {
  const config = cloneNeutralCustomerConfig();
  config.customerId = '';
  config.access = {
    allowedEmailDomains: [],
    totalUserCap: 50,
    enabledRoles: [...CUSTOMER_ROLES],
    roleSeatCaps: { employee: 43, manager: 5, admin: 2 }
  };
  config.capabilities = {
    enabledPlatforms: ['youtube', 'tiktok', 'twitter', 'instagram', 'facebook', 'kick', 'twitch', 'rumble'],
    enabledFeatures: [...CUSTOMER_FEATURES]
  };
  return {
    config,
    initialAdministrator: { name: '', email: '' },
    operator: { email: operatorEmail }
  };
}

function fieldValue(parameters, name) {
  return String(parameters.get(name) || '').trim();
}

function numberValue(parameters, name) {
  const raw = fieldValue(parameters, name);
  return raw === '' ? Number.NaN : Number(raw);
}

function splitList(value) {
  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function customerConfigFromForm(parameters) {
  const colors = Object.fromEntries(CUSTOMER_COLOR_TOKENS.map((token) => [
    token,
    fieldValue(parameters, `theme.${token}`)
  ]));
  return {
    schemaVersion: 1,
    customerId: fieldValue(parameters, 'customerId'),
    configVersion: numberValue(parameters, 'configVersion'),
    product: {
      productName: fieldValue(parameters, 'product.productName'),
      displayName: fieldValue(parameters, 'product.displayName'),
      shortName: fieldValue(parameters, 'product.shortName'),
      assistantName: fieldValue(parameters, 'product.assistantName'),
      tagline: fieldValue(parameters, 'product.tagline')
    },
    theme: {
      logoUrl: fieldValue(parameters, 'theme.logoUrl'),
      logoAltText: fieldValue(parameters, 'theme.logoAltText'),
      assistantImageUrl: fieldValue(parameters, 'theme.assistantImageUrl'),
      easterEggImageUrl: fieldValue(parameters, 'theme.easterEggImageUrl'),
      colors
    },
    legal: {
      ownerName: fieldValue(parameters, 'legal.ownerName'),
      companyName: fieldValue(parameters, 'legal.companyName'),
      reportingEmail: fieldValue(parameters, 'legal.reportingEmail'),
      secondaryEmail: fieldValue(parameters, 'legal.secondaryEmail'),
      phone: fieldValue(parameters, 'legal.phone'),
      addressLine1: fieldValue(parameters, 'legal.addressLine1'),
      city: fieldValue(parameters, 'legal.city'),
      region: fieldValue(parameters, 'legal.region'),
      postalCode: fieldValue(parameters, 'legal.postalCode'),
      country: fieldValue(parameters, 'legal.country'),
      originalWorkUrl: fieldValue(parameters, 'legal.originalWorkUrl')
    },
    access: {
      allowedEmailDomains: splitList(fieldValue(parameters, 'access.allowedEmailDomains')),
      totalUserCap: numberValue(parameters, 'access.totalUserCap'),
      enabledRoles: parameters.getAll('access.enabledRoles').map(String),
      roleSeatCaps: {
        employee: numberValue(parameters, 'access.employeeCap'),
        manager: numberValue(parameters, 'access.managerCap'),
        admin: numberValue(parameters, 'access.adminCap')
      }
    },
    capabilities: {
      enabledPlatforms: parameters.getAll('capabilities.enabledPlatforms').map(String),
      enabledFeatures: parameters.getAll('capabilities.enabledFeatures').map(String)
    },
    destinations: {
      driveRootFolderId: fieldValue(parameters, 'destinations.driveRootFolderId'),
      reportSpreadsheetId: fieldValue(parameters, 'destinations.reportSpreadsheetId'),
      eventSpreadsheetId: fieldValue(parameters, 'destinations.eventSpreadsheetId')
    },
    stats: { dashboardId: fieldValue(parameters, 'stats.dashboardId') }
  };
}

export function customerSetupRequestFromForm(parameters) {
  return {
    config: customerConfigFromForm(parameters),
    initialAdministrator: {
      email: fieldValue(parameters, 'initialAdministrator.email'),
      name: fieldValue(parameters, 'initialAdministrator.name')
    },
    operator: { email: fieldValue(parameters, 'operator.email') }
  };
}

export function customerUpdateRequestFromForm(parameters) {
  return {
    config: customerConfigFromForm(parameters),
    operator: { email: fieldValue(parameters, 'operator.email') },
    expectedConfigVersion: numberValue(parameters, 'expectedConfigVersion')
  };
}

function renderErrors(errors) {
  if (!errors?.length) return '';
  return `<section class="errors"><strong>Please correct these fields:</strong><ul>${errors.map((error) => (
    `<li><code>${escapeHtml(error.path)}</code>: ${escapeHtml(error.message)}</li>`
  )).join('')}</ul></section>`;
}

function renderImagePreviewModal() {
  return `<div id="image-preview-modal" class="image-preview-modal" hidden>
    <section class="image-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="image-preview-title" aria-describedby="image-preview-description">
      <div class="image-preview-heading">
        <div>
          <h2 id="image-preview-title">Image placement preview</h2>
          <p id="image-preview-description">See how this image will fit in its extension location.</p>
        </div>
        <button id="image-preview-close" class="image-preview-close" type="button" aria-label="Close image preview">×</button>
      </div>
      <div class="image-preview-canvas">
        <div data-preview-context="logo" hidden>
          <div class="mock-sidepanel">
            <div class="mock-brand-row">
              <img class="mock-logo" data-context-image alt="Logo preview">
              <div class="mock-brand-copy">
                <div class="mock-brand-title" data-context-display-name>Rights Reporter</div>
                <div class="mock-brand-tagline" data-context-tagline>Capture evidence, manage reports, and track outcomes.</div>
              </div>
              <div class="mock-gear" aria-hidden="true">⚙</div>
            </div>
            <span class="mock-chip">Scout Mode</span>
          </div>
        </div>
        <div data-preview-context="assistant" hidden>
          <div class="mock-settings">
            <div class="mock-settings-header">
              <img data-context-image alt="Assistant image preview in the Settings header">
              <div>
                <div class="mock-eyebrow" data-context-product-name>Rights Reporter</div>
                <div class="mock-settings-title">Enforcement Center</div>
              </div>
            </div>
            <div class="mock-assistant-strip">
              <img data-context-image alt="Assistant image preview in the Side panel">
              <div>
                <div class="mock-assistant-name" data-context-assistant-name>Reporting Assistant</div>
                <div class="mock-assistant-copy">Ready to help with reporting.</div>
              </div>
            </div>
          </div>
        </div>
        <div data-preview-context="easterEgg" hidden>
          <div class="mock-easter-stage">
            <img data-context-image alt="Easter egg overlay preview">
            <div class="mock-easter-label">Click anywhere to close</div>
          </div>
        </div>
      </div>
    </section>
  </div>`;
}

function renderCustomerLivePreview() {
  const imageFrame = (kind, fallback, alt, extraClass = '') => `<span class="live-image-frame ${escapeHtml(extraClass)}" data-live-image-frame="${escapeHtml(kind)}">
    <img data-live-image alt="${escapeHtml(alt)}" hidden>
    <span class="live-image-fallback" data-live-image-fallback>${escapeHtml(fallback)}</span>
  </span>`;

  return `<aside id="customer-live-preview" class="live-preview-shell" aria-label="Live customer extension preview">
    <div class="live-preview-toolbar">
      <div><strong>Live extension preview</strong><span>Updates while you edit</span></div>
      <span data-live-preview-view-name>Mock Side Panel</span>
    </div>
    <div class="live-preview-canvas">
      <div class="live-preview-device">
        <section class="live-preview-view" data-live-preview-view="sidepanel" aria-label="Mock Side Panel">
          <div class="live-sidepanel-top">
            <div class="live-brand-row">
              ${imageFrame('logo', 'RR', 'Customer logo preview', 'live-logo-frame')}
              <div>
                <div class="live-brand-title" data-live-text="displayName">Rights Reporter</div>
                <div class="live-brand-tagline" data-live-text="tagline">Capture evidence, manage reports, and track outcomes.</div>
              </div>
              <button class="live-gear" type="button" data-open-live-settings aria-label="Open mock Settings" title="Open mock Settings">⚙</button>
            </div>
            <div class="live-status-row">
              <span class="live-status-chip">Scout Mode</span>
              <span class="live-status-chip accent"><span data-live-text="shortName">Reporter</span> connected</span>
            </div>
          </div>
          <div class="live-sidepanel-body">
            <div class="live-assistant">
              ${imageFrame('assistant', 'A', 'Assistant preview')}
              <div>
                <div class="live-assistant-name" data-live-text="assistantName">Assistant</div>
                <div class="live-assistant-copy">Ready to help with reporting.</div>
              </div>
            </div>
            <div class="live-tabs" aria-hidden="true">
              <div class="live-tab active">Report</div><div class="live-tab">Automate</div><div class="live-tab">Intel</div>
            </div>
            <div class="live-card">
              <div class="live-card-title">Report Setup</div>
              <div class="live-card-copy">Choose a vertical and event, then capture evidence.</div>
              <div class="live-mock-field">Reporter · Customer employee</div>
              <div class="live-mock-field">Event · Sample championship</div>
              <button class="live-primary-button" type="button" tabindex="-1">Save to Log</button>
            </div>
            <div class="live-card">
              <div class="live-card-title">Squad Snapshot</div>
              <div class="live-card-copy">Scout Level 2 · 740 points &nbsp;|&nbsp; Enforcer Level 1</div>
            </div>
          </div>
        </section>

        <section class="live-preview-view live-settings-view" data-live-preview-view="settings" aria-label="Mock Settings page" hidden>
          <div class="live-settings-nav">
            <button class="live-back-button" type="button" data-close-live-settings>← Side Panel</button>
            <span>Mock Settings</span>
          </div>
          <div class="live-settings-header">
            ${imageFrame('assistant', 'A', 'Assistant preview in Settings')}
            <div>
              <div class="live-settings-eyebrow" data-live-text="productName">Rights Reporter</div>
              <div class="live-settings-title">Enforcement Center</div>
            </div>
          </div>
          <div class="live-settings-grid">
            <div class="live-settings-panel">
              <div class="live-settings-panel-row"><strong>Setup Status</strong><span class="live-complete">Complete</span></div>
              <p>Evidence storage, reporting log, and event configuration are connected.</p>
            </div>
            <div class="live-settings-panel">
              <div class="live-settings-panel-row"><strong>Core Connectivity</strong><span class="live-complete">Ready</span></div>
              <div class="live-mock-field">Evidence Storage · Box 1 complete</div>
            </div>
            <div class="live-settings-panel">
              <div class="live-settings-panel-row"><strong>Theme samples</strong><button class="live-accent-button" type="button" tabindex="-1">Accent Action</button></div>
              <p>Primary, accent, status, background, and text colors update here.</p>
              <div class="live-theme-swatches" aria-label="Theme color samples">
                <span class="live-theme-swatch" data-live-swatch="primary"></span>
                <span class="live-theme-swatch" data-live-swatch="accent"></span>
                <span class="live-theme-swatch" data-live-swatch="success"></span>
                <span class="live-theme-swatch" data-live-swatch="warning"></span>
                <span class="live-theme-swatch" data-live-swatch="danger"></span>
                <span class="live-theme-swatch" data-live-swatch="muted"></span>
              </div>
            </div>
            <div class="live-settings-panel">
              <strong>Five-click Easter egg</strong>
              <div class="live-easter-thumb">
                ${imageFrame('easterEgg', '5×', 'Easter egg preview')}
                <p>The selected image appears in the hidden Settings overlay.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
    <p class="live-preview-help">This is a compact placement preview. The installed extension keeps its full controls and responsive behavior.</p>
  </aside>`;
}

function renderForm(csrfToken, draft, errors = [], { mode = 'create', expectedConfigVersion = null } = {}) {
  const c = draft.config;
  const editing = mode === 'edit';
  const customerPath = encodeURIComponent(c.customerId);
  return page(editing ? `Edit ${c.product.displayName}` : 'New customer', `
    <div class="customer-config-layout">
    <div class="customer-config-form">
    <section class="notice"><strong>${editing ? 'Editing an existing customer:' : 'How this connects:'}</strong> ${editing
      ? 'saving validates the fixed configuration, checks it against active memberships, increments the version, and writes an audit record in one transaction. The customer ID cannot be changed.'
      : 'this local page writes one customer, one active administrator, and one audit record to Neon in a single transaction. The extension receives no database credential.'}</section>
    ${renderErrors(errors)}
    <form method="post" action="${editing ? `/customers/${customerPath}/review` : '/review'}" autocomplete="off" data-customer-config-form>
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      ${editing ? `<input type="hidden" name="expectedConfigVersion" value="${escapeHtml(expectedConfigVersion)}">` : ''}
      ${editing ? `<section class="notice">Purchased limits and features are managed on the <a href="/customers/${customerPath}/subscription">Subscription page</a>.</section>` : subscriptionFields(draft.subscription)}
      <fieldset><legend>${editing ? 'Change operator' : 'Operator and initial administrator'}</legend><div class="grid">
        ${input('operator.email', 'Operator email', draft.operator.email, { type: 'email', readonly: true, help: editing ? 'Configuration audit: records who saved this update. It is never sent to the extension.' : 'Audit log: records who performed this customer setup. It is not shown in the extension.' })}
        ${editing ? '' : input('initialAdministrator.name', 'Initial administrator name', draft.initialAdministrator.name, { help: 'Access management: identifies the first administrator created for this customer.' })}
        ${editing ? '' : input('initialAdministrator.email', 'Initial administrator Google email', draft.initialAdministrator.email, { type: 'email', help: 'Google sign-in: this exact account receives the initial administrator role and must match an allowed domain.' })}
      </div></fieldset>

      <fieldset><legend>Customer and product identity</legend><div class="grid">
        ${input('customerId', 'Customer ID', c.customerId, { pattern: '[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?', readonly: editing, help: editing ? 'Permanent database and API routing identifier. It cannot be changed after customer creation.' : 'Server routing and audit records: permanent lowercase identifier, for example acme-sports. Users do not normally see it.' })}
        ${input('configVersion', 'Configuration version', c.configVersion, { type: 'number', min: 1, readonly: editing, help: editing ? `Automatically advances from version ${escapeHtml(expectedConfigVersion)} when this update is saved.` : 'Theme/profile cache: increase this when changing an existing customer configuration so extension clients refresh it.' })}
        ${input('product.productName', 'Product name', c.product.productName, { help: 'Settings page: small product label above the main Settings heading. Also used in report metadata.' })}
        ${input('product.displayName', 'Display name', c.product.displayName, { help: 'Side panel: main header title. Also used in the Settings browser title and PDF/report headings.' })}
        ${input('product.shortName', 'Short name', c.product.shortName, { help: 'Compact profile label: reserved for space-constrained extension surfaces; it is not the main Side panel title.' })}
        ${input('product.assistantName', 'Assistant name', c.product.assistantName, { help: 'Assistant bubbles and reporting overlays: the customer-specific name used for the helper character.' })}
        ${input('product.tagline', 'Tagline', c.product.tagline, { wide: true, help: 'Side panel: descriptive line directly below the display name. It wraps when the panel is narrow.' })}
      </div></fieldset>

      <fieldset><legend>Theme</legend>
        <p class="section-help">These values theme the Side panel, Settings page, popup, reporting overlays, and generated reports. Image fields accept approved HTTPS raster images only; colors use six-digit hex values.</p>
        <div class="grid">
        ${imageUrlInput('theme.logoUrl', 'Approved logo HTTPS URL', c.theme.logoUrl, { kind: 'logo', help: 'Side panel: customer logo beside the display name. Leave blank to use the packaged neutral logo. No data URLs, HTML, JavaScript, CSS, or embedded credentials.' })}
        ${input('theme.logoAltText', 'Logo alternative text', c.theme.logoAltText, { help: 'Accessibility: describes the Side panel logo to screen-reader users and appears if the image cannot load.' })}
        ${imageUrlInput('theme.assistantImageUrl', 'Approved assistant image HTTPS URL', c.theme.assistantImageUrl, { kind: 'assistant', help: 'Side panel assistant strip and Settings page header: replaces the packaged Clippy image with a PNG, JPEG, WebP, or GIF.' })}
        ${imageUrlInput('theme.easterEggImageUrl', 'Approved Easter egg image HTTPS URL', c.theme.easterEggImageUrl, { kind: 'easterEgg', help: 'Settings page: image revealed after five clicks on the main heading. Leave blank for the packaged fallback.' })}
        ${CUSTOMER_COLOR_TOKENS.map((token) => colorInput(token, c.theme.colors[token])).join('')}
      </div></fieldset>

      <fieldset><legend>Legal owner and reporting contact</legend><div class="grid">
        ${input('legal.ownerName', 'Legal owner name', c.legal.ownerName, { help: 'DMCA forms, cease-and-desist PDFs, and Side panel rogue-site notices: names the copyright owner.' })}
        ${input('legal.companyName', 'Company name', c.legal.companyName, { required: false, help: 'PDF signatures and Side panel notice templates: names the company or authorized representative.' })}
        ${input('legal.reportingEmail', 'Reporting email', c.legal.reportingEmail, { type: 'email', help: 'Report setup and platform autofill: primary contact email used in DMCA forms and PDF contact details.' })}
        ${input('legal.secondaryEmail', 'Secondary email', c.legal.secondaryEmail, { type: 'email', required: false, help: 'Platform autofill and PDFs: backup legal/reporting contact when a second address is useful.' })}
        ${input('legal.phone', 'Phone', c.legal.phone, { required: false, help: 'Platform autofill and PDF contact block: rights-owner telephone number.' })}
        ${input('legal.addressLine1', 'Address', c.legal.addressLine1, { required: false, help: 'Platform autofill and PDF signature/contact block: street address for the rights owner.' })}
        ${input('legal.city', 'City', c.legal.city, { required: false, help: 'Platform autofill and PDF contact block: city portion of the legal address.' })}
        ${input('legal.region', 'State / region', c.legal.region, { required: false, help: 'Platform autofill and PDF contact block: state, province, or region.' })}
        ${input('legal.postalCode', 'Postal code', c.legal.postalCode, { required: false, help: 'Platform autofill and PDF contact block: ZIP or postal code.' })}
        ${input('legal.country', 'Country', c.legal.country, { required: false, help: 'Platform autofill and PDF contact block: country for the legal address.' })}
        ${input('legal.originalWorkUrl', 'Original work HTTPS URL', c.legal.originalWorkUrl, { type: 'url', wide: true, help: 'Side panel Report Setup and page scanner: official customer-owned site used as the default original-work source and trusted domain.' })}
      </div></fieldset>

      <fieldset><legend>Access limits</legend><div class="grid">
        ${textarea('access.allowedEmailDomains', 'Allowed email domains', c.access.allowedEmailDomains.join('\n'), 'Google sign-in and customer membership: only accounts from these domains can be activated. Enter one domain per line without @; the initial administrator must match.')}
        ${input('access.totalUserCap', 'Total active-user cap', c.access.totalUserCap, { type: 'number', min: 1, max: 100000, help: 'Settings access management: maximum active users across every role. The API enforces this during approvals and reactivations.' })}
        ${input('access.employeeCap', 'Employee seat cap', c.access.roleSeatCaps.employee, { type: 'number', min: 0, max: 100000, help: 'Settings access management: maximum active users assigned the Employee role.' })}
        ${input('access.managerCap', 'Manager seat cap', c.access.roleSeatCaps.manager, { type: 'number', min: 0, max: 100000, help: 'Settings access management: maximum active users assigned the Manager role.' })}
        ${input('access.adminCap', 'Administrator seat cap', c.access.roleSeatCaps.admin, { type: 'number', min: 1, max: 100000, help: 'Settings access management: maximum active administrators. At least one administrator is always required.' })}
        <div class="wide"><strong>Enabled roles</strong><span class="help">Settings access management: controls which roles administrators may assign. Administrator is mandatory; set a disabled role cap to zero.</span>
          ${checkboxGroup(
            'access.enabledRoles',
            CUSTOMER_ROLES,
            c.access.enabledRoles,
            (value) => value === 'admin' ? 'Administrator' : value.charAt(0).toUpperCase() + value.slice(1),
            (value) => ROLE_GUIDANCE[value] || ''
          )}
        </div>
      </div></fieldset>

      <fieldset><legend>Enabled features</legend>
        <p class="section-help">Checked features are returned in the verified customer profile and control which Side panel tabs and Settings tools are available, subject to the signed-in user’s role.</p>
        ${checkboxGroup(
          'capabilities.enabledFeatures',
          CUSTOMER_FEATURES,
          c.capabilities.enabledFeatures,
          (value) => FEATURE_GUIDANCE[value]?.label || value,
          (value) => FEATURE_GUIDANCE[value]?.help || ''
        )}
      </fieldset>

      <fieldset><legend>Enabled platforms</legend>
        <p class="section-help">Side panel Report, Automate, Repair, and page overlays: only checked platforms are returned to customer users for detection and customer-authorized workflows.</p>
        ${checkboxGroup(
          'capabilities.enabledPlatforms',
          PLATFORM_CATALOG.map((entry) => entry.key),
          c.capabilities.enabledPlatforms,
          (value) => PLATFORM_CATALOG.find((entry) => entry.key === value)?.label || value
        )}
      </fieldset>

      <fieldset><legend>Google destinations and statistics</legend><div class="grid">
        ${input('destinations.driveRootFolderId', 'Drive root folder ID', c.destinations.driveRootFolderId, { help: 'Settings page Box 1 / Open Locker and report storage: destination for PDFs and evidence screenshots. Enter the ID only, not the complete URL.' })}
        ${input('destinations.reportSpreadsheetId', 'Reporting spreadsheet ID', c.destinations.reportSpreadsheetId, { help: 'Settings page Box 2 and Side panel Report Setup: primary customer log for report submissions and enforcement actions. Enter the ID only.' })}
        ${input('destinations.eventSpreadsheetId', 'Event spreadsheet ID', c.destinations.eventSpreadsheetId, { help: 'Settings page Box 3 and Intelligence tools: source for event schedules, whitelists, briefing content, and XP multipliers. Enter the ID only.' })}
        ${input('stats.dashboardId', 'Statistics dashboard ID', c.stats.dashboardId, { pattern: '[A-Za-z0-9_-]{1,128}', help: 'Side panel Scoreboard and Settings Intelligence: selects the customer-scoped statistics dashboard, for example stats_acme_sports.' })}
      </div></fieldset>

      <div class="actions"><button type="submit">${editing ? 'Validate changes' : 'Validate and review'}</button>${editing ? `<a class="button secondary" href="/customers">Cancel</a>` : ''}<span>No database changes happen on this page.</span></div>
    </form>
    </div>
    ${renderCustomerLivePreview()}
    </div>
    ${renderImagePreviewModal()}
  `);
}

function listText(values) {
  return values.length ? values.join(', ') : 'None';
}

function displayTimestamp(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown' : date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function renderCustomerDirectory(customers, search = '') {
  const cards = customers.map((customer) => {
    const customerPath = encodeURIComponent(customer.customerId);
    const statusClass = customer.configurationValid ? (customer.active ? '' : 'inactive') : 'invalid';
    const status = customer.configurationValid ? (customer.active ? 'Active' : 'Inactive') : 'Invalid configuration';
    return `<article class="customer-card">
      <div class="customer-name"><strong>${escapeHtml(customer.displayName)}</strong><code>${escapeHtml(customer.customerId)}</code><br><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></div>
      <div class="customer-stat">Configuration<strong>Version ${escapeHtml(customer.configVersion)}</strong></div>
      <div class="customer-stat">Active users<strong>${escapeHtml(customer.activeUsers)}${customer.totalUserCap === null ? '' : ` / ${escapeHtml(customer.totalUserCap)}`}</strong></div>
      <div class="customer-stat">Administrators<strong>${escapeHtml(customer.activeAdministrators)}${customer.administratorCap === null ? '' : ` / ${escapeHtml(customer.administratorCap)}`}</strong><span>Updated ${escapeHtml(displayTimestamp(customer.updatedAt))}</span></div>
      <div class="actions">${customer.configurationValid
        ? `<a class="button" href="/customers/${customerPath}/edit">Edit customer</a><a class="button secondary" href="/customers/${customerPath}/subscription">Subscription</a>`
        : '<span class="help">Repair the stored configuration before editing.</span>'}</div>
    </article>`;
  }).join('');
  return page('Customers', `
    <div class="directory-heading"><div><h2>Customers</h2><p>Authoritative customer profiles stored in Lakebase Postgres.</p></div><a class="button" href="/">Create customer</a></div>
    <form class="customer-search" method="get" action="/customers" role="search">
      <label for="customer-search">Search customers by name, Wix site / account ID, authorized domain, or user email
        <input id="customer-search" name="q" type="search" value="${escapeHtml(search)}" maxlength="254" autocomplete="off">
      </label>
      <button type="submit">Search</button>${search ? '<a class="button secondary" href="/customers">Clear</a>' : ''}
    </form>
    ${customers.length ? `<div class="customer-grid">${cards}</div>` : `<div class="empty-state">${search ? 'No customers match your search.' : 'No customer profiles have been created yet.'}</div>`}
  `);
}

function renderReview(csrfToken, confirmationToken, request, subscription) {
  const { config, initialAdministrator, operator } = request;
  return page('Review customer', `
    <section class="notice"><strong>Review carefully.</strong> Confirming creates this customer immediately. Customer IDs cannot be reused by this tool.</section>
    <dl>
      ${subscription ? `<dt>Subscription</dt><dd>${escapeHtml(subscription.planKey)} · ${escapeHtml(subscription.interval)} · ${escapeHtml(subscription.startsAt)} through ${escapeHtml(subscription.paidThrough)} · ${escapeHtml(subscription.paymentKind)}</dd>` : ''}
      <dt>Customer</dt><dd>${escapeHtml(config.product.displayName)} (<code>${escapeHtml(config.customerId)}</code>)</dd>
      <dt>Configuration version</dt><dd>${escapeHtml(config.configVersion)}</dd>
      <dt>Operator</dt><dd>${escapeHtml(operator.email)}</dd>
      <dt>Initial administrator</dt><dd>${escapeHtml(initialAdministrator.name)} · ${escapeHtml(initialAdministrator.email)}</dd>
      <dt>Allowed domains</dt><dd>${escapeHtml(listText(config.access.allowedEmailDomains))}</dd>
      <dt>User limit</dt><dd>1 / ${escapeHtml(config.access.totalUserCap)} after creation</dd>
      <dt>Role limits</dt><dd>employee ${escapeHtml(config.access.roleSeatCaps.employee)}, manager ${escapeHtml(config.access.roleSeatCaps.manager)}, admin 1 / ${escapeHtml(config.access.roleSeatCaps.admin)}</dd>
      <dt>Features</dt><dd>${escapeHtml(listText(config.capabilities.enabledFeatures))}</dd>
      <dt>Platforms</dt><dd>${escapeHtml(listText(config.capabilities.enabledPlatforms))}</dd>
      <dt>Reporting email</dt><dd>${escapeHtml(config.legal.reportingEmail)}</dd>
      <dt>Logo</dt><dd>${escapeHtml(config.theme.logoUrl || 'Packaged neutral fallback')}</dd>
      <dt>Assistant image</dt><dd>${escapeHtml(config.theme.assistantImageUrl || 'Packaged assistant fallback')}</dd>
      <dt>Easter egg image</dt><dd>${escapeHtml(config.theme.easterEggImageUrl || 'Packaged Easter egg fallback')}</dd>
      <dt>Drive / Sheets</dt><dd>${escapeHtml(config.destinations.driveRootFolderId)} · ${escapeHtml(config.destinations.reportSpreadsheetId)} · ${escapeHtml(config.destinations.eventSpreadsheetId)}</dd>
      <dt>Statistics dashboard</dt><dd>${escapeHtml(config.stats.dashboardId)}</dd>
    </dl>
    <form method="post" action="/provision">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="confirmationToken" value="${escapeHtml(confirmationToken)}">
      <div class="actions"><button class="danger" type="submit">Create customer and administrator</button><a class="button secondary" href="/">Start over</a></div>
    </form>
  `);
}

function renderUpdateReview(csrfToken, confirmationToken, request) {
  const { config, operator, expectedConfigVersion } = request;
  const customerPath = encodeURIComponent(config.customerId);
  return page(`Review ${config.product.displayName}`, `
    <section class="notice"><strong>Review carefully.</strong> Confirming replaces version ${escapeHtml(expectedConfigVersion)} with version ${escapeHtml(config.configVersion)}. Active-member caps, roles, and domains are checked again inside the transaction.</section>
    <dl>
      <dt>Customer</dt><dd>${escapeHtml(config.product.displayName)} (<code>${escapeHtml(config.customerId)}</code>)</dd>
      <dt>Configuration version</dt><dd>${escapeHtml(expectedConfigVersion)} → ${escapeHtml(config.configVersion)}</dd>
      <dt>Operator</dt><dd>${escapeHtml(operator.email)}</dd>
      <dt>Allowed domains</dt><dd>${escapeHtml(listText(config.access.allowedEmailDomains))}</dd>
      <dt>User limit</dt><dd>${escapeHtml(config.access.totalUserCap)}</dd>
      <dt>Role limits</dt><dd>employee ${escapeHtml(config.access.roleSeatCaps.employee)}, manager ${escapeHtml(config.access.roleSeatCaps.manager)}, admin ${escapeHtml(config.access.roleSeatCaps.admin)}</dd>
      <dt>Features</dt><dd>${escapeHtml(listText(config.capabilities.enabledFeatures))}</dd>
      <dt>Platforms</dt><dd>${escapeHtml(listText(config.capabilities.enabledPlatforms))}</dd>
      <dt>Reporting email</dt><dd>${escapeHtml(config.legal.reportingEmail)}</dd>
      <dt>Drive / Sheets</dt><dd>${escapeHtml(config.destinations.driveRootFolderId)} · ${escapeHtml(config.destinations.reportSpreadsheetId)} · ${escapeHtml(config.destinations.eventSpreadsheetId)}</dd>
      <dt>Statistics dashboard</dt><dd>${escapeHtml(config.stats.dashboardId)}</dd>
    </dl>
    <form method="post" action="/customers/${customerPath}/update">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="confirmationToken" value="${escapeHtml(confirmationToken)}">
      <div class="actions"><button class="danger" type="submit">Save customer changes</button><a class="button secondary" href="/customers/${customerPath}/edit">Return to edit</a></div>
    </form>
  `);
}

function renderSuccess(result) {
  return page('Customer created', `
    <section class="success"><strong>Customer created successfully.</strong> The customer, initial administrator, and audit record committed together.</section>
    <dl>
      <dt>Customer ID</dt><dd><code>${escapeHtml(result.customerId)}</code></dd>
      <dt>Administrator</dt><dd>${escapeHtml(result.administratorEmail)}</dd>
      <dt>Active users</dt><dd>${escapeHtml(result.utilization.activeUsers.used)} / ${escapeHtml(result.utilization.activeUsers.limit)}</dd>
      <dt>Administrators</dt><dd>${escapeHtml(result.utilization.administrators.used)} / ${escapeHtml(result.utilization.administrators.limit)}</dd>
      <dt>Audit ID</dt><dd><code>${escapeHtml(result.auditId)}</code></dd>
    </dl>
    <section class="notice">The administrator can now reload the existing Rights Reporter extension and sign in with this exact Google email. No extension rebuild is required.</section>
    <div class="actions"><a class="button" href="/customers">View customers</a><a class="button secondary" href="/">Create another customer</a></div>
  `);
}

function renderUpdateSuccess(result) {
  const customerPath = encodeURIComponent(result.customerId);
  return page('Customer updated', `
    <section class="success"><strong>Customer updated successfully.</strong> The configuration and audit record committed together.</section>
    <dl>
      <dt>Customer</dt><dd>${escapeHtml(result.displayName)} (<code>${escapeHtml(result.customerId)}</code>)</dd>
      <dt>Configuration version</dt><dd>${escapeHtml(result.configVersion)}</dd>
      <dt>Changed values</dt><dd>${escapeHtml(listText(result.changedFields))}</dd>
      <dt>Active users</dt><dd>${escapeHtml(result.utilization.activeUsers.used)} / ${escapeHtml(result.utilization.activeUsers.limit)}</dd>
      <dt>Administrators</dt><dd>${escapeHtml(result.utilization.administrators.used)} / ${escapeHtml(result.utilization.administrators.limit)}</dd>
      <dt>Audit ID</dt><dd><code>${escapeHtml(result.auditId)}</code></dd>
    </dl>
    <section class="notice">Signed-in extensions will receive the new configuration after their current short-lived profile expires or access is refreshed.</section>
    <div class="actions"><a class="button" href="/customers">View customers</a><a class="button secondary" href="/customers/${customerPath}/edit">Edit again</a></div>
  `);
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    // Preserve the Origin on same-origin form POSTs; disclose no referrer off-site.
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
}

function send(response, status, body, contentType = 'text/html; charset=utf-8', additionalHeaders = {}) {
  response.writeHead(status, { ...securityHeaders(contentType), ...additionalHeaders });
  response.end(body);
}

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
}

async function readParameters(request) {
  const type = String(request.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new ApiError(415, 'invalid_request', 'The setup form content type is invalid.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'invalid_request', 'The setup form is too large.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function validateLocalPost(request, parameters, csrfToken) {
  const origin = String(request.headers.origin || '');
  if (origin && origin !== `http://${request.headers.host}`) throw new ApiError(403, 'invalid_origin', 'The setup request origin is not allowed.');
  const cookies = parseCookies(request.headers.cookie);
  const formToken = String(parameters.get('csrf') || '');
  if (!cookies.customer_setup_csrf || cookies.customer_setup_csrf !== csrfToken || formToken !== csrfToken) {
    throw new ApiError(403, 'invalid_csrf', 'The setup page expired. Reload it and try again.');
  }
}

function setupError(error) {
  if (error instanceof ApiError) return error;
  console.error('Customer setup error:', { code: error?.code || 'internal_error' });
  return new ApiError(500, 'customer_setup_failed', 'The customer operation could not be completed. No partial change was saved.');
}

function customerRouteId(pathname, action) {
  const match = pathname.match(new RegExp(`^/customers/([^/]+)/${action}$`));
  if (!match) return null;
  try {
    const customerId = decodeURIComponent(match[1]);
    return /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(customerId) ? customerId : null;
  } catch {
    return null;
  }
}

export async function startCustomerSetupServer({
  pool,
  operatorEmail = process.env.CUSTOMER_SETUP_OPERATOR_EMAIL || '',
  passwordHash = process.env.CUSTOMER_SETUP_PASSWORD_HASH,
  mustChangePassword = process.env.CUSTOMER_SETUP_PASSWORD_MUST_CHANGE === 'true',
  persistPassword,
  host = '127.0.0.1',
  port = 4174,
  provision = provisionCustomer,
  list = listCustomers,
  load = loadCustomerForEdit,
  update = updateCustomer,
  now = () => Date.now()
}) {
  if (host !== '127.0.0.1') throw new Error('The customer setup server must bind to 127.0.0.1.');
  const auth = createSellerAuth({ passwordHash, operatorEmail, mustChangePassword, persistPassword, now });
  const pendingReviews = new Map();
  let expectedOrigin = '';

  const server = http.createServer(async (request, response) => {
    try {
      const localPort = new URL(expectedOrigin).port;
      const allowedHosts = new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`]);
      if (!allowedHosts.has(request.headers.host)) {
        throw new ApiError(403, 'invalid_host', 'Open customer setup using localhost or 127.0.0.1 and the setup server port.');
      }
      const url = new URL(request.url || '/', expectedOrigin);
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { send(response, 204, '', 'image/x-icon'); return; }
      if (request.method === 'GET' && url.pathname === '/style.css') { send(response, 200, STYLE, 'text/css; charset=utf-8'); return; }
      const session = await auth.gate(request, response, url, { send, page, readParameters });
      if (!session) return;
      const csrfToken = session.csrf;
      const currentTime = now();
      for (const [token, review] of pendingReviews) {
        if (review.expiresAt <= currentTime) pendingReviews.delete(token);
      }

      if (request.method === 'GET' && url.pathname === '/colors.js') {
        send(response, 200, COLOR_SCRIPT, 'text/javascript; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/preview.js') {
        send(response, 200, IMAGE_PREVIEW_SCRIPT, 'text/javascript; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/customer-preview.js') {
        send(response, 200, CUSTOMER_CONFIG_PREVIEW_SCRIPT, 'text/javascript; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/style.css') {
        send(response, 200, STYLE, 'text/css; charset=utf-8');
        return;
      }
      const csrfCookie = { 'Set-Cookie': `customer_setup_csrf=${csrfToken}; Path=/; HttpOnly; SameSite=Strict` };
      if (request.method === 'GET' && url.pathname === '/') {
        send(response, 200, renderForm(csrfToken, newDraft(operatorEmail)), 'text/html; charset=utf-8', csrfCookie);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/customers') {
        const search = String(url.searchParams.get('q') || '').trim();
        if (search.length > 254) throw new ApiError(400, 'invalid_search', 'Search terms must be 254 characters or fewer.');
        const customers = await list(pool, search);
        send(response, 200, renderCustomerDirectory(customers, search), 'text/html; charset=utf-8', csrfCookie);
        return;
      }
      const statusCustomerId = customerRouteId(url.pathname, 'status');
      if (statusCustomerId && request.method === 'POST') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        if (!['true','false'].includes(parameters.get('active'))) throw new ApiError(400, 'invalid_request', 'Invalid customer status.');
        await setAdministrativeStatus(pool, { customerId: statusCustomerId, active: parameters.get('active') === 'true', expectedConfigVersion: Number(parameters.get('expectedConfigVersion')), idempotencyKey: parameters.get('idempotencyKey'), reason: parameters.get('reason') }, session.email);
        send(response, 200, page('Status updated', '<h2>Customer status updated</h2><a href="/customers">Return to customers</a>'));
        return;
      }
      const billingCustomerId = customerRouteId(url.pathname, 'billing-link');
      if (billingCustomerId && request.method === 'POST') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        await saveBillingMapping(pool, {
          customerId: billingCustomerId, accountId: parameters.get('accountId'), orderId: parameters.get('orderId'),
          planId: parameters.get('planId'), planKey: parameters.get('planKey'), interval: parameters.get('interval'),
          package: { totalUserCap: Number(parameters.get('billing.totalUserCap')), roleSeatCaps: Object.fromEntries(['employee','manager','admin'].map(role => [role, Number(parameters.get(`billing.cap.${role}`))])), enabledFeatures: parameters.getAll('billing.features') },
          expectedConfigVersion: Number(parameters.get('expectedConfigVersion'))
        }, session.email);
        send(response, 200, page('Billing linked', '<h2>Billing mapping saved</h2><a href="/customers">Return to customers</a>'));
        return;
      }
      const subscriptionCustomerId = customerRouteId(url.pathname, 'subscription');
      if (subscriptionCustomerId && request.method === 'GET') {
        const customer = await load(pool, subscriptionCustomerId);
        const details = await loadSubscription(pool, subscriptionCustomerId);
        send(response, 200, page('Subscription', renderSubscription(csrfToken, customer, details)), 'text/html; charset=utf-8', csrfCookie);
        return;
      }
      if (subscriptionCustomerId && request.method === 'POST') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        const customer = await load(pool, subscriptionCustomerId);
        const config = structuredClone(customer.config);
        config.access.totalUserCap = Number(parameters.get('totalUserCap'));
        config.access.roleSeatCaps = Object.fromEntries(['employee','manager','admin'].map(r => [r, Number(parameters.get(`cap.${r}`))]));
        config.capabilities.enabledFeatures = parameters.getAll('features');
        const candidate = subscriptionFromForm(parameters, config, {
          expectedRevision: Number(parameters.get('expectedRevision')),
          expectedConfigVersion: Number(parameters.get('expectedConfigVersion')),
          idempotencyKey: String(parameters.get('idempotencyKey') || ''), active: parameters.has('active')
        });
        const result = await applySubscriptionChange(pool, candidate, session.email);
        send(response, 200, page('Subscription saved', `<h2>Subscription saved</h2><p>Paid through ${escapeHtml(result.paidThrough)}. Purchased users: ${result.totalUserCap}.</p><a href="/customers/${encodeURIComponent(result.customerId)}/subscription">Return to subscription</a>`));
        return;
      }
      const editCustomerId = customerRouteId(url.pathname, 'edit');
      if (request.method === 'GET' && editCustomerId) {
        const customer = await load(pool, editCustomerId);
        const config = structuredClone(customer.config);
        config.configVersion = customer.configVersion + 1;
        send(response, 200, renderForm(csrfToken, {
          config,
          operator: { email: operatorEmail }
        }, [], {
          mode: 'edit',
          expectedConfigVersion: customer.configVersion
        }), 'text/html; charset=utf-8', csrfCookie);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/review') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        const candidate = customerSetupRequestFromForm(parameters);
        candidate.operator.email = session.email;
        const validation = validateCustomerProvisioningRequest(candidate);
        if (!validation.valid) {
          send(response, 400, renderForm(csrfToken, candidate, validation.errors));
          return;
        }
        const confirmationToken = crypto.randomBytes(32).toString('hex');
        pendingReviews.set(confirmationToken, {
          kind: 'create',
          sessionId: session.id,
          subscription: subscriptionFromForm(parameters, validation.request.config, { idempotencyKey: confirmationToken }),
          request: validation.request,
          expiresAt: currentTime + REVIEW_TTL_MS,
          inProgress: false
        });
        send(response, 200, renderReview(csrfToken, confirmationToken, validation.request, pendingReviews.get(confirmationToken).subscription));
        return;
      }
      const reviewCustomerId = customerRouteId(url.pathname, 'review');
      if (request.method === 'POST' && reviewCustomerId) {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        const candidate = customerUpdateRequestFromForm(parameters);
        candidate.operator.email = session.email;
        if (candidate.config.customerId !== reviewCustomerId) {
          throw new ApiError(409, 'customer_scope_mismatch', 'The customer ID cannot be changed through the edit form.');
        }
        const validation = validateCustomerUpdateRequest(candidate);
        if (!validation.valid) {
          send(response, 400, renderForm(csrfToken, candidate, validation.errors, {
            mode: 'edit',
            expectedConfigVersion: candidate.expectedConfigVersion
          }));
          return;
        }
        const confirmationToken = crypto.randomBytes(32).toString('hex');
        pendingReviews.set(confirmationToken, {
          kind: 'update',
          sessionId: session.id,
          request: validation.request,
          expiresAt: currentTime + REVIEW_TTL_MS,
          inProgress: false
        });
        send(response, 200, renderUpdateReview(csrfToken, confirmationToken, validation.request));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/provision') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        const confirmationToken = String(parameters.get('confirmationToken') || '');
        const review = pendingReviews.get(confirmationToken);
        if (!review || review.sessionId !== session.id || review.kind !== 'create' || review.expiresAt <= currentTime || review.inProgress) {
          throw new ApiError(409, 'invalid_confirmation', 'The confirmation expired or was already used. Start over.');
        }
        review.inProgress = true;
        try {
          const result = await provision(pool, review.request, { subscription: review.subscription });
          pendingReviews.delete(confirmationToken);
          send(response, 201, renderSuccess(result));
        } catch (error) {
          review.inProgress = false;
          throw error;
        }
        return;
      }
      const updateCustomerId = customerRouteId(url.pathname, 'update');
      if (request.method === 'POST' && updateCustomerId) {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken);
        const confirmationToken = String(parameters.get('confirmationToken') || '');
        const review = pendingReviews.get(confirmationToken);
        if (
          !review
          || review.sessionId !== session.id
          || review.kind !== 'update'
          || review.request.config.customerId !== updateCustomerId
          || review.expiresAt <= currentTime
          || review.inProgress
        ) {
          throw new ApiError(409, 'invalid_confirmation', 'The confirmation expired or was already used. Reload the customer and try again.');
        }
        review.inProgress = true;
        try {
          const result = await update(pool, review.request);
          pendingReviews.delete(confirmationToken);
          send(response, 200, renderUpdateSuccess(result));
        } catch (error) {
          review.inProgress = false;
          throw error;
        }
        return;
      }
      send(response, 404, page('Not found', '<section class="errors">This setup page does not exist.</section>'));
    } catch (rawError) {
      const error = setupError(rawError);
      const validationErrors = error.details?.validationErrors || [];
      send(response, error.status || 500, page('Setup error', `
        <section class="errors"><strong>${escapeHtml(error.message)}</strong>${renderErrors(validationErrors)}</section>
        <div class="actions"><a class="button secondary" href="/customers">Return to customers</a><a class="button secondary" href="/">Create customer</a></div>
      `));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  expectedOrigin = `http://${host}:${actualPort}`;
  return {
    url: `${expectedOrigin}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
