# ICOR Focus

A gravity map with you at the center. Open it and the question "what am I
actually working on?" answers itself in one look: everything you touched
today orbits close, older work ripples outward ring by ring, and your Key
Elements, Projects, Topics, Habits, Goals and Contacts each keep their own
color and shape while everything else renders neutral.

Most graph views show you the structure of your vault. ICOR Focus shows
you your attention. Distance here is not decoration: it is computed
deterministically from concrete signals (edits, mentions, backlinks,
opens), so the same day always draws the same map, and a project drifting
toward the outer rings is real information, not layout noise. The canvas
only renders what the signals say.

**Beta release.** This plugin works and is in daily use in a real vault,
but you will find rough edges. If something looks off, open an issue on
this repo and it gets fixed fast.

## Signals

An item's ring is its most recent interaction; its size is a decayed
intensity score. Four signals feed both:

- **File edits** - the file's modification day (covers you and the AI team)
- **Daily-note mentions** - `[[wikilinks]]` in daily notes, dated by the note's day (weight 3)
- **Backlinks anywhere** - a note edited on day X that links to Y counts for Y on day X
- **Opens** - every note you open is logged locally (in `data.json`, pruned after 35 days)

## The page

- `FOCUS` button under the ICOR for Life banner in the file tree, or the
  command `ICOR Focus: Open the Focus map`
- Ring widths are dynamic: busy days wide, empty days thin
- `ALL | ENTITIES` toggle on the page; range selector 7 / 14 / 30 days
- Drag nodes, pan the canvas, mousewheel zoom; click a node to open the note
- Faint lines connect items that link to each other (can be turned off)

## Privacy: no network use at all

ICOR Focus makes no network requests, and there is no telemetry. Every
signal it uses is computed from your own vault, and the log of which notes
you opened stays in this plugin's local `data.json`, pruned after 35 days.
Nothing leaves your machine.

## Install

Requires Obsidian 1.4.0 or newer.

- **From Obsidian:** Settings, Community plugins, Browse, search "ICOR
  Focus", install, enable.
- **Manually:** copy `main.js`, `manifest.json` and `styles.css` from the
  latest release into `.obsidian/plugins/icor-for-life-focus/` and enable the
  plugin.

No build step: `main.js` is hand-written CommonJS. Works on desktop and
mobile: on a touch screen, drag with one finger, pinch with two to zoom,
tap a node to open the note.

## ICOR for Life Obsidian Edition

ICOR Focus is the review surface of the **ICOR for Life Obsidian
Edition**: ICOR (Input, Control, Output, Refine), the productivity
methodology by Paperless Movement / myICOR, implemented as a ready-to-use
Obsidian vault. Best to be used in combination with:

- **[ICOR Planner](https://obsidian.md/plugins?id=icor-for-life-planner)**, the weekly
  planning board: Todoist, ClickUp, starred email and Google Calendar
  synced into the vault, planned by drag and drop. Focus shows you what
  is drifting to the outer rings; the Planner is where you drag it back
  into the week.
- **[myICOR INKLINE theme](https://community.obsidian.md/themes/icor-for-life-inkline)**,
  the hand-drawn ICOR look every surface of the Edition is designed
  against. The Focus canvas rides the same token grammar, so the map
  matches your vault in ink and paper mode alike.
- **[myICOR Connect](https://obsidian.md/plugins?id=icor-for-life-connect)**, your
  app.myicor.com account inside the vault. The reviewing habit this map
  is built for is taught in the ICOR Journey on myicor.com; Connect
  brings those courses next to your notes.
- **[ICOR Diagrams](https://obsidian.md/plugins?id=icor-for-life-diagrams)**, a
  fullscreen viewer with zoom and pan for the mermaid diagrams in your
  notes. Same instinct as this map: see the shape of a thing instead of
  scrolling through it.
- **[ICOR AI Chat](https://obsidian.md/plugins?id=icor-for-life-chat)**, your AI team
  in a tab beside your notes, working from your vault's own instructions.
  When the map shows something drifting to the outer rings, the team is one
  tab away to work out why.

The complete, preconfigured experience (theme, all plugins, the seven-room
vault structure and the AI team) ships free as the **ICOR for Life**
vault: https://myicor.com

## License

Please note that while the source can be read and modified for your
personal use, this plugin is not open source. It is licensed under the
ICOR for Life Source-Available License (Code) - see the `LICENSE` file
for the full terms. Third-party notices live in `THIRD-PARTY-NOTICES.md`.
