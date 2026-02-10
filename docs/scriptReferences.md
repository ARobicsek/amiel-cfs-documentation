# Script References

Quick reference for all JavaScript files in this project. **Read this file first when looking for code.**

---

## API Endpoints (`api/`)
Server-side Vercel functions. All require `Authorization: Bearer <SECRET_TOKEN>`.

| File | Description | Link |
|------|-------------|------|
| `backup-data.js` | Creates daily Google Sheets backups and sends monthly CSV email backups. | [backup-data.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/backup-data.js) |
| `cron-trigger.js` | Runs every 15 min via Vercel cron; checks if it's time to send a push notification reminder. | [cron-trigger.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/cron-trigger.js) |
| `ecg-webhook.js` | Receives ECG data from Health Auto Export (multipart/CSV), parses it, calculates R/S ratio, and stores in Sheets. | [ecg-webhook.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/ecg-webhook.js) |
| `health-webhook.js` | Receives JSON health data (HR, Steps, Sleep), aggregates daily stats, and stores in Sheets. | [health-webhook.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/health-webhook.js) |
| `get-entries.js` | Fetches recent daily entries from Google Sheets, merging in ECG data by date. | [get-entries.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/get-entries.js) |
| `get-hourly-data.js` | Two modes: (1) `?date=` fetches raw Health_Hourly for single day, (2) `?startDate=&endDate=` aggregates HR box plots + sleep/steps/HRV + feet on ground/brain time for multi-day view. | [get-hourly-data.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/api/get-hourly-data.js) |
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
| `api.js` | `submitEntry`, `getEntries`, `getHealthStats`, `subscribeToPush` | Wrapper functions for authenticated API calls. | [api.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/api.js) |
| `auth.js` | `getSecretToken`, `isAuthenticated`, `clearAuth`, `getAuthenticatedUrl` | Manages secret URL token authentication (store/retrieve from localStorage). | [auth.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/auth.js) |
| `offlineStorage.js` | `saveOfflineEntry`, `getPendingEntries`, `syncPendingEntries`, `setupOfflineSync` | IndexedDB utilities for offline-first entry storage and sync. | [offlineStorage.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/offlineStorage.js) |
| `pushNotification.js` | `isPushSupported`, `subscribeToPush`, `unsubscribeFromPush`, `isSubscribed` | Push notification subscription and management. | [pushNotification.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/pushNotification.js) |
| `statsDataService.js` | `processSingleDayData`, `formatMinutes`, `formatTime` | Stats data processing: HR/step-based sleep session validation (awake-score algorithm), step suppression, HR point extraction. | [statsDataService.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/utils/statsDataService.js) |

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
| `Stats/MultiDayView.jsx` | Multi-Day stats: date range navigation, 7D/30D/3M/6M presets, metric toggles, 6 stacked charts. | [MultiDayView.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/MultiDayView.jsx) |
| `Stats/charts/CombinedChart.jsx` | Combined HR scatter + Activity background chart (Chart.js). | [CombinedChart.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/CombinedChart.jsx) |
| `Stats/charts/HRBoxPlotChart.jsx` | Multi-day HR box plots (custom floating bars + whisker plugin, no external dependency). | [HRBoxPlotChart.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/HRBoxPlotChart.jsx) |
| `Stats/charts/SleepStackedBar.jsx` | Multi-day sleep stacked bar (deep/REM/core/awake in hours). | [SleepStackedBar.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/SleepStackedBar.jsx) |
| `Stats/charts/MetricLineChart.jsx` | Reusable line chart for Steps, HRV, Feet on Ground, Brain Time. | [MetricLineChart.jsx](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/src/components/Stats/charts/MetricLineChart.jsx) |

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

## Shared Libraries (`lib/`)

| File | Exports | Description | Link |
|------|---------|-------------|------|
| `sleepValidation.js` | `clusterSleepSessions`, `findBestSessionInCluster`, `parseSleepSession`, `computeValidatedSleepByDate` | Shared sleep validation algorithm used by API endpoints (get-hourly-data, get-entries). Mirrors client-side algorithm in statsDataService.js. | [sleepValidation.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/lib/sleepValidation.js) |

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
| `validate_sleep_sessions.js` | Offline analysis tool: reads `new_hourly.txt`, clusters overlapping sleep sessions, validates each against HR/step data using awake-score algorithm. | [validate_sleep_sessions.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/validate_sleep_sessions.js) |
| `compare_daily_vs_validated.js` | Compares pre-aggregated `Health_Daily` sleep totals vs validated granular data. | [compare_daily_vs_validated.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/compare_daily_vs_validated.js) |
| `backfill_daily_from_validated.js` | Backfill tool: computes validated sleep stats from Health_Hourly and updates Health_Daily rows in Google Sheets. | [backfill_daily_from_validated.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/backfill_daily_from_validated.js) |
| `backfill_hr_awake_asleep.js` | Backfill tool: computes HR-Awake and HR-Asleep from Health_Hourly sleep_stage + heart_rate rows and updates Health_Daily columns P & Q. | [backfill_hr_awake_asleep.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/scripts/backfill_hr_awake_asleep.js) |
| `../tests/verify_date_parsing.js` | Unit test to verify custom date parsing logic for cross-browser compatibility. | [verify_date_parsing.js](file:///c:/Users/ariro/OneDrive/Documents/Personal/Amiel%20CFS%20documentation%20app/tests/verify_date_parsing.js) |
