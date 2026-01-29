# Script References

Quick reference for all JavaScript files in this project. **Read this file first when looking for code.**

---

## API Endpoints (`api/`)
Server-side Vercel functions. All require `Authorization: Bearer <SECRET_TOKEN>`.

| File | Description | Link |
|------|-------------|------|
| `backup-data.js` | Creates daily Google Sheets backups and sends monthly CSV email backups. | [backup-data.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/backup-data.js) |
| `cron-trigger.js` | Runs every 15 min via Vercel cron; checks if it's time to send a push notification reminder. | [cron-trigger.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/cron-trigger.js) |
| `debug-env.js` | Debug endpoint that returns which environment variables are set (no token required). | [debug-env.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/debug-env.js) |
| `ecg-webhook.js` | Receives ECG data from Health Auto Export (multipart/CSV), parses it, calculates R/S ratio, and stores in Sheets. | [ecg-webhook.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/ecg-webhook.js) |
| `health-webhook.js` | Receives JSON health data (HR, Steps, Sleep), aggregates daily stats, and stores in Sheets. | [health-webhook.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/health-webhook.js) |
| `get-entries.js` | Fetches recent daily entries from Google Sheets, merging in ECG data by date. | [get-entries.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/get-entries.js) |
| `get-hourly-data.js` | Fetches raw Health_Hourly rows for a single date (used by Stats Single Day view). | [get-hourly-data.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/get-hourly-data.js) |
| `notification-settings.js` | GET/POST for user notification preferences (first reminder time, repeat interval). | [notification-settings.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/notification-settings.js) |
| `send-notification.js` | Sends push notifications with jokes to all subscribed devices. | [send-notification.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/send-notification.js) |
| `snooze.js` | Records a snooze request, storing snooze-until time in Sheets. | [snooze.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/snooze.js) |
| `submit-entry.js` | Saves/updates a daily entry (hours, meds, comments) to Google Sheets with audit logging. | [submit-entry.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/submit-entry.js) |
| `subscribe.js` | Saves a push notification subscription to Google Sheets. | [subscribe.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/subscribe.js) |

---

## Client Utilities (`src/utils/`)
Frontend helper modules.

| File | Exports | Description | Link |
|------|---------|-------------|------|
| `api.js` | `submitEntry`, `getEntries`, `subscribeToPush` | Wrapper functions for authenticated API calls. | [api.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/api.js) |
| `auth.js` | `getSecretToken`, `isAuthenticated`, `clearAuth`, `getAuthenticatedUrl` | Manages secret URL token authentication (store/retrieve from localStorage). | [auth.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/auth.js) |
| `offlineStorage.js` | `saveOfflineEntry`, `getPendingEntries`, `syncPendingEntries`, `setupOfflineSync` | IndexedDB utilities for offline-first entry storage and sync. | [offlineStorage.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/offlineStorage.js) |
| `pushNotification.js` | `isPushSupported`, `subscribeToPush`, `unsubscribeFromPush`, `isSubscribed` | Push notification subscription and management. | [pushNotification.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/pushNotification.js) |
| `statsDataService.js` | `processSingleDayData`, `formatMinutes`, `formatTime` | Stats data processing: Nested Session Differencing for sleep, step suppression, HR point extraction. | [statsDataService.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/statsDataService.js) |

---

## React Components (`src/components/`)

| File | Description | Link |
|------|-------------|------|
| `DailyEntry.jsx` | Main form for submitting daily entries (hours, meds, ECG checkbox). | [DailyEntry.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/DailyEntry.jsx) |
| `EntryHistory.jsx` | Displays past entries in a timeline/list format. | [EntryHistory.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/EntryHistory.jsx) |
| `Settings.jsx` | Notification settings, push subscription toggle, and debug tools. | [Settings.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Settings.jsx) |
| `Stats/StatsTab.jsx` | Top-level Stats tab with Single/Multi Day toggle and dark mode detection. | [StatsTab.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/StatsTab.jsx) |
| `Stats/SingleDayView.jsx` | Single Day stats: date navigation, HR scatter chart, activity bar, summary stats. | [SingleDayView.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/SingleDayView.jsx) |
| `Stats/FullscreenChart.jsx` | Wrapper providing fullscreen capability for charts (Fullscreen API + CSS fallback). | [FullscreenChart.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/FullscreenChart.jsx) |
| `Stats/charts/HRScatterChart.jsx` | 24h HR scatter plot using Chart.js (tap-for-tooltip). | [HRScatterChart.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/HRScatterChart.jsx) |
| `Stats/charts/ActivityBar.jsx` | Canvas-rendered broken bar (ASLEEP/WALKING/BLANK across 1440 minutes). | [ActivityBar.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/ActivityBar.jsx) |

---

## Service Worker (`public/`)

| File | Description | Link |
|------|-------------|------|
| `sw-custom.js` | Handles push events (show notification), notification clicks (snooze/track actions), and window focus. | [sw-custom.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/public/sw-custom.js) |

---

## App Entry Points (`src/`)

| File | Description | Link |
|------|-------------|------|
| `main.jsx` | React app entry point; renders `<App />` into DOM. | [main.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/main.jsx) |
| `App.jsx` | Root component with routing between DailyEntry, EntryHistory, StatsTab, and Settings tabs. | [App.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/App.jsx) |

---

## Build/Config (root)

| File | Description | Link |
|------|-------------|------|
| `vite.config.js` | Vite + PWA config: manifest, workbox caching, service worker setup. | [vite.config.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/vite.config.js) |
| `eslint.config.js` | ESLint flat config with React hooks/refresh plugins. | [eslint.config.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/eslint.config.js) |
| `validate-keys.js` | Utility script to validate VAPID keys are correctly configured. | [validate-keys.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/validate-keys.js) |
| `update_icons.js` | Utility script to copy F15_icon.png to all PWA icon locations. | [update_icons.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/update_icons.js) |
| `fix-sync-issues-v2.js` | One-off script to cleanup duplicates and fix sleep timestamps (Jan 2026). | [fix-sync-issues-v2.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/fix-sync-issues-v2.js) |
| `manual_sleep_calc.js` | Analysis tool to manually parse, deduplicate, and sum raw sleep data from text files. | [manual_sleep_calc.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/manual_sleep_calc.js) |
