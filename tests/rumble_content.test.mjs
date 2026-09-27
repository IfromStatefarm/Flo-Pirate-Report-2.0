import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../content_autofill.js', import.meta.url), 'utf8'))
  .replace('    init();', `
    globalThis.run = runRumbleReportSequence;
    waitForVisibleElement = async () => { globalThis.onWait(); return {}; };
    clickElement = () => globalThis.actions.push('click');
    checkReactCheckbox = () => globalThis.actions.push('check');
    findVisibleElement = () => null;
  `);

function setup(revokeAt = 0, denyAt = 0) {
  let listener, waits = 0, validations = 0;
  const messages = [], actions = [];
  const session = { sessionId: 'session-a', active: true };
  const context = vm.createContext({
    actions, URL, console,
    window: { location: { href: 'https://rumble.com/video.html' } },
    document: { getElementById: () => null, body: { innerText: '' } },
    setInterval() {}, setTimeout(callback) { callback(); },
    onWait() {
      waits += 1;
      if (waits === revokeAt) listener({ rumble_report_session: { oldValue: session } }, 'local');
    },
    chrome: {
      storage: { onChanged: { addListener: value => { listener = value; } } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        messages.push(message);
        if (message.action === 'validateRumbleSession') return { success: ++validations !== denyAt };
        return { success: true, done: false };
      } }
    }
  });
  vm.runInContext(source, context);
  return { run: () => context.run({ rumbleSession: session }), messages, actions };
}

for (const step of [1, 2, 3, 4]) {
  test(`revocation while waiting for Rumble action ${step} stops before that action`, async () => {
    const h = setup(step);
    await assert.rejects(h.run(), /session or account changed/);
    assert.equal(h.actions.length, step - 1);
    assert.equal(h.messages.some(message => message.action === 'advanceRumbleQueue'), false);
  });
}

test('background denial immediately before submit prevents submission even without a storage event', async () => {
  const h = setup(0, 5);
  await assert.rejects(h.run());
  assert.deepEqual(h.actions, ['click', 'click', 'check']);
  assert.equal(h.messages.some(message => message.action === 'advanceRumbleQueue'), false);
});

test('valid Rumble automation validates each action and sends its session ID when advancing', async () => {
  const h = setup();
  await h.run();
  assert.deepEqual(h.actions, ['click', 'click', 'check', 'click']);
  assert.equal(h.messages.filter(message => message.action === 'validateRumbleSession').length, 6);
  assert.equal(h.messages.at(-1).action, 'advanceRumbleQueue');
  assert.equal(h.messages.at(-1).sessionId, 'session-a');
});
