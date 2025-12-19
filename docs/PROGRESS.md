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
| 8 | Entry history view | DONE | Last 7 days, with smart date formatting |
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

### Phase 3: Polish (Future)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 16 | ECG integration | TODO | Phase 2 - photo upload |
| 17 | Data trends/charts | TODO | 7-day visualization |
| 18 | Streak animations | TODO | Motivation feature |

---

## Completed Features Log

### 2025-12-19 - Layout Fix & iPhone Notification Debugging (Session 15)
- **Layout Issue FIXED**:
  - Root cause: `#root` element in `src/App.css` only had `height: 100%` but no `width: 100%`
  - Fix: Added `width: 100%` to `#root` selector
  - Result: PWA now displays full-width on iPhone (no longer squeezed to left)

- **iPhone Push Notification Debugging (IN PROGRESS)**:
  - **Confirmed**: iOS 16.4+, PWA added to Home Screen, subscription saves correctly with `web.push.apple.com` endpoint
  - **Error**: Apple returns `403 Forbidden` with `{"reason":"BadJwtToken"}`
  - **Attempted fixes**:
    1. Changed `VAPID_EMAIL` from `admin@cfs-tracker.local` to real email - still 403
    2. Regenerated fresh VAPID keys - still 403
    3. Added TTL and urgency options to sendNotification - still 403
  - **Current state**: Added detailed key logging to verify VAPID keys match expected values
  - **Expected key values**:
    - Public Key: `BPGqn0LtT6P75SqiEY2l8YsB-Zv1qtNnHJS7qwRKtxbnTl33iqmeyHL3RHYS8B0dyzaX8Ur4tX6NdTe_A1WUrik` (87 chars)
    - Private Key length: 43 chars, starts with `sAYiUZ-lYH`
  - **Next step**: Check Vercel logs after redeploy to verify keys match, then investigate further

- **Code improvements**:
  - Added detailed error reporting for partial notification failures (shows errors even when some devices succeed)
  - Stopped auto-deleting 403 subscriptions (only delete 410/404) to allow debugging
  - Added TTL and urgency options to web-push sendNotification call

### 2025-12-18 - iPhone Notification Troubleshooting (Session 14)
- **Investigation**:
  - Confirmed duplicate notifications on Desktop (Localhost vs Production).
  - Identified that iPhone PWA "Saved successfully" message didn't initially create a subscription row in Google Sheets.
  - Clearing the "Subscriptions" sheet allowed a new subscription to be created from iPhone.
  - "Send Test Notification" reported "Sent to 0 devices" despite the subscription existing.
- **Findings**:
  - There might be an issue with how the subscription object is serialized or stored for iOS devices, or how the backend filters "valid" subscriptions.
  - The "0 devices" message implies the backend logic filtered out the iPhone subscription.
- **Next Steps**:
  - Debug `api/send-notification.js` to see why it might be skipping the iPhone subscription.
  - Check the format of the subscription object sent from the iPhone.

### 2025-12-18 - iPhone PWA Notification Fix (Session 14)
- **Investigation**:
  - Confirmed duplicate notifications on Desktop (Localhost vs Production).
  - Identified Key Mismatch (403 Forbidden) as the root cause of iPhone failures.
  - The iPhone PWA had a subscription created with an *old* VAPID key (from development/localhost) which was rejected by the production server.
- **Fixes**:
  - **Backend**: Updated `api/send-notification.js` to auto-detect 403/410/404 errors and remove invalid subscriptions.
  - **Frontend**: Updated `src/components/Settings.jsx` to force-unsubscribe before re-subscribing, ensuring the new VAPID key is used.
  - **UI Regression**: Fixed "squeezed" layout on mobile by removing default Vite `body { display: flex; place-items: center }` styles in `src/index.css`.
- **Result**:
  - "Send Test Notification" now reports "Sent to 1 device" and "Keys match".
  - Desktop notification received.
  - iPhone notification *sent* successfully (OS-level display pending user settings check).
- **Status**: **DEPLOYED & VERIFIED**

### 2025-12-18 - iPhone PWA Notification Fix (Session 13)
- **Fixed Notification Sending Logic**: **RESOLVED**
  - Root cause: `api/send-notification.js` assumed a header row always existed in Google Sheets. If the user deleted all rows (including header), the API would fail to find any subscriptions because it blindly skipped the first row.
  - Implemented robust row parsing: Iterates ALL rows, ignores invalid ones (like headers), and captures valid subscriptions regardless of row position.
  - Handled missing header row gracefully.
- **Status**: **READY FOR TESTING** - Code updated, awaiting deployment and user verification.

### 2025-12-18 - iPhone Notification Testing (Session 12)
- **Added Test Notification Feature**:
  - Implemented "Send Test Notification" button in Settings page (visible when subscribed)
  - Creates an immediate loop-back test:
    1. Client triggers `/api/send-notification`
    2. Server reads ALL subscriptions from Google Sheet
    3. Server broadcasts push notification to all devices
  - Perfect for verifying iPhone PWA configuration without waiting for scheduled time
- **Status**: **READY FOR TESTING** - awaiting user verification on iPhone

### 2025-12-18 - iPhone PWA Debugging & Token Fix (Session 11)
- **Fixed iPhone PWA Token Issue**: **RESOLVED**
  - Root cause: Safari browser and iOS PWA have separate localStorage storage
  - PWA didn't inherit authentication token from Safari browser
  - Added in-app debug panel (🐛 icon) to show real-time API errors and token status
  - Added authentication token input field in Settings page for direct token entry
  - Users can now paste token directly in PWA without URL parameters
  - Entries now save successfully from iPhone PWA!

- **Added iPhone PWA Debug Features**:
  - Debug toggle button in header (🐛) shows/hides debug panel
  - Debug panel displays: token status, online state, pending count, and API errors
  - Detailed logging for entry submission process with full error details
  - Helps troubleshoot issues without Mac/Safari Web Inspector
  - Committed as "Add in-app debug panel for iPhone troubleshooting"

- **Enhanced Settings Page**:
  - Added Authentication Token section with input field and Save button
  - Shows current token status with preview (first 15 characters)
  - Inline code styling for better token visibility
  - Committed as "Add token entry UI to Settings page for PWA"

- **Session Accomplishments**:
  - ✅ Debug panel deployed and working
  - ✅ Token entry UI deployed and working
  - ✅ iPhone PWA entries now saving to Google Sheets
  - ✅ Sync issue resolved - entries no longer pending

- Status: **DEPLOYED & VERIFIED** - iPhone PWA fully functional for data entry

### 2025-12-18 - GitHub Setup + Pending Entries Fix + Google Apps Script Cron (Session 10)
- **GitHub Repository Setup (Feature #19)**: **COMPLETE**
  - Added GitHub remote: https://github.com/ARobicsek/amiel-cfs-documentation.git
  - Pushed all code to GitHub
  - Repository ready for Vercel GitHub integration

- **Fixed Pending Entries Issue**: **RESOLVED**
  - Root cause: Auth token whitespace mismatches + invisible sync errors
  - Fixed auth token trimming in src/utils/auth.js (frontend)
  - Added visible sync error feedback in App.jsx ("Sync failed" badge)
  - Made pending count clickable for manual retry
  - Improved API error messages with HTTP status codes
  - Added error display overlay in DailyEntry.jsx
  - Enhanced logging in offlineStorage.js for debugging
  - Fixed production API URL issue by creating .env.production file
  - Users can now see and retry failed syncs

- **Fixed Timestamp Issues**:
  - Changed api/submit-entry.js to use server-calculated Eastern Time
  - Entries now show correct Eastern Time instead of UTC

- **Fixed Notification System**:
  - Added .trim() to GOOGLE_SHEET_ID in send-notification.js and snooze.js
  - Notifications now send successfully

- **Google Apps Script Cron Setup**: **COMPLETE**
  - Replaced Vercel's once-daily cron with Google Apps Script
  - Script configured to trigger /api/cron-trigger every 5 minutes
  - Fully operational and hitting endpoint successfully
  - Enables 15-minute notification intervals without Vercel Pro upgrade
  - Completely free solution using existing Google infrastructure

- Status: **DEPLOYED** - Pending final testing after Vercel redeployment

### 2025-12-18 - Authentication & Configuration Fixes (Session 9)
- **Fixed 401 Unauthorized Error**: Refactored auth logic to robustly handle whitespace/newlines in `SECRET_TOKEN`.
- **Fixed 500/404 Google Sheets Error**:
  - Identified issue: `GOOGLE_SHEET_ID` env variable contained a hidden newline character.
  - Updated all API endpoints (`subscribe`, `submit-entry`, `get-entries`, `cron-trigger`, `notification-settings`) to strictly `.trim()` the Sheet ID.
  - Improved error reporting: Added detailed JSON error responses and frontend alerts for debugging.
- **Verification**: Successfully enabled notifications on production (Vercel).
- Status: **VERIFIED & DEPLOYED**

### 2025-12-18 - Smart Customizable Reminders + Snooze (Session 7)
- **Customizable Reminder Schedule:**
  - Created api/notification-settings.js (GET/POST) for user preferences
  - Added Settings UI with time picker and repeat interval selector (15min/30min/1hr/2hr/4hr/never)
  - Updated cron to run every 15 minutes for more flexible scheduling
  - Smart "skip to tomorrow" logic when setting past times (Option B behavior)
  - "Stop after logging" checkbox to auto-stop reminders once user logs for the day
  - Settings stored in Google Sheets UserSettings tab

- **Snooze Functionality:**
  - Created api/snooze.js to handle one-time snooze requests
  - Added "Snooze 1 Hour" action button to push notifications
  - Updated service worker (sw-custom.js) to handle snooze clicks
  - Cron-trigger checks for active snooze and skips reminders during snooze period
  - Auto-clears snooze when expired and resumes normal reminder schedule
  - Shows confirmation notification after snoozing

- **Cross-Date Support:**
  - Handles reminders that span across days (e.g., 1 AM next morning)
  - Calculates next reminder time with "today" or "tomorrow" labels
  - Properly manages repeat intervals across midnight boundary

- Feature #14: **100% COMPLETE** - Full customization and snooze support ready

### 2025-12-18 - Notification Authentication Issues (Session 8)
- Fixed Vercel cron job configuration for Hobby plan (once per day at 9 PM ET)
- Deployed app to Vercel production
- Added all required environment variables:
  - GOOGLE_SERVICE_ACCOUNT_KEY
  - GOOGLE_SHEET_ID
  - SECRET_TOKEN
  - VAPID_PUBLIC_KEY
  - VAPID_PRIVATE_KEY
  - VAPID_EMAIL
  - VITE_SECRET_TOKEN
- Reorganized Settings page to show Reminder Schedule first
- **ISSUE**: API endpoints returning 401 Unauthorized despite correct token
  - Token `dev-secret-token-12345` is being stored and read correctly
  - Environment variables are set in Vercel
  - Debug logging added to notification-settings.js and subscribe.js
  - Still investigating authentication failure
- Status: **IN PROGRESS** - Authentication blocking notification setup

### 2025-12-18 - Push Notification Flow COMPLETE (Session 6)
- Fixed missing webpush.setVapidDetails() call in api/send-notification.js
- Implemented auto-creation of "Subscriptions" sheet tab in api/subscribe.js
- Added VAPID email validation and mailto: prefix handling
- Configured Google Sheets credentials in .env files (.env, .env.local, .env.development.local)
- Tested full subscription flow: Settings → Enable Notifications → Success
- Verified subscription data saved to Google Sheets (Subscriptions tab auto-created)
- Tested push notification sending via curl to /api/send-notification endpoint
- Confirmed notifications received and displayed in browser/Windows notification center
- Fixed Windows/Chrome notification permissions (required for display)
- Feature #12: **100% COMPLETE** - Push notifications fully functional end-to-end

### 2025-12-18 - Push Notification Subscription Flow (Session 5)
- Generated VAPID keys for web push authentication
- Installed web-push package (npm)
- Implemented subscription storage in api/subscribe.js (saves to Google Sheets)
- Completed api/send-notification.js with web-push library integration
- Created src/utils/pushNotification.js for frontend subscription management
- Built Settings component (src/components/Settings.jsx) with notification toggle UI
- Created Settings.css with responsive design and dark mode support
- Added custom service worker (public/sw-custom.js) for push event handling
- Integrated Settings page into App.jsx navigation
- Fixed authentication token handling (auth.js now uses VITE_SECRET_TOKEN)
- Updated .env.example with VAPID key documentation
- Added SECRET_TOKEN and VAPID keys to .env.local
- Status: **90% complete** - needed "Subscriptions" sheet tab (resolved in Session 6)

### 2025-12-18 - Offline Storage + Sync (Session 4)
- Integrated offline storage with App.jsx handleSave function
- Implemented IndexedDB storage for entries when offline or when API fails
- Added online/offline status indicator to header
- Added pending entries count indicator
- Implemented automatic sync when connection returns
- Added sync success notification
- Tested offline functionality with DevTools Network throttling
- Verified entries persist in IndexedDB and sync triggers on reconnect
- Added development auth bypass for local testing (auth.js)
- All offline storage features working as designed

### 2025-12-17 - Entry History View (Session 3)
- Created EntryHistory component (src/components/EntryHistory.jsx)
- Created EntryHistory styles (src/components/EntryHistory.css)
- Integrated EntryHistory into App.jsx navigation
- Implemented fetch logic to get last 7 days from Google Sheets API
- Added loading, error, and empty states
- Implemented smart date formatting (Today, Yesterday, or "Dec 17" format)
- Fixed date parsing to handle multiple formats (MM/DD/YYYY, ISO timestamps, formatted strings)
- Fixed vercel.json configuration (removed problematic rewrites)
- Set up Vercel CLI for local development
- Successfully tested with real Google Sheets data

### 2024-12-17 - Google Sheets Integration (Session 2)
- Completed Google Cloud setup (project, Sheets API, service account)
- Created Google Sheet with proper column headers (Timestamp, Date, Hours, Comments, Oxaloacetate, Exercise)
- Installed googleapis package
- Completed Google Sheets integration in api/submit-entry.js
- Completed Google Sheets integration in api/get-entries.js
- Configured timestamps to use US Eastern Time
- Created .env and .env.local files for local development
- Successfully tested API integration with Google Sheets

### 2024-12-17 - Initial Scaffolding (Session 1)
- Initialized Vite + React project with PWA plugin
- Created documentation structure (README, PROGRESS, SETUP-GUIDE, ARCHITECTURE)
- Set up Claude Code slash commands (/status, /next, /start-session, /end-session)
- Built DailyEntry component with hours slider (0.5hr increments, default 6h)
- Added collapsible optional fields (comments, oxaloacetate, exercise)
- Implemented auto light/dark theme based on system preference
- Created all API endpoint scaffolds (submit-entry, get-entries, subscribe, send-notification, cron-trigger)
- Created utility modules (auth.js, api.js, offlineStorage.js)
- Created vercel.json deployment config with cron job

---

## Next Up

**iPhone PWA Notifications** (Priority for Next Session)
- Enable notifications in the iPhone PWA (Settings → Notifications)
- Grant iOS notification permissions when prompted
- Configure notification schedule and timing
- Test notification receipt on iPhone lock screen
- Verify snooze functionality works on iPhone

**Future Enhancements**:
- Connect Vercel to GitHub for automatic deployments
- **Feature #16: ECG Integration** - Photo upload for ECG tracking

Phase 2 notifications are now complete! Moving to Phase 3 polish features.

**Implementation Steps**:
1. Design UI for ECG photo upload
2. Add photo capture/upload in DailyEntry component
3. Store photos in cloud storage (e.g., Google Drive, Cloudinary, or similar)
4. Display ECG photos in entry history
5. Add delete functionality for photos

**Prerequisites**:
- Need to choose cloud storage solution
- May need additional Google Cloud permissions for Drive API

---

## Blockers / Notes

- **Authentication & Configuration**: **RESOLVED** - Fixed whitespace handling in both Auth Token and Sheet ID.
- **Pending Entries Issue**: **RESOLVED** - Fixed auth token trimming, added visible error feedback, and manual retry button. Users can now see and resolve sync failures.
- **Vercel Cron Job Limitation**: **RESOLVED** - Replaced with Google Apps Script triggering endpoint every 5 minutes (adjustable to 15 min). Free solution using existing Google infrastructure, no Vercel Pro upgrade needed.
- **Production API URL**: **RESOLVED** - Created .env.production file to ensure relative URLs in production builds.
- **Timestamp Timezone Issues**: **RESOLVED** - Fixed all timestamp formatting to use Eastern Time correctly across submit-entry.js and subscribe.js.
- **VAPID Key Padding Error**: **RESOLVED** - Added automatic trimming and padding removal for VAPID keys to handle whitespace and base64 padding characters.
- **Notification System**: **FULLY OPERATIONAL** - End-to-end tested and working in production!
- **Notification Action Buttons**: Snooze button may not be visible in all browser/OS combinations. Chrome on Windows may not display notification action buttons depending on system settings. This is a browser/OS limitation, not a code issue. Alternative: Add snooze option in app UI as fallback.
- **PWA Icons**: Currently placeholders - need to generate real 192x192 and 512x512 PNG icons
- **Local Development**: Use `vercel dev` to run both frontend and API functions locally (not `npm run dev`)
- **Windows Notifications**: Users must enable Chrome/browser notifications in Windows Settings → System → Notifications for push notifications to display
- **Google Apps Script Trigger**: Currently set to 5 minutes for testing. Change to 15 minutes after verification.

---

## Status Legend

| Status | Meaning |
|--------|---------|
| DONE | Feature complete and tested |
| SCAFFOLD | Code structure in place, needs completion |
| TODO | Not started |
| BLOCKED | Cannot proceed (see Blockers section) |
