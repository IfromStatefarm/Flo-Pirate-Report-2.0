function normalized(value) {
  return String(value || '').trim();
}

function rememberOriginalPlaceholder(input) {
  if (!input?.dataset) return;
  if (!Object.prototype.hasOwnProperty.call(input.dataset, 'protectedOriginalPlaceholder')) {
    input.dataset.protectedOriginalPlaceholder = String(input.placeholder || '');
  }
  if (!Object.prototype.hasOwnProperty.call(input.dataset, 'protectedOriginalType')) {
    input.dataset.protectedOriginalType = String(input.type || 'text');
  }
}

const BLOCKED_CLIPBOARD_SHORTCUTS = new Set(['a', 'c', 'x']);
const BLOCKED_SELECTION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
]);

function preventDefault(event) {
  event.preventDefault();
}

function collapseSelection(input) {
  const caret = Number.isInteger(input.selectionEnd)
    ? input.selectionEnd
    : String(input.value || '').length;
  input.setSelectionRange?.(caret, caret);
}

function guardProtectedInput(input) {
  if (!input?.addEventListener || input.dataset?.protectedInteractionGuarded === 'true') return;
  input.dataset.protectedInteractionGuarded = 'true';
  input.classList?.add('protected-input-guarded');
  input.setAttribute?.('draggable', 'false');

  ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'].forEach((eventName) => {
    input.addEventListener(eventName, preventDefault);
  });

  input.addEventListener('select', () => collapseSelection(input));
  input.addEventListener('keydown', (event) => {
    const key = String(event.key || '');
    const shortcutKey = key.toLowerCase();
    const isClipboardOrSelectAll = (event.ctrlKey || event.metaKey)
      && BLOCKED_CLIPBOARD_SHORTCUTS.has(shortcutKey);
    const isKeyboardSelection = event.shiftKey && BLOCKED_SELECTION_KEYS.has(key);

    if (isClipboardOrSelectAll || isKeyboardSelection) {
      event.preventDefault();
      collapseSelection(input);
    }
  });
}

export function readProtectedInput(input, activeElement = globalThis.document?.activeElement) {
  if (!input) return '';
  if (activeElement === input || normalized(input.value)) return normalized(input.value);
  return normalized(input.dataset?.protectedValue);
}

export function revealProtectedInput(input) {
  if (!input) return;
  rememberOriginalPlaceholder(input);
  guardProtectedInput(input);
  input.type = 'password';
  input.value = normalized(input.dataset?.protectedValue);
  input.placeholder = input.dataset?.protectedOriginalPlaceholder || '';
  input.classList?.remove('protected-value-complete');
  input.setAttribute?.('aria-label', 'Saved value is masked. Type to edit or delete it.');
}

export function concealProtectedInput(input, completePlaceholder = 'Completed — click to edit') {
  if (!input) return '';
  rememberOriginalPlaceholder(input);
  guardProtectedInput(input);
  const value = normalized(input.value);
  input.dataset.protectedValue = value;
  input.type = input.dataset?.protectedOriginalType || 'text';
  input.value = '';
  input.placeholder = value
    ? completePlaceholder
    : (input.dataset?.protectedOriginalPlaceholder || '');
  input.classList?.toggle('protected-value-complete', Boolean(value));
  input.setAttribute?.('aria-label', value ? `${completePlaceholder}. Click to edit.` : input.placeholder);
  return value;
}

export function setProtectedInputValue(input, value, completePlaceholder) {
  if (!input) return;
  rememberOriginalPlaceholder(input);
  input.value = normalized(value);
  concealProtectedInput(input, completePlaceholder);
}
