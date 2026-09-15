/* ICOR for Life - Focus - a user-centered gravity map of the Lifeworld.
 *
 * Principle: the user sits in the center; everything they interacted with
 * orbits them.
 * The window is today plus the last N days. Each item appears exactly once,
 * in the ring of its most recent interaction; fresh mentions pull it inward,
 * age drifts it outward. Ring widths are dynamic: busy days wide, empty days
 * thin. Distance is computed deterministically from concrete signals (file
 * edits, daily-note mentions, backlinks, opens); the canvas only renders it.
 *
 * Hand-written CommonJS, no build step. INKLINE visual grammar.
 */

'use strict';

const {
  Plugin, ItemView, Notice, PluginSettingTab, Setting, TFile, setIcon, debounce,
  normalizePath,
} = require('obsidian');

const VIEW_TYPE_FOCUS = 'icor-focus-view';

/* The machine layer (GL-1008). One hidden folder, one subfolder named
   exactly as this plugin's id, one documented file with a top-level schema
   integer. Reached through the vault adapter only: the Vault API does not
   see a folder whose name starts with a dot, and the adapter is the same
   call on desktop and on a phone. */
const META_DIR = '.icor-for-life';
const ATTENTION_DIR = META_DIR + '/icor-for-life-focus';
const ATTENTION_PATH = ATTENTION_DIR + '/attention.json';
const ATTENTION_SCHEMA = 1;

/* What one interaction is worth, and the name its contribution carries in
   `signals`. One table, so the score and the breakdown can never disagree. */
const SIGNAL_WEIGHTS = { mentions: 3, edits: 2, opens: 2, backlinks: 1 };

const DEFAULT_SETTINGS = {
  windowDays: 7,            // past days shown beyond today
  excludeFolders: ['05 Assets'],
  includeReadmes: false,
  showLinks: true,
  entitiesOnly: false,      // page toggle, persisted
  halfLifeDays: 3,          // decay half-life for the intensity score
  countFileEdits: true,     // the mtime edit signal; see buildModel
  showList: true,           // the ranked list beside the map
  listCount: 10,            // rows in that list
  nodeSpacing: 26,          // extra separation between nodes, px
  ringPull: 1,              // radial spring multiplier
  labelMode: 'fade',        // 'fade' | 'always' | 'hidden'
  labelFadeZoom: 0.55,      // zoom level where fading labels appear
  opens: {},                // FROZEN as of v0.5.3: path -> { 'YYYY-MM-DD': count }.
                             // Obsidian Sync replicates data.json onto every device,
                             // last-write-wins, and this field was written on every
                             // single file-open: two synced devices silently clobbered
                             // each other's opens, and every open dirtied data.json
                             // for nothing (Flint's mobile audit, fix 2). New opens go
                             // to this device's own local storage instead (see
                             // OPENS_STORAGE_KEY below); this field stays exactly as it
                             // was at upgrade, read-only, and mergeOpens() at render
                             // time is the only thing that still reads it.
};

/* This device's own opens log lives here (App.loadLocalStorage /
   saveLocalStorage, vault-scoped, never synced) instead of in data.json. */
const OPENS_STORAGE_KEY = 'icor-for-life-focus:opens';

/* ---------------------------------------------------------------- types */

/* Entities carry a representative shape; everything else is a plain dot.
 * diamond = a key, square = a thing being built, triangle = a subject
 * pointing somewhere, hexagon = a repeating cell, star = a goal,
 * ring = a person around you. */
const TYPES = {
  'key-element': { label: 'Key Elements', color: '#ff5a2d', entity: true, shape: 'diamond' },
  'project':     { label: 'Projects',     color: '#6f8fd2', entity: true, shape: 'square' },
  'topic':       { label: 'Topics',       color: '#5ea8a0', entity: true, shape: 'triangle' },
  'habit':       { label: 'Habits',       color: '#7d9a7f', entity: true, shape: 'hex' },
  'goal':        { label: 'Goals',        color: '#c2a35c', entity: true, shape: 'star' },
  'person':      { label: 'People',       color: '#a87795', entity: true, shape: 'ring' },
  'company':     { label: 'Companies',    color: '#7f6fae', entity: true, shape: 'sqring' },
  'journal':     { label: 'Journal',      color: '#8e897d', entity: false, shape: 'dot' },
  'planner':     { label: 'Planner',      color: '#c2765a', entity: false, shape: 'dot' },
  'wip':         { label: 'WiP',          color: '#7a99a1', entity: false, shape: 'dot' },
  'inbox':       { label: 'Inbox',        color: '#b0855e', entity: false, shape: 'dot' },
  'ai-team':     { label: 'AI Team',      color: '#8087a6', entity: false, shape: 'dot' },
  'note':        { label: 'Notes',        color: '#6d6a61', entity: false, shape: 'dot' },
};

/* Trace the outline for a shape centered on (x, y) with "radius" r.
 * The caller decides fill and/or stroke. */
function traceShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'diamond') {
    const s = r * 1.25;
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
    ctx.closePath();
  } else if (shape === 'square') {
    const s = r * 0.92;
    if (ctx.roundRect) ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.35);
    else ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === 'triangle') {
    const s = r * 1.25;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.9, y + s * 0.7);
    ctx.lineTo(x - s * 0.9, y + s * 0.7);
    ctx.closePath();
  } else if (shape === 'hex') {
    const s = r * 1.12;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const px = x + Math.cos(a) * s, py = y + Math.sin(a) * s;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    const R = r * 1.5, ri = r * 0.62;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? ri : R;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'sqring') {
    const s = r * 0.95;
    if (ctx.roundRect) ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.3);
    else ctx.rect(x - s, y - s, s * 2, s * 2);
  } else { // dot, ring
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/* Hollow shapes: stroked outline plus a small filled core. */
function isHollow(shape) { return shape === 'ring' || shape === 'sqring'; }

/* Label alpha from the label mode. Pure so the gate can test it. */
function labelAlphaOf(mode, zoom, threshold, entity, isHover) {
  if (isHover) return 1;
  if (mode === 'hidden') return 0;
  const base = entity ? 0.85 : 0.55;
  if (mode === 'always') return base;
  return Math.max(0, Math.min(1, (zoom - threshold) * 2)) * base;
}

/* A ROOM IS ITS NUMBER. THE WORDS AFTER IT ARE A LABEL.
 *
 * This table used to be thirteen full-path literals. When `01 INBOX` was
 * renamed `01 Inbox` to match its title-case siblings, every literal naming it
 * stopped matching, in silence, because a prefix test that matches nothing
 * raises nothing: a whole room was quietly classified as 'note' and the
 * gravity map simply stopped colouring it. Correcting the literal would have
 * left the same trap armed for the next rename, and there will be one. The
 * SAME two-character edit cost 27 files and 21 CSS selectors elsewhere.
 *
 * The number is the part that does not move. It is the sort key, it is the
 * identity in every consumer's copy ("ROOM 01 - INBOX"), and it is what
 * survived this rename untouched. Match on it, and a room may be called
 * anything its owner likes.
 *
 * The structure BELOW a room is a separate contract that a room rename does not
 * touch, so 04's sub-paths stay as names. */
const ROOM_CLASS = {
  '00': 'journal',   // Daily Scratchpad
  '01': 'inbox',
  '02': 'planner',
  '03': 'wip',
  '06': 'ai-team',
};

/* Every room number this plugin depends on, so a missing one can be NAMED
 * rather than silently classified as an ordinary note. */
const EXPECTED_ROOMS = Object.keys(ROOM_CLASS).concat(['04']).sort();

const INNER_CLASS = [
  ['My Life/Key Elements/', 'key-element'],
  ['My Life/Projects/', 'project'],
  ['My Life/Topics/', 'topic'],
  ['My Life/Habits/', 'habit'],
  ['My Life/Goals/', 'goal'],
  ['Contacts/Companies/', 'company'],
  ['Contacts/', 'person'],
  ['Journal/', 'journal'],
];

/* The room number a vault path sits in, or null when it sits in none. */
function roomOf(path) {
  const m = /^(\d{2})[^/]*\//.exec(path);
  return m ? m[1] : null;
}

function classifyPath(path) {
  const room = roomOf(path);
  if (room === '04') {
    const rest = path.slice(path.indexOf('/') + 1);
    for (const [prefix, cls] of INNER_CLASS) if (rest.startsWith(prefix)) return cls;
    return 'note';
  }
  return (room && ROOM_CLASS[room]) || 'note';
}

/* The rooms this plugin expects, and the ones the vault actually has.
 * Pure so it can be tested without a vault. */
function missingRooms(topLevelFolderNames) {
  const present = new Set();
  for (const name of topLevelFolderNames) {
    const m = /^(\d{2})/.exec(name);
    if (m) present.add(m[1]);
  }
  return EXPECTED_ROOMS.filter((n) => !present.has(n));
}

/* ---------------------------------------------------------------- dates */

function dayKeyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayKey(now) { return dayKeyOf(now || new Date()); }

/* Whole local days between a day key and now. 0 = today. -1 = future/invalid. */
function dayIndexOf(key, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return -1;
  const then = new Date(+m[1], +m[2] - 1, +m[3]);
  const ref = now || new Date();
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diff = Math.round((today - then) / 86400000);
  return diff < 0 ? -1 : diff;
}

function dayIndexOfMtime(mtime, now) {
  return dayIndexOf(dayKeyOf(new Date(mtime)), now);
}

/* The inverse of dayIndexOf: the day key `dayIdx` whole local days before
 * now. 0 gives today. Local, like every other date in this file, so a
 * reader of the written file sees the day Tom had, not the day Greenwich
 * had. */
function dayKeyAgo(dayIdx, now) {
  const ref = now || new Date();
  return dayKeyOf(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - dayIdx));
}

const DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- model */

/* Interactions accumulate per path: keep the most recent day index, a
 * decayed intensity score, and the same score split by which signal paid
 * for it. Weights are SIGNAL_WEIGHTS: daily-note mention 3, edit 2, open 2,
 * backlink 1.
 *
 * The split is not decoration. Two numbers answer "which topics have my
 * attention" in this vault -- this score and the journal-link count the
 * vault script computes -- and they can only be compared if this one says
 * how much of itself came from each signal. */
function makeAccumulator(windowDays, halfLifeDays) {
  const items = new Map();
  return {
    add(path, dayIdx, weight, signal) {
      if (dayIdx < 0 || dayIdx > windowDays) return;
      let it = items.get(path);
      if (!it) {
        it = { path, lastDay: dayIdx, score: 0, signals: { edits: 0, mentions: 0, backlinks: 0, opens: 0 } };
        items.set(path, it);
      }
      if (dayIdx < it.lastDay) it.lastDay = dayIdx;
      const gained = weight * Math.pow(0.5, dayIdx / halfLifeDays);
      it.score += gained;
      if (signal && it.signals[signal] !== undefined) it.signals[signal] += gained;
    },
    items,
  };
}

function isExcluded(path, excludeFolders, includeReadmes) {
  if (!includeReadmes && /(^|\/)README\.md$/i.test(path)) return true;
  for (const f of excludeFolders) {
    const p = f.endsWith('/') ? f : f + '/';
    if (path === f || path.startsWith(p)) return true;
  }
  return false;
}

/* Combine the frozen historical opens log (data.json, no longer written)
 * with this device's own live one (local storage) for a single render.
 * Both are `{ path: { 'YYYY-MM-DD': count } }`; a day present on both sides
 * (the crossover day this device upgraded) sums rather than picks a winner.
 * Neither input is mutated. */
function mergeOpens(historical, device) {
  const out = {};
  for (const src of [historical, device]) {
    for (const [path, days] of Object.entries(src || {})) {
      const o = out[path] || (out[path] = {});
      for (const [key, count] of Object.entries(days || {})) {
        o[key] = (o[key] || 0) + count;
      }
    }
  }
  return out;
}

/* Drop day-keys older than the widest selectable window (30 days) plus a
 * small buffer, and any path left with no keys. Pure: the caller decides
 * which log this runs against and owns saving it. `now` overridable for the
 * gates. */
function pruneOpensLog(log, now) {
  for (const path of Object.keys(log)) {
    for (const key of Object.keys(log[path])) {
      const idx = dayIndexOf(key, now);
      if (idx < 0 || idx > 35) delete log[path][key];
    }
    if (!Object.keys(log[path]).length) delete log[path];
  }
  return log;
}

/* Build the focus model from the vault. Pure-ish: everything it reads is
 * passed in, so the test harness can feed it a fake vault. `settings.opens`
 * is expected to already be the merged view (mergeOpens) by the time it
 * gets here. */
function buildModel(app, settings, now) {
  const ref = now || new Date();
  const N = settings.windowDays;
  const acc = makeAccumulator(N, settings.halfLifeDays);
  const files = app.vault.getMarkdownFiles()
    .filter((f) => !isExcluded(f.path, settings.excludeFolders, settings.includeReadmes));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const resolved = (app.metadataCache && app.metadataCache.resolvedLinks) || {};

  for (const f of files) {
    const editDay = dayIndexOfMtime(f.stat.mtime, ref);
    /* 1) edits, from the file's own mtime.
     *
     * Switchable, and default on so nobody's map changes under them. In a
     * vault where scripts rewrite notes in bulk, one bulk pass stamps the
     * same mtime on hundreds of files and the edit signal then measures the
     * script rather than the person. Off, the score keeps only the signals a
     * person leaves: daily-note mentions, backlinks and opens.
     *
     * Note what the switch does NOT do: a backlink is still dated by the
     * source file's edit day, because that is the only date a link has. Off
     * means an edit no longer scores on its own, not that mtime stops being
     * read. */
    if (settings.countFileEdits !== false) acc.add(f.path, editDay, SIGNAL_WEIGHTS.edits, 'edits');
    const links = resolved[f.path] || {};
    const isDaily = DAILY_NOTE_RE.test(f.basename);
    const noteDay = isDaily ? dayIndexOf(f.basename, ref) : -1;
    for (const target of Object.keys(links)) {
      if (!byPath.has(target)) continue;
      if (target === f.path) continue;
      // 2) daily-note mentions, dated by the note's own day
      if (isDaily && noteDay >= 0) acc.add(target, noteDay, SIGNAL_WEIGHTS.mentions, 'mentions');
      // 3) backlinks anywhere, dated by the source's edit day
      else if (editDay >= 0) acc.add(target, editDay, SIGNAL_WEIGHTS.backlinks, 'backlinks');
    }
  }
  // 4) opens logged by the plugin
  for (const [path, days] of Object.entries(settings.opens || {})) {
    if (!byPath.has(path)) continue;
    if (isExcluded(path, settings.excludeFolders, settings.includeReadmes)) continue;
    for (const [key, count] of Object.entries(days)) {
      acc.add(path, dayIndexOf(key, ref), SIGNAL_WEIGHTS.opens * Math.min(count, 5), 'opens');
    }
  }

  const nodes = [];
  for (const it of acc.items.values()) {
    const type = classifyPath(it.path);
    nodes.push({
      path: it.path,
      name: it.path.replace(/\.md$/, '').split('/').pop(),
      type,
      entity: TYPES[type].entity,
      lastDay: it.lastDay,
      score: it.score,
      signals: it.signals,
    });
  }
  nodes.sort((a, b) => a.path < b.path ? -1 : 1);

  // edges among surviving nodes (drawn faintly, both directions deduped)
  const have = new Set(nodes.map((n) => n.path));
  const edges = [];
  const seen = new Set();
  for (const src of Object.keys(resolved)) {
    if (!have.has(src)) continue;
    for (const dst of Object.keys(resolved[src])) {
      if (!have.has(dst) || src === dst) continue;
      const key = src < dst ? src + '\n' + dst : dst + '\n' + src;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([src, dst]);
    }
  }
  return { nodes, edges, windowDays: N };
}

/* ------------------------------------------------------------ attention */

function round3(n) { return Math.round(n * 1000) / 1000; }

/* The same order the list shows and the file records: score first, then the
 * more recently touched, then the path so the order never depends on which
 * way the vault happened to hand the files over. Returns a new array; the
 * caller's is untouched. */
function rankNodes(nodes) {
  return nodes.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.lastDay !== b.lastDay) return a.lastDay - b.lastDay;
    return a.path < b.path ? -1 : 1;
  });
}

function topAttention(nodes, limit) {
  const n = Math.max(1, Math.floor(limit || 10));
  return rankNodes(nodes).slice(0, n);
}

/* One node as a row of the machine-layer file. Scores are rounded to three
 * decimals: they are a ranking, and the last digits of a float are noise a
 * reader would have to pretend to trust. */
function attentionItem(node, now) {
  const s = node.signals || {};
  return {
    path: node.path,
    name: node.name,
    type: node.type,
    score: round3(node.score),
    last_seen: dayKeyAgo(node.lastDay, now),
    signals: {
      edits: round3(s.edits || 0),
      mentions: round3(s.mentions || 0),
      backlinks: round3(s.backlinks || 0),
      opens: round3(s.opens || 0),
    },
  };
}

/* The whole file, as written. Every node in the window, ranked, because a
 * reader that wants a different top N must not have to ask this plugin to
 * recompute with a different setting. `count_file_edits` rides along: the
 * same vault scores differently with the edit signal off, and a reader
 * comparing this number with the vault script's has to know which it got. */
function attentionPayload(model, settings, now) {
  const ref = now || new Date();
  return {
    schema: ATTENTION_SCHEMA,
    generated_at: ref.toISOString(),
    window_days: model.windowDays,
    count_file_edits: (settings || {}).countFileEdits !== false,
    items: rankNodes(model.nodes).map((n) => attentionItem(n, ref)),
  };
}

/* Ring geometry: dynamic band widths. Busy days wide, empty days thin,
 * so chips never cross ring boundaries. Returns per-day inner radius, width,
 * and center radius, plus the total outer radius. */
function bandLayout(nodes, windowDays, coreRadius) {
  const counts = new Array(windowDays + 1).fill(0);
  for (const n of nodes) counts[n.lastDay] += 1;
  const bands = [];
  let r = coreRadius;
  for (let d = 0; d <= windowDays; d++) {
    const c = counts[d];
    const width = c === 0 ? 22 : Math.min(150, 52 + 16 * Math.sqrt(c));
    bands.push({ day: d, count: c, inner: r, width, center: r + width / 2 });
    r += width;
  }
  return { bands, outer: r };
}

/* Stable pseudo-angle per path so items keep their bearing across rebuilds. */
function angleOf(path) {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}

function nodeRadius(node) {
  const r = 4.5 + 2.6 * Math.sqrt(node.score);
  return Math.min(17, node.entity ? Math.max(7, r) : r);
}

/* ---------------------------------------------------------------- view */

class FocusView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.model = { nodes: [], edges: [], windowDays: 7 };
    this.sim = new Map();      // path -> {x,y,vx,vy,node}
    this.bands = null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.hover = null;
    this.drag = null;
    this.raf = 0;
    this.needsKick = 60;
  }

  getViewType() { return VIEW_TYPE_FOCUS; }
  getDisplayText() { return 'Focus'; }
  getIcon() { return 'focus'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('ifocus-root');

    const bar = root.createDiv('ifocus-bar');
    const head = bar.createDiv('ifocus-head');
    head.createDiv({ cls: 'ifocus-kicker', text: 'FOCUS' });
    this.subEl = head.createDiv({ cls: 'ifocus-sub' });

    const controls = bar.createDiv('ifocus-controls');
    const seg = controls.createDiv('ifocus-seg');
    this.segAll = seg.createDiv({ cls: 'ifocus-seg-btn', text: 'ALL' });
    this.segEnt = seg.createDiv({ cls: 'ifocus-seg-btn', text: 'ENTITIES' });
    this.registerDomEvent(this.segAll, 'click', () => this.setEntitiesOnly(false));
    this.registerDomEvent(this.segEnt, 'click', () => this.setEntitiesOnly(true));

    this.rangeEl = controls.createEl('select', { cls: 'ifocus-range dropdown' });
    for (const d of [7, 14, 30]) {
      const o = this.rangeEl.createEl('option', { text: `${d} days`, value: String(d) });
      if (d === this.plugin.settings.windowDays) o.selected = true;
    }
    this.registerDomEvent(this.rangeEl, 'change', async () => {
      this.plugin.settings.windowDays = parseInt(this.rangeEl.value, 10) || 7;
      await this.plugin.saveSettings();
      this.refresh();
    });

    this.gearBtn = controls.createDiv({ cls: 'ifocus-gear clickable-icon' });
    setIcon(this.gearBtn, 'sliders-horizontal');
    this.gearBtn.setAttr('aria-label', 'Display and forces');
    this.registerDomEvent(this.gearBtn, 'click', () => {
      this.panel.toggleClass('is-open', !this.panel.hasClass('is-open'));
      this.gearBtn.toggleClass('is-on', this.panel.hasClass('is-open'));
    });

    const body = root.createDiv('ifocus-body');
    this.stage = body.createDiv('ifocus-stage');
    this.buildList(body);
    this.canvas = this.stage.createEl('canvas', { cls: 'ifocus-canvas' });
    this.buildPanel();
    this.tip = this.stage.createDiv('ifocus-tip');
    this.tip.hide();
    this.legend = this.stage.createDiv('ifocus-legend');
    this.emptyEl = this.stage.createDiv({ cls: 'ifocus-empty', text: 'Nothing in the window yet. Touch a note and it appears here.' });

    this.wirePointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.stage);

    this.refresh();
    this.loop();
  }

  async onClose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.ro) this.ro.disconnect();
  }

  setEntitiesOnly(v) {
    this.plugin.settings.entitiesOnly = v;
    this.plugin.saveSettings();
    this.refresh();
  }

  /* The ranked list beside the map.
   *
   * The map answers "what shape is my attention"; it does not answer "which
   * five notes, in order". The score was computed for every node anyway and
   * was only ever drawn as a radius, so the list says out loud what the map
   * has always known.
   *
   * The heading names the number. There are two attention numbers in this
   * scaffold -- this one and the journal-link count the vault script
   * computes -- and an unlabelled list of topics invites a reader to take
   * one for the other. */
  buildList(parent) {
    this.listEl = parent.createDiv('ifocus-list');
    this.listEl.createDiv({ cls: 'ifocus-list-head', text: 'ATTENTION (FOCUS SCORE)' });
    this.listSubEl = this.listEl.createDiv({ cls: 'ifocus-list-sub' });
    this.listRowsEl = this.listEl.createDiv('ifocus-list-rows');
  }

  /* One row per node: rank, name, score, last seen. Clicking or pressing
   * Enter opens the note, the same contract a click on the map has.
   *
   * The row is a div carrying role, tabindex and a key handler rather than
   * a bare clickable div, for the reason the launcher gives: a surface the
   * keyboard cannot reach is a surface half the people cannot use. */
  renderList() {
    if (!this.listEl) return;
    const s = this.plugin.settings;
    this.listEl.toggleClass('is-hidden', !s.showList);
    if (!s.showList) return;

    const rows = topAttention(this.model.nodes, s.listCount);
    this.listSubEl.setText(`top ${rows.length} · today + ${this.model.windowDays} days`);
    this.listRowsEl.empty();
    if (!rows.length) {
      this.listRowsEl.createDiv({ cls: 'ifocus-list-empty', text: 'Nothing in the window yet.' });
      return;
    }
    rows.forEach((node, i) => {
      const row = this.listRowsEl.createDiv('ifocus-list-row');
      row.setAttr('role', 'button');
      row.setAttr('tabindex', '0');
      const sig = node.signals || {};
      const breakdown = `edits ${round3(sig.edits || 0)}, mentions ${round3(sig.mentions || 0)}, `
        + `backlinks ${round3(sig.backlinks || 0)}, opens ${round3(sig.opens || 0)}`;
      row.setAttr('aria-label', `${node.name}, Focus score ${round3(node.score)}, last seen `
        + `${dayKeyAgo(node.lastDay, new Date())}. Open the note. Score from ${breakdown}.`);
      row.createDiv({ cls: 'ifocus-list-rank', text: String(i + 1) });
      const mid = row.createDiv('ifocus-list-mid');
      const name = mid.createDiv({ cls: 'ifocus-list-name', text: node.name });
      const t = TYPES[node.type];
      if (t) name.style.setProperty('--row-color', t.color);
      mid.createDiv({ cls: 'ifocus-list-day', text: dayKeyAgo(node.lastDay, new Date()) });
      row.createDiv({ cls: 'ifocus-list-score', text: round3(node.score).toFixed(1) });
      /* Exactly what a click on the node does (see the pointer release
         handler): the same path, the same leaf, so the two surfaces cannot
         drift into two behaviours. */
      const open = () => {
        const f = this.plugin.app.vault.getAbstractFileByPath(node.path);
        if (f instanceof TFile) this.plugin.app.workspace.getLeaf('tab').openFile(f);
      };
      this.registerDomEvent(row, 'click', open);
      this.registerDomEvent(row, 'keydown', (evt) => {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        open();
      });
    });
  }

  /* The floating display-and-forces panel, graph-view style. */
  buildPanel() {
    const s = this.plugin.settings;
    this.panel = this.stage.createDiv('ifocus-panel');
    const save = () => { this.plugin.saveSettings(); this.needsKick = Math.max(this.needsKick, 90); };

    const slider = (label, min, max, step, get, set) => {
      const row = this.panel.createDiv('ifocus-p-row');
      row.createDiv({ cls: 'ifocus-p-label', text: label });
      const input = row.createEl('input', { cls: 'ifocus-p-slider' });
      input.type = 'range';
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(get());
      this.registerDomEvent(input, 'input', () => { set(parseFloat(input.value)); save(); });
      return input;
    };

    this.panel.createDiv({ cls: 'ifocus-p-head', text: 'FORCES' });
    slider('Node spacing', 4, 90, 1,
      () => s.nodeSpacing, (v) => { s.nodeSpacing = v; });
    slider('Ring pull', 0.2, 2.5, 0.1,
      () => s.ringPull, (v) => { s.ringPull = v; });

    this.panel.createDiv({ cls: 'ifocus-p-head', text: 'TITLES' });
    const modeRow = this.panel.createDiv('ifocus-p-row');
    modeRow.createDiv({ cls: 'ifocus-p-label', text: 'Show titles' });
    const modeSel = modeRow.createEl('select', { cls: 'dropdown ifocus-p-select' });
    for (const [v, txt] of [['fade', 'Fade by zoom'], ['always', 'Always'], ['hidden', 'Hidden']]) {
      const o = modeSel.createEl('option', { text: txt, value: v });
      if (s.labelMode === v) o.selected = true;
    }
    const fadeSlider = slider('Fade-in zoom', 0.2, 1.6, 0.05,
      () => s.labelFadeZoom, (v) => { s.labelFadeZoom = v; });
    const syncFade = () => fadeSlider.toggleAttribute('disabled', s.labelMode !== 'fade');
    this.registerDomEvent(modeSel, 'change', () => { s.labelMode = modeSel.value; syncFade(); save(); });
    syncFade();

    this.panel.createDiv({ cls: 'ifocus-p-head', text: 'LINKS' });
    const linkRow = this.panel.createDiv('ifocus-p-row');
    linkRow.createDiv({ cls: 'ifocus-p-label', text: 'Link lines' });
    const linkCb = linkRow.createEl('input', { cls: 'ifocus-p-check' });
    linkCb.type = 'checkbox';
    linkCb.checked = !!s.showLinks;
    this.registerDomEvent(linkCb, 'change', () => { s.showLinks = linkCb.checked; save(); });
  }

  /* Rebuild the model, keep existing positions where paths survive. */
  refresh() {
    const s = this.plugin.settings;
    /* opens is device-local now (see the plugin's deviceOpens); merge the
       frozen historical log back in for the render without mutating either
       source or the persisted settings object. */
    const now = new Date();
    const merged = Object.assign({}, s, { opens: mergeOpens(s.opens, this.plugin.deviceOpens) });
    let model = buildModel(this.plugin.app, merged, now);
    /* Every recompute writes the machine-layer file, and it writes the WHOLE
       model: the page toggle below is one person's view of the map, not a
       fact about the vault, and a reader of the file must not inherit it. */
    this.plugin.writeAttention(model, now);
    if (s.entitiesOnly) {
      const keep = new Set(model.nodes.filter((n) => n.entity).map((n) => n.path));
      model = {
        nodes: model.nodes.filter((n) => keep.has(n.path)),
        edges: model.edges.filter(([a, b]) => keep.has(a) && keep.has(b)),
        windowDays: model.windowDays,
      };
    }
    this.model = model;
    this.bands = bandLayout(model.nodes, model.windowDays, 92);

    const next = new Map();
    for (const n of model.nodes) {
      const band = this.bands.bands[n.lastDay];
      const a = angleOf(n.path);
      const prev = this.sim.get(n.path);
      const tx = Math.cos(a) * band.center;
      const ty = Math.sin(a) * band.center;
      next.set(n.path, prev
        ? Object.assign(prev, { node: n, tx, ty, ta: a })
        : { node: n, x: tx * 1.35, y: ty * 1.35, vx: 0, vy: 0, tx, ty, ta: a });
    }
    this.sim = next;
    this.needsKick = 120;

    // header + segment state + legend
    this.subEl.setText(`today + ${model.windowDays} days · ${model.nodes.length} items`);
    this.segAll.toggleClass('is-on', !s.entitiesOnly);
    this.segEnt.toggleClass('is-on', s.entitiesOnly);
    this.legend.empty();
    const present = new Set(model.nodes.map((n) => n.type));
    for (const [key, t] of Object.entries(TYPES)) {
      if (!present.has(key)) continue;
      const row = this.legend.createDiv('ifocus-lg-row');
      const dot = row.createDiv({ cls: 'ifocus-lg-dot ifocus-shape-' + t.shape });
      dot.style.setProperty('--lg-color', t.color);
      row.createDiv({ cls: 'ifocus-lg-name', text: t.label });
    }
    if (model.nodes.length) this.emptyEl.hide(); else this.emptyEl.show();
    this.renderList();
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.needsKick = Math.max(this.needsKick, 2);
  }

  /* stage px -> world coords */
  toWorld(px, py) {
    const rect = this.stage.getBoundingClientRect();
    const cx = rect.width / 2 + this.pan.x;
    const cy = rect.height / 2 + this.pan.y;
    return { x: (px - cx) / this.zoom, y: (py - cy) / this.zoom };
  }

  hitTest(px, py) {
    const w = this.toWorld(px, py);
    let best = null; let bestD = 1e9;
    for (const s of this.sim.values()) {
      const r = nodeRadius(s.node) + 4 / this.zoom;
      const d = Math.hypot(s.x - w.x, s.y - w.y);
      if (d < r && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  wirePointer() {
    const c = this.canvas;
    this.pointers = new Map();
    this.pinch = null;
    const startPinch = () => {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.tip.hide();
      this.pinch = { d0: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: this.zoom };
    };
    this.registerDomEvent(c, 'pointerdown', (e) => {
      const rect = this.stage.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      this.pointers.set(e.pointerId, { x: px, y: py });
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* touch may refuse capture */ }
      if (this.pointers.size === 2) { startPinch(); return; }
      if (this.pointers.size > 2) return;
      const hit = this.hitTest(px, py);
      this.drag = hit
        ? { kind: 'node', s: hit, moved: false, sx: px, sy: py }
        : { kind: 'pan', px, py, moved: false, sx: px, sy: py };
    });
    this.registerDomEvent(c, 'pointermove', (e) => {
      const rect = this.stage.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: px, y: py });
      if (this.pinch && this.pointers.size >= 2) {
        // two-finger pinch: zoom around the midpoint, like wheel-zoom around
        // the cursor
        const [a, b] = [...this.pointers.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const d = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
        const before = this.toWorld(mx, my);
        this.zoom = Math.min(3, Math.max(0.35, this.pinch.zoom0 * (d / this.pinch.d0)));
        const after = this.toWorld(mx, my);
        this.pan.x += (after.x - before.x) * this.zoom;
        this.pan.y += (after.y - before.y) * this.zoom;
        this.needsKick = Math.max(this.needsKick, 2);
        return;
      }
      if (this.drag) {
        // tap tolerance: a finger wobbles a few px; only past 5px is it a drag
        if (!this.drag.moved
          && Math.hypot(px - this.drag.sx, py - this.drag.sy) <= 5) return;
        this.drag.moved = true;
        if (this.drag.kind === 'node') {
          const w = this.toWorld(px, py);
          this.drag.s.x = w.x; this.drag.s.y = w.y;
          this.drag.s.vx = 0; this.drag.s.vy = 0;
        } else {
          this.pan.x += px - this.drag.px;
          this.pan.y += py - this.drag.py;
          this.drag.px = px; this.drag.py = py;
        }
        this.needsKick = Math.max(this.needsKick, 2);
        return;
      }
      if (e.pointerType === 'touch') return; // no hover state on touch
      const hit = this.hitTest(px, py);
      const prevHover = this.hover;
      this.hover = hit ? hit.node.path : null;
      c.toggleClass('is-hit', !!hit);
      if (hit) {
        const t = TYPES[hit.node.type];
        const when = hit.node.lastDay === 0 ? 'today'
          : hit.node.lastDay === 1 ? 'yesterday' : `${hit.node.lastDay} days ago`;
        this.tip.setText(`${hit.node.name} \u00b7 ${t.label} \u00b7 ${when}`);
        this.tip.style.left = Math.round(px + 14) + 'px';
        this.tip.style.top = Math.round(py + 10) + 'px';
        this.tip.show();
        // native page-preview popover, like hovering a link in a note
        if (prevHover !== this.hover) {
          this.plugin.app.workspace.trigger('hover-link', {
            event: e,
            source: 'icor-focus',
            hoverParent: this,
            targetEl: c,
            linktext: hit.node.path,
            sourcePath: hit.node.path,
          });
        }
      } else this.tip.hide();
      this.needsKick = Math.max(this.needsKick, 1);
    });
    const release = (e, mayOpen) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.needsKick = Math.max(this.needsKick, 10);
        return;
      }
      const d = this.drag;
      this.drag = null;
      if (mayOpen && d && d.kind === 'node' && !d.moved) {
        const f = this.plugin.app.vault.getAbstractFileByPath(d.s.node.path);
        if (f instanceof TFile) this.plugin.app.workspace.getLeaf('tab').openFile(f);
      }
      this.needsKick = Math.max(this.needsKick, 30);
    };
    this.registerDomEvent(c, 'pointerup', (e) => release(e, true));
    this.registerDomEvent(c, 'pointercancel', (e) => release(e, false));
    this.registerDomEvent(c, 'pointerleave', () => { this.hover = null; this.tip.hide(); });
    this.registerDomEvent(c, 'wheel', (e) => {
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const before = this.toWorld(px, py);
      this.zoom = Math.min(3, Math.max(0.35, this.zoom * Math.exp(-e.deltaY * 0.0016)));
      const after = this.toWorld(px, py);
      this.pan.x += (after.x - before.x) * this.zoom;
      this.pan.y += (after.y - before.y) * this.zoom;
      this.needsKick = Math.max(this.needsKick, 2);
    }, { passive: false });
  }

  step() {
    const arr = [...this.sim.values()];
    let energy = 0;
    for (const s of arr) {
      if (this.drag && this.drag.kind === 'node' && this.drag.s === s) continue;
      // radial spring toward the band center, angular spring toward home bearing
      const r = Math.hypot(s.x, s.y) || 0.001;
      const band = this.bands.bands[s.node.lastDay];
      const ux = s.x / r, uy = s.y / r;
      const radialF = (band.center - r) * 0.012 * (this.plugin.settings.ringPull || 1);
      s.vx += ux * radialF; s.vy += uy * radialF;
      const targetX = Math.cos(s.ta) * r, targetY = Math.sin(s.ta) * r;
      s.vx += (targetX - s.x) * 0.0022; s.vy += (targetY - s.y) * 0.0022;
    }
    // pairwise separation (n is small; O(n^2) is fine)
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = nodeRadius(a.node) + nodeRadius(b.node)
          + (this.plugin.settings.nodeSpacing != null ? this.plugin.settings.nodeSpacing : 26);
        if (d < min) {
          const push = (min - d) / d * 0.06;
          const px = dx * push, py = dy * push;
          a.vx -= px; a.vy -= py; b.vx += px; b.vy += py;
        }
      }
    }
    for (const s of arr) {
      if (this.drag && this.drag.kind === 'node' && this.drag.s === s) continue;
      s.vx *= 0.86; s.vy *= 0.86;
      s.x += s.vx; s.y += s.vy;
      energy += Math.abs(s.vx) + Math.abs(s.vy);
    }
    return energy;
  }

  cssVar(name, fallback) {
    const v = getComputedStyle(this.canvas).getPropertyValue(name).trim();
    return v || fallback;
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + this.pan.x, H / 2 + this.pan.y);
    ctx.scale(this.zoom, this.zoom);

    const dark = document.body.hasClass('theme-dark');
    const ink = dark ? '#f6f3ec' : '#1c212b';
    const faint = dark ? 'rgba(246,243,236,' : 'rgba(28,33,43,';
    const marker = this.cssVar('--ink-marker', '#ff5a2d');

    // day rings, boundary circles + labels up the 12 o'clock axis
    ctx.lineWidth = 1 / this.zoom;
    for (const band of this.bands.bands) {
      const edge = band.inner + band.width;
      ctx.beginPath();
      ctx.arc(0, 0, edge, 0, Math.PI * 2);
      if (band.day === 0) {
        // today's boundary: dashed, in the marker accent
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = marker;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = faint + (band.day % 2 ? '0.05)' : '0.09)');
        ctx.stroke();
      }
      if (band.count > 0 || band.day === 0) {
        ctx.fillStyle = band.day === 0 ? marker : faint + '0.42)';
        ctx.font = `${Math.max(9, 10 / this.zoom)}px "Spline Sans Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        const label = band.day === 0 ? 'TODAY' : `-${band.day}D`;
        ctx.fillText(label, 0, -band.center + 3);
      }
    }

    // link lines among visible nodes
    if (this.plugin.settings.showLinks) {
      ctx.strokeStyle = faint + '0.10)';
      ctx.lineWidth = 1 / this.zoom;
      for (const [a, b] of this.model.edges) {
        const sa = this.sim.get(a), sb = this.sim.get(b);
        if (!sa || !sb) continue;
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
    }

    // the user disk in the center
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#10131a' : '#f6f3ec';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = marker;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = faint + '0.25)';
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = '600 21px Caveat, cursive';
    ctx.textAlign = 'center';
    ctx.fillText('you', 0, 7);

    // nodes + labels
    const st = this.plugin.settings;
    for (const s of this.sim.values()) {
      const n = s.node;
      const r = nodeRadius(n);
      const t = TYPES[n.type];
      const isHover = this.hover === n.path;
      traceShape(ctx, t.shape, s.x, s.y, r);
      if (isHollow(t.shape)) {
        // people and companies: open outline plus a small core
        ctx.lineWidth = Math.max(2.5, r * 0.45);
        ctx.strokeStyle = t.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.fill();
      } else {
        ctx.fillStyle = t.color;
        ctx.globalAlpha = n.entity ? 1 : 0.78;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (n.entity || isHover) {
        traceShape(ctx, t.shape, s.x, s.y, isHollow(t.shape) ? r * 1.22 : r);
        ctx.lineWidth = (isHover ? 2 : 1.2) / this.zoom;
        ctx.strokeStyle = isHover ? marker : faint + '0.55)';
        ctx.stroke();
      }
      const labelAlpha = labelAlphaOf(st.labelMode, this.zoom, st.labelFadeZoom, n.entity, isHover);
      if (labelAlpha > 0.03) {
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = ink;
        ctx.font = `${11 / Math.sqrt(this.zoom)}px "Instrument Sans", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const name = n.name.length > 26 ? n.name.slice(0, 25) + '…' : n.name;
        ctx.fillText(name, s.x, s.y + r + 13 / Math.sqrt(this.zoom));
        ctx.globalAlpha = 1;
      }
    }
  }

  loop() {
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (!this.canvas.isConnected) return;
      const energy = this.step();
      if (energy > 0.25 || this.needsKick > 0) {
        this.needsKick = Math.max(0, this.needsKick - 1);
        this.draw();
      }
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/* ---------------------------------------------------------------- plugin */

class IcorFocusPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.deviceOpens = this.app.loadLocalStorage(OPENS_STORAGE_KEY) || {};
    this.registerView(VIEW_TYPE_FOCUS, (leaf) => new FocusView(leaf, this));
    this.addCommand({
      id: 'open-focus',
      name: 'Open the Focus map',
      callback: () => this.openFocus(),
    });
    this.addSettingTab(new IcorFocusSettingTab(this.app, this));

    // instant page previews from the map, no modifier key needed
    if (typeof this.registerHoverLinkSource === 'function') {
      this.registerHoverLinkSource('icor-focus', {
        display: 'ICOR for Life - Focus', defaultMod: false,
      });
    }

    // opens log -- this device's own, local storage, never data.json (fix 2)
    this.registerEvent(this.app.workspace.on('file-open', (f) => {
      if (!f || f.extension !== 'md') return;
      const key = todayKey();
      const o = this.deviceOpens;
      if (!o[f.path]) o[f.path] = {};
      o[f.path][key] = (o[f.path][key] || 0) + 1;
      this.pruneOpens();
      this.saveSoon();
    }));

    // live refresh of any open focus view when the vault changes
    const kick = debounce(() => this.refreshViews(), 900, true);
    this.registerEvent(this.app.vault.on('modify', kick));
    this.registerEvent(this.app.vault.on('create', kick));
    this.registerEvent(this.app.vault.on('delete', kick));
    this.registerEvent(this.app.vault.on('rename', kick));
    this.registerEvent(this.app.metadataCache.on('resolved', kick));

    /* A ROOM THAT IS NOT THERE MUST SAY SO.
     *
     * The failure this closes is not a crash, it is a shrug: before the room
     * numbers above, a renamed room matched nothing and the map lost a whole
     * class of note without a single line in the console. A contract keyed on a
     * value someone else can change has to announce it when it breaks, or the
     * plugin just quietly does less and everybody assumes that is the shape of
     * the vault. Said once, at load, and never again. */
    this.app.workspace.onLayoutReady(() => this.reportMissingRooms());

    // the launcher under the ICOR for Life banner
    this.app.workspace.onLayoutReady(() => this.mountLauncher());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountLauncher()));

    this.saveSoon = debounce(() => this.saveDeviceOpens(), 4000, true);
  }

  /* Recompute every open map. A settings change that alters the score or
     the list has to land on the page the person is looking at, and on the
     written file with it. */
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS)) {
      if (leaf.view instanceof FocusView) leaf.view.refresh();
    }
  }

  /* Write the ranked model to the machine layer (GL-1008).
   *
   * Four rules from the guideline, all of them load-bearing:
   *   - the adapter, never the Vault API and never `fs`: a dot folder is
   *     invisible to the Vault API, and the adapter is the same call on a
   *     phone;
   *   - `exists` then `mkdir` every time, because a vault that arrived on a
   *     second device through Obsidian Sync does not have the folder (Sync
   *     skips dot folders) and a vault built by hand never had it;
   *   - only this plugin's own `<plugin-id>/` subfolder;
   *   - the file is regenerated, never a source. Delete it and the next
   *     recompute brings it back whole.
   *
   * A failed write is logged once and swallowed: the map is the product and
   * a read-only or full disk must not take it down. */
  async writeAttention(model, now) {
    const adapter = this.app.vault && this.app.vault.adapter;
    if (!adapter) return;
    try {
      for (const dir of [META_DIR, ATTENTION_DIR]) {
        const p = normalizePath(dir);
        if (!(await adapter.exists(p))) await adapter.mkdir(p);
      }
      const payload = attentionPayload(model, this.settings, now);
      await adapter.write(normalizePath(ATTENTION_PATH), JSON.stringify(payload, null, 2));
    } catch (err) {
      console.warn(`ICOR for Life - Focus: could not write ${ATTENTION_PATH}`, err);
    }
  }

  reportMissingRooms() {
    const names = this.app.vault.getRoot().children
      .filter((f) => f.children !== undefined)
      .map((f) => f.name);
    // A vault with no numbered rooms at all is not a scaffold, and telling
    // someone their plain vault is broken would be the louder wrong answer.
    if (names.every((n) => !/^\d{2}/.test(n))) return;
    const missing = missingRooms(names);
    if (missing.length === 0) return;
    const message = `ICOR for Life - Focus: this vault has no room ${missing.join(', ')}. `
      + 'Those notes will be drawn as ordinary notes until the rooms are there.';
    console.warn(message);
    new Notice(message, 12000);
  }

  onunload() {
    for (const el of document.querySelectorAll('.ifocus-launcher')) el.remove();
  }

  pruneOpens() {
    pruneOpensLog(this.deviceOpens);
  }

  /* Icon-only launcher inside the file explorer's tool-button row.
   *
   * This row rather than the ribbon, because the ICOR for Life scaffold hides
   * the left ribbon and an icon on a hidden surface is not an entry point.
   * The palette keeps `Open the Focus map` either way, so this is a second
   * route rather than the only one - but it is the only VISIBLE one.
   *
   * The role, the tabindex and the key handler are deliberately MORE than
   * Obsidian's own `addNavButton`, which makes a bare div with a click
   * listener and no tab stop. The INKLINE theme already ships a
   * `:focus-visible` ring for this slot, and a ring nothing can ever focus is
   * a rule that reads as enforced and never fires. */
  mountLauncher() {
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const row = leaf.view && leaf.view.containerEl
        && leaf.view.containerEl.querySelector('.nav-buttons-container');
      if (!row || row.querySelector('.ifocus-launcher')) continue;
      const btn = row.createDiv({ cls: 'clickable-icon nav-action-button ifocus-launcher' });
      setIcon(btn, 'focus');
      btn.setAttr('aria-label', 'Open the Focus map');
      btn.setAttr('role', 'button');
      btn.setAttr('tabindex', '0');
      this.registerDomEvent(btn, 'click', () => this.openFocus());
      this.registerDomEvent(btn, 'keydown', (evt) => {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        this.openFocus();
      });
    }
  }

  async openFocus() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_FOCUS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.opens) this.settings.opens = {};
  }

  async saveSettings() { await this.saveData(this.settings); }

  saveDeviceOpens() {
    this.app.saveLocalStorage(OPENS_STORAGE_KEY, this.deviceOpens);
  }
}

/* ---------------------------------------------------------------- settings */

class IcorFocusSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('The window').setHeading();
    new Setting(containerEl)
      .setName('Days shown')
      .setDesc('Today plus this many past days. The page range selector changes the same value.')
      .addDropdown((d) => {
        d.addOption('7', '7 days').addOption('14', '14 days').addOption('30', '30 days')
          .setValue(String(this.plugin.settings.windowDays))
          .onChange(async (v) => {
            this.plugin.settings.windowDays = parseInt(v, 10) || 7;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName('What appears').setHeading();
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('One folder path per line. Notes inside never appear on the map.')
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.excludeFolders.join('\n'))
          .onChange(async (v) => {
            this.plugin.settings.excludeFolders =
              v.split('\n').map((s) => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          });
        t.inputEl.rows = 3;
      });
    new Setting(containerEl)
      .setName('Include README files')
      .addToggle((t) => t.setValue(this.plugin.settings.includeReadmes)
        .onChange(async (v) => {
          this.plugin.settings.includeReadmes = v;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName('Draw link lines')
      .setDesc('Faint lines between items that link to each other.')
      .addToggle((t) => t.setValue(this.plugin.settings.showLinks)
        .onChange(async (v) => {
          this.plugin.settings.showLinks = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('What counts').setHeading();
    new Setting(containerEl)
      .setName('Count file edits')
      .setDesc('On, a file being edited counts towards its score. Turn it off in a vault '
        + 'where scripts rewrite many notes at once: one bulk pass stamps the same edit '
        + 'time on hundreds of files, and the score then measures the script instead of '
        + 'you. Off, only mentions in daily notes, backlinks and your own opens count.')
      .addToggle((t) => t.setValue(this.plugin.settings.countFileEdits !== false)
        .onChange(async (v) => {
          this.plugin.settings.countFileEdits = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(containerEl).setName('The list').setHeading();
    new Setting(containerEl)
      .setName('Show the ranked list')
      .setDesc('The list beside the map, highest score first.')
      .addToggle((t) => t.setValue(this.plugin.settings.showList !== false)
        .onChange(async (v) => {
          this.plugin.settings.showList = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
    new Setting(containerEl)
      .setName('Rows in the list')
      .setDesc('How many notes the list shows. The written file always carries every '
        + 'note in the window, whatever this says.')
      .addSlider((sl) => sl.setLimits(3, 30, 1)
        .setValue(this.plugin.settings.listCount || 10)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.listCount = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
  }
}

module.exports = IcorFocusPlugin;
module.exports.default = IcorFocusPlugin;
module.exports.__test = {
  classifyPath, roomOf, missingRooms, ROOM_CLASS, EXPECTED_ROOMS,
  dayKeyOf, dayIndexOf, dayIndexOfMtime, makeAccumulator,
  isExcluded, buildModel, bandLayout, angleOf, nodeRadius, TYPES,
  traceShape, labelAlphaOf, mergeOpens, pruneOpensLog, OPENS_STORAGE_KEY,
  DEFAULT_SETTINGS, FocusView, IcorFocusPlugin, VIEW_TYPE_FOCUS,
  rankNodes, topAttention, attentionItem, attentionPayload, dayKeyAgo, round3,
  SIGNAL_WEIGHTS, META_DIR, ATTENTION_DIR, ATTENTION_PATH, ATTENTION_SCHEMA,
};
