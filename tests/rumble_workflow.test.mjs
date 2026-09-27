import test from 'node:test';
import assert from 'node:assert/strict';
import { createRumbleWorkflow } from '../background/services/rumble_workflow.js';
import { createReportingWorkflow } from '../background/services/reporting_workflow.js';

const key = 'rumble_report_session';
const url = 'https://rumble.com/video-one.html';
const scope = { customerId: 'customer-a', userId: 'user-a' };
function setup(t, count = 1) {
  const state = { piracy_cart: Array.from({ length: count }, (_, i) => ({ ...scope, url: i ? `https://rumble.com/video-${i}.html` : url })) };
  let profile = scope;
  const tabs = [], reports = [];
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  const local = {
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, state[key]]))),
    set: async values => { Object.assign(state, structuredClone(values)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; }
  };
  globalThis.chrome = { storage: { local }, tabs: {
    create: async options => { tabs.push(options); return { id: tabs.length }; }, remove: async () => {}
  } };
  const dependencies = {
    getCustomerProfile: async () => profile,
    handleBatchReport: async (data, { assertActive }) => {
      await assertActive(profile);
      reports.push(data);
      return { success: true };
    }
  };
  const workflow = createRumbleWorkflow(dependencies);
  return { workflow, state, tabs, reports, dependencies, local, switchTo: value => { profile = value; } };
}

const settings = { eventName: 'A event', vertical: 'A sport' };
test('owned sessions resume after worker restart and advance only the current item', async t => {
  const h = setup(t, 2);
  await h.workflow.start(settings);
  const session = h.state[key];
  assert.equal(session.customerId, scope.customerId);
  assert.equal(session.userId, scope.userId);
  assert.ok(session.sessionId);
  const restarted = createRumbleWorkflow(h.dependencies);
  await restarted.validate(url, session.sessionId);
  await assert.rejects(restarted.advance(session.urls[1], 1, session.sessionId));
  assert.equal((await restarted.advance(url, 1, session.sessionId)).done, false);
  await assert.rejects(restarted.advance(url, 1, session.sessionId));
  assert.equal((await restarted.advance(session.urls[1], 2, session.sessionId)).logged, true);
  assert.deepEqual(h.reports, [settings]);
  assert.equal(h.state[key], undefined);
});

for (const changed of [{ customerId: 'customer-b', userId: 'user-a' }, { customerId: 'customer-a', userId: 'user-b' }]) {
  test(`rejects old settings after account change to ${JSON.stringify(changed)}`, async t => {
    const h = setup(t);
    await h.workflow.start(settings);
    const id = h.state[key].sessionId;
    h.switchTo(changed);
    h.state.piracy_cart = [{ ...changed, url }];
    await assert.rejects(h.workflow.validate(url, id), /account changed/);
    await assert.rejects(h.workflow.advance(url, 1, id), /account changed/);
    assert.equal(h.reports.length, 0);
    assert.deepEqual(h.state.piracy_cart, [{ ...changed, url }]);
  });
}

test('logout/cancel and same-account replacement reject already-loaded pages', async t => {
  const h = setup(t);
  await h.workflow.start(settings);
  const id = h.state[key].sessionId;
  await h.workflow.cancel();
  assert.equal(h.state[key], undefined);
  await h.workflow.start({ eventName: 'New event' });
  await assert.rejects(h.workflow.validate(url, id));
  await assert.rejects(h.workflow.advance(url, 1, id));
  await h.workflow.validate(url, h.state[key].sessionId);
  assert.equal(h.reports.length, 0);
});

test('legacy unscoped sessions and unowned queue items fail closed', async t => {
  const h = setup(t);
  h.state[key] = { active: true, urls: [url], currentIndex: 0, formData: settings };
  await assert.rejects(h.workflow.validate(url));
  await assert.rejects(h.workflow.advance(url, 1));
  h.state.piracy_cart = [{ url }];
  await assert.rejects(h.workflow.start(settings));
  assert.equal(h.tabs.length, 0);
  assert.equal(h.reports.length, 0);
});

test('cancel during a pending session write removes the late session and opens no tab', async t => {
  const h = setup(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const originalSet = h.local.set;
  h.local.set = async values => { entered(); await blocked; await originalSet(values); };
  const pending = h.workflow.start(settings);
  await started;
  await h.workflow.cancel();
  release();
  await assert.rejects(pending);
  assert.equal(h.state[key], undefined);
  assert.equal(h.tabs.length, 0);
});

test('concurrent duplicate advance cannot log a completed session twice', async t => {
  const h = setup(t);
  await h.workflow.start(settings);
  const id = h.state[key].sessionId;
  const results = await Promise.allSettled([h.workflow.advance(url, 1, id), h.workflow.advance(url, 1, id)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(h.reports.length, 1);
});

test('real reporting workflow rejects an account switch during its own profile lookup', async t => {
  const h = setup(t);
  const nextProfile = { customerId: 'customer-b', userId: 'user-b' };
  const reporter = createReportingWorkflow({
    getCustomerProfile: async () => nextProfile,
    getCustomerTheme: async () => { assert.fail('Must reject before reading the new customer settings'); }
  });
  const workflow = createRumbleWorkflow({ ...h.dependencies, handleBatchReport: reporter.handleBatchReport });
  await workflow.start(settings);
  const id = h.state[key].sessionId;
  const result = await workflow.advance(url, 1, id);
  assert.equal(result.success, false);
  assert.match(result.error, /account changed/);
  assert.equal(h.state.piracy_cart.length, 1);
});


test('logout during reporting write authorization cannot overwrite a new queue', async t => {
  const h = setup(t);
  let release, entered, reads = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const reporter = createReportingWorkflow({
    getCustomerProfile: async () => {
      // Pause authorization of the first operation-state write. Metadata
      // preparation no longer writes its snapshot back over the live queue.
      if (++reads === 4) { entered(); await blocked; }
      return scope;
    },
    getCustomerTheme: async () => ({}),
    getAuthToken: async () => 'token',
    ensureYearlyReportFolder: async () => 'reports',
    ensureDailyScreenshotFolder: async () => 'screenshots'
  });
  globalThis.chrome.runtime = { sendMessage: async () => {} };
  const workflow = createRumbleWorkflow({ ...h.dependencies, handleBatchReport: reporter.handleBatchReport });
  await workflow.start(settings);
  const pending = workflow.advance(url, 1, h.state[key].sessionId);
  await started;
  await workflow.cancel();
  const newCart = [{ ...scope, url: 'https://rumble.com/new-account-queue.html' }];
  h.state.piracy_cart = newCart;
  release();
  await assert.rejects(pending, /account changed/);
  assert.deepEqual(h.state.piracy_cart, newCart);
});
