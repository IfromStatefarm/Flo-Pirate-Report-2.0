import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteImages } from '../utils/idb_storage.js';
import { imageStorageKey } from '../utils/evidence_scope.js';

test('selective screenshot deletion is scoped and waits for transaction completion', async t => {
  const profile = { customerId: 'customer-a', userId: 'user-a' };
  const otherProfile = { customerId: 'customer-b', userId: 'user-a' };
  const records = new Map([
    [imageStorageKey('reported', profile), 'reported image'],
    [imageStorageKey('new', profile), 'new image'],
    [imageStorageKey('reported', otherProfile), 'other account image']
  ]);
  let transaction;
  let closed = false;
  const opened = Promise.withResolvers();
  const db = {
    transaction: () => {
      transaction = { objectStore: () => ({ delete: key => records.delete(key) }) };
      opened.resolve();
      return transaction;
    },
    close: () => { closed = true; }
  };
  const original = globalThis.indexedDB;
  t.after(() => { globalThis.indexedDB = original; });
  globalThis.indexedDB = {
    open: () => {
      const request = {};
      queueMicrotask(() => request.onsuccess({ target: { result: db } }));
      return request;
    }
  };
  let completed = false;
  const deletion = deleteImages(['reported', 'reported', null], profile).then(() => { completed = true; });
  await opened.promise;
  assert.equal(completed, false);
  assert.equal(closed, false);
  transaction.oncomplete();
  await deletion;
  assert.equal(closed, true);
  assert.deepEqual([...records.values()], ['new image', 'other account image']);
});

test('selective screenshot deletion requires an account scope', async () => {
  await assert.rejects(deleteImages(['reported'], null), /verified evidence scope/);
});
