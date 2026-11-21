/* THE MAP MUST NOT SLOW OBSIDIAN DOWN.
 *
 * The drawing loop compares every drawn note with every other, every frame.
 * Before 0.7.1 it ran for as long as a Focus tab existed (even in the
 * background) and nothing capped how many notes it drew: a sync touching
 * 3,000 files meant ~4.5 million comparisons a frame. These gates hold the
 * three rules that close it: the loop sleeps when settled or hidden, the
 * drawing keeps at most MAX_MAP_NODES notes (the machine-layer file keeps
 * them all), and an unchanged ranking is not written again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeApp, makeAdapter } from './harness.mjs';

const { __test, makePlugin } = loadPlugin();
const { capForMap, loopShouldRun, MAX_MAP_NODES, ATTENTION_PATH } = __test;
const NOW = new Date('2026-11-21T10:00:00Z');

function nodesOf(n) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ path: `n${String(i).padStart(4, '0')}.md`, score: i, lastDay: i % 7 });
  }
  return nodes;
}

test('the drawing is capped at MAX_MAP_NODES, keeping the highest scores', () => {
  assert.equal(MAX_MAP_NODES, 300);
  const nodes = nodesOf(3000);
  const edges = [['n2999.md', 'n2998.md'], ['n0000.md', 'n2999.md']];
  const capped = capForMap({ nodes, edges, windowDays: 7 });
  assert.equal(capped.nodes.length, 300);
  assert.equal(capped.hidden, 2700);
  assert.ok(capped.nodes.every((n) => n.score >= 2700), 'only the top scores stay');
  assert.deepEqual(capped.edges.map((e) => [...e]), [['n2999.md', 'n2998.md']], 'edges to a hidden note go too');
  const sorted = capped.nodes.map((n) => n.path);
  assert.deepEqual(sorted, [...sorted].sort(), 'the drawn order stays the path order');
});

test('a small map is drawn whole', () => {
  const nodes = nodesOf(12);
  const capped = capForMap({ nodes, edges: [], windowDays: 7 });
  assert.equal(capped.nodes.length, 12);
  assert.equal(capped.hidden, 0);
  assert.equal(capForMap({ nodes: nodesOf(50), edges: [], windowDays: 7 }, 20).nodes.length, 20, 'the cap can be set');
});

test('the loop sleeps when the map has settled, is hidden or is gone', () => {
  assert.equal(loopShouldRun({ connected: true, visible: true, energy: 5, needsKick: 0 }), true, 'moving: runs');
  assert.equal(loopShouldRun({ connected: true, visible: true, energy: 0, needsKick: 3 }), true, 'kicked: runs');
  assert.equal(loopShouldRun({ connected: true, visible: true, energy: 0.1, needsKick: 0 }), false, 'settled: sleeps');
  assert.equal(loopShouldRun({ connected: true, visible: false, energy: 5, needsKick: 9 }), false, 'background tab: sleeps');
  assert.equal(loopShouldRun({ connected: false, visible: true, energy: 5, needsKick: 9 }), false, 'closed: sleeps');
});

test('an unchanged ranking is not written again', async () => {
  const adapter = makeAdapter();
  const plugin = makePlugin(makeApp({ adapter }), {});
  await plugin.onload();
  const model = { nodes: [], windowDays: 7 };
  await plugin.writeAttention(model, NOW);
  await plugin.writeAttention(model, new Date(NOW.getTime() + 5000));
  assert.equal(adapter._calls.filter(([op, p]) => op === 'write' && p === ATTENTION_PATH).length, 1);
  await plugin.writeAttention({ nodes: [], windowDays: 14 }, NOW);
  assert.equal(adapter._calls.filter(([op, p]) => op === 'write' && p === ATTENTION_PATH).length, 2, 'a changed ranking is written');
});
