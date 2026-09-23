// Service worker del CRM: solo recibe avisos push y abre el chat al tocarlos.
// No cachea nada: el CRM siempre carga en vivo.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CRM", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CRM";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: Boolean(data.urgent),
      icon: "/web-app-manifest-192x192.png",
      badge: "/favicon-96x96.png",
      data: { href: data.href || "/admin/whatsapp" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/admin/whatsapp";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith("/admin")) {
          await client.focus();
          if ("navigate" in client) await client.navigate(href);
          return;
        }
      }
      await self.clients.openWindow(href);
    })()
  );
});
