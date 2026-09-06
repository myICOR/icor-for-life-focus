/* THE OPENS-LOG GATE (Flint's mobile audit, fix 2, v0.5.3).
 *
 * The opens log used to live inside `settings.opens` and get written to
 * data.json on every single `file-open`, debounced 4s. Obsidian Sync
 * replicates data.json to every device, last-write-wins: with two devices
 * open, the iPhone's opens and the Mac's opens silently overwrote each
 * other, so the attention map lost exactly the data it exists to show, and
 * every open dirtied a synced file for nothing.
 *
 * The fix: new opens go to THIS device's own local storage
 * (App.loadLocalStorage / saveLocalStorage, never synced) instead of
 * data.json. The historical `settings.opens` already in data.json is left
 * exactly as it was -- read-only from here on -- and mergeOpens() combines
 * both logs at render time, without mutating either source.
 *
 * Three things this gate has to prove:
 *   1. a file-open updates the device-local log, never settings.opens, and
 *      the debounced save writes ONLY the device log to local storage;
 *   2. onload() reads any existing device log back out of local storage,
 *      and never touches settings.opens for it;
 *   3. mergeOpens() combines the frozen historical log with the device log
 *      for a render without mutating either input, summing a day that
 *      happens to appear on both sides.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeApp } from './harness.mjs';

const { __test, makePlugin } = loadPlugin();
const { mergeOpens, pruneOpensLog, OPENS_STORAGE_KEY } = __test;

/* main.js runs inside a vm context with its own realm: an object literal
   built INSIDE a function main.js defines (e.g. mergeOpens's `const out =
   {}`) carries that realm's Object.prototype even when built from
   outer-realm inputs, so a strict deepEqual against a plain literal here
   fails on prototype identity alone with matching data ("same structure but
   not reference-equal") -- the same trap Sync's gates hit with vm-realm
   arrays. JSON round-tripping strips the foreign prototype. */
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------- pure functions -- */

test('mergeOpens: a path/day on only one side survives untouched', () => {
  const historical = { 'a.md': { '2026-09-01': 2 } };
  const device = { 'b.md': { '2026-09-05': 1 } };
  const out = mergeOpens(historical, device);
  assert.deepEqual(plain(out), { 'a.md': { '2026-09-01': 2 }, 'b.md': { '2026-09-05': 1 } });
});

test('mergeOpens: the same path/day on both sides sums, it does not pick a winner', () => {
  const historical = { 'a.md': { '2026-09-06': 3 } };
  const device = { 'a.md': { '2026-09-06': 2 } };
  assert.deepEqual(plain(mergeOpens(historical, device)), { 'a.md': { '2026-09-06': 5 } });
});

test('mergeOpens: neither input is mutated', () => {
  const historical = { 'a.md': { '2026-09-01': 1 } };
  const device = { 'a.md': { '2026-09-01': 1 } };
  const historicalCopy = JSON.parse(JSON.stringify(historical));
  const deviceCopy = JSON.parse(JSON.stringify(device));
  mergeOpens(historical, device);
  assert.deepEqual(historical, historicalCopy);
  assert.deepEqual(device, deviceCopy);
});

test('mergeOpens: missing or empty sides are handled', () => {
  assert.deepEqual(plain(mergeOpens(undefined, { 'a.md': { '2026-09-01': 1 } })), { 'a.md': { '2026-09-01': 1 } });
  assert.deepEqual(plain(mergeOpens({ 'a.md': { '2026-09-01': 1 } }, undefined)), { 'a.md': { '2026-09-01': 1 } });
  assert.deepEqual(plain(mergeOpens({}, {})), {});
});

test('pruneOpensLog: drops a day older than 35 days and an emptied path entirely', () => {
  const now = new Date(2026, 8, 6); // 2026-09-06
  const log = {
    'a.md': { '2026-09-05': 1, '2026-07-01': 2 }, // 2026-07-01 is well past 35 days
    'b.md': { '2026-07-01': 1 }, // only a stale day -- the whole path should go
  };
  pruneOpensLog(log, now);
  assert.deepEqual(log, { 'a.md': { '2026-09-05': 1 } });
});

/* --------------------------------------------------- plugin integration -- */

test('onload(): the device opens log loads from local storage, never from settings.opens', async () => {
  const app = makeApp({
    localStorageSeed: { [OPENS_STORAGE_KEY]: { 'device-only.md': { '2026-09-06': 4 } } },
  });
  const plugin = makePlugin(app, { opens: { 'historical.md': { '2026-09-01': 9 } } });
  await plugin.onload();

  assert.deepEqual(plain(plugin.deviceOpens), { 'device-only.md': { '2026-09-06': 4 } });
  assert.deepEqual(plain(plugin.settings.opens), { 'historical.md': { '2026-09-01': 9 } }, 'the historical log must be left exactly as loaded');
});

test('onload(): with nothing in local storage yet, deviceOpens starts empty, not seeded from settings.opens', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, { opens: { 'historical.md': { '2026-09-01': 9 } } });
  await plugin.onload();

  assert.deepEqual(plain(plugin.deviceOpens), {});
});

test('a file-open updates deviceOpens and never settings.opens', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, { opens: {} });
  await plugin.onload();

  app.workspace._emit('file-open', { path: 'Notes/today.md', extension: 'md' });

  assert.equal(Object.keys(plugin.deviceOpens).length, 1, 'file-open did not touch deviceOpens at all');
  assert.ok(plugin.deviceOpens['Notes/today.md'], 'the opened path is missing from deviceOpens');
  assert.deepEqual(plain(plugin.settings.opens), {}, 'settings.opens (data.json) was written by a file-open -- the whole point of this fix is that it must not be');
});

test('a file-open on a non-markdown file, or with no file, is ignored (matches the pre-fix guard)', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, { opens: {} });
  await plugin.onload();

  app.workspace._emit('file-open', null);
  app.workspace._emit('file-open', { path: 'attachment.png', extension: 'png' });

  assert.deepEqual(plain(plugin.deviceOpens), {});
});

test('two opens on the same day on the same path count up, exactly like the pre-fix settings.opens behavior did', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, { opens: {} });
  await plugin.onload();

  const file = { path: 'Notes/today.md', extension: 'md' };
  app.workspace._emit('file-open', file);
  app.workspace._emit('file-open', file);

  const key = Object.keys(plugin.deviceOpens['Notes/today.md'])[0];
  assert.equal(plugin.deviceOpens['Notes/today.md'][key], 2);
});

test('the debounced save (saveSoon) persists ONLY the device log to local storage, never data.json', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, { opens: { 'historical.md': { '2026-09-01': 9 } } });
  await plugin.onload();
  const savedBefore = plugin.saved;

  app.workspace._emit('file-open', { path: 'Notes/today.md', extension: 'md' });
  /* the stub's debounce is a synchronous passthrough (see harness header),
     so saveSoon() has already resolved to saveDeviceOpens() by here */

  assert.deepEqual(app._store.get(OPENS_STORAGE_KEY), plugin.deviceOpens, 'saveSoon did not persist the device log to local storage');
  assert.equal(plugin.saved, savedBefore, 'a file-open wrote to data.json (this.saveData) -- it must only ever touch local storage now');
});

test('saveDeviceOpens() writes the current in-memory device log, not a stale one', () => {
  const app = makeApp();
  const plugin = makePlugin(app, {});
  plugin.deviceOpens = { 'x.md': { '2026-09-06': 1 } };
  plugin.saveDeviceOpens();
  assert.deepEqual(app._store.get(OPENS_STORAGE_KEY), { 'x.md': { '2026-09-06': 1 } });
});
