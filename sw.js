// 서비스워커: 네트워크 우선(항상 최신), 오프라인일 때만 캐시 사용
const CACHE = "jeju-toilet-v15";
const SHELL = ["./", "index.html", "css/app.css", "fonts/ddong-logo.woff", "js/app.js", "js/i18n.js", "js/icons.js", "js/sos.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "data/toilets.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const same = url.origin === location.origin;
  const cdn = /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (!same && !cdn) return;
  if (cdn) { // 외부 라이브러리·폰트는 캐시 우선
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
