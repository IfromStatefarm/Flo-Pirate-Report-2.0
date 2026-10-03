import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

test('real Chrome extension sees MAIN-world approved session and rejects unrelated page accounts', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'enforcer-chrome-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const extension = path.join(temp, 'extension');
  await fs.mkdir(extension);
  await fs.copyFile(new URL('../../utils/enforcer_session.js', import.meta.url), path.join(extension, 'enforcer_session.js'));
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Enforcer regression', version: '1.0', permissions: ['scripting', 'tabs'], host_permissions: ['https://www.youtube.com/*', 'https://www.tiktok.com/*'], background: { service_worker: 'worker.js', type: 'module' } }));
  await fs.writeFile(path.join(extension, 'worker.js'), "import { tabHasApprovedEnforcerSession } from './enforcer_session.js'; globalThis.inspectSession = tabHasApprovedEnforcerSession; chrome.runtime.onInstalled.addListener(() => {});");
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true,
    ...(process.env.CHROME_TEST_EXECUTABLE ? { executablePath: process.env.CHROME_TEST_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  t.after(() => context.close());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  let handle = '@approved';
  let loggedIn = true;
  const channelId = `UC${'aB'.repeat(11)}`;
  let menuChannel = channelId;
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>
    window.ytcfg = { get: key => key === 'LOGGED_IN' ? ${loggedIn} : undefined };
    </script><a href="/@approved" title="@approved">Unrelated approved channel</a>
    <button id="avatar-btn" onclick="document.querySelector('ytd-active-account-header-renderer').hidden=false">Account</button>
    <ytd-active-account-header-renderer><span id="channel-handle">${handle}</span><a href="/channel/${menuChannel}">Your channel</a></ytd-active-account-header-renderer>` }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/*' }))[0].id);
  const isolated = await worker.evaluate(async id => (await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => typeof window.ytcfg }))[0].result, tabId);
  assert.equal(isolated, 'undefined', 'fixture page globals must actually be isolated');
  const inspect = config => worker.evaluate(({ id, config }) => globalThis.inspectSession(id, config), { id: tabId, config });
  const handles = { youtube: { authorizedHandles: ['@approved'] } };
  assert.equal(await inspect(handles), true, 'approved MAIN-world session is recognized');
  assert.equal(await inspect({ youtube: { authorizedChannelIds: [channelId] } }), true);
  assert.equal(await inspect({ youtube: { authorizedChannelIds: [channelId.toLowerCase()] } }), false);
  handle = '@approved-impostor'; menuChannel = `UC${'z'.repeat(22)}`;
  await page.reload();
  assert.equal(await inspect(handles), false, 'substring and unrelated anchors cannot approve an account');
  handle = '@approved'; loggedIn = false;
  await page.reload();
  assert.equal(await inspect(handles), false, 'signed-out session is denied');
  // Exercise the asynchronous menu-open path too.
  loggedIn = true;
  await page.reload();
  await page.evaluate(() => {
    const header = document.querySelector('ytd-active-account-header-renderer');
    header.remove();
    document.querySelector('#avatar-btn').onclick = () => setTimeout(() => document.body.append(header), 150);
  });
  assert.equal(await inspect(handles), true);
  await context.route('https://www.tiktok.com/**', route => route.fulfill({ contentType: 'text/html',
    body: `<a data-e2e="nav-profile" href="/${handle}">Profile</a><a href="/@approved">Other account</a>` }));
  const tiktok = { tiktok: { authorizedHandles: ['@approved'] } };
  await page.goto('https://www.tiktok.com/');
  assert.equal(await inspect(tiktok), true);
  handle = '@approved-impostor';
  await page.reload();
  assert.equal(await inspect(tiktok), false);
});
