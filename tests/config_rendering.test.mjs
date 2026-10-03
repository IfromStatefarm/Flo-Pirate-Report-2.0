import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateGoogleCommand } from '../server/integrations/google_command_policy.js';

const customerConfig = JSON.parse(await readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const actor = { role: 'admin', platforms: ['youtube'], customerConfig };
const command = (verticals) => ({
  name: 'updateConfigSections', args: [{ verticals }], requestId: 'config-1'
});

test('configuration command validates nested vertical and event shapes and lengths', () => {
  const verticalName = 'Sports <a href="https://example.test">open</a>';
  const eventName = 'Final <form><input name="spoof"></form>';
  assert.doesNotThrow(() => validateGoogleCommand(actor, command([
    { name: verticalName, events: [{ eventName, double_xp: true }] }
  ])));

  for (const verticals of [
    null,
    [null],
    [{ name: 'Sports', events: {} }],
    [{ name: '', events: [] }],
    [{ name: 'x'.repeat(161), events: [] }],
    [{ name: 'Sports', events: [null] }],
    [{ name: 'Sports', events: [{}] }],
    [{ name: 'Sports', events: [{ eventName: 7 }] }],
    [{ name: 'Sports', events: [{ name: 'x'.repeat(241) }] }],
    [{ name: 'Sports', events: [{ name: 'Final', double_xp: 'true' }] }],
    Array.from({ length: 201 }, (_, index) => ({ name: `Sport ${index}`, events: [] }))
  ]) {
    assert.throws(() => validateGoogleCommand(actor, command(verticals)), { code: 'invalid_operation' });
  }
});

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this._text = '';
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map(child => child.textContent).join('');
  }
  set innerHTML(_) {
    throw new Error('HTML parsing is forbidden in the bounty renderer');
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) {
    this._text = '';
    this.children = children;
  }
  addEventListener(type, listener) {
    assert.equal(type, 'click');
    this.click = listener;
  }
}

test('side-panel bounty click renders hostile stored names only as text', async () => {
  const source = await readFile(new URL('../sidepanel/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('// --- BOUNTY EVENTS (DOUBLE XP) TOGGLE ---');
  const end = source.indexOf('// --- TOGGLE CLOSER SCANNER LOGIC ---', start);
  assert.ok(start >= 0 && end > start);

  const button = new FakeNode('button');
  const container = new FakeNode('div');
  const list = new FakeNode('ul');
  const nodes = { bountyBtn: button, 'bounty-list-container': container, 'bounty-list': list };
  const document = {
    getElementById: id => nodes[id],
    createElement: tag => new FakeNode(tag),
    createTextNode: value => {
      const node = new FakeNode('#text');
      node.textContent = value;
      return node;
    }
  };
  const verticalName = 'Sports <a href="https://example.test">open</a>';
  const eventName = 'Final <form><input name="spoof"></form>';
  const fallbackName = 'Replay <button>approve</button>';
  const context = { document, configData: {
    verticals: [{ name: verticalName, events: [
      { eventName, double_xp: true },
      { name: fallbackName, double_xp: true }
    ] }]
  } };
  vm.runInNewContext(source.slice(start, end), context);

  button.click();
  assert.equal(container.style.display, 'block');
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].tagName, 'li');
  assert.equal(list.children[0].children[0].tagName, 'strong');
  assert.equal(list.children[0].children[0].textContent, `${verticalName}:`);
  assert.equal(list.children[0].children[1].tagName, '#text');
  assert.equal(list.children[0].children[1].textContent, ` ${eventName}`);
  assert.equal(list.children[1].children[1].textContent, ` ${fallbackName}`);
  assert.equal(list.textContent, `${verticalName}: ${eventName}${verticalName}: ${fallbackName}`);
});
