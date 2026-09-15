/* THE PHONE-LAYOUT GATE (0.6.0).
 *
 * The ranked list is a fixed 248px column beside the map. On a phone that
 * is most of the screen, and the map is left with about 140px: the feature
 * that was added in 0.6.0 takes the feature the plugin already had away.
 * `styles.css` answers it with a `body.is-phone` block that stacks the two.
 *
 * That block is invisible to every other gate here: the harness never
 * constructs the view (see harness.mjs), so nothing else in this suite
 * would notice the rules being deleted, renamed or clipped out of a future
 * stylesheet edit. This gate reads the shipped stylesheet as text and
 * asserts the four rules are present, which is the part a machine can
 * check.
 *
 * What a machine here CANNOT check: how it actually renders.
 * `App.emulateMobile(true)` is a method on the running Obsidian app; there
 * is no headless Obsidian, and this suite is plain `node --test` against
 * the bundle, so the rendered result has to be read by a person with the
 * plugin installed. The CHANGELOG says so rather than implying a run that
 * did not happen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(repo, 'styles.css'), 'utf8');

/* Whitespace-insensitive: the gate is about the rule existing, not about
   how the file happens to be indented on the day it is read. */
const flat = css.replace(/\s+/g, ' ');

test('the phone stacks the map and the list instead of putting them side by side', () => {
  assert.match(flat, /body\.is-phone \.ifocus-body \{ flex-direction: column; \}/);
});

test('the phone list drops the 248px column width', () => {
  const rule = flat.match(/body\.is-phone \.ifocus-list \{([^}]*)\}/);
  assert.ok(rule, 'no body.is-phone .ifocus-list rule in styles.css');
  assert.match(rule[1], /width: auto;/);
});

test('the phone caps the rows so a long list cannot push the map off screen', () => {
  assert.match(flat, /body\.is-phone \.ifocus-list-rows \{ max-height: \d+vh; \}/);
});

test('the phone keeps a floor under the map', () => {
  const rule = flat.match(/body\.is-phone \.ifocus-stage \{([^}]*)\}/);
  assert.ok(rule, 'no body.is-phone .ifocus-stage rule in styles.css');
  assert.match(rule[1], /min-height: \d+px;/);
});
