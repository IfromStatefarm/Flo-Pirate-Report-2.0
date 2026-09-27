import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportingWorkflow } from '../background/services/reporting_workflow.js';

function setup(t, { platform = 'youtube', count = 11, failure, uploadScreenshots = false, hooks = {} } = {}) {
  const profile = { customerId: 'customer-a', userId: 'user-a', integrations: {} };
  const originalCart = Array.from({ length: count }, (_, index) => ({
    customerId: profile.customerId,
    userId: profile.userId,
    url: platform === 'youtube'
      ? `https://www.youtube.com/watch?v=video${index}`
      : `https://www.instagram.com/p/video${index}/`,
    handle: 'channel',
    views: '100',
    screenshotId: `screenshot-${index}`
  }));
  const state = { piracy_cart: structuredClone(originalCart) };
  const originalChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = originalChrome; });
  globalThis.chrome = {
    runtime: { sendMessage: async message => { hooks.onProgress?.(message); } },
    tabs: {
      get: async () => ({ id: 1, windowId: 1, active: true, url: 'https://example.com' }),
      query: async () => [{ id: 1, url: 'https://example.com' }],
      captureVisibleTab: async () => 'data:image/jpeg;base64,new-image'
    },
    storage: { local: {
      get: async keys => structuredClone(Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map(key => [key, state[key]])
      )),
      set: async values => { await hooks.onWrite?.(values); Object.assign(state, structuredClone(values)); },
      remove: async keys => { (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete state[key]; }); }
    } }
  };
  const generatedUrls = [];
  const generatedReports = [];
  const screenshotUploads = [];
  const finalizedBatches = [];
  const deletedImages = [];
  const images = new Map(originalCart.map(item => [item.screenshotId, item.screenshotId]));
  let failureStage = failure;
  function failAt(stage) {
    if (failureStage === stage) throw new Error(`${stage} failed`);
  }
  const workflow = createReportingWorkflow({
    getCustomerProfile: async () => profile,
    getCustomerTheme: async () => ({}),
    getAuthToken: async () => { await hooks.onAuthentication?.(); failAt('authentication'); return 'token'; },
    ensureYearlyReportFolder: async () => { failAt('folder'); return 'reports'; },
    ensureDailyScreenshotFolder: async () => 'screenshots',
    generatePDF: async report => {
      failAt('pdf');
      generatedReports.push(structuredClone(report));
      generatedUrls.push(report.items.map(item => item.url));
      return new Blob(['report']);
    },
    getImage: async id => {
      failAt('image-read');
      return failureStage === 'missing-image' ? undefined : images.get(id);
    },
    base64ToBlob: data => { failAt('image-conversion'); return new Blob([data]); },
    uploadToDrive: async (token, folder, name, blob, mimeType) => {
      failAt('upload');
      if (mimeType === 'image/jpeg') {
        screenshotUploads.push(name);
        if (name.includes('_Evidence_2_')) failAt('screenshot-upload');
        if (failureStage === 'missing-link') return {};
        if (failureStage === 'invalid-link') return { webViewLink: 'not-a-url' };
      }
      return { webViewLink: `https://drive.google.com/${name}` };
    },
    finalizeReportBatch: async (scope, batchId, reports) => {
      await hooks.onFinalization?.();
      failAt('finalization');
      finalizedBatches.push(structuredClone(reports));
      return { reports, streak: { streakCount: 1, lastReportDate: '2026-09-25', freezes: 0 } };
    },
    deleteImages: async (ids, scope) => {
      assert.deepEqual(scope, profile);
      deletedImages.push(...ids);
      ids.forEach(id => images.delete(id));
    },
    saveImage: async (id, image) => { images.set(id, image); await hooks.onImageSaved?.(id); },
    getUserEmail: async () => 'scout@example.com',
    checkIfAuthorized: async () => false,
    recordCustomerEvent: async () => {}
  });
  return {
    state, originalCart, generatedUrls, generatedReports, screenshotUploads, finalizedBatches,
    profile, workflow, deletedImages, images,
    add: (data, method = 'handleAddVideo') => workflow[method]({ id: 1, windowId: 1, url: 'https://example.com' }, data),
    retry: () => { failureStage = undefined; },
    run: () => workflow.handleBatchReport({ eventName: 'Event', vertical: 'Sport', uploadScreenshots })
  };
}

for (const failure of ['authentication', 'folder', 'pdf', 'upload', 'finalization']) {
  test(`YouTube retains all 11 queued items after ${failure} failure`, async t => {
    const fixture = setup(t, { failure });
    assert.deepEqual(await fixture.run(), { success: false, error: `${failure} failed` });
    assert.deepEqual(fixture.state.piracy_cart, fixture.originalCart);
    assert.deepEqual(fixture.deletedImages, []);
  });
}

test('retry after authentication failure reports ten YouTube items and preserves the eleventh', async t => {
  const fixture = setup(t, { failure: 'authentication' });
  assert.equal((await fixture.run()).success, false);
  fixture.retry();
  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.generatedUrls, [fixture.originalCart.slice(0, 10).map(item => item.url)]);
  assert.deepEqual(fixture.state.piracy_cart, fixture.originalCart.slice(10));
  assert.deepEqual(fixture.deletedImages, fixture.originalCart.slice(0, 10).map(item => item.screenshotId));

  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.generatedUrls[1], [fixture.originalCart[10].url]);
  assert.equal(fixture.state.piracy_cart, undefined);
  assert.equal(fixture.state.report_operation_v1, undefined);
  assert.deepEqual(fixture.deletedImages, fixture.originalCart.map(item => item.screenshotId));
});

test('Instagram also preserves overflow items after authentication failure', async t => {
  const fixture = setup(t, { platform: 'instagram', count: 31, failure: 'authentication' });
  assert.equal((await fixture.run()).success, false);
  assert.deepEqual(fixture.state.piracy_cart, fixture.originalCart);
});

for (const failure of ['screenshot-upload', 'image-read', 'missing-image', 'image-conversion', 'missing-link', 'invalid-link']) {
  test(`required evidence ${failure} failure retains the queue and screenshots without finalizing`, async t => {
    const fixture = setup(t, { count: 2, uploadScreenshots: true, failure });
    const result = await fixture.run();
    assert.equal(result.success, false);
    assert.match(result.error, /Screenshot upload failed.*queue and local screenshots have been kept/);
    assert.deepEqual(fixture.state.piracy_cart, fixture.originalCart);
    assert.deepEqual(fixture.deletedImages, []);
    assert.equal(fixture.generatedReports.length, 0);
    assert.equal(fixture.finalizedBatches.length, 0);
    const operation = Object.values(fixture.state.report_operation_v1.groups)[0];
    assert.equal(operation.evidenceLinks, undefined);
    assert.equal(operation.submission, undefined);
  });
}

test('retry after a partial screenshot upload failure includes all evidence before cleanup', async t => {
  const fixture = setup(t, { count: 2, uploadScreenshots: true, failure: 'screenshot-upload' });
  assert.equal((await fixture.run()).success, false);
  const operation = Object.values(fixture.state.report_operation_v1.groups)[0];
  fixture.retry();
  assert.equal((await fixture.run()).success, true);
  assert.equal(fixture.generatedReports[0].reportId, operation.reportId);
  assert.equal(fixture.generatedReports[0].dataScope.eventId, operation.eventId);
  assert.ok(fixture.generatedReports[0].items.every(item => item.screenshotLink.startsWith('https://')));
  assert.deepEqual(fixture.screenshotUploads.slice(0, 2), fixture.screenshotUploads.slice(2));
  assert.equal(fixture.finalizedBatches.length, 1);
  assert.equal(fixture.state.piracy_cart, undefined);
  assert.deepEqual(fixture.deletedImages, fixture.originalCart.map(item => item.screenshotId));
});

test('retry repairs a legacy cached submission that omitted required screenshots', async t => {
  const fixture = setup(t, { count: 2, uploadScreenshots: true, failure: 'finalization' });
  assert.equal((await fixture.run()).success, false);
  const operation = Object.values(fixture.state.report_operation_v1.groups)[0];
  operation.evidenceLinks[1].screenshotLink = '';
  fixture.retry();
  assert.equal((await fixture.run()).success, true);
  assert.notEqual(fixture.generatedReports[1].reportId, operation.reportId);
  assert.notEqual(fixture.generatedReports[1].dataScope.eventId, operation.eventId);
  assert.ok(fixture.generatedReports[1].items.every(item => item.screenshotLink.startsWith('https://')));
  assert.equal(fixture.finalizedBatches.length, 1);
});

test('retry reuses a complete cached submission after finalization fails', async t => {
  const fixture = setup(t, { count: 2, uploadScreenshots: true, failure: 'finalization' });
  assert.equal((await fixture.run()).success, false);
  fixture.retry();
  assert.equal((await fixture.run()).success, true);
  assert.equal(fixture.generatedReports.length, 1);
  assert.equal(fixture.screenshotUploads.length, 2);
});

test('items captured without a screenshot can still be reported', async t => {
  const fixture = setup(t, { count: 1, uploadScreenshots: true });
  fixture.state.piracy_cart[0].screenshotId = null;
  assert.equal((await fixture.run()).success, true);
  assert.equal(fixture.generatedReports[0].items[0].screenshotLink, '');
  assert.equal(fixture.screenshotUploads.length, 0);
});

for (const count of [1, 11]) {
  for (const method of ['handleAddVideo', 'handleProcessNewItem']) {
    test(`successful batch preserves concurrent ${method} capture with ${count} initial items`, async t => {
      const hooks = {};
      const fixture = setup(t, { count, uploadScreenshots: true, hooks });
      let added;
      hooks.onFinalization = async () => {
        assert.equal((await fixture.add({ url: 'https://www.youtube.com/watch?v=new', handle: 'new' }, method)).success, true);
        added = structuredClone(fixture.state.piracy_cart.at(-1));
      };
      assert.equal((await fixture.run()).success, true);
      assert.deepEqual(fixture.state.piracy_cart, [...fixture.originalCart.slice(10), added]);
      assert.ok(fixture.images.has(added.screenshotId));
      assert.deepEqual(fixture.deletedImages, fixture.originalCart.slice(0, 10).map(item => item.screenshotId));
      assert.deepEqual(fixture.generatedUrls, [fixture.originalCart.slice(0, 10).map(item => item.url)]);
    });
  }
}

test('metadata preparation never overwrites captures added after the snapshot', async t => {
  const hooks = {};
  const fixture = setup(t, { count: 1, hooks });
  const added = { ...fixture.originalCart[0], url: 'https://www.youtube.com/watch?v=new', screenshotId: 'new-image' };
  hooks.onProgress = message => {
    if (message.status === 'Verifying view counts...') {
      fixture.state.piracy_cart.push(added);
      fixture.images.set(added.screenshotId, 'image');
    }
  };
  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.state.piracy_cart, [added]);
  assert.ok(fixture.images.has(added.screenshotId));
});

test('a removed and recaptured URL survives acceptance of its earlier capture', async t => {
  const hooks = {};
  const fixture = setup(t, { count: 1, hooks });
  let replacement;
  hooks.onFinalization = async () => {
    await fixture.workflow.undoCart();
    assert.equal((await fixture.add(fixture.originalCart[0])).success, true);
    replacement = structuredClone(fixture.state.piracy_cart[0]);
  };
  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.state.piracy_cart, [replacement]);
  assert.ok(fixture.images.has(replacement.screenshotId));
  assert.deepEqual(fixture.deletedImages, ['screenshot-0']);
  assert.equal(fixture.state.report_operation_v1, undefined);
});

test('failed finalization keeps both the snapshot and newly added evidence', async t => {
  const hooks = {};
  const fixture = setup(t, { count: 1, failure: 'finalization', hooks });
  hooks.onFinalization = async () => {
    await fixture.add({ url: 'https://www.youtube.com/watch?v=new' });
  };
  assert.equal((await fixture.run()).success, false);
  assert.equal(fixture.state.piracy_cart.length, 2);
  assert.deepEqual(fixture.state.piracy_cart[0], fixture.originalCart[0]);
  assert.ok(fixture.state.piracy_cart.every(item => fixture.images.has(item.screenshotId)));
  assert.deepEqual(fixture.deletedImages, []);
});

test('cleanup preserves other scopes and screenshots still referenced by retained captures', async t => {
  const hooks = {};
  const fixture = setup(t, { count: 1, hooks });
  const retained = [
    { ...fixture.originalCart[0], captureId: 'replacement-capture' },
    { ...fixture.originalCart[0], customerId: 'customer-b' }
  ];
  hooks.onFinalization = async () => {
    fixture.state.piracy_cart.push(...retained);
    fixture.state.report_operation_v1.groups.unrelated = { reportId: 'unrelated' };
  };
  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.state.piracy_cart, retained);
  assert.deepEqual(fixture.deletedImages, []);
  assert.deepEqual(fixture.state.report_operation_v1.groups, { unrelated: { reportId: 'unrelated' } });
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('capture queued during the cleanup write retains its row and already saved screenshot', async t => {
  const cleanupStarted = deferred();
  const releaseCleanup = deferred();
  const imageSaved = deferred();
  const hooks = {
    onWrite: async values => {
      if (values.piracy_cart?.length === 0) {
        cleanupStarted.resolve();
        await releaseCleanup.promise;
      }
    },
    onImageSaved: imageSaved.resolve
  };
  const fixture = setup(t, { count: 1, hooks });
  const reporting = fixture.run();
  await cleanupStarted.promise;
  const capture = fixture.add({ url: 'https://www.youtube.com/watch?v=new' });
  const screenshotId = await imageSaved.promise;
  releaseCleanup.resolve();
  assert.equal((await reporting).success, true);
  assert.equal((await capture).success, true);
  assert.equal(fixture.state.piracy_cart.length, 1);
  assert.equal(fixture.state.piracy_cart[0].screenshotId, screenshotId);
  assert.ok(fixture.images.has(screenshotId));
  assert.deepEqual(fixture.deletedImages, ['screenshot-0']);
});

test('Twitch metadata refresh uses the batch snapshot and preserves captures added while scraping', async t => {
  const fixture = setup(t, { count: 1 });
  fixture.state.piracy_cart[0].url = 'https://www.twitch.tv/videos/123';
  const tabGet = chrome.tabs.get;
  chrome.tabs.create = async () => ({ id: 2 });
  chrome.tabs.get = async id => id === 2 ? { status: 'complete' } : tabGet(id);
  chrome.tabs.remove = async () => {};
  chrome.scripting = { executeScript: async () => [] };
  let added;
  chrome.tabs.sendMessage = async () => {
    assert.equal((await fixture.add({ url: 'https://www.twitch.tv/videos/456' })).success, true);
    added = structuredClone(fixture.state.piracy_cart.at(-1));
    return { success: true, data: { handle: 'refreshed', views: '200', contentType: 'vod' } };
  };
  assert.equal((await fixture.run()).success, true);
  assert.deepEqual(fixture.generatedUrls, [['https://www.twitch.tv/videos/123']]);
  assert.equal(fixture.generatedReports[0].items[0].views, '200');
  assert.deepEqual(fixture.state.piracy_cart, [added]);
  assert.ok(fixture.images.has(added.screenshotId));
});
