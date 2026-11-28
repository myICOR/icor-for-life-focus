/* THE FOLDERS GATE (0.9.0, the Workbench layout of ICOR for Life 3.0).
 *
 * ICOR for Life 3.0 has twelve flat folders by ICOR stage: Input (00 Daily
 * Notes, 01 Inbox), Control (02 My Life, 03 Journal, 04 Notes, 05 Contacts,
 * 06 Sources, 10 Files, 11 Databases), Output (07 Planner, 08 Workbench) and
 * Refine (09 AI). The numbers moved twice, so a number says nothing: 02 was
 * the Planner in 2.x and the Inner World in early 3.0. This gate holds:
 *
 *   1. CLASSIFICATION by full folder name, for the current layout, an early
 *      3.0 vault and a 2.x vault, and never by number.
 *   2. NO WIP: no type, no label, no path.
 *   3. THE DEFAULT: 10 Files is excluded; a saved list that still equals an
 *      old default (05 Assets, 04 Assets) keeps working while the vault has
 *      that folder, and follows it to 10 Files once it moved.
 *   4. THE NOTICE: a missing folder is named by its current name, as a
 *      folder; nothing the plugin shows says "room".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadPlugin, makeApp } from './harness.mjs';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'main.js'), 'utf8');
const { __test, makePlugin } = loadPlugin();
const plain = (x) => JSON.parse(JSON.stringify(x));

const NEW = ['00 Daily Notes', '01 Inbox', '02 My Life', '03 Journal', '04 Notes', '05 Contacts', '06 Sources',
  '07 Planner', '08 Workbench', '09 AI', '10 Files', '11 Databases'];
const EARLY = ['00 Daily Notes', '01 Inbox', '02 Inner World', '03 Outer World', '04 Assets', '05 Databases', '06 Planner'];
const OLD = ['00 Daily Scratchpad', '01 Inbox', '02 Planner', '03 WiP', '04 Inner World', '05 Assets', '06 AI Team', '07 Databases'];

/* ------------------------------------------------- 1. CLASSIFICATION -- */

test('the Workbench layout: every folder is classified by its name', () => {
  const c = __test.classifyPath;
  assert.equal(c('00 Daily Notes/2026/11/2026-11-23.md'), 'journal');
  assert.equal(c('01 Inbox/scan.md'), 'inbox');
  assert.equal(c('02 My Life/Topics/pka.md'), 'topic');
  assert.equal(c('02 My Life/Projects/Focus sprint.md'), 'project');
  assert.equal(c('02 My Life/Key Elements/Health.md'), 'key-element');
  assert.equal(c('03 Journal/2026/11/a.md'), 'journal');
  assert.equal(c('04 Notes/Idea.md'), 'note');
  assert.equal(c('05 Contacts/People/Ana.md'), 'person');
  assert.equal(c('05 Contacts/Companies/ICOR.md'), 'company');
  assert.equal(c('06 Sources/Deep Work.md'), 'note');
  assert.equal(c('07 Planner/Call the bank.md'), 'planner');
  assert.equal(c('08 Workbench/2026-11-28 Talk/brief.md'), 'note');
});

test('an early 3.0 vault keeps its colours under its Inner World names', () => {
  const c = __test.classifyPath;
  assert.equal(c('02 Inner World/My Life/Topics/pka.md'), 'topic');
  assert.equal(c('02 Inner World/Contacts/People/Ana.md'), 'person');
  assert.equal(c('02 Inner World/Journal/2026/11/a.md'), 'journal');
  assert.equal(c('06 Planner/Call the bank.md'), 'planner');
});

test('a 2.x vault keeps its colours under its old names', () => {
  const c = __test.classifyPath;
  assert.equal(c('00 Daily Scratchpad/2026/09/2026-09-15.md'), 'journal');
  assert.equal(c('04 Inner World/My Life/Topics/pka.md'), 'topic');
  assert.equal(c('02 Planner/Call the bank.md'), 'planner');
  assert.equal(c('06 AI Team/Larry.md'), 'ai-team', 'the 2.x team folder, read for such a vault only');
});

test('a number is never a match', () => {
  const c = __test.classifyPath;
  assert.equal(c('02 My Life/Projects/p.md'), 'project', '02 My Life is not the 2.x Planner');
  assert.equal(c('04 Notes/My Life/Topics/x.md'), 'note', '04 Notes is not the 2.x Inner World');
  assert.equal(c('06 Sources/x.md'), 'note', '06 Sources is not the 2.x AI Team');
  assert.equal(c('03 Journal/x.md'), 'journal', '03 Journal is not a work-in-progress folder');
  assert.equal(c('06 Außenwelt/x.md'), 'note');
  assert.equal(c('README.md'), 'note');
});

/* ------------------------------------------------------------ 2. NO WIP -- */

test('no work-in-progress folder: no type, no legend label, no path', () => {
  assert.equal(__test.TYPES.wip, undefined);
  assert.equal(__test.classifyPath('03 WiP/draft.md'), 'note', 'a leftover 2.x folder is drawn as ordinary notes');
  assert.doesNotMatch(source, /03 WiP|WiP|'wip'/);
});

/* ------------------------------------------------------- 3. THE DEFAULT -- */

test('10 Files is excluded by default', () => {
  assert.deepEqual(plain(__test.DEFAULT_SETTINGS.excludeFolders), ['10 Files']);
  assert.equal(__test.isExcluded('10 Files/Images/a.md', __test.DEFAULT_SETTINGS.excludeFolders, false), true);
  assert.equal(__test.isExcluded('10 Files Archive/a.md', __test.DEFAULT_SETTINGS.excludeFolders, false), false, 'by full name');
});

test('a saved old default follows the folder only once it has moved; anything else is left alone', () => {
  const adopt = (saved, folders) => plain(__test.adoptExcludeFolders(saved, (n) => folders.includes(n)));
  assert.deepEqual(adopt(['05 Assets'], OLD), ['05 Assets'], 'the vault still has 05 Assets: as saved');
  assert.deepEqual(adopt(['05 Assets'], NEW), ['10 Files'], 'the vault moved: the new name');
  assert.deepEqual(adopt(['04 Assets'], EARLY), ['04 Assets'], 'an early 3.0 vault still has 04 Assets: as saved');
  assert.deepEqual(adopt(['04 Assets'], NEW), ['10 Files'], 'an early 3.0 vault that moved: the new name');
  assert.deepEqual(adopt(['05 Assets'], ['Notes']), ['05 Assets'], 'neither folder: as saved');
  assert.deepEqual(adopt(['05 Assets', 'Archive'], NEW), ['05 Assets', 'Archive'], 'a list the member changed is theirs');
  assert.deepEqual(adopt(['10 Files'], OLD), ['10 Files']);
});

test('the plugin saves the adopted list once the layout is ready', async () => {
  const app = makeApp();
  app.vault.getRoot = () => ({ children: NEW.map((name) => ({ name, children: [] })) });
  const plugin = makePlugin(app, { excludeFolders: ['05 Assets'] });
  await plugin.loadSettings();
  await plugin.adoptDefaults();
  assert.deepEqual(plain(plugin.settings.excludeFolders), ['10 Files']);
  assert.deepEqual(plain(plugin.saved.excludeFolders), ['10 Files']);

  const old = makeApp();
  old.vault.getRoot = () => ({ children: OLD.map((name) => ({ name, children: [] })) });
  const kept = makePlugin(old, { excludeFolders: ['05 Assets'] });
  await kept.loadSettings();
  await kept.adoptDefaults();
  assert.deepEqual(plain(kept.settings.excludeFolders), ['05 Assets']);
});

/* -------------------------------------------------------- 4. THE NOTICE -- */

test('missing folders are named by their current names, by full name, never by number', () => {
  assert.deepEqual(plain(__test.missingFolders(NEW)), []);
  assert.deepEqual(plain(__test.missingFolders(EARLY)), [], 'an early 3.0 vault has every folder under its old name');
  assert.deepEqual(plain(__test.missingFolders(OLD)), [], 'a 2.x vault has every folder under its old name');
  assert.deepEqual(plain(__test.missingFolders(['00 Daily Notes', '01 Inbox', '02 My Life', '05 Contacts', '06 AI Team'])), ['03 Journal', '07 Planner']);
});

test('the notice says folder, and no string the plugin shows says room', () => {
  assert.equal(__test.missingFoldersMessage(['02 My Life']),
    'ICOR Focus: this vault has no 02 My Life folder. Those notes will be drawn as ordinary notes until the folder is there.');
  assert.match(__test.missingFoldersMessage(['02 My Life', '07 Planner']), /no 02 My Life, 07 Planner folders\. .* until the folders are there\./);
  /* Every string literal in main.js, comments skipped. */
  const strings = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      strings.push(source.slice(i + 1, j));
      i = j;
    }
  }
  assert.ok(strings.length > 100, 'the scan found the strings');
  assert.deepEqual(strings.filter((t) => /(?<![\w-])rooms?\b(?!-)/i.test(t)), []);
  assert.deepEqual(strings.filter((t) => /scaffold|harness|full stack|local folder/i.test(t)), []);
});
