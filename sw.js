/* Bible Tracker service worker — offline-capable, network-first.
 * Same-origin requests always try the network first and fall back to the
 * cache, so app updates show up on reload instead of going stale. The cache
 * is only the offline safety net. Bump CACHE to evict old precaches. */
var CACHE = "bible-tracker-v8";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./seed.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  // Never intercept cross-origin traffic (Bible.com links, etc.).
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        // Offline navigation fallback; subresources just fail.
        if (e.request.mode === "navigate") return caches.match("./index.html");
        throw new Error("offline");
      });
    })
  );
});
