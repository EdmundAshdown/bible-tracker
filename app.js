/* Bible Tracker — zero-dependency app. State persists in localStorage. */
(function () {
  "use strict";

  var SEED = window.BIBLE_SEED;
  if (!SEED) {
    document.body.innerHTML = "<p style='padding:40px'>Missing seed.js — run <code>python3 scripts/extract.py</code> first.</p>";
    return;
  }

  var STORE_KEY = "bible-tracker-v1";

  // Bible.com book codes — same mapping as the original spreadsheet formula:
  // first 3 letters (spaces removed, uppercased), with these exceptions.
  var CODE_EXCEPTIONS = {
    "Ezekiel": "EZK", "Joel": "JOL", "Song of Solomon": "SNG", "Nahum": "NAM",
    "Mark": "MRK", "John": "JHN", "Philippians": "PHP", "Philemon": "PHM",
    "James": "JAS", "1 John": "1JN", "2 John": "2JN", "3 John": "3JN"
  };
  function bibleCode(name) {
    if (CODE_EXCEPTIONS[name]) return CODE_EXCEPTIONS[name];
    return name.replace(/ /g, "").slice(0, 3).toUpperCase();
  }

  // ---------- State ----------
  // Every install starts empty: seed.js only carries structure (book list +
  // chapter counts), never reading progress. Reads are whatever you log here.
  function chapterCount(b) {
    if (typeof b.chapters === "number") return b.chapters;
    return b.chapters ? b.chapters.length : 0;
  }
  function emptyRead() {
    var read = {};
    SEED.books.forEach(function (b) {
      var arr = [];
      for (var i = 0, n = chapterCount(b); i < n; i++) arr.push(false);
      read[b.name] = arr;
    });
    return read;
  }
  // The event log is only the "recently read" list, so it stays capped. All the
  // long-range stats (streak, best streak, heatmap, pace) read `days` / `bookLast`
  // instead, which never get trimmed — otherwise a 1,189-chapter tracker would
  // silently lose its history once you logged more than the cap.
  var HISTORY_CAP = 500;
  var DAY_KEY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

  function defaultState() {
    return {
      read: emptyRead(),
      history: [],
      days: {},       // "y-m-d" -> chapters marked that day, kept forever
      bookLast: {},   // book name -> when its most recent chapter was marked
      translation: SEED.defaultTranslationAbbr,
      plan: { target: null },
      notes: {},
      notif: { enabled: false, time: "08:00", last: "" },
      lastExport: 0,
      savedAt: 0
    };
  }
  // Storage health: catches private windows / blocked storage instead of failing silently.
  var storeOK = true;
  (function () {
    try {
      localStorage.setItem("__bt_probe", "1");
      if (localStorage.getItem("__bt_probe") !== "1") storeOK = false;
      localStorage.removeItem("__bt_probe");
    } catch (e) { storeOK = false; }
  })();
  function validTranslation(ab) {
    for (var i = 0; i < SEED.translations.length; i++) {
      if (SEED.translations[i].abbr === ab) return true;
    }
    return false;
  }
  function validDayCounts(obj, out) {
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var v = Math.floor(+obj[k]);
      if (DAY_KEY_RE.test(k) && v > 0 && v <= 1189) out[k] = v;
    });
    return out;
  }
  function validLastReads(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    var known = {};
    SEED.books.forEach(function (b) { known[b.name] = true; });
    Object.keys(obj).forEach(function (k) {
      if (!known[k]) return; // ignore book names this seed doesn't have
      if (+obj[k] > 0) out[k] = +obj[k];
    });
    return out;
  }
  function cleanHistory(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (h) {
      return h && typeof h.b === "string" && +h.c > 0 && +h.ts > 0;
    }).map(function (h) {
      return { b: h.b, c: Math.floor(+h.c), ts: +h.ts, on: !!h.on };
    });
  }
  // Older saves only had the event log. Rebuild the permanent tallies from it
  // before that log gets trimmed, so stats never lose data.
  function talliesFromHistory(hist) {
    var t = { days: {}, bookLast: {} };
    hist.forEach(function (h) {
      if (!h.on) return;
      var k = dayKey(h.ts);
      t.days[k] = (t.days[k] || 0) + 1;
      if (!t.bookLast[h.b] || h.ts > t.bookLast[h.b]) t.bookLast[h.b] = h.ts;
    });
    return t;
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var st = defaultState();
      if (s.read) {
        Object.keys(st.read).forEach(function (name) {
          if (Array.isArray(s.read[name]) && s.read[name].length === st.read[name].length) {
            st.read[name] = s.read[name].map(Boolean);
          }
        });
      }
      var hist = cleanHistory(s.history);
      if (hist.length) st.history = hist.slice(0, HISTORY_CAP);
      if (s.days) validDayCounts(s.days, st.days);
      if (s.bookLast) st.bookLast = validLastReads(s.bookLast);
      if (!s.days || !s.bookLast) {
        var derived = talliesFromHistory(hist); // pre-tally save: rebuild from the log
        if (!s.days) st.days = derived.days;
        if (!s.bookLast) st.bookLast = derived.bookLast;
      }
      if (+s.lastExport) st.lastExport = +s.lastExport;
      if (typeof s.translation === "string" && validTranslation(s.translation)) st.translation = s.translation;
      if (s.plan && (s.plan.target === null || typeof s.plan.target === "string")) {
        st.plan = { target: s.plan.target || null };
      }
      if (s.notes && typeof s.notes === "object") {
        Object.keys(s.notes).forEach(function (k) {
          var n = s.notes[k];
          if (n && typeof n.t === "string") st.notes[k] = { t: n.t.slice(0, 2000), s: !!n.s, u: +n.u || 0 };
        });
      }
      if (s.notif && typeof s.notif === "object") {
        if (typeof s.notif.time === "string" && /^\d\d:\d\d/.test(s.notif.time)) st.notif.time = s.notif.time;
        if (typeof s.notif.last === "string") st.notif.last = s.notif.last;
        st.notif.enabled = !!s.notif.enabled;
      }
      if (+s.savedAt) st.savedAt = +s.savedAt;
      return st;
    } catch (e) { return defaultState(); }
  }
  var state = loadState();
  function save() {
    state.savedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storeOK = false;
      renderStoreBanner();
    }
  }
  function noteKey(book, ch) { return book + "|" + ch; }

  function translation() {
    var found = null;
    SEED.translations.forEach(function (t) { if (t.abbr === state.translation) found = t; });
    if (!found) {
      SEED.translations.forEach(function (t) { if (t.abbr === SEED.defaultTranslationAbbr) found = t; });
    }
    return found || SEED.translations[0];
  }
  function chapterUrl(book, ch) {
    var tr = translation();
    return "https://www.bible.com/bible/" + tr.id + "/" + bibleCode(book) + "." + ch + "." + tr.abbr;
  }

  // ---------- Derived data ----------
  function bookStats(name) {
    var arr = state.read[name];
    var total = arr.length;
    var readCount = 0, firstUnread = -1;
    for (var i = 0; i < total; i++) {
      if (arr[i]) readCount++;
      else if (firstUnread === -1) firstUnread = i + 1;
    }
    return { total: total, read: readCount, pct: total ? readCount / total : 0, next: firstUnread };
  }
  function totals(testament) {
    var read = 0, total = 0;
    SEED.books.forEach(function (b) {
      if (testament && b.testament !== testament) return;
      var s = bookStats(b.name);
      read += s.read; total += s.total;
    });
    return { read: read, total: total, pct: total ? read / total : 0 };
  }
  function firstUnreadCanonical() {
    for (var i = 0; i < SEED.books.length; i++) {
      var s = bookStats(SEED.books[i].name);
      if (s.next !== -1) return { book: SEED.books[i].name, chapter: s.next };
    }
    return null;
  }
  function inProgressBooks() {
    return SEED.books.filter(function (b) {
      var s = bookStats(b.name);
      return s.pct > 0 && s.pct < 1;
    }).sort(function (a, b) {
      // Most recently worked on first, then whichever is furthest along.
      var la = state.bookLast[a.name] || 0, lb = state.bookLast[b.name] || 0;
      if (la !== lb) return lb - la;
      return bookStats(b.name).pct - bookStats(a.name).pct;
    });
  }
  function unreadList(testament, onlyBooks) {
    var out = [];
    SEED.books.forEach(function (b) {
      if (testament && b.testament !== testament) return;
      if (onlyBooks && onlyBooks.indexOf(b.name) === -1) return;
      var arr = state.read[b.name];
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i]) out.push({ book: b.name, chapter: i + 1 });
      }
    });
    return out;
  }
  function firstUnreadIn(bookNames) {
    for (var i = 0; i < bookNames.length; i++) {
      var arr = state.read[bookNames[i]];
      if (!arr) continue;
      for (var c = 0; c < arr.length; c++) {
        if (!arr[c]) return { book: bookNames[i], chapter: c + 1 };
      }
    }
    return null;
  }
  var WISDOM_BOOKS = ["Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon"];
  var GENRE_ORDER = ["Pentateuch", "History", "Poetry", "Major", "Minor", "Gospels",
    "Early Church History", "Pauline Letters", "Prison", "Pastoral", "General Letters", "Prophecy"];
  function genreKey(b) { return b.subCategory || b.category || b.classification || "Other"; }
  function genreGroups() {
    var map = {};
    SEED.books.forEach(function (b) {
      var k = genreKey(b);
      if (!map[k]) map[k] = { read: 0, total: 0 };
      var s = bookStats(b.name);
      map[k].read += s.read;
      map[k].total += s.total;
    });
    var keys = GENRE_ORDER.filter(function (k) { return !!map[k]; });
    Object.keys(map).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    return keys.map(function (k) {
      return { name: k, read: map[k].read, total: map[k].total, pct: map[k].total ? map[k].read / map[k].total : 0 };
    });
  }
  function planInfo() {
    var all = totals(null);
    var remaining = all.total - all.read;
    var t = state.plan.target;
    if (!t) return { set: false, remaining: remaining };
    var target = new Date(t + "T00:00:00").getTime();
    if (isNaN(target)) return { set: false, remaining: remaining };
    // Calendar-day difference (UTC noon basis) so DST changes can't skew it.
    var now = new Date();
    var tp = new Date(target);
    var daysLeft = Math.round(
      (Date.UTC(tp.getFullYear(), tp.getMonth(), tp.getDate()) -
       Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    return {
      set: true, target: t, remaining: remaining, daysLeft: daysLeft,
      perDay: daysLeft > 0 && remaining > 0 ? Math.ceil(remaining / daysLeft) : 0,
      done: remaining === 0
    };
  }
  function bookNoteCount(name) {
    var n = 0, pre = name + "|";
    Object.keys(state.notes).forEach(function (k) { if (k.indexOf(pre) === 0) n++; });
    return n;
  }
  function cumulativeSeries() {
    var keys = Object.keys(state.days).filter(function (k) { return state.days[k] > 0; });
    keys.sort(function (a, b) { return dayTs(a) - dayTs(b); });
    var pts = [], n = 0;
    keys.forEach(function (k) { n += state.days[k]; pts.push({ ts: dayTs(k), n: n }); });
    return pts;
  }
  function cumulativeSvg(pts) {
    var W = 520, H = 96, P = 8;
    var t0 = pts[0].ts, t1 = pts[pts.length - 1].ts;
    var span = Math.max(t1 - t0, 864e5);
    var max = pts[pts.length - 1].n;
    function X(ts) { return (P + (ts - t0) / span * (W - 2 * P)).toFixed(1); }
    function Y(n) { return (H - P - (n / max) * (H - 2 * P)).toFixed(1); }
    var line = "M" + X(t0) + "," + Y(0);
    pts.forEach(function (p) { line += " L" + X(p.ts) + "," + Y(p.n); });
    var area = line + " L" + X(t1) + "," + Y(0) + " L" + X(t0) + "," + Y(0) + " Z";
    return '<svg class="cumulative" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Cumulative chapters logged">' +
      '<path d="' + area + '" fill="rgba(61,220,132,0.15)"/>' +
      '<path d="' + line + '" fill="none" stroke="#3ddc84" stroke-width="2"/>' +
      '<circle cx="' + X(t1) + '" cy="' + Y(max) + '" r="3.5" fill="#3ddc84"/></svg>';
  }

  // ---------- History / streak helpers ----------
  // Streaks, the heatmap and the pace estimate all read the permanent daily
  // tallies (`state.days`), never the capped event log — so years of reading
  // can't quietly fall off the end.
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function dayTs(key) {
    var p = String(key).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }
  function readDates() {
    var set = {};
    Object.keys(state.days).forEach(function (k) { if (state.days[k] > 0) set[k] = true; });
    return set;
  }
  function readingDayCount() {
    return Object.keys(readDates()).length;
  }
  function streak() {
    var days = readDates();
    var d = new Date();
    if (!days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1); // allow "keeps streak alive today"
    var n = 0;
    while (days[dayKey(d.getTime())]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function readsByDay() {
    // dayKey -> number of chapters marked read that day
    return state.days;
  }
  function bestStreak() {
    var keys = Object.keys(readDates());
    if (!keys.length) return 0;
    var days = keys.map(dayTs).sort(function (a, b) { return a - b; });
    var best = 1, run = 1;
    for (var i = 1; i < days.length; i++) {
      if (Math.round((days[i] - days[i - 1]) / 864e5) === 1) {
        run++;
        if (run > best) best = run;
      } else if (days[i] !== days[i - 1]) {
        run = 1;
      }
    }
    return best;
  }
  function weekCount() {
    var cutoff = Date.now() - 7 * 864e5;
    var n = 0;
    Object.keys(state.days).forEach(function (k) {
      if (dayTs(k) >= cutoff) n += state.days[k];
    });
    return n;
  }
  function relTime(ts) {
    var mins = Math.max(0, Math.round((Date.now() - ts) / 6e4));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    if (days < 7) return days + "d ago";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function fmtPct(p) {
    var v = p * 100;
    return (v >= 99.95 ? Math.round(v) : Math.round(v * 10) / 10) + "%";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- Filters (not persisted) ----------
  var filters = { q: "", testament: "all", status: "all", genre: "all", sort: "canonical" };

  // ---------- Mutations ----------
  function logAndToggle(book, chapter /* 1-based */, value) {
    var arr = state.read[book];
    var next = typeof value === "boolean" ? value : !arr[chapter - 1];
    if (arr[chapter - 1] === next) return;
    arr[chapter - 1] = next;
    var ts = Date.now();
    if (next) {
      // Permanent tallies that survive the history trim above them.
      var k = dayKey(ts);
      state.days[k] = (state.days[k] || 0) + 1;
      state.bookLast[book] = ts;
    }
    state.history.unshift({ b: book, c: chapter, ts: ts, on: next });
    state.history = state.history.slice(0, HISTORY_CAP);
    save();
    render();
  }

  // ---------- Render ----------
  var $ = function (id) { return document.getElementById(id); };

  function renderHero() {
    var el = $("heroSection");
    var next = firstUnreadCanonical();
    if (!next) {
      el.innerHTML =
        '<div class="hero-eyebrow">Finished</div>' +
        '<h2 class="hero-title">You read the whole Bible 🎉</h2>' +
        '<p class="hero-sub">All 1,189 chapters complete. Amazing. Start again, or revisit a favorite book below.</p>';
      return;
    }
    var resume = inProgressBooks().slice(0, 6);
    var chips = resume.map(function (b) {
      var s = bookStats(b.name);
      var when = state.bookLast[b.name];
      return '<button class="resume-chip" data-resume="' + esc(b.name) + '"' +
        ' title="' + esc(b.name) + (when ? " — last marked read " + relTime(when) : "") + '">' +
        esc(b.name) + " " + s.next + " <small>" + fmtPct(s.pct) + "</small>" +
        (when ? " <small>" + relTime(when) + "</small>" : "") + "</button>";
    }).join("");
    // Nothing logged yet — a brand-new (or freshly reset) tracker. Say what this
    // is and how progress is kept, instead of a bare "Up next Genesis 1".
    var all = totals(null);
    var fresh = all.read === 0;
    el.innerHTML =
      '<div class="hero-eyebrow">' + (fresh ? "Start here" : "Up next") + "</div>" +
      '<h2 class="hero-title">' + esc(next.book) + " " + next.chapter + "</h2>" +
      '<p class="hero-sub">' + (fresh
        ? "Nothing marked read yet — 0 of " + all.total.toLocaleString() + " chapters. Tick them off as you read; " +
          "progress saves in this browser, and Export / Import moves it between devices."
        : "First unread chapter in Bible order · " + esc(translation().name) + " on Bible.com") + "</p>" +
      '<div class="hero-actions">' +
        '<button class="btn primary" id="heroMark">Mark as read ✓</button>' +
        '<a class="btn ghost" href="' + chapterUrl(next.book, next.chapter) + '" target="_blank" rel="noopener">Read on Bible.com ↗</a>' +
      "</div>" +
      (chips ? '<div class="resume-row">' + chips + "</div>" : "");
    $("heroMark").addEventListener("click", function () { logAndToggle(next.book, next.chapter, true); });
    el.querySelectorAll("[data-resume]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var name = chip.getAttribute("data-resume");
        var card = document.querySelector('[data-book-card="' + CSS.escape(name) + '"]');
        filters.q = ""; filters.testament = "all"; filters.status = "all"; filters.genre = "all";
        syncFilterInputs(); renderBooks();
        var target = document.querySelector('[data-book-card="' + CSS.escape(name) + '"]');
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  function renderDashboard() {
    var all = totals(null), ot = totals("Old Testament"), nt = totals("New Testament");
    $("overallRing").style.setProperty("--pct", (all.pct * 100).toFixed(2));
    $("overallPct").textContent = fmtPct(all.pct);
    $("chaptersRead").textContent = all.read.toLocaleString();
    $("chaptersTotal").textContent = all.total.toLocaleString();

    $("otPct").textContent = fmtPct(ot.pct);
    $("otBar").style.width = (ot.pct * 100).toFixed(1) + "%";
    $("otCount").textContent = ot.read.toLocaleString() + " of " + ot.total.toLocaleString() + " chapters";
    $("ntPct").textContent = fmtPct(nt.pct);
    $("ntBar").style.width = (nt.pct * 100).toFixed(1) + "%";
    $("ntCount").textContent = nt.read.toLocaleString() + " of " + nt.total.toLocaleString() + " chapters";

    var done = SEED.books.filter(function (b) { return bookStats(b.name).pct === 1; }).length;
    $("booksDone").textContent = done + " / " + SEED.books.length;
    var st = streak(), best = bestStreak();
    $("streak").textContent = st + (st === 1 ? " day" : " days");
    $("streakLabel").textContent = best > 0 ? "Day streak · best " + best : "Day streak — log a read to start";
    var wk = weekCount();
    $("weekCount").textContent = wk;
    var remaining = all.total - all.read;
    if (wk > 0) {
      var perDay = wk / 7;
      var days = Math.ceil(remaining / perDay);
      $("eta").textContent = days > 60 ? "≈ " + Math.round(days / 30) + " mo" : "≈ " + days + "d";
      $("etaLabel").textContent = "left at 7-day pace (" + (Math.round(perDay * 10) / 10) + "/day)";
    } else {
      $("eta").textContent = "–";
      $("etaLabel").textContent = "log reads to get a pace estimate";
    }
  }

  function renderStoreBanner() {
    var b = $("storeBanner");
    if (!b) return;
    if (!storeOK) {
      b.hidden = false;
      b.innerHTML = "⚠️ <strong>Saving isn't working</strong> in this browser context (private window or blocked storage?). " +
        "Progress will NOT persist between sessions — use Export to back up what you log.";
    } else if (typeof location !== "undefined" && location.protocol === "file:") {
      b.hidden = false;
      b.innerHTML = "You're viewing the app as a file. Progress saves in this browser, but for dock-pinning, offline use, " +
        "and one shared store, run <code>./start-server.sh</code> and use the installed app instead.";
    } else {
      b.hidden = true;
      b.innerHTML = "";
    }
  }
  function renderStorageStatus() {
    var el = $("storageStatus");
    if (!el) return;
    if (!storeOK) {
      el.textContent = "Store unavailable — progress will not persist between sessions. Export to back up.";
      return;
    }
    var all = totals(null);
    var noted = Object.keys(state.notes).length;
    var where = (typeof location !== "undefined") ? location.protocol + "//" + location.host + location.pathname : "app";
    el.textContent = "Store: " + where + " · " + all.read.toLocaleString() + " of " + all.total.toLocaleString() +
      " chapters read · " + noted + " note" + (noted === 1 ? "" : "s") + " · " +
      (state.savedAt ? "last saved " + relTime(state.savedAt) : "nothing saved yet") +
      " · " + (state.lastExport ? "last backup " + relTime(state.lastExport) : "no backup yet") + ".";
  }
  // Backup nudge: the browser can lose this store without warning, so the
  // settings dialog keeps a quiet running commentary on how stale a backup is.
  function renderBackupStatus() {
    var el = $("backupStatus");
    if (!el) return;
    var logged = 0;
    Object.keys(state.days).forEach(function (k) { logged += state.days[k]; });
    if (!logged) {
      el.textContent = "Nothing logged yet. Export saves a JSON copy you can restore on any device.";
      return;
    }
    if (!state.lastExport) {
      el.textContent = "⚠️ No backup yet — " + logged + " chapter" + (logged === 1 ? "" : "s") +
        " logged in this browser only. Export a JSON copy so a cleared cache can't take them with it.";
      return;
    }
    var since = 0;
    state.history.forEach(function (h) { if (h.on && h.ts > state.lastExport) since++; });
    var sinceTxt = since >= HISTORY_CAP ? "500+" : String(since);
    var stale = Date.now() - state.lastExport > 30 * 864e5;
    if (stale && since > 0) {
      el.textContent = "⚠️ Last backup " + relTime(state.lastExport) + " (" + sinceTxt +
        " read" + (since === 1 ? "" : "s") + " since). Export to bring it up to date.";
    } else {
      el.textContent = "Last backup " + relTime(state.lastExport) +
        (since > 0 ? " · " + sinceTxt + " read" + (since === 1 ? "" : "s") + " since." : ".");
    }
  }
  function renderPlan() {
    var el = $("planCard");
    if (!el) return;
    var info = planInfo();
    var pace = weekCount() / 7;
    var html = "<h2>Finish-by-date plan</h2>" +
      '<p class="plan-sub">Pick a target date — your daily number updates as you read.</p>' +
      '<div class="plan-controls"><label>Target date <input type="date" id="planDate" value="' + (info.target || "") + '"></label>' +
      (info.set ? '<button class="btn ghost small" id="planClear">Clear</button>' : "") + "</div>";
    if (!info.set) {
      html += '<div class="plan-big">' + info.remaining + " <small>chapters to go — set a date for a daily target</small></div>";
    } else if (info.done) {
      html += '<div class="plan-big">🎉 <small>finished — every chapter read</small></div>';
    } else if (info.daysLeft <= 0) {
      html += '<div class="plan-big">' + info.remaining + " <small>chapters left — target date has passed</small></div>" +
        '<p class="plan-sub">Pick a new date to get a fresh daily number.</p>';
    } else {
      var perDay = info.perDay;
      html += '<div class="plan-big">' + perDay + " <small>chapter" + (perDay === 1 ? "" : "s") +
        "/day · " + info.daysLeft + " day" + (info.daysLeft === 1 ? "" : "s") + " left</small></div>";
      var paceTxt = Math.round(pace * 10) / 10;
      html += pace >= perDay
        ? '<p><span class="plan-track">On track — your 7-day pace is ' + paceTxt + "/day ✓</span></p>"
        : '<p><span class="plan-track behind">Behind pace — your 7-day average is ' + paceTxt + "/day</span></p>";
      var portion = unreadList(null, null).slice(0, perDay);
      var shown = portion.slice(0, 30);
      html += '<ul class="portion-list">' + shown.map(function (p) {
        return '<li><input type="checkbox" data-portion-book="' + esc(p.book) + '" data-portion-ch="' + p.chapter + '"' +
          '" aria-label="Mark ' + esc(p.book) + " " + p.chapter + ' read">' +
          "<span>" + esc(p.book) + " " + p.chapter + "</span>" +
          '<a class="link-btn" href="' + chapterUrl(p.book, p.chapter) + '" target="_blank" rel="noopener">Open ↗</a></li>';
      }).join("") + "</ul>";
      html += portion.length > shown.length
        ? '<p class="plan-sub">Today\'s portion is ' + portion.length + " chapters — showing the first " + shown.length + " in Bible order.</p>"
        : '<p class="plan-sub">Today\'s portion in Bible order — checking one marks it read.</p>';
    }
    el.innerHTML = html;
    var di = $("planDate");
    if (di) di.addEventListener("change", function () { state.plan.target = di.value || null; save(); render(); });
    var cl = $("planClear");
    if (cl) cl.addEventListener("click", function () { state.plan.target = null; save(); render(); });
    el.querySelectorAll("[data-portion-book]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        logAndToggle(cb.getAttribute("data-portion-book"), parseInt(cb.getAttribute("data-portion-ch"), 10), cb.checked);
      });
    });
  }
  function renderStreams() {
    var el = $("streamCard");
    if (!el) return;
    var ot = [], nt = [];
    SEED.books.forEach(function (b) {
      (b.testament === "Old Testament" ? ot : nt).push(b.name);
    });
    var streams = [
      { name: "Old Testament", sub: "Law, history, poetry, prophets", next: firstUnreadIn(ot) },
      { name: "New Testament", sub: "Gospels, letters, Revelation", next: firstUnreadIn(nt) },
      { name: "Psalms & Wisdom", sub: "Job · Psalms · Proverbs · Ecclesiastes · Song", next: firstUnreadIn(WISDOM_BOOKS) }
    ];
    el.innerHTML = "<h2>Today's streams</h2>" +
      '<p class="plan-sub">One chapter from each stream — a balanced daily diet.</p>' +
      streams.map(function (s, i) {
        var body = s.next
          ? '<span class="stream-next">' + esc(s.next.book) + " " + s.next.chapter + "</span>" +
            '<a class="link-btn" href="' + chapterUrl(s.next.book, s.next.chapter) + '" target="_blank" rel="noopener">Open ↗</a>' +
            '<button class="btn primary small" data-stream="' + i + '">Mark read ✓</button>'
          : '<span class="stream-next">✓ Stream complete</span>';
        return '<div class="stream-row"><div class="stream-name">' + s.name + "<small>" + s.sub + "</small></div>" + body + "</div>";
      }).join("");
    el.querySelectorAll("[data-stream]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var s = streams[parseInt(btn.getAttribute("data-stream"), 10)];
        if (s.next) logAndToggle(s.next.book, s.next.chapter, true);
      });
    });
  }
  function renderGenres() {
    var el = $("genreRows");
    if (!el) return;
    el.innerHTML = genreGroups().map(function (g) {
      return '<div class="genre-row"><span class="genre-name" title="' + esc(g.name) + '">' + esc(g.name) + "</span>" +
        '<div class="bar"><div class="bar-fill" style="width:' + (g.pct * 100).toFixed(1) +
        '%;background:linear-gradient(90deg,#b07f2a,var(--accent))"></div></div>' +
        '<span class="genre-pct">' + fmtPct(g.pct) + "<small>" + g.read + "/" + g.total + "</small></span></div>";
    }).join("");
  }
  function renderRecent() {
    var list = $("recentList");
    var block = $("streakBlock");
    var st = streak(), best = bestStreak(), counts = readsByDay();

    // 26-week activity grid (oldest → today), oldest column first
    var WEEKS = 26, CELLS = WEEKS * 7;
    var cells = "";
    var midday = new Date();
    midday.setHours(12, 0, 0, 0);
    for (var i = CELLS - 1; i >= 0; i--) {
      var d = new Date(midday.getTime() - i * 864e5);
      var n = counts[dayKey(d.getTime())] || 0;
      var lvl = n === 0 ? "l0" : n === 1 ? "l1" : n <= 3 ? "l2" : "l3";
      var label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
        (n ? " — " + n + " chapter" + (n === 1 ? "" : "s") : " — no reading logged");
      cells += '<div class="day-cell ' + lvl + (i === 0 ? " today" : "") + '" title="' + label + '"></div>';
    }
    var pts = cumulativeSeries();
    var chart = pts.length > 1
      ? cumulativeSvg(pts) + '<p class="heatmap-legend">Cumulative chapters logged in the app (' +
        pts[pts.length - 1].n + " chapters over " + pts.length + " reading day" + (pts.length === 1 ? "" : "s") + ").</p>"
      : "";
    var fire = st > 0
      ? '<span class="streak-fire">🔥 ' + st + "-day streak</span>"
      : '<span class="streak-fire dim">No active streak yet</span>';
    block.innerHTML =
      '<div class="streak-line">' + fire +
      (best > 0 ? '<span class="streak-best">Best: ' + best + " day" + (best === 1 ? "" : "s") + "</span>" : "") + "</div>" +
      '<div class="year-heatmap">' + cells + '</div><p class="heatmap-legend">Last 26 weeks — darker green means more chapters that day.</p>' +
      chart;

    var daysRead = readingDayCount();
    if (!state.history.length) {
      $("recentHint").textContent = "";
      list.innerHTML = '<li class="empty-note" style="border:none;background:none;padding:0">' +
        "No reads logged here yet — mark a chapter below and it will show up here with a timestamp, feeding your streak.</li>";
      return;
    }
    $("recentHint").textContent = daysRead + " reading day" + (daysRead === 1 ? "" : "s") +
      " · last " + Math.min(state.history.length, 20) + " events";
    list.innerHTML = state.history.slice(0, 20).map(function (h) {
      return "<li><span class='" + (h.on ? "" : "undone") + "'>" + (h.on ? "✓ " : "○ ") +
        esc(h.b) + " " + h.c + (h.on ? "" : " (unmarked)") + "</span><time>" + relTime(h.ts) + "</time></li>";
    }).join("");
  }

  function filteredBooks() {
    var q = filters.q.trim().toLowerCase();
    var books = SEED.books.filter(function (b) {
      if (filters.testament !== "all" && b.testament !== filters.testament) return false;
      if (filters.genre !== "all" && b.classification !== filters.genre) return false;
      var s = bookStats(b.name);
      if (filters.status === "complete" && s.pct !== 1) return false;
      if (filters.status === "not-started" && s.pct !== 0) return false;
      if (filters.status === "in-progress" && (s.pct === 0 || s.pct === 1)) return false;
      if (q) {
        // Matches the book name, Bible.com code, genre or category.
        var hay = (b.name + " " + bibleCode(b.name) + " " + (b.classification || "") + " " +
          (b.category || "") + " " + (b.subCategory || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (filters.sort === "progress-desc") books = books.slice().sort(function (a, b) { return bookStats(b.name).pct - bookStats(a.name).pct; });
    else if (filters.sort === "progress-asc") books = books.slice().sort(function (a, b) { return bookStats(a.name).pct - bookStats(b.name).pct; });
    else if (filters.sort === "name") books = books.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return books;
  }

  function saveNote(name, ch, text, starred) {
    var k = noteKey(name, ch);
    if (!String(text).trim() && !starred) delete state.notes[k];
    else state.notes[k] = { t: String(text).slice(0, 2000), s: !!starred, u: Date.now() };
    save();
    render();
  }
  function notesPanelHtml(name) {
    var total = state.read[name].length;
    var rows = Object.keys(state.notes)
      .filter(function (k) { return k.indexOf(name + "|") === 0; })
      .map(function (k) { return { ch: parseInt(k.slice(name.length + 1), 10), note: state.notes[k] }; })
      .filter(function (r) { return r.ch >= 1 && r.ch <= total; })
      .sort(function (a, b) { return a.ch - b.ch; });
    var html = rows.map(function (r) {
      return '<div class="note-row"><div class="note-head"><span>' + esc(name) + " " + r.ch + "</span>" +
        '<button class="star-btn' + (r.note.s ? " on" : "") + '" data-note-star="' + esc(name) + '" data-ch="' + r.ch + '" title="Star this chapter" aria-pressed="' + !!r.note.s + '">★</button>' +
        '<button class="note-del" data-note-del="' + esc(name) + '" data-ch="' + r.ch + '">Delete</button>' +
        '<a class="link-btn" href="' + chapterUrl(name, r.ch) + '" target="_blank" rel="noopener">Open ↗</a></div>' +
        '<textarea rows="2" data-note-text="' + esc(name) + '" data-ch="' + r.ch + '" placeholder="What stood out?">' + esc(r.note.t) + "</textarea></div>";
    }).join("");
    var next = bookStats(name).next;
    html += '<div class="note-add"><input type="number" min="1" max="' + total + '" value="' + (next === -1 ? 1 : next) + '"' +
      ' data-note-new-ch="' + esc(name) + '" aria-label="Chapter number for new note">' +
      '<button class="btn ghost small" data-note-add="' + esc(name) + '">Add note</button></div>';
    return html;
  }

  function renderBooks() {
    var grid = $("bookGrid");
    var books = filteredBooks();
    $("bookCount").textContent = books.length + " of " + SEED.books.length;
    grid.innerHTML = books.map(function (b) {
      var s = bookStats(b.name);
      var tag = b.testament === "Old Testament" ? "ot" : "nt";
      var dots = state.read[b.name].map(function (on, i) {
        var ch = i + 1;
        var note = state.notes[noteKey(b.name, ch)];
        var cls = "chapter" + (on ? " read" : "") + (ch === s.next ? " next-up" : "") +
          (note ? " has-note" : "") + (note && note.s ? " starred" : "");
        return '<button class="' + cls + '" data-book="' + esc(b.name) + '" data-ch="' + ch + '"' +
          ' title="' + esc(b.name) + " " + ch + (ch === s.next ? " — next up" : "") + (note && note.s ? " — ★ starred" : "") + '"' +
          ' aria-pressed="' + on + '">' + ch + "</button>";
      }).join("");
      var nc = bookNoteCount(b.name);
      var action;
      if (s.next === -1) {
        action = '<span class="next-label">✓ Complete</span>' +
          '<a class="link-btn" href="' + chapterUrl(b.name, 1) + '" target="_blank" rel="noopener">Re-read ↗</a>';
      } else {
        action = '<button class="btn primary small" data-mark="' + esc(b.name) + '" data-ch="' + s.next + '">Mark ' + esc(b.name) + " " + s.next + " ✓</button>" +
          '<a class="link-btn" href="' + chapterUrl(b.name, s.next) + '" target="_blank" rel="noopener">Open ↗</a>';
      }
      return '<article class="card book-card' + (s.next === -1 ? " complete" : "") + '" data-book-card="' + esc(b.name) + '">' +
        '<div class="book-top"><div><h3 class="book-name">' + esc(b.name) + "</h3>" +
        '<div class="book-meta">' + esc(b.classification || "") + (b.category && b.category !== b.classification ? " · " + esc(b.category) : "") + "</div></div>" +
        '<div><span class="testament-tag ' + tag + '">' + (tag === "ot" ? "OT" : "NT") + '</span> <span class="book-pct">' + fmtPct(s.pct) + "</span></div></div>" +
        '<div class="bar"><div class="bar-fill ' + (tag === "ot" ? "ot-fill" : "nt-fill") + '" style="width:' + (s.pct * 100).toFixed(1) + '%"></div></div>' +
        '<div class="book-count">' + s.read + " of " + s.total + " chapters" + (s.next !== -1 ? ' · <span class="next-label">next: ch ' + s.next + "</span>" : "") + "</div>" +
        '<div class="chapters">' + dots + "</div>" +
        '<div class="book-actions">' + action +
        ' <button class="btn ghost small notes-toggle' + (nc ? " has-notes" : "") + '" data-notes="' + esc(b.name) + '">✎ Notes' + (nc ? " (" + nc + ")" : "") + "</button></div>" +
        '<div class="notes-panel" data-notes-panel="' + esc(b.name) + '" hidden>' + notesPanelHtml(b.name) + "</div></article>";
    }).join("") || '<p class="empty-note">No books match these filters.</p>';

    grid.querySelectorAll(".chapter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        logAndToggle(btn.getAttribute("data-book"), parseInt(btn.getAttribute("data-ch"), 10));
      });
    });
    grid.querySelectorAll("[data-mark]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        logAndToggle(btn.getAttribute("data-mark"), parseInt(btn.getAttribute("data-ch"), 10), true);
      });
    });
    grid.querySelectorAll("[data-notes]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = grid.querySelector('[data-notes-panel="' + CSS.escape(btn.getAttribute("data-notes")) + '"]');
        if (panel) panel.hidden = !panel.hidden;
      });
    });
    grid.querySelectorAll("[data-note-text]").forEach(function (ta) {
      ta.addEventListener("change", function () {
        var name = ta.getAttribute("data-note-text"), ch = parseInt(ta.getAttribute("data-ch"), 10);
        var prev = state.notes[noteKey(name, ch)];
        saveNote(name, ch, ta.value, prev ? prev.s : false);
      });
    });
    grid.querySelectorAll("[data-note-star]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-note-star"), ch = parseInt(btn.getAttribute("data-ch"), 10);
        var prev = state.notes[noteKey(name, ch)];
        saveNote(name, ch, prev ? prev.t : "", !(prev && prev.s));
      });
    });
    grid.querySelectorAll("[data-note-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        delete state.notes[noteKey(btn.getAttribute("data-note-del"), parseInt(btn.getAttribute("data-ch"), 10))];
        save();
        render();
      });
    });
    grid.querySelectorAll("[data-note-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-note-add");
        var input = grid.querySelector('[data-note-new-ch="' + CSS.escape(name) + '"]');
        var total = state.read[name].length;
        var ch = parseInt(input ? input.value : "1", 10);
        if (!(ch >= 1 && ch <= total)) ch = 1;
        var k = noteKey(name, ch);
        if (!state.notes[k]) {
          state.notes[k] = { t: "", s: false, u: Date.now() };
          save();
        }
        render();
        var panel = document.querySelector('[data-notes-panel="' + CSS.escape(name) + '"]');
        if (panel) {
          panel.hidden = false;
          var ta = panel.querySelector('[data-note-text][data-ch="' + ch + '"]');
          if (ta) ta.focus();
        }
      });
    });
  }

  function render() {
    renderStoreBanner();
    renderHero();
    renderDashboard();
    renderPlan();
    renderStreams();
    renderGenres();
    renderRecent();
    renderBooks();
    renderStorageStatus();
    renderBackupStatus();
  }

  // ---------- Controls ----------
  function syncTranslationSelect() {
    var sel = $("translationSelect");
    if (sel.options.length) sel.value = state.translation;
  }
  function syncFilterInputs() {
    $("searchInput").value = filters.q;
    document.querySelectorAll("[data-testament]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-testament") === filters.testament);
    });
    $("statusFilter").value = filters.status;
    $("genreFilter").value = filters.genre;
    $("sortSelect").value = filters.sort;
  }

  function checkReminder() {
    if (!state.notif.enabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var now = new Date();
    var parts = String(state.notif.time || "08:00").split(":");
    var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +parts[0] || 0, +parts[1] || 0);
    if (now < at) return;
    var today = dayKey(now.getTime());
    if (state.notif.last === today) return;
    if (readDates()[today]) return; // already read today — no nudge needed
    state.notif.last = today;
    save();
    var st = streak();
    try {
      new Notification("Bible Tracker", {
        body: st > 0
          ? "Protect your " + st + "-day streak — today's streams are waiting."
          : "Today's readings are waiting — log one to start a streak."
      });
    } catch (e) {}
  }

  function initControls() {
    // Settings modal
    var overlay = $("settingsOverlay");
    function openSettings() {
      overlay.hidden = false;
      var c = $("settingsClose");
      if (c && c.focus) c.focus();
    }
    function closeSettings() {
      overlay.hidden = true;
      var b = $("settingsBtn");
      if (b && b.focus) b.focus();
    }
    $("settingsBtn").addEventListener("click", openSettings);
    $("settingsClose").addEventListener("click", closeSettings);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSettings(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeSettings();
    });

    // Translation picker (alphabetical by name)
    var sel = $("translationSelect");
    var sorted = SEED.translations.slice().sort(function (a, b) {
      var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    sel.innerHTML = sorted.map(function (t) {
      return '<option value="' + esc(t.abbr) + '"' + (t.abbr === state.translation ? " selected" : "") + ">" +
        esc(t.name) + " (" + esc(t.abbr) + ")</option>";
    }).join("");
    sel.addEventListener("change", function () { state.translation = sel.value; save(); render(); });

    // Genre filter
    var genres = [];
    SEED.books.forEach(function (b) { if (b.classification && genres.indexOf(b.classification) === -1) genres.push(b.classification); });
    var gf = $("genreFilter");
    genres.forEach(function (g) {
      var o = document.createElement("option");
      o.value = g; o.textContent = g;
      gf.appendChild(o);
    });

    $("searchInput").addEventListener("input", function (e) { filters.q = e.target.value; renderBooks(); });
    document.querySelectorAll("[data-testament]").forEach(function (b) {
      b.addEventListener("click", function () {
        filters.testament = b.getAttribute("data-testament");
        syncFilterInputs(); renderBooks();
      });
    });
    $("statusFilter").addEventListener("change", function (e) { filters.status = e.target.value; renderBooks(); });
    $("genreFilter").addEventListener("change", function (e) { filters.genre = e.target.value; renderBooks(); });
    $("sortSelect").addEventListener("change", function (e) { filters.sort = e.target.value; renderBooks(); });

    // Daily streak reminder (fires while the app is open)
    var notifBox = $("notifEnable"), notifTime = $("notifTime");
    function syncNotif() {
      notifBox.checked = state.notif.enabled;
      notifTime.value = state.notif.time || "08:00";
      var note = $("notifNote");
      if (typeof Notification === "undefined") {
        note.textContent = "Notifications aren't supported in this browser.";
        notifBox.disabled = true;
      } else if (Notification.permission === "denied") {
        note.textContent = "Notifications are blocked — allow them in browser settings to use reminders.";
      } else {
        note.textContent = "Shows once a day, but only while the app is open.";
      }
    }
    notifBox.addEventListener("change", function () {
      if (!notifBox.checked) { state.notif.enabled = false; save(); syncNotif(); return; }
      if (typeof Notification === "undefined") { notifBox.checked = false; return; }
      if (Notification.permission === "granted") { state.notif.enabled = true; save(); syncNotif(); return; }
      Notification.requestPermission().then(function (p) {
        state.notif.enabled = (p === "granted");
        save(); syncNotif();
        if (!state.notif.enabled) alert("The reminder needs notification permission to work.");
      });
    });
    notifTime.addEventListener("change", function () { state.notif.time = notifTime.value || "08:00"; save(); });
    syncNotif();
    checkReminder();
    setInterval(checkReminder, 60000);

    // Export / import / reset
    $("exportBtn").addEventListener("click", function () {
      var payload = { app: "bible-tracker", version: 3, exportedAt: new Date().toISOString(), translation: state.translation, read: state.read, history: state.history, days: state.days, bookLast: state.bookLast, plan: state.plan, notes: state.notes, notif: { enabled: state.notif.enabled, time: state.notif.time } };
      var blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "bible-tracker-progress.json";
      a.click();
      state.lastExport = Date.now();
      save();
      renderBackupStatus();
      renderStorageStatus();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    $("importBtn").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(r.result);
          if (!data.read) throw new Error("bad file");
          var st = defaultState();
          Object.keys(st.read).forEach(function (name) {
            if (Array.isArray(data.read[name]) && data.read[name].length === st.read[name].length) {
              st.read[name] = data.read[name].map(Boolean);
            }
          });
          state.read = st.read;
          var hist = cleanHistory(data.history);
          state.history = hist.slice(0, HISTORY_CAP);
          // Restore the permanent tallies if the file has them, else rebuild from its log.
          state.days = {};
          state.bookLast = {};
          if (data.days) validDayCounts(data.days, state.days);
          if (data.bookLast) state.bookLast = validLastReads(data.bookLast);
          if (!data.days || !data.bookLast) {
            var derived = talliesFromHistory(hist);
            if (!data.days) state.days = derived.days;
            if (!data.bookLast) state.bookLast = derived.bookLast;
          }
          if (typeof data.translation === "string" && validTranslation(data.translation)) state.translation = data.translation;
          if (data.plan && (data.plan.target === null || typeof data.plan.target === "string")) state.plan = { target: data.plan.target || null };
          if (data.notes && typeof data.notes === "object") {
            state.notes = {};
            Object.keys(data.notes).forEach(function (k) {
              var n = data.notes[k];
              if (n && typeof n.t === "string") state.notes[k] = { t: n.t.slice(0, 2000), s: !!n.s, u: +n.u || 0 };
            });
          }
          if (data.notif && typeof data.notif === "object") {
            if (typeof data.notif.time === "string") state.notif.time = data.notif.time;
            state.notif.enabled = false; // never auto-enable reminders from a file
          }
          save(); syncTranslationSelect(); render();
          alert("Progress imported ✓");
        } catch (err) { alert("Could not import that file."); }
        e.target.value = "";
      };
      r.readAsText(f);
    });
    $("resetBtn").addEventListener("click", function () {
      if (!confirm("Clear all reading progress, notes and history, and start over with an empty tracker?")) return;
      state = defaultState();
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      filters = { q: "", testament: "all", status: "all", genre: "all", sort: "canonical" };
      syncFilterInputs(); syncTranslationSelect(); syncNotif();
      render();
    });
  }

  initControls();
  render();
})();
