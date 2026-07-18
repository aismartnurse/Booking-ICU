self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '🏥 ICU Booking', {
      body: data.body || '',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'icu-update',
      renotify: true,
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('/status.html'));
});
