/* ICOR Focus - a user-centered gravity map of the Lifeworld.
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
} = require('obsidian');

const VIEW_TYPE_FOCUS = 'icor-focus-view';

const DEFAULT_SETTINGS = {
  windowDays: 7,            // past days shown beyond today
  excludeFolders: ['05 Assets'],
  includeReadmes: false,
  showLinks: true,
  entitiesOnly: false,      // page toggle, persisted
  halfLifeDays: 3,          // decay half-life for the intensity score
  nodeSpacing: 26,          // extra separation between nodes, px
  ringPull: 1,              // radial spring multiplier
  labelMode: 'fade',        // 'fade' | 'always' | 'hidden'
  labelFadeZoom: 0.55,      // zoom level where fading labels appear
  opens: {},                // path -> { 'YYYY-MM-DD': count }
};

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

const DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- model */

/* Interactions accumulate per path: keep the most recent day index and a
 * decayed intensity score. Weights: daily-note mention 3, edit 2, open 2,
 * backlink 1. */
function makeAccumulator(windowDays, halfLifeDays) {
  const items = new Map();
  return {
    add(path, dayIdx, weight) {
      if (dayIdx < 0 || dayIdx > windowDays) return;
      let it = items.get(path);
      if (!it) { it = { path, lastDay: dayIdx, score: 0 }; items.set(path, it); }
      if (dayIdx < it.lastDay) it.lastDay = dayIdx;
      it.score += weight * Math.pow(0.5, dayIdx / halfLifeDays);
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

/* Build the focus model from the vault. Pure-ish: everything it reads is
 * passed in, so the test harness can feed it a fake vault. */
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
    // 1) edits
    acc.add(f.path, editDay, 2);
    const links = resolved[f.path] || {};
    const isDaily = DAILY_NOTE_RE.test(f.basename);
    const noteDay = isDaily ? dayIndexOf(f.basename, ref) : -1;
    for (const target of Object.keys(links)) {
      if (!byPath.has(target)) continue;
      if (target === f.path) continue;
      // 2) daily-note mentions, dated by the note's own day
      if (isDaily && noteDay >= 0) acc.add(target, noteDay, 3);
      // 3) backlinks anywhere, dated by the source's edit day
      else if (editDay >= 0) acc.add(target, editDay, 1);
    }
  }
  // 4) opens logged by the plugin
  for (const [path, days] of Object.entries(settings.opens || {})) {
    if (!byPath.has(path)) continue;
    if (isExcluded(path, settings.excludeFolders, settings.includeReadmes)) continue;
    for (const [key, count] of Object.entries(days)) {
      acc.add(path, dayIndexOf(key, ref), 2 * Math.min(count, 5));
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

    this.stage = root.createDiv('ifocus-stage');
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
    let model = buildModel(this.plugin.app, s, new Date());
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
        display: 'ICOR Focus', defaultMod: false,
      });
    }

    // opens log
    this.registerEvent(this.app.workspace.on('file-open', (f) => {
      if (!f || f.extension !== 'md') return;
      const key = todayKey();
      const o = this.settings.opens;
      if (!o[f.path]) o[f.path] = {};
      o[f.path][key] = (o[f.path][key] || 0) + 1;
      this.pruneOpens();
      this.saveSoon();
    }));

    // live refresh of any open focus view when the vault changes
    const kick = debounce(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FOCUS)) {
        if (leaf.view instanceof FocusView) leaf.view.refresh();
      }
    }, 900, true);
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

    this.saveSoon = debounce(() => this.saveSettings(), 4000, true);
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
    const message = `ICOR Focus: this vault has no room ${missing.join(', ')}. `
      + 'Those notes will be drawn as ordinary notes until the rooms are there.';
    console.warn(message);
    new Notice(message, 12000);
  }

  onunload() {
    for (const el of document.querySelectorAll('.ifocus-launcher')) el.remove();
  }

  pruneOpens() {
    const o = this.settings.opens;
    for (const path of Object.keys(o)) {
      for (const key of Object.keys(o[path])) {
        const idx = dayIndexOf(key);
        if (idx < 0 || idx > 35) delete o[path][key];
      }
      if (!Object.keys(o[path]).length) delete o[path];
    }
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
  }
}

module.exports = IcorFocusPlugin;
module.exports.default = IcorFocusPlugin;
module.exports.__test = {
  classifyPath, roomOf, missingRooms, ROOM_CLASS, EXPECTED_ROOMS,
  dayKeyOf, dayIndexOf, dayIndexOfMtime, makeAccumulator,
  isExcluded, buildModel, bandLayout, angleOf, nodeRadius, TYPES,
  traceShape, labelAlphaOf,
  DEFAULT_SETTINGS, FocusView, IcorFocusPlugin, VIEW_TYPE_FOCUS,
};
