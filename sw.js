/**
 * m-way app — Service Worker
 * Handles incoming push notifications and click-through.
 * No caching yet (offline mode can be added later if desired).
 */

const SW_VERSION = "v1.0.0";

self.addEventListener("install", (event) => {
  // Activate this SW immediately on install (replaces any old version)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any open clients (PWA windows) immediately
  event.waitUntil(self.clients.claim());
});

/**
 * Push event: fired by the OS when a push arrives from Apple/Google/etc.
 * We expect the payload to be a JSON object: { title, body, data, tag }.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback: treat raw text as the body
    payload = { title: "m-way app", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "m-way app";
  const options = {
    body: payload.body || "",
    data: payload.data || {},
    tag: payload.tag,                // dedupe similar pushes (e.g. same project)
    renotify: !!payload.renotify,    // re-alert even if a tagged push exists
    requireInteraction: !!payload.requireInteraction,
    dir: "auto",
    lang: "ar",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Click handler: when user taps a notification, focus an existing PWA
 * window or open a new one. Optionally route to a deep link from payload.data.url.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "./";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsList) => {
        // Prefer reusing an existing window
        for (const client of clientsList) {
          if ("focus" in client) {
            // Optionally navigate within the existing window
            if (client.url !== url && "navigate" in client) {
              return client.navigate(url).then(() => client.focus());
            }
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
      .catch(() => {})
  );
});

/**
 * Optional: when subscription changes (browser rotates the endpoint),
 * we'd re-register here. For now, just log it.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  // Future: re-subscribe and update Supabase
});
