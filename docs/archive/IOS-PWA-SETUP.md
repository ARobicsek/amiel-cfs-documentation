# iOS PWA Installation & Notification Setup Guide

This guide explains how to install the CFS Tracker as a Progressive Web App (PWA) on iPhone and enable push notifications.

## Requirements

- **iOS 16.4 or later** (released March 2023)
- Safari browser
- The app MUST be added to Home Screen (notifications don't work in Safari browser)

## Installation Steps

### 1. Install the PWA to Home Screen

1. Open Safari on your iPhone
2. Navigate to your CFS Tracker URL (e.g., `https://your-app.vercel.app`)
3. Tap the **Share** button (square with arrow pointing up) at the bottom
4. Scroll down and tap **"Add to Home Screen"**
5. Optionally edit the name
6. Tap **"Add"** in the top right
7. The app icon will appear on your Home Screen

### 2. Open the PWA from Home Screen

**IMPORTANT**: You MUST open the app from the Home Screen icon, not from Safari.

1. Tap the CFS Tracker icon on your Home Screen
2. The app will open in full-screen mode (no Safari UI)

### 3. Enable Notifications

1. In the PWA, tap the **Settings** icon at the bottom
2. Tap **"Enable Notifications"**
3. iOS will show a permission dialog
4. Tap **"Allow"**
5. You should see "Notifications Enabled ✓"

### 4. Verify Notifications Work

To test that notifications are working:

1. Ask the admin to trigger a test notification, OR
2. Wait for your scheduled reminder time

If successful, you'll see a notification even when the app is closed!

---

## Known Limitations on iOS

### Notification Action Buttons May Not Display
- The "Track Now" and "Snooze 1 Hour" buttons may not appear on iOS notifications
- This is an iOS limitation, not a bug in our app
- You can still open the app by tapping the notification itself

### Must Re-Subscribe After Reinstalling PWA
- If you delete the PWA and reinstall it, you'll need to enable notifications again
- Your data is safe (stored in Google Sheets), but the notification subscription is device-specific

### Background Service Worker Throttling
- iOS may throttle background sync more aggressively than Android
- If you log an entry while offline, it may take longer to sync on iOS

---

## Troubleshooting

### "Enable Notifications" button doesn't work
1. Make sure you're using **iOS 16.4 or later**
   - Go to Settings → General → About → iOS Version
2. Make sure you opened the app from the **Home Screen icon**, not Safari
3. Check iOS Settings → Notifications → CFS Tracker → Allow Notifications is ON

### Notifications aren't appearing
1. Verify iOS Settings → Notifications → CFS Tracker → Allow Notifications is ON
2. Check that "Lock Screen", "Notification Center", and "Banners" are enabled
3. Make sure the PWA is actually running (open it at least once after installation)
4. Check your UserSettings in Google Sheets - ensure reminders are configured

### Need to re-enable notifications
1. Go to iOS Settings → Notifications → CFS Tracker
2. Toggle "Allow Notifications" OFF then ON
3. Open the PWA from Home Screen
4. Go to Settings in the app and disable/re-enable notifications

---

## Checking iOS Version

1. Open **Settings** app
2. Tap **General**
3. Tap **About**
4. Look for **iOS Version** (should be 16.4 or later for notifications)

If you're on an older iOS version, you'll need to update to use push notifications in PWAs.

---

## Alternative: Android or Desktop

If push notifications don't work on your iPhone:
- Use the PWA on **Android** (Chrome/Edge/Samsung Internet)
- Use the PWA on **Desktop** (Chrome, Edge, or Firefox)
- Both platforms have better PWA support than iOS

---

## Questions?

Refer to [NOTIFICATION-TESTING-GUIDE.md](NOTIFICATION-TESTING-GUIDE.md) for general notification testing and configuration.
