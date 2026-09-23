import crypto from 'node:crypto';

// Run ONLY in a trusted Wix/Node backend. Inject the authenticated Wix SDK's
// getOrder function and secrets from the site's server-side secret store.
// Reuse syncOrder in purchase/cycle/update handlers and scheduled reconciliation.
export function createWixBillingBridge({ getOrder, secret, accountId, endpoint, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || typeof secret !== 'string' || secret.length < 32 || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId || '') || typeof getOrder !== 'function') throw new Error('Configure a trusted HTTPS billing backend and secret.');
  return {
    async syncOrder(orderId) {
      const response = await getOrder(orderId);
      const order = response.order || response;
      if ((order.id || order._id) !== orderId || order.type !== 'ONLINE') throw new Error('Only matching online Wix orders can update paid access.');
      // updatedDate comes from a fresh authoritative order lookup, never event
      // delivery time. Preserve microseconds where the API provides them.
      const updated = order.updatedDate instanceof Date ? order.updatedDate.toISOString() : String(order.updatedDate || '');
      const micro = /\.(\d+)Z$/.exec(updated)?.[1] || '';
      const sequence = Date.parse(updated) * 1000 + Number(micro.padEnd(6, '0').slice(3, 6));
      if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Wix order revision time is missing.');
      const paid = order.status === 'ACTIVE' && order.lastPaymentStatus === 'PAID';
      const start = order.currentCycle?.startedDate || order.startDate;
      const end = order.currentCycle?.endedDate || (!paid && order.endDate);
      if (!start || !end || !(new Date(end) > new Date(start))) throw new Error('A finite, verified payment period is required. Unlimited plans and incomplete future cycles need manual setup.');
      if (paid && (!order.currentCycle || (order.freeTrialDays > 0 && Number(order.currentCycle.index) === 0))) throw new Error('Trial cycles do not prove payment.');
      const state = paid ? 'paid' : order.status === 'PAUSED' ? 'paused' : ['CANCELED','ENDED'].includes(order.status) ? 'canceled' : 'past_due';
      const reference = paid ? `${order.subscriptionId || orderId}:${order.currentCycle.index}` : '';
      const event = {
        schemaVersion: 1,
        eventId: crypto.createHash('sha256').update(`${accountId}:${orderId}:${sequence}:${state}:${order.autoRenewCanceled === true}`).digest('hex'),
        accountId, orderId, planId: order.planId, sequence, state,
        periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(),
        paymentReference: reference, cancelAtPeriodEnd: order.autoRenewCanceled === true || state === 'canceled'
      };
      const raw = JSON.stringify(event), timestamp = String(Date.now());
      const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
      const result = await fetchImpl(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Billing-Timestamp': timestamp, 'X-Billing-Signature': signature }, body: raw, signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw new Error(`License receiver returned ${result.status}; retry this order synchronization.`);
      return result.json();
    },
    async reconcile(orderIds) {
      const outcomes = [];
      for (const orderId of orderIds) {
        try { await this.syncOrder(orderId); outcomes.push({ orderId, accepted: true }); }
        catch (error) { outcomes.push({ orderId, accepted: false, error: error.message }); }
      }
      return outcomes;
    }
  };
}
