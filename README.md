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
The worker is network-first, so updates appear on reload. When a new version
is waiting, the app says so at the top of the page with a **Reload** button
instead of leaving you to guess.

## Where your data lives

Every install starts **empty** — nothing is marked read until you mark it
yourself. The tracker ships no reading progress from anyone else, so a fresh
browser, a new device, or a friend's copy all begin at 0%.

Progress then saves to the browser's `localStorage` **per origin** — the
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
  for every in-progress book, most recently read first. On a brand-new (or
  freshly reset) tracker the hero instead explains that nothing is marked
  read yet and where progress lives.
- **Dashboard** — overall % ring, OT / NT progress bars, books finished,
  day streak, chapters this week, and a finish-date estimate from your
  7-day pace.
- **Recently read** — timestamped history of chapters you log in the app, so
  your streak and pace estimate grow as you read. Stats are kept as permanent
  per-day tallies, so years of reading can't fall off the end of the log.
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
- **All 66 books** — search (book name, Bible.com code, or genre), OT/NT
  filter, status filter (in progress / not started / complete), genre filter,
  and sorting. Each card has a per-chapter grid (click to toggle), a quick
  "mark next" button, and a Bible.com link for the next chapter.
- **Translation picker** — all 74 translations from the spreadsheet;
  every Bible.com link updates to your choice (defaults to NKJV).
- **Export / Import / Reset** — progress auto-saves to `localStorage`;
  export a JSON backup anytime. The settings dialog and the footer both show
  how long it's been since your last backup, and warn once it's a month stale.
  Import also rebuilds the stats from an older backup that only had an event log.

## Tests

```sh
node scripts/check.js
```

No dependencies, no build step — it loads the app into a small DOM stub and
asserts the things that are easy to break by accident: the seed still describes
all 66 books / 1,189 chapters / 74 translations **and ships no reading
progress**, the service worker precaches every file it names, a fresh install
boots empty, a store saved by an older version still loads, and stats survive
past the 500-event history cap. Run it before committing.

## Files

| File | Purpose |
|---|---|
| `index.html` / `styles.css` / `app.js` | The app |
| `seed.js` | Book list, chapter counts and translations, generated from the spreadsheet (no reading progress) |
| `bible-data.json` | Same data in plain JSON (reference / debugging) |
| `scripts/check.js` | Smoke test — `node scripts/check.js` |
| `scripts/extract.py` | Regenerates `seed.js` + `bible-data.json` from the `.xlsx` |
| `scripts/make_icons.py` | Regenerates the PWA icons in `icons/` |
| `manifest.webmanifest`, `sw.js`, `favicon.ico`, `icons/` | PWA assets (dock install + offline) |
| `start-server.sh` | Serves the app on http://localhost:8901 for installing |
| ` Bible Reading.xlsx` | Original spreadsheet — kept locally, intentionally not committed |

## Regenerating the book data from the spreadsheet

This needs the original ` Bible Reading.xlsx` sitting next to the scripts. It
is deliberately not committed here, and only its *structure* is used: book
order, testament, genre and chapter counts.

If you change the book list or chapter counts in Excel, re-run:

```sh
python3 scripts/extract.py
```

then reload the page. The extract deliberately ignores the spreadsheet's own
read/unread checkboxes — the app starts empty for everyone, so personal
progress never ships inside `seed.js`. Regenerating therefore never touches
what you've logged in the browser (exports and history are unaffected); to
move progress between browsers or devices, use **Export / Import** in Settings.
