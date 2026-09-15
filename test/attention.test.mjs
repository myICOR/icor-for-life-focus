/* THE ATTENTION GATE (0.6.0: the ranked list and the machine-layer file).
 *
 * Until now the score existed only as a radius on the canvas. 0.6.0 says it
 * out loud in a ranked list and writes it to
 * `.icor-for-life/icor-for-life-focus/attention.json` so a script, the AI
 * chat or another plugin can read the same number.
 *
 * What this gate has to prove:
 *   1. the ranking is total and deterministic (score, then recency, then
 *      path), and the top N is a slice of it;
 *   2. the per-signal breakdown adds up to the score, so the Focus score and
 *      the vault script's journal-link count can actually be compared;
 *   3. "Count file edits" off removes the edit contribution and nothing
 *      else, because mtime is bulk-written in a scripted vault;
 *   4. the write goes through the adapter, into this plugin's own subfolder
 *      only, with `exists` before `mkdir` every time (GL-1008);
 *   5. a refused write is swallowed: the file is a by-product, the map is
 *      the product.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeApp, makeAdapter } from './harness.mjs';

const { __test, makePlugin } = loadPlugin();
const {
  buildModel, rankNodes, topAttention, attentionPayload, dayKeyAgo,
  DEFAULT_SETTINGS, META_DIR, ATTENTION_DIR, ATTENTION_PATH, ATTENTION_SCHEMA,
} = __test;

const plain = (x) => JSON.parse(JSON.stringify(x));

const NOW = new Date(2026, 8, 15, 12, 0, 0); // 2026-09-15, local noon

/* A markdown file as buildModel sees one. `daysAgo` sets the mtime. */
function file(path, daysAgo) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 9, 0, 0);
  return {
    path,
    basename: path.replace(/\.md$/, '').split('/').pop(),
    extension: 'md',
    stat: { mtime: d.getTime() },
  };
}

function modelOf(files, { resolvedLinks = {}, settings = {} } = {}) {
  const app = makeApp({ markdownFiles: files, resolvedLinks });
  return buildModel(app, Object.assign({}, DEFAULT_SETTINGS, settings), NOW);
}

/* ------------------------------------------------------------- ranking -- */

test('rankNodes: highest score first', () => {
  const nodes = [
    { path: 'a.md', score: 1, lastDay: 0 },
    { path: 'b.md', score: 9, lastDay: 3 },
    { path: 'c.md', score: 4, lastDay: 1 },
  ];
  assert.deepEqual(rankNodes(nodes).map((n) => n.path), ['b.md', 'c.md', 'a.md']);
});

test('rankNodes: an equal score breaks on recency, then on path, so the order never depends on vault order', () => {
  const nodes = [
    { path: 'z.md', score: 5, lastDay: 2 },
    { path: 'a.md', score: 5, lastDay: 2 },
    { path: 'm.md', score: 5, lastDay: 0 },
  ];
  assert.deepEqual(rankNodes(nodes).map((n) => n.path), ['m.md', 'a.md', 'z.md']);
});

test('rankNodes: the caller array is not reordered', () => {
  const nodes = [{ path: 'a.md', score: 1, lastDay: 0 }, { path: 'b.md', score: 2, lastDay: 0 }];
  rankNodes(nodes);
  assert.deepEqual(nodes.map((n) => n.path), ['a.md', 'b.md']);
});

test('topAttention: takes the first N of the ranking, and a short list is not padded', () => {
  const nodes = [1, 2, 3, 4, 5].map((i) => ({ path: `${i}.md`, score: i, lastDay: 0 }));
  assert.deepEqual(topAttention(nodes, 2).map((n) => n.path), ['5.md', '4.md']);
  assert.equal(topAttention(nodes, 50).length, 5);
  assert.equal(topAttention([], 10).length, 0);
});

test('topAttention: a missing, zero or negative count falls back to ten rather than to an empty list', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ path: `${i}.md`, score: i, lastDay: 0 }));
  assert.equal(topAttention(nodes).length, 10);
  assert.equal(topAttention(nodes, 0).length, 10);
  assert.equal(topAttention(nodes, -4).length, 1);
});

/* ------------------------------------------------------------- signals -- */

test('the per-signal contributions add up to the score', () => {
  const model = modelOf([file('04 Inner World/My Life/Topics/pka.md', 0), file('00 Daily Scratchpad/2026-09-15.md', 0)], {
    resolvedLinks: { '00 Daily Scratchpad/2026-09-15.md': { '04 Inner World/My Life/Topics/pka.md': 1 } },
  });
  for (const node of model.nodes) {
    const sum = Object.values(node.signals).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - node.score) < 1e-9, `${node.path}: signals ${sum} does not equal score ${node.score}`);
  }
});

test('a daily-note mention lands on mentions, a plain backlink on backlinks', () => {
  const topic = '04 Inner World/My Life/Topics/pka.md';
  const daily = modelOf([file(topic, 0), file('00 Daily Scratchpad/2026-09-15.md', 0)], {
    resolvedLinks: { '00 Daily Scratchpad/2026-09-15.md': { [topic]: 1 } },
  }).nodes.find((n) => n.path === topic);
  assert.equal(daily.signals.mentions, 3);
  assert.equal(daily.signals.backlinks, 0);

  const plainLink = modelOf([file(topic, 0), file('03 WiP/draft.md', 0)], {
    resolvedLinks: { '03 WiP/draft.md': { [topic]: 1 } },
  }).nodes.find((n) => n.path === topic);
  assert.equal(plainLink.signals.backlinks, 1);
  assert.equal(plainLink.signals.mentions, 0);
});

test('an open lands on opens and is capped at five a day, exactly as the score always capped it', () => {
  const p = '04 Inner World/My Life/Topics/pka.md';
  const node = modelOf([file(p, 0)], {
    settings: { countFileEdits: false, opens: { [p]: { [dayKeyAgo(0, NOW)]: 9 } } },
  }).nodes.find((n) => n.path === p);
  assert.equal(node.signals.opens, 10);
  assert.equal(node.score, 10);
});

/* ------------------------------------------------- the edit-signal switch -- */

test('Count file edits off removes the edit contribution and leaves every other signal alone', () => {
  const topic = '04 Inner World/My Life/Topics/pka.md';
  const files = [file(topic, 0), file('00 Daily Scratchpad/2026-09-15.md', 0)];
  const links = { '00 Daily Scratchpad/2026-09-15.md': { [topic]: 1 } };

  const on = modelOf(files, { resolvedLinks: links, settings: { countFileEdits: true } })
    .nodes.find((n) => n.path === topic);
  const off = modelOf(files, { resolvedLinks: links, settings: { countFileEdits: false } })
    .nodes.find((n) => n.path === topic);

  assert.equal(on.signals.edits, 2);
  assert.equal(off.signals.edits, 0);
  assert.equal(off.signals.mentions, on.signals.mentions);
  assert.equal(off.score, on.score - 2);
});

test('Count file edits off still dates a backlink by the source file edit day: the switch drops the edit score, it does not stop reading mtime', () => {
  const topic = '04 Inner World/My Life/Topics/pka.md';
  const node = modelOf([file(topic, 30), file('03 WiP/draft.md', 1)], {
    resolvedLinks: { '03 WiP/draft.md': { [topic]: 1 } },
    settings: { countFileEdits: false, windowDays: 7 },
  }).nodes.find((n) => n.path === topic);
  assert.ok(node, 'a topic reached only by a backlink must still appear');
  assert.equal(node.lastDay, 1, 'the backlink is dated by the source file edit day');
  assert.equal(node.signals.edits, 0);
});

test('the default is on, so nobody upgrading sees their map change', () => {
  assert.equal(DEFAULT_SETTINGS.countFileEdits, true);
  assert.equal(DEFAULT_SETTINGS.listCount, 10);
  assert.equal(DEFAULT_SETTINGS.showList, true);
});

/* ------------------------------------------------------------- payload -- */

test('attentionPayload: the documented shape, ranked, with the whole window in it', () => {
  const topic = '04 Inner World/My Life/Topics/pka.md';
  const model = modelOf([file(topic, 0), file('03 WiP/draft.md', 2)]);
  const payload = plain(attentionPayload(model, { countFileEdits: true }, NOW));

  assert.equal(payload.schema, ATTENTION_SCHEMA);
  assert.equal(payload.schema, 1);
  assert.equal(payload.generated_at, NOW.toISOString());
  assert.equal(payload.window_days, 7);
  assert.equal(payload.count_file_edits, true);
  assert.equal(payload.items.length, model.nodes.length);

  const first = payload.items[0];
  assert.deepEqual(Object.keys(first).sort(), ['last_seen', 'name', 'path', 'score', 'signals', 'type']);
  assert.deepEqual(Object.keys(first.signals).sort(), ['backlinks', 'edits', 'mentions', 'opens']);
  assert.equal(first.path, topic);
  assert.equal(first.name, 'pka');
  assert.equal(first.type, 'topic');
  assert.equal(first.last_seen, '2026-09-15');
  assert.ok(payload.items[0].score >= payload.items[1].score);
});

test('attentionPayload: last_seen is a local day key, not a UTC instant', () => {
  const p = '03 WiP/draft.md';
  const model = modelOf([file(p, 3)]);
  const payload = plain(attentionPayload(model, {}, NOW));
  assert.equal(payload.items[0].last_seen, '2026-09-12');
});

test('attentionPayload: count_file_edits records which of the two numbers a reader got', () => {
  const model = modelOf([file('03 WiP/draft.md', 0)], { settings: { countFileEdits: false } });
  assert.equal(plain(attentionPayload(model, { countFileEdits: false }, NOW)).count_file_edits, false);
});

test('attentionPayload: an empty window writes an empty list, never a missing key', () => {
  const payload = plain(attentionPayload({ nodes: [], windowDays: 14 }, {}, NOW));
  assert.deepEqual(payload.items, []);
  assert.equal(payload.window_days, 14);
});

/* --------------------------------------------------------- the write -- */

test('writeAttention: exists then mkdir for both folders, then one write, all through the adapter', async () => {
  const adapter = makeAdapter();
  const app = makeApp({ adapter });
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention({ nodes: [], windowDays: 7 }, NOW);

  assert.deepEqual(adapter._calls, [
    ['exists', META_DIR],
    ['mkdir', META_DIR],
    ['exists', ATTENTION_DIR],
    ['mkdir', ATTENTION_DIR],
    ['write', ATTENTION_PATH],
  ]);
});

test('writeAttention: a folder that is already there is not created again', async () => {
  const adapter = makeAdapter({ existing: [META_DIR, ATTENTION_DIR] });
  const app = makeApp({ adapter });
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention({ nodes: [], windowDays: 7 }, NOW);

  assert.deepEqual(adapter._calls.filter(([op]) => op === 'mkdir'), []);
});

test('writeAttention: the file lands in this plugin id subfolder and nowhere else', async () => {
  const adapter = makeAdapter();
  const app = makeApp({ adapter });
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention({ nodes: [], windowDays: 7 }, NOW);

  assert.deepEqual([...adapter._files.keys()], ['.icor-for-life/icor-for-life-focus/attention.json']);
  assert.equal(ATTENTION_PATH, '.icor-for-life/icor-for-life-focus/attention.json');
});

test('writeAttention: what lands on disk is the documented JSON, parseable, schema first', async () => {
  const adapter = makeAdapter();
  const topic = '04 Inner World/My Life/Topics/pka.md';
  const app = makeApp({ adapter, markdownFiles: [file(topic, 0)] });
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention(modelOf([file(topic, 0)]), NOW);

  const written = JSON.parse(adapter._files.get(ATTENTION_PATH));
  assert.equal(written.schema, 1);
  assert.equal(written.items[0].path, topic);
  assert.equal(written.items[0].signals.edits, 2);
});

test('writeAttention: a refused write is swallowed, because the map is the product and the file is a by-product', async () => {
  const adapter = makeAdapter({ failOn: 'write' });
  const app = makeApp({ adapter });
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention({ nodes: [], windowDays: 7 }, NOW);
  assert.ok(true, 'writeAttention threw out of a failed adapter write');
});

test('writeAttention: an app with no adapter at all is a no-op, not a crash', async () => {
  const app = makeApp({ adapter: undefined });
  delete app.vault.adapter;
  const plugin = makePlugin(app, {});
  await plugin.onload();

  await plugin.writeAttention({ nodes: [], windowDays: 7 }, NOW);
  assert.ok(true);
});
