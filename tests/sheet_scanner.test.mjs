import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSheetScanner } from '../services/sheet_scanner.js';

const platforms = [
  { key: 'youtube', url: 'https://www.youtube.com/watch?v=test-video', live: 'ytd-watch-metadata', phrase: 'Video unavailable' },
  { key: 'tiktok', url: 'https://www.tiktok.com/@artist/video/123', live: '[data-e2e="video-views"]', phrase: 'Video not found' },
  { key: 'twitter', url: 'https://x.com/artist/status/123', live: 'article[data-testid="tweet"]', phrase: 'This post has been deleted' },
  { key: 'instagram', url: 'https://www.instagram.com/p/test/', live: 'article', phrase: "Sorry, this page isn't available" },
  { key: 'facebook', url: 'https://www.facebook.com/artist/posts/123', live: '[role="article"]', phrase: "This content isn't available" },
  { key: 'rumble', url: 'https://rumble.com/v123-test.html', live: 'video', phrase: 'This video is unavailable' },
  { key: 'discord', url: 'https://discord.com/channels/1/2/3', live: '[id^="chat-messages-"]', phrase: 'Message deleted' },
  { key: 'twitch', url: 'https://www.twitch.tv/videos/123', live: 'video', phrase: 'Video not found' },
  { key: 'kick', url: 'https://kick.com/artist/videos/123', live: 'video', phrase: 'Video not found' }
];

async function scan(t, { platform = platforms[0], body = '', title = 'Video', live = true,
  error = '', errorSelector = '', delayedBody, delayedError, rowStatus = 'Open',
  cellStrikethrough = false, extraUnknownUrl = '' } = {}) {
  const { url } = platform;
  let checkingExtra = false;
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
      create: async ({ url: requestedUrl }) => {
        checkingExtra = requestedUrl === extraUnknownUrl;
        return { id: 1 };
      },
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
            title: checkingExtra ? 'Sign in to continue' : title,
            body: { get innerText() { return checkingExtra ? 'This content is private' : body; } },
            querySelector: selector => !checkingExtra && live && selector === platform.live
              ? {} : !checkingExtra && error && selector === errorSelector ? { innerText: error } : null,
            querySelectorAll: selectors => !checkingExtra && error && selectors.split(',').map(s => s.trim()).includes(errorSelector)
              ? [{ innerText: error }] : []
          },
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
    getColumnHDataWithFormatting: async () => [{ text: extraUnknownUrl ? `${url} ${extraUnknownUrl}` : url,
      status: rowStatus, cellStrikethrough }],
    getCustomerProfile: async () => profile,
    updateRowStatus: async (...args) => { statusWrites.push(args); },
    updateCellWithRichText: async (...args) => { formattingWrites.push(args); },
    addEnforcerBonusPoints: async (...args) => { rewards.push(args); },
    recordCustomerEvent: async (_profile, type, data) => { events.push({ type, ...data }); }
  });
  const result = await scanner.run();
  assert.equal(result.success, true);
  assert.deepEqual(removedTabs, extraUnknownUrl ? [1, 1] : [1]);
  return { result, statusWrites, formattingWrites, rewards, events };
}

function assertNoResolutionWrites(h) {
  assert.equal(h.result.resolvedCount, 0);
  assert.deepEqual(h.formattingWrites, []);
  assert.deepEqual(h.rewards, []);
  assert.equal(h.statusWrites.some(([, status]) => status === 'Resolved'), false);
  assert.equal(h.events.some(event => event.new_status === 'Resolved' || event.enforcer_points > 0), false);
}

function assertActive(h) {
  assertNoResolutionWrites(h);
  assert.equal(h.result.activeCount, 1);
  assert.equal(h.result.unknownCount, 0);
  assert.equal(h.statusWrites[0][1], 'Investigating');
  assert.equal(h.events.find(event => event.type === 'automation.platform_outcome').outcome, 'active');
}

function assertUnknown(h) {
  assertNoResolutionWrites(h);
  assert.equal(h.result.activeCount, 0);
  assert.equal(h.result.unknownCount, 1);
  assert.deepEqual(h.statusWrites, []);
  assert.equal(h.events.find(event => event.type === 'automation.platform_outcome').outcome, 'unknown');
}

for (const platform of platforms) {
  test(`${platform.key}: playable post ignores hostile description/comment and title`, async t => {
    const h = await scan(t, {
      platform,
      body: `Viewer comment: ${platform.phrase}. Page not found. Message deleted.`,
      title: `404 - ${platform.phrase}`
    });
    assertActive(h);
  });
  test(`${platform.key}: body and title alone leave availability unknown`, async t => {
    const h = await scan(t, {
      platform, live: false, body: platform.phrase, title: `404 - ${platform.phrase}`
    });
    assertUnknown(h);
  });
  test(`${platform.key}: private or inaccessible page cannot earn credit`, async t => {
    const h = await scan(t, {
      platform, live: false, body: 'This content is private. Sign in to continue.',
      title: 'Login required'
    });
    assertUnknown(h);
  });
}

test('TikTok playable video wins over a removal marker and hostile comment', async t => {
  assertActive(await scan(t, { platform: platforms[1], body: 'video not found',
    errorSelector: '[data-e2e="video-removed"]', error: 'Video removed' }));
});

test('TikTok removed component resolves, strikes the URL, and requests reward', async t => {
  const h = await scan(t, { platform: platforms[1], live: false,
    errorSelector: '[data-e2e="video-removed"]', error: 'Video removed' });
  assert.equal(h.result.resolvedCount, 1);
  assert.equal(h.result.activeCount, 0);
  assert.equal(h.statusWrites[0][1], 'Resolved');
  assert.equal(h.formattingWrites.length, 1);
  assert.equal(h.rewards.length, 1);
});

test('a removed link beside an unknown link cannot resolve or reward the row', async t => {
  const h = await scan(t, { platform: platforms[1], live: false,
    errorSelector: '[data-e2e="video-removed"]', error: 'Video removed',
    extraUnknownUrl: platforms[2].url });
  assert.equal(h.result.resolvedCount, 1);
  assert.equal(h.result.unknownCount, 1);
  assert.equal(h.formattingWrites.length, 1);
  assert.deepEqual(h.statusWrites, []);
  assert.deepEqual(h.rewards, []);
  assert.equal(h.events.some(event => event.new_status === 'Resolved'), false);
});

for (const [platform, errorSelector, error] of [
  [platforms[2], '[data-testid="tweetUnavailable"]', 'This post has been deleted'],
  [platforms[3], '[data-testid="post-removed"]', 'This post has been removed'],
  [platforms[4], '[data-testid="post-removed"]', 'This post has been removed'],
  [platforms[5], '[data-testid="video-removed"]', 'This video has been removed'],
  [platforms[6], '[data-testid="message-deleted"]', 'This message was deleted']
]) {
  test(`${platform.key}: dedicated deleted component resolves`, async t => {
    const h = await scan(t, { platform, live: false, errorSelector, error });
    assert.equal(h.result.resolvedCount, 1);
    assert.equal(h.statusWrites[0][1], 'Resolved');
    assert.equal(h.formattingWrites.length, 1);
    assert.equal(h.rewards.length, 1);
  });
  test(`${platform.key}: dedicated component on live post cannot resolve`, async t => {
    assertActive(await scan(t, { platform, errorSelector, error }));
  });
}

for (const error of ['This video has been removed', 'This account has been terminated',
  'This video is no longer available due to a copyright claim']) {
  test(`YouTube player removal notice resolves: ${error}`, async t => {
    const h = await scan(t, { live: false, errorSelector: 'yt-player-error-message-renderer', error });
    assert.equal(h.result.resolvedCount, 1);
    assert.equal(h.statusWrites[0][1], 'Resolved');
    assert.equal(h.formattingWrites.length, 1);
    assert.equal(h.rewards.length, 1);
  });
}

for (const error of ['Video unavailable', 'This video is private', 'An error occurred. Please try again later.']) {
  test(`YouTube ambiguous player notice cannot resolve: ${error}`, async t => {
    assertUnknown(await scan(t, { live: false, errorSelector: 'yt-player-error-message-renderer', error }));
  });
}

test('YouTube delayed player removal notice is detected', async t => {
  const h = await scan(t, { delayedError: 'This video has been removed',
    errorSelector: 'yt-player-error-message-renderer' });
  assert.equal(h.result.resolvedCount, 1);
  assert.equal(h.statusWrites[0][1], 'Resolved');
});

test('YouTube delayed description mention stays active', async t => {
  assertActive(await scan(t, { delayedBody: 'This video has been removed' }));
});

test('a previously Resolved row is not rewarded from its saved status or body text', async t => {
  const h = await scan(t, { platform: platforms[1], rowStatus: 'Resolved', live: false,
    body: 'Video not found', title: '404 - Video not found' });
  assert.deepEqual(h.statusWrites, []);
  assert.deepEqual(h.formattingWrites, []);
  assert.deepEqual(h.rewards, []);
});

test('a previously struck URL is rechecked before resolving the row', async t => {
  const h = await scan(t, { platform: platforms[1], cellStrikethrough: true,
    body: 'Video not found' });
  assertNoResolutionWrites(h);
});
