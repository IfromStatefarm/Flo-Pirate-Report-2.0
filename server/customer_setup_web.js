import crypto from 'node:crypto';
import http from 'node:http';
import { ApiError } from './api_error.js';
import { provisionCustomer, validateCustomerProvisioningRequest } from './customer_provisioning.js';
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
header { background: #1f2937; color: white; padding: 24px max(24px, calc((100vw - 1080px) / 2)); }
header h1 { margin: 0 0 6px; font-size: 26px; }
header p { margin: 0; color: #cbd5e1; }
main { max-width: 1080px; margin: 0 auto; padding: 24px; }
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
textarea { min-height: 86px; resize: vertical; }
input:focus, textarea:focus { outline: 3px solid #bfdbfe; border-color: #2563eb; }
.checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.check { display: flex; gap: 8px; align-items: center; font-weight: 500; }
.check input { width: auto; }
.help { display: block; color: #64748b; font-size: 12px; font-weight: 400; }
.actions { display: flex; gap: 12px; align-items: center; margin: 20px 0 40px; }
button, .button { appearance: none; border: 0; border-radius: 9px; padding: 11px 18px; background: #2563eb; color: white; font: inherit; font-weight: 750; cursor: pointer; text-decoration: none; }
.secondary { background: #475569; }
.danger { background: #b91c1c; }
dl { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 10px 18px; background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; }
dt { font-weight: 750; color: #475569; }
dd { margin: 0; overflow-wrap: anywhere; }
code { background: #e2e8f0; border-radius: 5px; padding: 2px 5px; }
@media (max-width: 620px) { dl { grid-template-columns: 1fr; } dd { margin-bottom: 8px; } }
`;

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
</head>
<body>
  <header><h1>Rights Reporter Customer Setup</h1><p>Local operator tool · credentials stay on this computer</p></header>
  <main>${content}</main>
</body>
</html>`;
}

function input(name, label, value, {
  type = 'text', required = true, help = '', min = '', max = '', pattern = '', wide = false
} = {}) {
  return `<label class="${wide ? 'wide' : ''}">${escapeHtml(label)}
    <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"
      ${required ? 'required' : ''} ${min !== '' ? `min="${escapeHtml(min)}"` : ''}
      ${max !== '' ? `max="${escapeHtml(max)}"` : ''} ${pattern ? `pattern="${escapeHtml(pattern)}"` : ''}>
    ${help ? `<span class="help">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

function textarea(name, label, value, help = '') {
  return `<label class="wide">${escapeHtml(label)}
    <textarea name="${escapeHtml(name)}" required>${escapeHtml(value)}</textarea>
    ${help ? `<span class="help">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

function checkboxGroup(name, values, selected, labelFor) {
  const chosen = new Set(selected);
  return `<div class="checks">${values.map((value) => `<label class="check">
    <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${chosen.has(value) ? 'checked' : ''}>
    <span>${escapeHtml(labelFor(value))}</span>
  </label>`).join('')}</div>`;
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

export function customerSetupRequestFromForm(parameters) {
  const colors = Object.fromEntries(CUSTOMER_COLOR_TOKENS.map((token) => [
    token,
    fieldValue(parameters, `theme.${token}`)
  ]));
  return {
    config: {
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
    },
    initialAdministrator: {
      email: fieldValue(parameters, 'initialAdministrator.email'),
      name: fieldValue(parameters, 'initialAdministrator.name')
    },
    operator: { email: fieldValue(parameters, 'operator.email') }
  };
}

function renderErrors(errors) {
  if (!errors?.length) return '';
  return `<section class="errors"><strong>Please correct these fields:</strong><ul>${errors.map((error) => (
    `<li><code>${escapeHtml(error.path)}</code>: ${escapeHtml(error.message)}</li>`
  )).join('')}</ul></section>`;
}

function renderForm(csrfToken, draft, errors = []) {
  const c = draft.config;
  return page('New customer', `
    <section class="notice"><strong>How this connects:</strong> this local page writes one customer, one active administrator, and one audit record to Neon in a single transaction. The extension receives no database credential.</section>
    ${renderErrors(errors)}
    <form method="post" action="/review" autocomplete="off">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <fieldset><legend>Operator and initial administrator</legend><div class="grid">
        ${input('operator.email', 'Operator email', draft.operator.email, { type: 'email', help: 'Who is performing this setup; recorded in the audit.' })}
        ${input('initialAdministrator.name', 'Initial administrator name', draft.initialAdministrator.name)}
        ${input('initialAdministrator.email', 'Initial administrator Google email', draft.initialAdministrator.email, { type: 'email', help: 'Must use one of the allowed customer domains.' })}
      </div></fieldset>

      <fieldset><legend>Customer and product identity</legend><div class="grid">
        ${input('customerId', 'Customer ID', c.customerId, { pattern: '[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?', help: 'Permanent lowercase slug, for example acme-sports.' })}
        ${input('configVersion', 'Configuration version', c.configVersion, { type: 'number', min: 1 })}
        ${input('product.productName', 'Product name', c.product.productName)}
        ${input('product.displayName', 'Display name', c.product.displayName)}
        ${input('product.shortName', 'Short name', c.product.shortName)}
        ${input('product.assistantName', 'Assistant name', c.product.assistantName)}
        ${input('product.tagline', 'Tagline', c.product.tagline, { wide: true })}
      </div></fieldset>

      <fieldset><legend>Theme</legend><div class="grid">
        ${input('theme.logoUrl', 'Approved logo HTTPS URL', c.theme.logoUrl, { required: false, wide: true, help: 'Optional. No data URLs, embedded HTML, credentials, JavaScript, or CSS.' })}
        ${input('theme.logoAltText', 'Logo alternative text', c.theme.logoAltText)}
        ${CUSTOMER_COLOR_TOKENS.map((token) => input(`theme.${token}`, `Color: ${token}`, c.theme.colors[token], { pattern: '#[0-9A-Fa-f]{6}' })).join('')}
      </div></fieldset>

      <fieldset><legend>Legal owner and reporting contact</legend><div class="grid">
        ${input('legal.ownerName', 'Legal owner name', c.legal.ownerName)}
        ${input('legal.companyName', 'Company name', c.legal.companyName, { required: false })}
        ${input('legal.reportingEmail', 'Reporting email', c.legal.reportingEmail, { type: 'email' })}
        ${input('legal.secondaryEmail', 'Secondary email', c.legal.secondaryEmail, { type: 'email', required: false })}
        ${input('legal.phone', 'Phone', c.legal.phone, { required: false })}
        ${input('legal.addressLine1', 'Address', c.legal.addressLine1, { required: false })}
        ${input('legal.city', 'City', c.legal.city, { required: false })}
        ${input('legal.region', 'State / region', c.legal.region, { required: false })}
        ${input('legal.postalCode', 'Postal code', c.legal.postalCode, { required: false })}
        ${input('legal.country', 'Country', c.legal.country, { required: false })}
        ${input('legal.originalWorkUrl', 'Original work HTTPS URL', c.legal.originalWorkUrl, { type: 'url', wide: true })}
      </div></fieldset>

      <fieldset><legend>Access limits</legend><div class="grid">
        ${textarea('access.allowedEmailDomains', 'Allowed email domains', c.access.allowedEmailDomains.join('\n'), 'One domain per line, without @. The initial administrator must match.')}
        ${input('access.totalUserCap', 'Total active-user cap', c.access.totalUserCap, { type: 'number', min: 1, max: 100000 })}
        ${input('access.employeeCap', 'Employee seat cap', c.access.roleSeatCaps.employee, { type: 'number', min: 0, max: 100000 })}
        ${input('access.managerCap', 'Manager seat cap', c.access.roleSeatCaps.manager, { type: 'number', min: 0, max: 100000 })}
        ${input('access.adminCap', 'Administrator seat cap', c.access.roleSeatCaps.admin, { type: 'number', min: 1, max: 100000 })}
        <div class="wide"><strong>Enabled roles</strong><span class="help">Administrator is mandatory. Set disabled role caps to zero.</span>
          ${checkboxGroup('access.enabledRoles', CUSTOMER_ROLES, c.access.enabledRoles, (value) => value)}
        </div>
      </div></fieldset>

      <fieldset><legend>Enabled features</legend>
        ${checkboxGroup('capabilities.enabledFeatures', CUSTOMER_FEATURES, c.capabilities.enabledFeatures, (value) => value)}
      </fieldset>

      <fieldset><legend>Enabled platforms</legend>
        <span class="help">Only checked platforms are returned to customer users.</span>
        ${checkboxGroup(
          'capabilities.enabledPlatforms',
          PLATFORM_CATALOG.map((entry) => entry.key),
          c.capabilities.enabledPlatforms,
          (value) => PLATFORM_CATALOG.find((entry) => entry.key === value)?.label || value
        )}
      </fieldset>

      <fieldset><legend>Google destinations and statistics</legend><div class="grid">
        ${input('destinations.driveRootFolderId', 'Drive root folder ID', c.destinations.driveRootFolderId, { help: 'The ID only, not the complete URL.' })}
        ${input('destinations.reportSpreadsheetId', 'Reporting spreadsheet ID', c.destinations.reportSpreadsheetId, { help: 'The ID only, not the complete URL.' })}
        ${input('destinations.eventSpreadsheetId', 'Event spreadsheet ID', c.destinations.eventSpreadsheetId, { help: 'The ID only, not the complete URL.' })}
        ${input('stats.dashboardId', 'Statistics dashboard ID', c.stats.dashboardId, { pattern: '[A-Za-z0-9_-]{1,128}', help: 'For example stats_acme_sports.' })}
      </div></fieldset>

      <div class="actions"><button type="submit">Validate and review</button><span>No database changes happen on this page.</span></div>
    </form>
  `);
}

function listText(values) {
  return values.length ? values.join(', ') : 'None';
}

function renderReview(csrfToken, confirmationToken, request) {
  const { config, initialAdministrator, operator } = request;
  return page('Review customer', `
    <section class="notice"><strong>Review carefully.</strong> Confirming creates this customer immediately. Customer IDs cannot be reused by this tool.</section>
    <dl>
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
    <div class="actions"><a class="button" href="/">Create another customer</a></div>
  `);
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
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

function validateLocalPost(request, parameters, csrfToken, expectedOrigin) {
  const origin = String(request.headers.origin || '');
  if (origin && origin !== expectedOrigin) throw new ApiError(403, 'invalid_origin', 'The setup request origin is not allowed.');
  const cookies = parseCookies(request.headers.cookie);
  const formToken = String(parameters.get('csrf') || '');
  if (!cookies.customer_setup_csrf || cookies.customer_setup_csrf !== csrfToken || formToken !== csrfToken) {
    throw new ApiError(403, 'invalid_csrf', 'The setup page expired. Reload it and try again.');
  }
}

function setupError(error) {
  if (error instanceof ApiError) return error;
  console.error('Customer setup error:', error);
  return new ApiError(500, 'customer_setup_failed', 'The customer could not be created. No partial customer was saved.');
}

export async function startCustomerSetupServer({
  pool,
  operatorEmail = '',
  host = '127.0.0.1',
  port = 4174,
  provision = provisionCustomer,
  now = () => Date.now()
}) {
  if (host !== '127.0.0.1') throw new Error('The customer setup server must bind to 127.0.0.1.');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const pendingReviews = new Map();
  let expectedOrigin = '';

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', expectedOrigin);
      const currentTime = now();
      for (const [token, review] of pendingReviews) {
        if (review.expiresAt <= currentTime) pendingReviews.delete(token);
      }

      if (request.method === 'GET' && url.pathname === '/style.css') {
        send(response, 200, STYLE, 'text/css; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        send(response, 200, renderForm(csrfToken, newDraft(operatorEmail)), 'text/html; charset=utf-8', {
          'Set-Cookie': `customer_setup_csrf=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/review') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken, expectedOrigin);
        const candidate = customerSetupRequestFromForm(parameters);
        const validation = validateCustomerProvisioningRequest(candidate);
        if (!validation.valid) {
          send(response, 400, renderForm(csrfToken, candidate, validation.errors));
          return;
        }
        const confirmationToken = crypto.randomBytes(32).toString('hex');
        pendingReviews.set(confirmationToken, {
          request: validation.request,
          expiresAt: currentTime + REVIEW_TTL_MS,
          inProgress: false
        });
        send(response, 200, renderReview(csrfToken, confirmationToken, validation.request));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/provision') {
        const parameters = await readParameters(request);
        validateLocalPost(request, parameters, csrfToken, expectedOrigin);
        const confirmationToken = String(parameters.get('confirmationToken') || '');
        const review = pendingReviews.get(confirmationToken);
        if (!review || review.expiresAt <= currentTime || review.inProgress) {
          throw new ApiError(409, 'invalid_confirmation', 'The confirmation expired or was already used. Start over.');
        }
        review.inProgress = true;
        try {
          const result = await provision(pool, review.request);
          pendingReviews.delete(confirmationToken);
          send(response, 201, renderSuccess(result));
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
        <div class="actions"><a class="button secondary" href="/">Return to customer setup</a></div>
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
