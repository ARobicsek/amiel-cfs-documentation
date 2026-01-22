# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         iPhone                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    PWA (React)                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │ DailyEntry  │  │   History   │  │    Settings     │   │  │
│  │  │  (slider)   │  │  (7 days)   │  │  (reminders)    │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │  │
│  │         │                │                   │            │  │
│  │         └────────────────┴───────────────────┘            │  │
│  │                          │                                 │  │
│  │              ┌───────────┴───────────┐                    │  │
│  │              │    Service Worker     │                    │  │
│  │              │  (offline + push)     │                    │  │
│  │              └───────────┬───────────┘                    │  │
│  │                          │                                 │  │
│  │              ┌───────────┴───────────┐                    │  │
│  │              │      IndexedDB        │                    │  │
│  │              │   (offline queue)     │                    │  │
│  │              └───────────────────────┘                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vercel (Backend)                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 Serverless Functions                       │  │
│  │                                                            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │ submit-entry │  │ get-entries  │  │  subscribe   │    │  │
│  │  │    POST      │  │    GET       │  │    POST      │    │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │  │
│  │         │                 │                  │            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │ cron-trigger │  │send-notif    │  │  schedules   │    │  │
│  │  │  (hourly)    │  │ + jokes API  │  │    CRUD      │    │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Google Sheets API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Google Sheets                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Sheet 1: Entries                                          │  │
│  │  ┌──────────┬──────┬───────┬──────────┬───────┬─────────┐ │  │
│  │  │Timestamp │ Date │ Hours │ Comments │ Oxa(g)│ Ex(min) │ │  │
│  │  ├──────────┼──────┼───────┼──────────┼───────┼─────────┤ │  │
│  │  │ ...      │ ...  │ 6.5   │ ...      │ 100   │ 15      │ │  │
│  │  └──────────┴──────┴───────┴──────────┴───────┴─────────┘ │  │
│  │                                                            │  │
│  │  Sheet 2: Subscriptions (for push notifications)           │  │
│  │  Sheet 3: Schedules (reminder times)                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Daily Entry Submission

```
1. User slides hours slider → taps Save
2. App checks online status
   ├── Online: POST to /api/submit-entry
   │   └── Vercel function appends row to Google Sheet
   └── Offline: Save to IndexedDB
       └── Service Worker syncs when online
3. Show success feedback (animation/haptic)
```

### Push Notification Flow

```
1. Vercel cron runs every hour
2. Check if current time matches any scheduled reminder
3. If match:
   a. Fetch joke from jokes API
   b. Send push notification with joke
4. User taps notification → opens app at entry form
```

## Key Design Decisions

### Why PWA instead of Native?
- No App Store approval needed
- Same codebase for web and "native" feel
- Easier to update (just deploy)
- Still installable with home screen icon

### Why Google Sheets instead of Database?
- Zero cost
- Data immediately viewable/exportable
- No database management
- Easy to share with caregiver
- Good enough for single user

### Why Secret URL instead of Login?
- Zero friction (critical for CFS patient)
- Token stored locally after first visit
- Simple to implement
- Adequate security for personal health app

### Why Vercel?
- Free tier is generous
- Serverless = no server management
- Built-in cron jobs
- Automatic HTTPS
- Easy deployment from GitHub

## File Responsibilities

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main router, theme provider |
| `src/components/DailyEntry.jsx` | Hours slider, submit button |
| `src/components/OptionalFields.jsx` | Collapsible extra fields |
| `src/components/History.jsx` | Past entries list |
| `src/components/Settings.jsx` | Notification schedule |
| `src/utils/auth.js` | Token management |
| `src/utils/api.js` | API calls with auth |
| `src/utils/offlineStorage.js` | IndexedDB operations |
| `api/submit-entry.js` | Save to Google Sheets |
| `api/get-entries.js` | Fetch from Google Sheets |
| `api/subscribe.js` | Save push subscription |
| `api/send-notification.js` | Send push with joke |
| `api/cron-trigger.js` | Check schedules, trigger notifications |

## Security Model

```
┌─────────────────────────────────────────────┐
│              Security Layers                 │
├─────────────────────────────────────────────┤
│ 1. HTTPS (enforced by Vercel)               │
│ 2. Secret token in URL/localStorage         │
│ 3. Token validated on every API call        │
│ 4. Service account has Sheets-only access   │
│ 5. No sensitive PII stored                  │
└─────────────────────────────────────────────┘
```

The secret URL approach is appropriate because:
- Single known user
- Non-critical data (hours tracking)
- Private URL not shared publicly
- Token rotatable if compromised

## Data Backup & Redundancy

The app implements multiple layers of data protection:

### 1. Automated Daily Backups

```
┌────────────────────────────────────────────────────────┐
│  Vercel Cron (5 AM ET daily)                           │
│         │                                              │
│         ▼                                              │
│  /api/backup-data                                      │
│         │                                              │
│         ├──► Sheet1       → Backup_YYYY-MM-DD          │
│         ├──► ECG_Readings → ECG_Backup_YYYY-MM-DD      │
│         ├──► ECG_Waveforms→ Waveform_Backup_YYYY-MM-DD │
│         │                                              │
│         └──► Prune backups older than 30 days          │
└────────────────────────────────────────────────────────┘
```

- Creates timestamped backup sheets within the same spreadsheet
- Backs up all three data sheets: Sheet1, ECG_Readings, ECG_Waveforms
- Retains 30 days of daily backups (90 backup sheets total)
- Includes anomaly detection (warns if row count drops unexpectedly)

### 2. Write-Ahead Audit Log

Every entry submission is logged to an `AuditLog` sheet BEFORE the main write:

| Timestamp | Action | DateFor | RequestBody (JSON) |
|-----------|--------|---------|-------------------|
| 01/21/2026, 19:30:00 | SUBMIT_ENTRY | 01/21/2026 | {"hours": 6.5, ...} |

This enables:
- Complete data replay if Sheet1 is corrupted
- Debugging and troubleshooting historical issues
- Audit trail of all modifications

### 3. Monthly Email Backups

On the 1st of each month, CSV backups are emailed to:
- amiel.robicsek@gmail.com
- ari.robicsek@gmail.com

Attachments include:
- `cfs-tracker-entries-YYYY-MM.csv` (Sheet1)
- `cfs-tracker-ecg-readings-YYYY-MM.csv` (ECG_Readings)
- `cfs-tracker-ecg-waveforms-YYYY-MM.csv` (ECG_Waveforms)

**Setup required**: Add `RESEND_API_KEY` to Vercel environment variables.

### 4. Google Sheets Version History

Google Sheets automatically maintains version history for ~30 days. Access via:
1. File → Version history → See version history
2. Select a previous version to view/restore

### Protected Ranges (Manual Setup)

To prevent accidental manual edits:
1. Open the Google Sheet
2. Select header row (Row 1)
3. Right-click → "Protect range"
4. Set permissions to only allow the service account to edit

| File | Purpose |
|------|---------|
| `api/backup-data.js` | Daily backup (3 sheets) + monthly email |
| `api/submit-entry.js` | Entry submission + audit logging |

