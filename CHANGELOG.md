# Changelog

All notable changes to ICOR for Life - Focus.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.6.0 carry their notes on the GitHub release itself
(the commit subjects since the previous tag).

## [0.8.0] - 2026-11-23

### Changed
- **The map knows ICOR for Life 3.0's folders.** 3.0 renumbers the vault's
  folders and groups them by stage: Input (`00 Daily Notes`, `01 Inbox`),
  Control (`02 Inner World`, `03 Outer World`, `04 Assets`, `05 Databases`)
  and Output (`06 Planner`). Your daily notes, inbox, Planner tasks and the
  Key Elements, Projects, Topics, Habits, Goals and Contacts in
  `02 Inner World` keep their colours and shapes.
- **Folders are matched by their full name, never by their number.** 3.0
  reuses numbers: 02 was the Planner and is now the Inner World, 04 was the
  Inner World and is now Assets, and `06 Planner` shares its 06 with an old
  `06 AI Team`. Matching by number would have drawn your Projects as Planner
  tasks. A vault that has not moved to 3.0 keeps its colours under its old
  names (`00 Daily Scratchpad`, `04 Inner World`, `02 Planner`). A folder you
  renamed yourself is drawn as ordinary notes.
- **Assets are left off the map as `04 Assets`.** If your Excluded folders
  setting still says `05 Assets`, it stays that way while the vault has that
  folder, and becomes `04 Assets` (saved) once the vault has moved. A list
  you changed yourself is never touched.
- **The work-in-progress colour is gone**, with the folder: 3.0 has none. A
  leftover `03 WiP` folder is drawn as ordinary notes.
- The notice about a missing folder says "folder" and names it by its 3.0
  name.

## [0.7.1] - 2026-11-21

### Fixed
- **The map no longer slows Obsidian down.** Its drawing loop ran every
  frame for as long as a Focus tab existed, even in the background, and
  compared every drawn note with every other. It now sleeps once the map
  has settled or when the tab is hidden, and wakes on a pointer, a zoom, a
  refresh or when the tab comes back.
- **At most 300 notes are drawn**, the ones that score highest; the
  header says how many more there are. `attention.json` still holds the
  whole ranking.
- **A hidden map does not recompute** on every vault change; it catches up
  when it is shown.
- **`attention.json` is written only when the ranking changed**, not every
  few seconds while you type.

## [0.7.0] - 2026-09-21

### Changed
- Relicensed under MIT. Releases before 0.7.0 remain under the ICOR for Life
  Source-Available License (Code) v1.0.
- Release workflow: the guard job's checkout pinned to a commit SHA.

## [0.6.0] - 2026-09-15

### Added
- **A ranked list beside the map.** The map has always known which notes
  carry your attention; it only ever drew it as a radius. The list now says
  it: highest score first, with the score and the day each note was last
  touched. Click a row, or tab to it and press Enter, and the note opens.
  Ten rows by default, and settings change the number or hide the list.

  It is headed **Attention (Focus score)**, because a scaffold can hold more
  than one attention number and an unlabelled list of topics invites you to
  read one as the other.
- **The ranking is written to disk, once per recompute**, at
  `.icor-for-life/icor-for-life-focus/attention.json` with `schema: 1`, so a
  script, the AI chat or another plugin can read the same number instead of
  computing a second one. The file carries every note in the window, not
  just the rows the list shows, and each item splits its score by signal
  (edits, mentions, backlinks, opens). The shape is documented in the README
  under "Machine layer". The folder is hidden, the write goes through the
  vault adapter, and the file is regenerated, never a source: delete it and
  the next recompute brings it back.
- **A "Count file edits" setting**, on by default so no existing map
  changes. Turn it off in a vault where scripts rewrite many notes at once:
  one bulk pass stamps the same edit time on hundreds of files, and the
  score then measures the script rather than you. Off, only mentions in
  daily notes, backlinks and your own opens count. Backlinks are still dated
  by the day their source file was edited, because that is the only date a
  link has.
- **On a phone the list sits under the map, not beside it.** Side by side
  the list takes a fixed 248px, which on a phone would have left the map
  about 140px wide: the new feature would have taken the old one away. On a
  phone the two stack, map first, and the rows scroll inside a capped box so
  a long list cannot push the map off the screen. The setting still turns
  the list off entirely.

  Stated plainly, because it matters for what was and was not proven: the
  rules are gated as text by `test/phone-layout.test.mjs`, but the rendered
  result was not checked. `App.emulateMobile(true)` is a method on the
  running Obsidian app and this suite is plain `node --test` against the
  bundle, so there is no headless way to run it. The render needs a person
  with the plugin installed, on a phone or with mobile emulation on.

### Internal
- The row colour is set through `setCssProps` rather than
  `style.setProperty`, the form the Obsidian API sanctions for a dynamic
  custom property.
