import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { defineConfig } from '@neon/config/v1';
import { youtubePreflight } from '../server/scripts/youtube_preflight.mjs';

const source = stripTypeScriptTypes(await fs.readFile(new URL('../neon.ts', import.meta.url), 'utf8'))
  .replace(/import[^;]+;/, '').replace('export default', 'globalThis.config =');

test('declared data function forwards the server-only YouTube credential and validates with Neon', () => {
  for (const apiKey of ['fixture-server-key', undefined]) {
    const env = { CUSTOMER_DATABASE_URL: 'fixture-db', GOOGLE_OAUTH_CLIENT_ID: 'fixture-client', ALLOWED_EXTENSION_IDS: 'fixture-extension', ALLOWED_EXTENSION_ORIGINS: 'fixture-origin', ...(apiKey ? { YOUTUBE_DATA_API_KEY: apiKey } : {}) };
    // Validate the entire declaration so unrelated invalid slugs cannot block
    // deploying the customer API and its YouTube credential.
    const context = vm.createContext({ process: { env }, defineConfig: value => value });
    vm.runInContext(source, context);
    const functions = context.config.preview.functions;
    assert.equal(functions.data.env.YOUTUBE_DATA_API_KEY, apiKey);
    if (!apiKey) assert.equal(Object.hasOwn(functions.data.env, 'YOUTUBE_DATA_API_KEY'), false);
    assert.equal(functions.data.source, 'api/v1/extension/data.js');
    defineConfig(JSON.parse(JSON.stringify(context.config)));
    for (const [name, config] of Object.entries(functions)) {
      if (name !== 'data') assert.equal(config.env?.YOUTUBE_DATA_API_KEY, undefined);
    }
  }
});

const owner = `UC${'aB'.repeat(11)}`;
const options = { apiKey: 'fixture-server-key', videoUrl: 'https://youtu.be/abcdefghijk', channelId: owner, whitelist: [{ originalAccount: '@reviewed', channelId: owner }] };
const fetchImpl = async value => {
  const url = new URL(value);
  assert.equal(url.searchParams.get('key'), options.apiKey);
  return Response.json({ items: [url.pathname.endsWith('/videos') ? { id: 'abcdefghijk', snippet: { channelId: owner } } : { id: owner }] });
};
test('staging preflight verifies video ownership and stable whitelist conversion without writes', async () => {
  assert.deepEqual(await youtubePreflight({ ...options, fetchImpl }), { ownerLookup: 'passed', verifiedWhitelistEntries: 1 });
});
test('staging preflight rejects missing credentials, unconverted handles and mismatched owners', async () => {
  await assert.rejects(youtubePreflight({ ...options, apiKey: '', fetchImpl }), /YOUTUBE_DATA_API_KEY/);
  await assert.rejects(youtubePreflight({ ...options, whitelist: [{ originalAccount: '@reviewed', channelId: '@reviewed' }], fetchImpl }), { code: 'authorized_accounts_unverified' });
  await assert.rejects(youtubePreflight({ ...options, channelId: `UC${'z'.repeat(22)}`, fetchImpl }), /video owner differs/);
  await assert.rejects(youtubePreflight({ ...options, whitelist: [{ originalAccount: '@reviewed', channelId: `UC${'z'.repeat(22)}` }], fetchImpl }), /verified|mismatch/);
});
