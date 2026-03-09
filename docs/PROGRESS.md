# Development Progress

Track completed features and current status here. Update after completing each feature.

## Current Status: Phase 1 - Foundation

### Phase 1: Core App (MVP)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Project setup (Vite + React) | DONE | Basic scaffolding complete |
| 2 | PWA configuration | DONE | manifest.json, service worker |
| 3 | Hours slider UI | DONE | Half-hour increments, default 6h |
| 4 | Google Sheets integration | DONE | Writes to Google Sheet with Eastern Time |
| 5 | Submit entry API | DONE | Saves entries to Google Sheets |
| 6 | Secret URL auth | DONE | Token handling in src/utils/auth.js |
| 7 | Optional fields (collapsible) | DONE | Comments, oxaloacetate, exercise |
| 8 | Entry history view | DONE | Last 10 days, ECG data integrated, redesigned cards |
| 9 | Offline storage + sync | DONE | IndexedDB with auto-sync on reconnect |
| 10 | Auto light/dark theme | DONE | Follows system preference |

### Phase 2: Notifications

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 11 | Web Push setup | DONE | VAPID keys generated, web-push installed |
| 12 | Push subscription flow | DONE | Full flow complete, tested end-to-end |
| 13 | Notification endpoint | DONE | Sends push with jokes from API |
| 14 | Vercel cron job | DONE | Customizable schedule + snooze feature |
| 15 | Settings page | DONE | Enable/disable notifications UI complete |
| 16 | Manual Alert Trigger | DONE | Custom message support + Parent UI |

### Phase 3: Stats & Visualization

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 16 | Stats Tab - Single Day View | DONE | HR scatter + activity bar (sleep/walking/blank), 24h timeline, date navigation, summary stats |
| 17 | Stats Tab - Multi Day View | DONE | 6 charts: HR box plots, sleep stacked bars, steps/HRV/feet on ground/brain time line charts. Date range nav + 7D/30D/3M/6M presets. Fullscreen per chart. |
| 18 | Streak animations | TODO | ON HOLD - Motivation feature |
| 19 | Sleep session validation (HR/step-based) | DONE | HR/step awake-score validation for picking best session from nested Apple Watch clusters. Handles nested, sequential, and cross-midnight sessions. Sparse-data guard prevents false parent expansion. Step count tooltip added. |

### Phase 4: ECG Integration (COMPLETE - Fully Automatic)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 18 | Google Drive & Sheets setup | DONE | ECG folder created, ECG_Readings sheet ready |
| 19 | ECG webhook endpoint | DONE | R/S ratio + HR validation, waveform storage in Sheets |
| 20 | Health Auto Export config | DONE | CSV parsing fixed, duplicate detection working |
| 21 | ECG history display | DONE | HR + R/S ratio in history cards, "Will do ECG" button |
| 22 | Health Data Integration | DONE | Automated Heart Rate, Steps, Sleep, HRV via Health Auto Export |

**Key Design:** NO manual data entry. R/S ratio calculated automatically from raw voltage data.

**User Experience After Setup:**
1. Take 30-second ECG on Apple Watch
2. Open CFS Tracker, save daily entry, tap "Sync ECG Data" button
3. Health Auto Export opens and syncs cached ECG data

**ECG_Readings Columns (15 total):**
Timestamp, Date, Classification, Avg HR (Apple), R/S Ratio, R Amp, S Amp, Calc HR, HR Valid, Beats, Notes, ECG_ID, Samples, Sampling_Freq, HR Diff

**ECG_Waveforms Columns (6 total):**
ECG_ID, Sampling_Freq, Voltage_1, Voltage_2, Voltage_3, Voltage_4

**Documentation:**
- `docs/ECG-CAPTURE-PLANNING.md` - Research & options analysis
- `docs/ECG-IMPLEMENTATION-GUIDE.md` - Step-by-step dev guide (fully automatic approach)

---

### Next Up
1. Streak animations (Feature 18, currently ON HOLD)
2. Any new discrepancies or data quality issues discovered during use

---
