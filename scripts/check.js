#!/usr/bin/env node
/* Smoke test for Bible Tracker — no dependencies, no build step.
 *
 *   node scripts/check.js
 *
 * Covers the things that are easy to break by accident:
 *   - seed.js still describes the whole Bible (66 books / 1,189 chapters / 74
 *     translations) and ships NO reading progress,
 *   - the service worker precaches everything the app needs, and every path it
 *     lists actually exists,
 *   - a fresh install boots completely empty (the whole point of the app),
 *   - a store saved by an older version still loads,
 *   - and stats survive past the 500-event history cap.
 *
 * The app is loaded into a tiny DOM stub, so this runs in plain Node.
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.dirname(__dirname);
var STORE_KEY = "bible-tracker-v1";

var checks = 0;
var failures = 0;
function ok(name, pass, detail) {
  checks++;
  if (pass) {
    console.log("  \u2713 " + name);
  } else {
    failures++;
    console.log("  \u2717 " + name + (detail ? "  \u2014 " + detail : ""));
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}
function section(title) {
  console.log("\n" + title);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ---------- seed.js ----------
function loadSeed() {
  var sandbox = {};
  new Function("window", read("seed.js"))(sandbox);
  return sandbox.BIBLE_SEED;
}

// ---------- minimal DOM ----------
// ---------- tiny HTML parser for the stub DOM ----------
// Lets the test reach into rendered markup (chapter buttons, bulk-mark buttons)
// the way a real browser would, instead of only elements with an id.
function parseAttrs(str) {
  var attrs = {};
  var re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  var m;
  while ((m = re.exec(str))) {
    var k = m[1];
    var v = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ""));
    attrs[k] = v;
  }
  return attrs;
}
function parseTags(html) {
  var tags = [];
  if (!html) return tags;
  var re = /<([a-zA-Z]+)([^>]*)>/g;
  var m;
  while ((m = re.exec(html))) {
    var attrs = parseAttrs(m[2]);
    var classes = attrs["class"] ? String(attrs["class"]).split(/\s+/) : [];
    tags.push({ tag: m[1], attrs: attrs, classes: classes });
  }
  return tags;
}
function matchesSelector(tag, sel) {
  sel = String(sel).trim();
  if (!sel) return false;
  var parts = sel.split(/\s+/);
  if (parts.length > 1) return false;
  var s = parts[0];
  if (s.charAt(0) === ".") return tag.classes.indexOf(s.slice(1)) !== -1;
  if (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]") {
    var inner = s.slice(1, -1);
    var eqi = inner.indexOf("=");
    var attr, val, hasVal;
    if (eqi === -1) { attr = inner; hasVal = false; }
    else { attr = inner.slice(0, eqi); val = inner.slice(eqi + 1); hasVal = true;
      if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') val = val.slice(1, -1);
    }
    if (!hasVal) return Object.prototype.hasOwnProperty.call(tag.attrs, attr);
    return tag.attrs[attr] === val;
  }
  return tag.tag === s;
}

function queryAll(el, sel) {
  var parsed = parseTags(el.innerHTML);
  var out = [];
  parsed.forEach(function (t) {
    if (!matchesSelector(t, sel)) return;
    var stub = makeElement(t.attrs.id || "");
    Object.keys(t.attrs).forEach(function (k) { stub.dataset[k] = t.attrs[k]; });
    stub.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(t.attrs, k) ? t.attrs[k] : null; };
    stub.setAttribute = function (k, v) { t.attrs[k] = v; };
    stub.classList.contains = function (c) { return t.classes.indexOf(c) !== -1; };
    stub.click = function (ev) { (stub._handlers.click || []).forEach(function (fn) { fn(ev || {}); }); };
    out.push(stub);
  });
  return out;
}

function makeElement(id) {
  var handlers = {};
  var el = {
    id: id,
    style: { setProperty: function () {}, width: "" },
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    options: [],
    dataset: {},
    children: [],
    files: [],
    hidden: false,
    checked: false,
    disabled: false,
    value: "",
    textContent: "",
    innerHTML: "",
    _handlers: handlers,
    addEventListener: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener: function () {},
    setAttribute: function () {},
    getAttribute: function () { return ""; },
    appendChild: function (child) { el.children.push(child); },
    focus: function () {},
    click: function () { (handlers.click || []).forEach(function (fn) { fn(); }); },
    remove: function () {},
    scrollIntoView: function () {},
    querySelector: function (sel) { var r = queryAll(el, sel); return r.length ? r[0] : null; },
    querySelectorAll: function (sel) { return queryAll(el, sel); }
  };
  return el;
}
function makeDom() {
  var els = {};
  return {
    body: makeElement("body"),
    _els: els,
    getElementById: function (id) { return (els[id] = els[id] || makeElement(id)); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) { return makeElement(tag); },
    addEventListener: function () {}
  };
}

// Boot app.js against a fake store. Returns the DOM plus a view of what the app saved.
function boot(store) {
  var appSrc = read("app.js");
  var doc = makeDom();
  var kv = new Map();
  if (store) kv.set(STORE_KEY, JSON.stringify(store));
  var storage = {
    getItem: function (k) { return kv.has(k) ? kv.get(k) : null; },
    setItem: function (k, v) { kv.set(k, String(v)); },
    removeItem: function (k) { kv.delete(k); }
  };
  var location = { protocol: "https:", host: "example.test", pathname: "/index.html", href: "https://example.test/index.html" };
  var win = { BIBLE_SEED: SEED, __BT_TEST: true };
  var fn = new Function(
    "window", "document", "localStorage", "location", "CSS",
    "setInterval", "clearInterval", "Notification", appSrc
  );
  fn(win, doc, storage, location, { escape: function (s) { return s; } },
     function () { return 0; }, function () {}, undefined);
  return {
    doc: doc,
    state: function () { return kv.has(STORE_KEY) ? JSON.parse(kv.get(STORE_KEY)) : null; },
    text: function (id) { return doc.getElementById(id).textContent; },
    html: function (id) { return doc.getElementById(id).innerHTML; },
    click: function (id, ev) {
      var el = doc.getElementById(id);
      var handlers = el._handlers.click;
      if (!handlers || !handlers.length) throw new Error("no click handler on #" + id);
      handlers[0](ev || {});
    },
    gridEl: doc.getElementById("bookGrid"),
    __bt: win.__bt
  };
}

function localDayKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// A day's events, newest last, so nothing lands in the future.
function historyFor(days, perDay) {
  var hist = [];
  var noon = new Date();
  noon.setHours(12, 0, 0, 0);
  for (var d = days - 1; d >= 0; d--) {
    var base = d === 0 ? Date.now() : noon.getTime() - d * 864e5;
    for (var i = 0; i < perDay; i++) {
      hist.push({ b: "Psalms", c: (i % 100) + 1, ts: base - (perDay - i) * 60000, on: true });
    }
  }
  hist.sort(function (a, b) { return b.ts - a.ts; });
  return hist;
}

var SEED = loadSeed();

// ---------- 1. seed data ----------
section("seed.js");
eq("66 books", SEED.books.length, 66);
eq("74 translations", SEED.translations.length, 74);
var countsOK = SEED.books.every(function (b) { return Number.isInteger(b.chapters) && b.chapters > 0; });
var chapters = SEED.books.reduce(function (n, b) { return n + (Number.isInteger(b.chapters) ? b.chapters : 0); }, 0);
ok("1,189 chapters", countsOK && chapters === 1189, countsOK ? "sum = " + chapters : "some books have no chapter count");
ok("default translation exists", SEED.translations.some(function (t) { return t.abbr === SEED.defaultTranslationAbbr; }), SEED.defaultTranslationAbbr);
ok("book names are unique", new Set(SEED.books.map(function (b) { return b.name; })).size === SEED.books.length);
ok("every book has a name, testament and chapter count",
  SEED.books.every(function (b) {
    return typeof b.name === "string" && b.name &&
      (b.testament === "Old Testament" || b.testament === "New Testament") &&
      Number.isInteger(b.chapters) && b.chapters > 0;
  }));
// The whole point of the current design: no personal progress ships with the app.
ok("seed carries no per-chapter read flags",
  SEED.books.every(function (b) { return !Array.isArray(b.chapters); }),
  "chapters must be a count, not an array of booleans");
ok("no read flags anywhere in seed.js", !/\btrue\b|\bfalse\b/.test(read("seed.js").replace(/"exportedFrom":"[^"]*"/g, "")));
ok("extract.py writes counts, not flags", /"chapters": count/.test(read("scripts/extract.py")));

// ---------- 2. service worker precache ----------
section("sw.js");
var sw = read("sw.js");
var assets = (sw.match(/var ASSETS = \[([\s\S]*?)\];/) || [])[1];
ok("ASSETS list found", !!assets);
var paths = (assets || "").match(/"\.\/[^"]*"/g) || [];
ok("ASSETS has entries", paths.length > 0);
var missing = paths.map(function (p) { return p.slice(1, -1); }).filter(function (p) {
  var target = p === "./" ? "index.html" : p;
  return !fs.existsSync(path.join(ROOT, target));
});
eq("every precached path exists", missing.join(", "), "");
eq("cache name is versioned", /var CACHE = "bible-tracker-v\d+";/.test(sw), true);
["index.html", "styles.css", "app.js", "seed.js"].forEach(function (f) {
  ok("precaches " + f, paths.indexOf('"./' + f + '"') !== -1);
});
ok("store key matched by this test", read("app.js").indexOf('"' + STORE_KEY + '"') !== -1, STORE_KEY);

// ---------- 3. a fresh install is empty ----------
section("fresh install");
var fresh = boot(null);
eq("no chapters marked read", fresh.text("chaptersRead"), "0");
eq("total chapters shown", fresh.text("chaptersTotal"), "1,189");
eq("overall progress", fresh.text("overallPct"), "0%");
eq("books finished", fresh.text("booksDone"), "0 / 66");
ok("hero welcomes a new reader", fresh.html("heroSection").indexOf("Start here") !== -1);
ok("hero states the empty totals", fresh.html("heroSection").indexOf("0 of 1,189") !== -1);
ok("no chapter rendered as read", fresh.html("bookGrid").indexOf("chapter read") === -1);
ok("nothing written to the store yet", fresh.state() === null);
ok("backup hint for a new reader", fresh.text("backupStatus").indexOf("Nothing logged yet") === 0, fresh.text("backupStatus"));

// ---------- 4. logging writes the permanent tallies ----------
section("logging a chapter");
var markErr = null;
try { fresh.click("heroMark"); } catch (e) { markErr = e.message; }
ok("hero offers a chapter to mark", !markErr, markErr);
if (!markErr) {
  var logged = fresh.state();
  var today = localDayKey(Date.now());
  eq("chapter saved as read", JSON.stringify(logged.read.Genesis.slice(0, 2)), JSON.stringify([true, false]));
  eq("history gets one event", logged.history.length, 1);
  eq("daily tally records today", logged.days[today], 1);
  ok("book recency recorded", typeof logged.bookLast.Genesis === "number" && logged.bookLast.Genesis > 0);
  eq("streak starts at one day", fresh.text("streak"), "1 day");
}

// ---------- 5. stores from older versions still load ----------
section("existing store from an older version");
var legacyRead = {};
legacyRead.Genesis = SEED.books[0].chapters;
legacyRead["2 John"] = 1;
var legacyArr = {};
legacyArr.Genesis = new Array(50).fill(false).map(function (_, i) { return i < 3; });
legacyArr["2 John"] = [true];
var legacy = boot({
  read: legacyArr,
  history: [
    { b: "Genesis", c: 1, ts: Date.now() - 864e5, on: true },
    { b: "Genesis", c: 2, ts: Date.now() - 2 * 3600e3, on: true },
    { b: "Genesis", c: 3, ts: Date.now(), on: true }
  ],
  translation: "ESV",
  plan: { target: null },
  notes: { "Genesis|1": { t: "note", s: true, u: Date.now() } },
  notif: { enabled: false, time: "08:00", last: "" },
  savedAt: Date.now() - 864e5
});
eq("progress preserved", legacy.text("chaptersRead"), "4");
ok("translation preserved", legacy.html("translationSelect").indexOf('value="ESV" selected') !== -1, legacy.html("translationSelect").slice(0, 80));
eq("streak rebuilt from the old event log", legacy.text("streak"), "2 days");
ok("notes preserved", legacy.html("bookGrid").indexOf("Notes (1)") !== -1, legacy.html("bookGrid").indexOf("Notes") === -1 ? "notes button not rendered" : "");
legacy.click("heroMark"); // any save writes the derived tallies
var legacySave = legacy.state();
eq("tallies derived on save", Object.keys(legacySave.days).length, 2);
ok("today's counts derived", legacySave.days[localDayKey(Date.now())] >= 3, JSON.stringify(legacySave.days));

// ---------- 6. stats survive past the history cap ----------
section("more than " + 500 + " logged events");
var DAYS = 175, PER_DAY = 4;
var busy = boot({ read: {}, history: historyFor(DAYS, PER_DAY), translation: "NKJV", plan: { target: null }, notes: {}, notif: { enabled: false, time: "08:00", last: "" }, savedAt: Date.now() });
var streakDays = parseInt(busy.text("streak"), 10);
ok("streak covers the whole run (" + streakDays + " days)", streakDays >= DAYS - 1, "expected ~" + DAYS);
ok("best streak matches", busy.text("streakLabel").indexOf("best " + streakDays) !== -1, busy.text("streakLabel"));
ok("heatmap keeps the early weeks", busy.text("recentHint").indexOf(DAYS + " reading days") === 0, busy.text("recentHint"));
var emptyCells = (busy.html("streakBlock").match(/day-cell l0/g) || []).length;
ok("only the pre-reading days are blank (" + emptyCells + ")", emptyCells <= 7, "a 26-week grid is 182 cells");
var busyErr = null;
try { busy.click("heroMark"); } catch (e) { busyErr = e.message; }
ok("chapter marked after the cap", !busyErr, busyErr); // marking trims the event log — the tallies must survive
if (!busyErr) {
  var busySave = busy.state();
  eq("event log capped", busySave.history.length, 500);
  ok("reading days kept after the cap", Object.keys(busySave.days).length >= DAYS, Object.keys(busySave.days).length + " days");
  ok("totals still intact", Object.keys(busySave.days).reduce(function (n, k) { return n + busySave.days[k]; }, 0) >= DAYS * PER_DAY, "sum of day counts");
  ok("chart covers every reading day", busy.html("streakBlock").indexOf(DAYS + " reading days") !== -1);
}

// ---------- 7. bulk marking + undo ----------
section("bulk marking");
var bulk = boot(null);

function findRest(b, name) {
  var out = null;
  b.gridEl.querySelectorAll("[data-mark-rest]").forEach(function (btn) {
    if (btn.getAttribute("data-mark-rest") === name) out = btn;
  });
  return out;
}
var genRest = findRest(bulk, "Genesis");
ok("Genesis offers 'mark all left'", !!genRest, "no mark-all button for an unread book");

// Bulk-mark every remaining chapter in Genesis via the exposed mutation.
var n = bulk.__bt.bulkApply("Genesis", (function () {
  var arr = bulk.state() ? null : null;
  var out = []; for (var i = 1; i <= 50; i++) out.push(i); return out;
})(), true);
// Only the unread ones count.
var bulkState = bulk.state();
eq("bulk marks every chapter", bulkState.read.Genesis.reduce(function (n, x) { return n + (x ? 1 : 0); }, 0), 50);
eq("bulk reports the count", n, 50);
eq("day tally grows by the count", bulkState.days[localDayKey(Date.now())], 50);
ok("undo toast appears", bulk.doc.getElementById("undoToast").hidden === false);
// Undo restores everything.
bulk.__bt.undoBulk();
var undone = bulk.state();
eq("undo restores the read array", undone.read.Genesis.reduce(function (n, x) { return n + (x ? 1 : 0); }, 0), 0);
ok("undo clears the day tally", undone.days[localDayKey(Date.now())] === undefined, JSON.stringify(undone.days));
ok("undo hides the toast", bulk.doc.getElementById("undoToast").hidden === true);

// A fully read book offers no bulk button.
var full = boot(null);
var g = findRest(full, "Genesis");
if (g) g.click(); // mark all (via UI is not wired to handlers in the stub, so use __bt)
// Re-mark via __bt to make it complete, then re-render by toggling a filter? render happens inside bulkApply.
full.__bt.bulkApply("Genesis", (function(){var o=[];for(var i=1;i<=50;i++)o.push(i);return o;})(), true);
ok("no 'mark all left' on a complete book", findRest(full, "Genesis") === null);

// Undo a bulk action that changed nothing is a no-op.
var noop = boot(null);
var noopErr = null;
try { noop.__bt.undoBulk(); } catch (e) { noopErr = e.message; }
ok("undo with no pending action is harmless", !noopErr, noopErr);

// Bulk marking a book that is already complete changes nothing.
var already = boot(null);
already.__bt.bulkApply("Genesis", (function(){var o=[];for(var i=1;i<=50;i++)o.push(i);return o;})(), true);
var r2 = already.__bt.bulkApply("Genesis", (function(){var o=[];for(var i=1;i<=50;i++)o.push(i);return o;})(), true);
eq("bulk on a complete book changes nothing", r2, 0);

// Shift-click range logic mirrors a toggle: marking 2..5 of Exodus.
var range = boot(null);
range.__bt.logAndToggle("Exodus", 2, true); // anchor + mark
// Simulate the range computation the UI does.
var chapters = []; for (var c = 2; c <= 5; c++) chapters.push(c);
var rn = range.__bt.bulkApply("Exodus", chapters, false);
// Exodus 2 was read; range takes the opposite of the clicked chapter's prior state (unread -> ... )
// Here we explicitly unmark 2..5; verify 2 becomes unread and others untouched.
var rs = range.state();
ok("range unmarks chapter 2", rs.read.Exodus[1] === false);
ok("range leaves chapter 1 unread", rs.read.Exodus[0] === false);
// Re-mark via a fresh range to confirm marking works.
var range2 = boot(null);
range2.__bt.bulkApply("Exodus", [2,3,4,5], true);
var rs2 = range2.state();
ok("range marks 2", rs2.read.Exodus[1] === true);
ok("range marks 3", rs2.read.Exodus[2] === true);
ok("range marks 4", rs2.read.Exodus[3] === true);
ok("range marks 5", rs2.read.Exodus[4] === true);
ok("range leaves 1 unread", rs2.read.Exodus[0] === false);
ok("range leaves 6 unread", rs2.read.Exodus[5] === false);

// Undo restores after a range mark.
range2.__bt.undoBulk();
ok("range undo restores chapter 2", range2.state().read.Exodus[1] === false);

// ---------- summary ----------
console.log("\n" + (failures ? "\u2717 " + failures + " of " + checks + " checks failed" : "\u2713 all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
