import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preferenceSource = await readFile(new URL('../utils/assistant_preference.js', import.meta.url), 'utf8');

function loadPreference(initialState = {}) {
  const state = { ...initialState };
  const context = vm.createContext({
    chrome: {
      storage: {
        sync: {
          async get(keys) {
            return Object.fromEntries(keys.map((key) => [key, state[key]]));
          },
          async set(values) {
            Object.assign(state, values);
          }
        }
      }
    },
    console
  });

  vm.runInContext(preferenceSource, context, { filename: 'assistant_preference.js' });
  return { preference: context.RightsReporterAssistantPreference, state };
}

test('assistant is enabled by default for existing users', async () => {
  const { preference } = loadPreference();

  assert.equal(preference.STORAGE_KEY, 'assistant_enabled');
  assert.equal(await preference.read(), true);
  assert.equal(preference.isEnabled(undefined), true);
});

test('assistant preference persists an explicit per-user opt-out', async () => {
  const { preference, state } = loadPreference({ assistant_enabled: true });

  assert.equal(await preference.write(false), false);
  assert.equal(state.assistant_enabled, false);
  assert.equal(await preference.read(), false);
});

test('assistant preference is loaded before every content-page assistant', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const assistantContentScript = manifest.content_scripts.find((entry) => entry.js.includes('clippy.js'));

  assert.ok(assistantContentScript);
  assert.ok(
    assistantContentScript.js.indexOf('utils/assistant_preference.js') < assistantContentScript.js.indexOf('clippy.js')
  );
});
