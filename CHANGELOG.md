# Changelog

All notable changes to ICOR for Life - Focus.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.6.0 carry their notes on the GitHub release itself
(the commit subjects since the previous tag).

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
