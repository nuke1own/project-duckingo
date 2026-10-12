const CACHE_NAME = "duckingo-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/chat.html",
  "/styles.css",
  "/chat.js",
  "/global-shortcuts.js",
  "/theme.js",
  "/register-sw.js",
  "/sw.js",
  "/favicon.svg",
  "/tools/qr-code/",
  "/tools/image-studio/",
  "/tools/pdf-studio/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(fetch(request).then((response) => {
        if (response.ok) return caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
        return undefined;
      }).catch(() => undefined));
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch {
      if (request.mode === "navigate") return caches.match("/index.html");
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
