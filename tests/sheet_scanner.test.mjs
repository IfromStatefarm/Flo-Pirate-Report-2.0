import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSheetScanner } from '../services/sheet_scanner.js';

const removalMessages = [
  'Video unavailable',
  'This video has been removed',
  'This video is private',
  'This video is no longer available',
  'This account has been terminated',
  'This video is no longer available due to a copyright claim'
];

async function scan(t, { body = '', title = 'Video - YouTube', error = '', delayedBody,
  delayedError, metadata = true, errorSelector = 'yt-player-error-message-renderer' } = {}) {
  const url = 'https://www.youtube.com/watch?v=test-video';
  const profile = { customerId: 'customer-a', userId: 'user-a', integrations: {} };
  const statusWrites = [], formattingWrites = [], rewards = [], events = [], removedTabs = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    if (delay !== 20000) queueMicrotask(callback);
    return 0;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  t.after(() => {
    if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome);
    else delete globalThis.chrome;
  });
  globalThis.chrome = {
    runtime: {
      connect: () => ({ onDisconnect: { addListener() {} }, postMessage() {} }),
      sendMessage: async () => {}
    },
    storage: { local: { set: async () => {} } },
    tabs: {
      create: async () => ({ id: 1 }),
      remove: async id => { removedTabs.push(id); },
      onUpdated: {
        addListener: listener => queueMicrotask(() => listener(1, { status: 'complete' }, { url })),
        removeListener() {}
      }
    },
    scripting: {
      executeScript: async ({ func, args }) => {
        const context = vm.createContext({
          document: {
            title,
            body: { get innerText() { return body; } },
            querySelector: selector => metadata && selector === 'ytd-watch-metadata' ? {} : null,
            querySelectorAll: selectors => error && selectors.split(', ').includes(errorSelector)
              ? [{ innerText: error }] : []
          },
          window: { location: { href: url } },
          setTimeout(callback, delay) {
            if (delay === 2500) {
              if (delayedBody !== undefined) body = delayedBody;
              if (delayedError !== undefined) error = delayedError;
            }
            queueMicrotask(callback);
          }
        });
        // Chrome serializes this function into an isolated page context.
        return [{ result: await vm.runInContext(`(${func.toString()})(${JSON.stringify(args[0])})`, context) }];
      }
    }
  };
  const scanner = createSheetScanner({
    getColumnHDataWithFormatting: async () => [{ text: url, status: 'Open' }],
    getCustomerProfile: async () => profile,
    updateRowStatus: async (...args) => { statusWrites.push(args); },
    updateCellWithRichText: async (...args) => { formattingWrites.push(args); },
    addEnforcerBonusPoints: async (...args) => { rewards.push(args); },
    recordCustomerEvent: async (_profile, type, data) => { events.push({ type, ...data }); }
  });
  const result = await scanner.run();
  assert.equal(result.success, true);
  assert.equal(result.checkedCount, 1);
  assert.deepEqual(removedTabs, [1]);
  return { result, statusWrites, formattingWrites, rewards, events };
}

function assertActive(h) {
  assert.equal(h.result.resolvedCount, 0);
  assert.equal(h.result.activeCount, 1);
  assert.equal(h.statusWrites[0][1], 'Investigating');
  assert.deepEqual(h.formattingWrites, []);
  assert.deepEqual(h.rewards, []);
  assert.equal(h.events.find(event => event.type === 'automation.platform_outcome').outcome, 'active');
  assert.equal(h.events.some(event => event.new_status === 'Resolved' || event.enforcer_points > 0), false);
}

for (const message of [...removalMessages, 'copyright claim']) {
  for (const delayed of [false, true]) {
    test(`playable video stays active when ${delayed ? 'delayed' : 'initial'} description/comment quotes "${message}"`, async t => {
      const body = `A discussion about: ${message}`;
      assertActive(await scan(t, delayed ? { delayedBody: body } : { body }));
    });
  }
  test(`player removal notice resolves the video: ${message}`, async t => {
    const h = await scan(t, { error: message });
    assert.equal(h.result.resolvedCount, 1);
    assert.equal(h.result.activeCount, 0);
    assert.equal(h.statusWrites[0][1], 'Resolved');
    assert.equal(h.formattingWrites.length, 1);
    assert.equal(h.rewards.length, 1);
  });
}

for (const errorSelector of ['yt-player-error-message-renderer', 'ytd-video-error-message-renderer', '.ytp-error-content-wrap']) {
  test(`delayed removal notice in ${errorSelector} is still detected`, async t => {
    const h = await scan(t, { delayedError: removalMessages[5], errorSelector });
    assert.equal(h.result.resolvedCount, 1);
    assert.equal(h.statusWrites[0][1], 'Resolved');
  });
}

test('a video title mentioning 404 / page not found does not resolve the video', async t => {
  assertActive(await scan(t, { title: '404: Page not found - YouTube' }));
});

test('a transient player error does not establish removal', async t => {
  assertActive(await scan(t, { error: 'An error occurred. Please try again later.' }));
});

test('body text alone cannot establish removal even when metadata never loads', async t => {
  assertActive(await scan(t, { body: removalMessages.join('\n'), metadata: false }));
});
