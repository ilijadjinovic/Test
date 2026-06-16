self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima poruku od app.js i prikazuje browser notifikaciju
self.addEventListener('message', e => {
  if (e.data?.type !== 'SHOW_NOTIF') return;
  const { title, body, tag } = e.data;
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag,
      renotify: true,
      vibrate: [200, 100, 200]
    })
  );
});

// Klik na notifikaciju — otvori app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(self.registration.scope);
    })
  );
});
