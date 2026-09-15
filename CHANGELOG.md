# Changelog

All notable changes to ICOR for Life - Focus.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.6.0 carry their notes on the GitHub release itself
(the commit subjects since the previous tag).

## [0.6.0] - 2026-09-15

Pending Flint's review-before-ship. Not released until that read is done.

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
