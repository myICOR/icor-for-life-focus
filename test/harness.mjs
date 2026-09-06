/* The harness the Focus gates load the real main.js through.
 *
 * Deliberately thin, unlike Sync's harness: nothing here exercises the
 * canvas / ItemView rendering surface (registerView only stores the
 * FocusView factory, it never constructs one, so the DOM- and RAF-heavy
 * half of the plugin is out of scope for these gates on purpose). What is
 * in scope: `IcorFocusPlugin.onload()`, the file-open opens-log handler,
 * and the pure functions the file exports under `__test` (mergeOpens,
 * pruneOpensLog, buildModel, ...).
 *
 * `debounce` in the stub is a synchronous passthrough -- real Obsidian
 * debounces on a wall-clock timer, but a gate cares that `saveSoon()`
 * eventually calls `saveDeviceOpens()`, not about the 4 seconds in
 * between, so the stub calls straight through and the gates read as
 * "after this file-open, the save happened."
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);

/* A vault-scoped localStorage stand-in for App.loadLocalStorage /
   saveLocalStorage (real Obsidian keys it per vault, never syncs it). */
export function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    loadLocalStorage: (key) => (store.has(key) ? store.get(key) : null),
    saveLocalStorage: (key, data) => { if (data === null || data === undefined) store.delete(key); else store.set(key, data); },
    _store: store,
  };
}

/* A minimal event bus per bucket (workspace / vault / metadataCache):
   `.on(evt, cb)` registers, `._emit(evt, ...args)` fires every registered
   callback -- the fixture's way of standing in for a real Obsidian
   `file-open` firing. */
function makeBus() {
  const handlers = {};
  return {
    on: (evt, cb) => { (handlers[evt] || (handlers[evt] = [])).push(cb); return { evt, cb }; },
    _emit: (evt, ...args) => { for (const cb of (handlers[evt] || [])) cb(...args); },
  };
}

export function makeApp({ localStorageSeed = {}, markdownFiles = [] } = {}) {
  const workspaceBus = makeBus();
  const vaultBus = makeBus();
  const metadataCacheBus = makeBus();
  return {
    vault: {
      getMarkdownFiles: () => markdownFiles,
      getRoot: () => ({ children: [] }),
      on: vaultBus.on,
      _emit: vaultBus._emit,
    },
    metadataCache: { resolvedLinks: {}, on: metadataCacheBus.on, _emit: metadataCacheBus._emit },
    workspace: {
      onLayoutReady: () => {},
      on: workspaceBus.on,
      _emit: workspaceBus._emit,
      getLeavesOfType: () => [],
    },
    ...makeLocalStorage(localStorageSeed),
  };
}

/* --------------------------------------------------------- the stub -- */

function makeObsidian() {
  const chain = () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => chain()) });
  class Component {
    constructor() { this._events = []; }
    registerEvent(e) { this._events.push(e); }
    registerDomEvent() {}
    addCommand(c) { (this.commands || (this.commands = [])).push(c); }
    addSettingTab() {}
    registerView(type, factory) { (this.views || (this.views = {}))[type] = factory; }
  }
  return {
    Plugin: class extends Component {
      constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; this.saved = null; }
      async loadData() { return this.saved === null ? null : JSON.parse(JSON.stringify(this.saved)); }
      async saveData(d) { this.saved = JSON.parse(JSON.stringify(d)); }
    },
    ItemView: class extends Component { constructor(leaf) { super(); this.leaf = leaf; } },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {} }; } },
    Setting: class { constructor() { return chain(); } },
    Notice: class { constructor(msg) { this.msg = msg; } },
    TFile: class { constructor(path) { this.path = path; } },
    setIcon: () => {},
    /* synchronous passthrough -- see file header */
    debounce: (fn) => fn,
  };
}

/* Load main.js. Returns the plugin class, the `__test` surface main.js
   already exports, and a `makePlugin(app, saved)`. */
export function loadPlugin() {
  const obsidian = makeObsidian();
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { querySelectorAll: () => [] },
    window: {},
    console, setTimeout, clearTimeout,
    JSON, Date, Math, Number, String, Array, Object, Map, Set, Promise, RegExp,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  const PluginClass = sandbox.module.exports;
  return {
    PluginClass,
    __test: PluginClass.__test,
    obsidian,
    makePlugin(app, saved = null) {
      const plugin = new PluginClass(app, { id: 'icor-for-life-focus', version: '0.0.0-gate' });
      plugin.saved = saved;
      return plugin;
    },
  };
}
