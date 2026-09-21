# ICOR for Life - Focus

**See where your attention actually went.**

You sit at the center. Everything you worked on today orbits close, older
work ripples outward ring by ring, and the question "what am I actually
working on?" answers itself in one look.

Part of the [ICOR for Life](https://myicor.com) suite.

## What it is for

A graph view shows you the shape of your vault. That is interesting once and
then never again, because the shape barely changes.

This shows you something that changes every day: where your attention has
been going. A project drifting toward the outer rings is real information. So
is a Topic you swore you were exploring sitting three rings out, untouched
since last month.

Use it at the start of a week to see what you actually did last week, rather
than what you remember doing.

## Getting started

Click **FOCUS** under the ICOR for Life banner in the file tree, or run
**Open the Focus map** from the command palette.

There is nothing to set up and nothing to configure. The map draws itself
from what is already in your vault.

## Reading the map

- **Distance is recency.** The closest ring is today; each ring out is older.
  Busy days draw wide rings, quiet days thin ones.
- **Size is intensity.** A note you touched repeatedly is bigger than one you
  opened once.
- **Colour is kind.** Key Elements, Projects, Topics, Habits, Goals and
  Contacts each keep their own colour and shape; everything else stays
  neutral so it does not compete.
- **The same day always draws the same map.** Position is computed from what
  happened, not from a layout algorithm looking for a pleasing arrangement.
  If something moved, something changed.

Toggle between everything and entities only, switch the range between 7, 14
and 30 days, drag nodes, pan, zoom, and click any node to open the note.

## The list beside the map

The map shows you the shape. The list beside it names the notes: highest
score first, with the score and the day each one was last touched. Click a
row, or tab to it and press Enter, and the note opens in a new tab.

It is headed **Attention (Focus score)** on purpose. If you also run a
script that counts how often you wrote about something in your journal, that
is a different number measuring a different thing. Both are useful; neither
is the other.

The list shows ten notes by default. Settings change that, and can hide the
list altogether.

## What it counts

Four things, all of them already in your vault or on your machine:

- **Edits**, so work the AI team did on your behalf counts too.
- **Mentions in daily notes**, dated by the day of the note.
- **Backlinks**, so a note edited today pulls what it links to along with it.
- **Opens**, logged on this device only and pruned after 35 days.

**Count file edits** in settings turns the first one off. Turn it off if
scripts rewrite many notes in your vault at once: one bulk pass stamps the
same edit time on hundreds of files, and the score then measures the script
rather than you. It is on by default, so nothing changes unless you say so.
Backlinks are still dated by the day their source file was edited, because
that is the only date a link has.

## Machine layer

Every time the map recomputes, Focus writes what it computed to
`.icor-for-life/icor-for-life-focus/attention.json`, so a script, the AI
chat or another plugin can read the same ranking instead of guessing at it.
The folder is hidden, nothing in it is a note, and deleting it loses
nothing: the next recompute writes the file again.

```json
{
  "schema": 1,
  "generated_at": "2026-09-15T10:00:00.000Z",
  "window_days": 7,
  "count_file_edits": true,
  "items": [
    {
      "path": "04 Inner World/My Life/Topics/knowledge-management.md",
      "name": "knowledge-management",
      "type": "topic",
      "score": 8.25,
      "last_seen": "2026-09-15",
      "signals": { "edits": 2, "mentions": 3, "backlinks": 1, "opens": 2.25 }
    }
  ]
}
```

- `schema` is an integer. Check it before you trust a field; this document
  describes `1`.
- `generated_at` is the instant of the recompute, in UTC.
- `window_days` is the range the map was showing: today plus that many days.
- `count_file_edits` says whether the edit signal was counted, because the
  same vault scores differently with it off.
- `items` carries **every** note in the window, highest score first, not just
  the ones the list shows. Ties break on the more recently seen note, then on
  the path, so the order is the same on two machines with the same vault.
- `last_seen` is a local day, `YYYY-MM-DD`: the day of the most recent thing
  that counted.
- `signals` splits the score by what paid for it, and the four numbers add up
  to `score`.

The file is per device. Obsidian Sync skips folders whose name starts with a
dot, so each machine writes its own, which is right: the opens half of the
score is that machine's anyway.

## What it touches

- **Reads your notes and their links** to build the map.
- **Writes one small local log** of which notes you opened, on this device,
  pruned after 35 days. It never leaves your machine.
- **Writes one small JSON file** under `.icor-for-life/icor-for-life-focus/`
  with the ranking it just computed. See "Machine layer" above. It writes
  nowhere else, and it never touches your notes.

**It makes no network connection and starts no process.**

## Good to know

- **It only renders what the signals say.** An empty-looking map means a quiet
  period, not a broken plugin.
- **Beta.** In daily use in a real vault, and you will find rough edges. If
  something looks off, open an issue.

## Support

What myICOR supports: the plugin as published in a tagged release, on the
current version, installed from that release. Bugs go to this repo's issues,
security reports to the process in `SECURITY.md`.

What the community maintains: anything marked community-maintained, including
community source adapters. We review it before it is merged. We do not support
it, we cannot promise it keeps working, and it can be disabled or removed in
any release.

What is yours: your own changes, your fork, your local patch. Please reproduce
the problem on a clean install of the current release before reporting it.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice.
Releases before 0.7.0 stay under the ICOR for Life
Source-Available License (Code) v1.0 they were published with.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L.; a fork needs
its own plugin id and name. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
