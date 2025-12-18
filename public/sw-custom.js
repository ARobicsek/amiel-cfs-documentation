// Custom Service Worker for Push Notifications
// This file handles push notification events

// Listen for push events
self.addEventListener('push', (event) => {
  console.log('Push event received:', event);

  let data = {
    title: 'CFS Tracker',
    body: 'You have a new notification',
    icon: '/pwa-192x192.png',
    badge: '/favicon.svg'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (error) {
      console.error('Failed to parse push data:', error);
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/favicon.svg',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Listen for notification click events
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);

  event.notification.close();

  // Open the app or focus existing window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }

      // Open a new window if none exists
      if (clients.openWindow) {
        const urlToOpen = event.notification.data?.url || '/';
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Listen for notification close events
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event);
});
