const CACHE_NAME = "acq-cache-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/css/styles.css",
  "./assets/js/app.js",
  "./assets/js/history-db.js",
  "./assets/js/iscore-parser.js",
  "./data/codes.json",
  "./data/rating.json",
  "./manifest.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./tools/extractor.html",
];

const RUNTIME_CACHE = "acq-runtime-v2";
const RUNTIME_HOSTS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isRuntimeHost = RUNTIME_HOSTS.includes(url.hostname);
  const cacheName = isRuntimeHost ? RUNTIME_CACHE : CACHE_NAME;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(cacheName).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      // للأصول الخارجية (مكتبات PDF/Excel) نُفضّل النسخة المخزنة محليًا أولًا لضمان العمل دون اتصال
      return isRuntimeHost ? (cached || network) : (cached || network);
    })
  );
});
