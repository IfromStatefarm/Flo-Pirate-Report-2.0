import crypto from 'node:crypto';
import { CUSTOMER_FEATURES } from '../utils/customer_config.js';
import { calendarEnd, validateSubscription } from './subscription_service.js';

export const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const input = (name, label, value, type = 'text', extra = '') => `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
const dateValue = value => value ? new Date(value).toISOString().slice(0, 16) : '';

export function subscriptionFields(subscription = null) {
  return `<fieldset><legend>Package and subscription</legend><div class="grid">
    ${input('subscription.planKey', 'Package name / version', subscription?.plan_key || '', 'text', 'required maxlength="80"')}
    <label>Billing interval<select name="subscription.interval">${options([['month', 'Monthly'], ['year', 'Yearly']], subscription?.billing_interval || 'month')}</select></label>
    ${input('subscription.startsAt', 'Access starts (UTC)', dateValue(subscription?.starts_at), 'datetime-local', 'required')}
    ${input('subscription.paidThrough', 'Paid through (UTC, exclusive)', dateValue(subscription?.paid_through), 'datetime-local')}
    <span class="help wide">An empty paid-through date grants one calendar month or year from the start. Recording a billing interval does not collect payment.</span>
    <label>Access grant<select name="subscription.paymentKind">${options([['paid', 'Payment received'], ['trial', 'Trial'], ['complimentary', 'Complimentary']], subscription?.payment_kind || 'paid')}</select></label>
    ${input('subscription.paymentReference', 'Payment / invoice reference (required for paid access)', '', 'text', 'maxlength="128"')}
    ${input('subscription.reason', 'Reason for this change', '', 'text', 'required maxlength="500"')}
    <label class="check"><input name="subscription.cancelAtPeriodEnd" type="checkbox" ${subscription?.cancel_at_period_end ? 'checked' : ''}>Cancel renewal after the paid period</label>
  </div></fieldset>`;
}
export function subscriptionFromForm(parameters, config, { expectedRevision = 0, expectedConfigVersion = config.configVersion, idempotencyKey = crypto.randomUUID(), active = true } = {}) {
  const utc = name => {
    const value = String(parameters.get(`subscription.${name}`) || '');
    return value ? `${value}Z` : '';
  };
  return validateSubscription({
    customerId: config.customerId,
    planKey: String(parameters.get('subscription.planKey') || ''),
    interval: String(parameters.get('subscription.interval') || ''),
    startsAt: utc('startsAt'), paidThrough: utc('paidThrough'),
    paymentKind: String(parameters.get('subscription.paymentKind') || ''),
    paymentReference: String(parameters.get('subscription.paymentReference') || ''),
    reason: String(parameters.get('subscription.reason') || ''),
    cancelAtPeriodEnd: parameters.has('subscription.cancelAtPeriodEnd'),
    totalUserCap: config.access.totalUserCap, roleSeatCaps: config.access.roleSeatCaps,
    enabledFeatures: config.capabilities.enabledFeatures,
    expectedRevision, expectedConfigVersion, idempotencyKey, active,
    operation: String(parameters.get('operation') || 'save')
  });
}
export function renderSubscription(csrf, customer, details) {
  const sub = details.subscription;
  const path = `/customers/${encodeURIComponent(customer.customerId)}/subscription`;
  const hidden = (name, value) => input(name, '', value, 'hidden');
  const fields = customer.config;
  return `<div class="subscription-heading"><h2>${escape(customer.displayName)} · Subscription</h2><a class="button secondary" href="/customers/${encodeURIComponent(customer.customerId)}/edit">Back to edit customer</a></div>
    <p>${sub ? `Paid through ${escape(new Date(sub.paid_through).toISOString())}. Revision ${sub.revision}.` : 'No subscription: protected API access is locked until terms are saved.'}</p>
    ${details.billingLink ? '<section class="notice">Billing manages this subscription. Update paid terms through your payment provider.</section>' : ''}
    <form method="post" action="/customers/${encodeURIComponent(customer.customerId)}/status">
      ${hidden('csrf', csrf)}${hidden('expectedConfigVersion', customer.configVersion)}${hidden('idempotencyKey', crypto.randomUUID())}
      ${hidden('active', customer.active ? 'false' : 'true')}
      ${input('reason', 'Reason for suspending or restoring service', '', 'text', 'required maxlength="500"')}
      <button>${customer.active ? 'Suspend customer' : 'Restore customer'}</button>
      <p class="help">This seller control is independent of payment status. Renewals cannot undo a suspension.</p>
    </form>
    <form method="post" action="${path}">
    ${hidden('csrf', csrf)}${hidden('expectedRevision', sub?.revision || 0)}${hidden('expectedConfigVersion', customer.configVersion)}${hidden('idempotencyKey', crypto.randomUUID())}
    ${subscriptionFields(sub)}
    <fieldset><legend>Purchased users and features</legend><div class="grid">
    ${input('totalUserCap', 'Total named users', fields.access.totalUserCap, 'number', 'required min="1" max="100000"')}
    ${['employee', 'manager', 'admin'].map(r => input(`cap.${r}`, `${r} user limit`, fields.access.roleSeatCaps[r], 'number', `required min="${r === 'admin' ? 1 : 0}" max="100000"`)).join('')}
    ${CUSTOMER_FEATURES.map(feature => `<label class="check"><input type="checkbox" name="features" value="${feature}" ${fields.capabilities.enabledFeatures.includes(feature) ? 'checked' : ''}>${escape(feature)}</label>`).join('')}
    <label class="check"><input name="active" type="checkbox" ${customer.active ? 'checked' : ''}>Customer enabled (clear to suspend)</label>
    </div></fieldset>
    <div class="actions"><button name="operation" value="save" ${details.billingLink ? 'disabled' : ''}>Save subscription terms</button>
    ${sub ? `<button name="operation" value="renew" ${details.billingLink ? 'disabled' : ''}>Record payment and renew selected interval</button>` : ''}</div>
    ${sub ? `<p class="help">Renew starts from the later of the paid-through date or today. An on-time renewal would end ${escape(calendarEnd(sub.paid_through, sub.billing_interval))}. Seats are replaced by the numbers above, never added.</p>` : ''}
    </form>
    <h3>Connect a Wix order</h3>
    <p>Map a verified Wix order to this customer and a Wix plan to the package above. Plan mappings are immutable; use a new plan ID for changed terms.</p>
    <form method="post" action="/customers/${encodeURIComponent(customer.customerId)}/billing-link">
    ${hidden('csrf', csrf)}${hidden('expectedConfigVersion', customer.configVersion)}
    <div class="grid">${input('accountId', 'Wix site / account ID', details.billingLink?.account_id || '', 'text', 'required')}
    ${input('orderId', 'Wix order ID', details.billingLink?.order_id || '', 'text', 'required')}
    ${input('planId', 'Wix pricing plan ID', '', 'text', 'required')}
    ${input('planKey', 'Internal package name / version', sub?.plan_key || '', 'text', 'required maxlength="80"')}
    <label>Package interval<select name="interval">${options([['month','Monthly'],['year','Yearly']], sub?.billing_interval || 'month')}</select></label>
    ${input('billing.totalUserCap', 'Purchased users for this Wix plan', fields.access.totalUserCap, 'number', 'required min="1" max="100000"')}
    ${['employee','manager','admin'].map(role => input(`billing.cap.${role}`, `${role} seats for this Wix plan`, fields.access.roleSeatCaps[role], 'number', `required min="${role === 'admin' ? 1 : 0}" max="100000"`)).join('')}
    ${CUSTOMER_FEATURES.map(feature => `<label class="check"><input type="checkbox" name="billing.features" value="${feature}" ${fields.capabilities.enabledFeatures.includes(feature) ? 'checked' : ''}>${escape(feature)}</label>`).join('')}</div>
    <button ${sub ? '' : 'disabled'}>Save trusted billing mapping</button></form>
    <h3>Recent subscription changes</h3><ul>${details.audit.map(row => `<li>${escape(new Date(row.occurred_at).toISOString())} — ${escape(row.actor)}: ${escape(row.reason)}</li>`).join('') || '<li>No changes yet.</li>'}</ul>`;
}
