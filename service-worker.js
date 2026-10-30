const CACHE_NAME = "flora-anotomy-shell-v136";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=113",
  "./script.js?v=110",
  "./ai-chat.js?v=107",
  "./ui-enhancements.js?v=4",
  "./supabase-config.js?v=2",
  "./supabase-auth.js?v=15",
  "./garden.js?v=1",
  "./flora-extra.js",
  "./flora-additional.js",
  "./flora-houseplants.js",
  "./flora-new-pack.js",
  "./flora-expansion.js",
  "./flora-expansion-media.js",
  "./flora-verified-media.js",
  "./flora-additional-media.js",
  "./flora-more.js",
  "./flora-more-media.js",
  "./flora-1000.js",
  "./flora-1111.js",
  "./manifest.webmanifest.json?v=92",
  "./icon.svg?v=92",
  "./icon-192.png?v=92",
  "./icon-512.png?v=92",
  "./apple-touch-icon.png?v=92"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("flora-anotomy-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestURL = new URL(event.request.url);
  if (event.request.method !== "GET" || requestURL.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch (error) {
    console.error("Не удалось прочитать push-уведомление Flora.", error);
  }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 80) : "Пора проверить растения";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 180) : "Загляните в свой сад Flora.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "flora-care-reminder",
    renotify: false,
    data: { url: typeof payload.url === "string" ? payload.url : "./#garden" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./#garden", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});