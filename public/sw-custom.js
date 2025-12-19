// Custom Service Worker for Push Notifications
// This file handles push notification events

// Listen for push events
self.addEventListener('push', (event) => {
  console.log('Push event received:', event);

  let title = 'CFS Tracker';
  let options = {
    body: 'You have a new notification',
    icon: '/pwa-192x192.png',
    badge: '/favicon.svg',
    tag: 'cfs-notification',
    requireInteraction: true // Keep it visible until user interacts
  };

  if (event.data) {
    try {
      const json = event.data.json();
      title = json.title || title;
      options.body = json.body || options.body;
      options.icon = json.icon || options.icon;
      options.badge = json.badge || options.badge;
      if (json.data) options.data = json.data;
      if (json.actions) options.actions = json.actions;
    } catch (error) {
      console.error('Failed to parse push data as JSON:', error);
      // Fallback to text if JSON parsing fails
      options.body = event.data.text() || options.body;
    }
  }

  // Ensure paths are absolute (helps on some devices)
  const origin = self.location.origin;
  if (options.icon && !options.icon.startsWith('http')) {
    options.icon = origin + (options.icon.startsWith('/') ? '' : '/') + options.icon;
  }
  if (options.badge && !options.badge.startsWith('http')) {
    options.badge = origin + (options.badge.startsWith('/') ? '' : '/') + options.badge;
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Listen for notification click events
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  console.log('Action:', event.action);

  event.notification.close();

  // Handle snooze action
  if (event.action === 'snooze') {
    console.log('Snooze action clicked');

    event.waitUntil(
      fetch('/api/snooze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${self.SECRET_TOKEN || 'dev-secret-token-12345'}`
        },
        body: JSON.stringify({ duration: 60 })
      })
      .then(response => response.json())
      .then(data => {
        console.log('Snooze successful:', data);

        // Show a confirmation notification
        return self.registration.showNotification('Snoozed for 1 hour', {
          body: 'You\'ll be reminded again in 1 hour.',
          icon: '/pwa-192x192.png',
          badge: '/favicon.svg',
          tag: 'snooze-confirmation',
          requireInteraction: false
        });
      })
      .catch(error => {
        console.error('Snooze failed:', error);
      })
    );

    return;
  }

  // Handle "track" action or default click - open the app
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
