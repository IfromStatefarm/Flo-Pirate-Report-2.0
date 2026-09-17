import assert from 'node:assert/strict';
import test from 'node:test';
import {
  concealProtectedInput,
  readProtectedInput,
  revealProtectedInput,
  setProtectedInputValue
} from '../utils/protected_input.js';

function fakeInput(placeholder = 'Paste ID') {
  const classes = new Set();
  const listeners = new Map();
  return {
    type: 'text',
    value: '',
    placeholder,
    selectionStart: 0,
    selectionEnd: 0,
    dataset: {},
    attributes: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) {
      const eventListeners = listeners.get(name) || [];
      eventListeners.push(listener);
      listeners.set(name, eventListeners);
    },
    dispatch(name, properties = {}) {
      const event = {
        key: '',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...properties
      };
      (listeners.get(name) || []).forEach((listener) => listener(event));
      return event;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
}

test('conceals a saved ID until the field is focused for editing', () => {
  const input = fakeInput();
  setProtectedInputValue(input, 'saved-resource-id', 'Box 1 complete — click to edit');

  assert.equal(input.value, '');
  assert.equal(input.placeholder, 'Box 1 complete — click to edit');
  assert.equal(readProtectedInput(input, null), 'saved-resource-id');
  assert.equal(input.classList.contains('protected-value-complete'), true);

  revealProtectedInput(input);
  assert.equal(input.value, 'saved-resource-id');
  assert.equal(input.type, 'password');
  assert.equal(input.placeholder, 'Paste ID');
  assert.equal(input.attributes['aria-label'], 'Saved value is masked. Type to edit or delete it.');
  assert.equal(input.classList.contains('protected-input-guarded'), true);
});

test('clearing the revealed field resets the protected-value cycle', () => {
  const input = fakeInput();
  setProtectedInputValue(input, 'saved-resource-id', 'Box 2 complete — click to edit');
  revealProtectedInput(input);
  input.value = '';
  concealProtectedInput(input, 'Box 2 complete — click to edit');

  assert.equal(readProtectedInput(input, null), '');
  assert.equal(input.type, 'text');
  assert.equal(input.placeholder, 'Paste ID');
  assert.equal(input.classList.contains('protected-value-complete'), false);
});

test('blocks selection and clipboard extraction while leaving editing available', () => {
  const input = fakeInput();
  setProtectedInputValue(input, 'saved-resource-id', 'Box 3 complete — click to edit');
  revealProtectedInput(input);

  for (const eventName of ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart']) {
    assert.equal(input.dispatch(eventName).defaultPrevented, true, `${eventName} should be blocked`);
  }

  assert.equal(input.dispatch('keydown', { key: 'c', ctrlKey: true }).defaultPrevented, true);
  assert.equal(input.dispatch('keydown', { key: 'C', metaKey: true }).defaultPrevented, true);
  assert.equal(input.dispatch('keydown', { key: 'a', ctrlKey: true }).defaultPrevented, true);
  assert.equal(input.dispatch('keydown', { key: 'ArrowLeft', shiftKey: true }).defaultPrevented, true);
  assert.equal(input.dispatch('keydown', { key: 'Backspace' }).defaultPrevented, false);
  assert.equal(input.dispatch('paste').defaultPrevented, false);

  input.selectionStart = 0;
  input.selectionEnd = 8;
  input.dispatch('select');
  assert.equal(input.selectionStart, 8);
  assert.equal(input.selectionEnd, 8);
});
