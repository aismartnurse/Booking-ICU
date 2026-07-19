// รับ push event → แสดง notification ค้างไว้จนกว่าจะปิด
self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : {};
  e.waitUntil(
    Promise.all([
      // แสดง notification ค้างไว้
      self.registration.showNotification(data.title || '🏥 ICU Booking', {
        body: data.body || '',
        tag: 'icu-update',
        renotify: true,
        requireInteraction: true,  // ค้างไว้จนกว่าจะปิดเอง
        vibrate: [300, 100, 300, 100, 300, 100, 300],
      }),
      // ส่ง message ไปยังทุก tab ที่เปิดอยู่ให้เล่นเสียง
      self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'PLAY_SOUND', data: data });
        });
      })
    ])
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('/status.html'));
});
