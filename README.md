# Bible Tracker

A zero-dependency web app converted from ` Bible Reading.xlsx`, with a better UI
than the spreadsheet allowed.

Just open **`index.html`** in a browser — no build step, no server needed
(works straight from `file://`).

## Pin to Dock (install as an app)

Service workers and browser install prompts need `http`, not `file://`,
so serve it locally first:

```sh
./start-server.sh        # serves on http://localhost:8901 and opens it
```

Then pin it:

- **Safari (macOS Sonoma+):** File → Add to Dock. Gives you a standalone
  dock icon with the app icon.
- **Chrome / Edge / Arc:** ⋯ menu → Save and Share → Install app
  (or "Add to Dock" / "Create shortcut → Open as window").
- **iPhone / iPad:** Share → Add to Home Screen.

Once installed it also works **offline** (service worker caches the app).
The worker is network-first, so updates appear on reload — if the app ever
looks stale after an update, reload twice (the second load picks up the new
worker, which also clears the old cache).

## Where your data lives

Progress saves to the browser's `localStorage` **per origin** — the
double-clicked file (`file://`), `http://localhost:8901`, and the
dock-pinned app each have their own separate store. So pick one way to
open the app (the dock icon is the best one) and stick with it; the footer
shows exactly which store is active, what it holds, and when it last saved.
If saving is blocked entirely (private window, disabled storage), the app
says so in a banner instead of failing silently. Use Export for backups
regardless.

## What's inside

- **Up-next hero** — first unread chapter in Bible order, with one-click
  "Mark as read" and a deep link to read it on Bible.com. Plus resume chips
  for every in-progress book.
- **Dashboard** — overall % ring, OT / NT progress bars, books finished,
  day streak, chapters this week, and a finish-date estimate from your
  7-day pace.
- **Recently read** — timestamped history of chapters you log in the app.
  (The spreadsheet tracked only checked boxes, not dates, so history starts
  fresh from your first logged read.)
- **Streak & history section** — 🔥 current day-streak with all-time best,
  a 26-week activity heatmap, a cumulative progress chart, the full
  timestamped log, and an optional daily streak reminder (fires while the
  app is open).
- **Finish-by-date plan** — pick a target date for a daily chapters/day
  number, an on-track/behind verdict from your 7-day pace, and a checkable
  "today's portion" list.
- **Today's streams** — one next-chapter each from Old Testament,
  New Testament, and Psalms & Wisdom.
- **Progress by genre** — 12 bars (Pentateuch → Minor Prophets → Gospels →
  Prison letters…) from the spreadsheet's own classifications.
- **Chapter notes & stars** — per-book ✎ Notes panels; noted chapters get
  a gold dot, starred ones a gold outline.
- **All 66 books** — search, OT/NT filter, status filter (in progress /
  not started / complete), genre filter, and sorting. Each card has a
  per-chapter grid (click to toggle), a quick "mark next" button, and a
  Bible.com link for the next chapter.
- **Translation picker** — all 74 translations from the spreadsheet;
  every Bible.com link updates to your choice (defaults to NKJV).
- **Export / Import / Reset** — progress auto-saves to `localStorage`;
  export a JSON backup anytime.

## Files

| File | Purpose |
|---|---|
| `index.html` / `styles.css` / `app.js` | The app |
| `seed.js` | Initial reading state, generated from the spreadsheet |
| `bible-data.json` | Same data in plain JSON (reference / debugging) |
| `scripts/extract.py` | Regenerates `seed.js` + `bible-data.json` from the `.xlsx` |
| `scripts/make_icons.py` | Regenerates the PWA icons in `icons/` |
| `manifest.webmanifest`, `sw.js`, `favicon.ico`, `icons/` | PWA assets (dock install + offline) |
| `start-server.sh` | Serves the app on http://localhost:8901 for installing |
| ` Bible Reading.xlsx` | Original spreadsheet — kept locally, intentionally not committed |

## Re-importing from the spreadsheet

This needs the original ` Bible Reading.xlsx` sitting next to the scripts. It
is deliberately not committed here — it holds personal reading progress, and
`seed.js` / `bible-data.json` already carry everything the app needs. Keep your
own copy alongside the project.

If you update the checkboxes in Excel, re-run:

```sh
python3 scripts/extract.py
```

then reload the page. Note: re-importing replaces the seed; any reads you
logged only in the app (and their history) live in the browser — export a
backup first if you want to keep them.
