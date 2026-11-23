/* THE ENTRY POINT IS OBSIDIAN'S OWN RIBBON (0.8.1).
 *
 * Tom, 2026-11-23: the row of icons under the logo goes, and every plugin's
 * launcher moves to the ribbon on the left, so members can reorder or hide it
 * in Settings, Appearance, Ribbon menu like any other plugin's icon.
 *
 * Behaviour, not source text: the real main.js is loaded through the harness,
 * with a file explorer whose tool-button row records every node anyone puts
 * into it, the layout ready and a layout change fired. Nothing may land in
 * that row, and exactly one ribbon icon is registered, with a tooltip, opening
 * the map through the same function as the command. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, makeApp } from './harness.mjs';

const { makePlugin } = loadPlugin();

function explorerWithRow() {
  const written = [];
  const row = {
    createDiv: (o) => { written.push(['createDiv', o]); return { setAttr() {}, addClass() {} }; },
    createEl: (t, o) => { written.push(['createEl', t, o]); return { setAttr() {}, addClass() {} }; },
    appendChild: (n) => { written.push(['appendChild', n]); return n; },
    insertBefore: (n) => { written.push(['insertBefore', n]); return n; },
    prepend: (n) => { written.push(['prepend', n]); },
    append: (n) => { written.push(['append', n]); },
    querySelector: () => null,
  };
  const leaf = {
    view: { containerEl: { querySelector: (sel) => (sel === '.nav-buttons-container' ? row : null) } },
  };
  return { leaf, written };
}

test('nothing is written into the file explorer\'s tool-button row', async () => {
  const { leaf, written } = explorerWithRow();
  const app = makeApp();
  app.workspace.onLayoutReady = (cb) => cb();
  app.workspace.getLeavesOfType = (type) => (type === 'file-explorer' ? [leaf] : []);
  const plugin = makePlugin(app, {});
  await plugin.onload();
  app.workspace._emit('layout-change');
  assert.deepEqual(written, [], 'the plugin put something into .nav-buttons-container');
});

test('exactly one ribbon icon, with a tooltip, opening the map like the command does', async () => {
  const app = makeApp();
  const plugin = makePlugin(app, {});
  let opened = 0;
  plugin.openFocus = () => { opened += 1; };
  await plugin.onload();
  const ribbons = plugin.ribbons || [];
  assert.equal(ribbons.length, 1, `addRibbonIcon was called ${ribbons.length} times`);
  assert.equal(ribbons[0].icon, 'focus');
  assert.equal(ribbons[0].title, 'Open the Focus map');
  const command = plugin.commands.find((c) => c.id === 'open-focus');
  assert.ok(command, 'the open-focus command is registered');
  assert.equal(command.name, ribbons[0].title, 'the ribbon tooltip and the command say the same thing');
  ribbons[0].callback();
  command.callback();
  assert.equal(opened, 2, 'the ribbon icon and the command both open the map');
});
