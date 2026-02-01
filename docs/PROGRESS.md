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

## Completed Features Log

### 2026-01-31 - UX Fix: Cleaner API Error Messages (Session 54)

**Session Summary:**
Quick fix to clean up the duplicate medication error message UI.

**Accomplishments:**

1. **Removed HTTP status code from error messages** — Changed `apiRequest()` in `src/utils/api.js` to throw errors without the status code prefix. Error messages now show "Medication 'Vitamin D' already exists" instead of "400: Medication 'Vitamin D' already exists".

**Files Modified:**
- `src/utils/api.js` — Removed `${response.status}:` prefix from error throws (status still logged to console for debugging)

---

### 2026-01-31 - Bug Fixes: HR Tooltip + iOS Fullscreen Nav (Session 53)

**Session Summary:**
Fixed two bugs from Session 52: HR box plot tooltip not triggering on whiskers, and iOS fullscreen navigation exiting fullscreen.

**Accomplishments:**

1. **HR box plot tooltip fix** — Added custom Chart.js interaction mode `boxplotWhisker` that triggers tooltip when touching anywhere within the min→max whisker range, not just the median line. Required importing `Interaction` from chart.js and registering the custom mode.

2. **iOS fullscreen nav fix** — Replaced `<button>` elements with `<div role="button">` for nav/close buttons in fullscreen mode. iOS Safari was exiting fullscreen on button clicks despite `preventDefault()`. Added `onTouchEnd` handlers and iOS-specific CSS (`-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none`, `user-select: none`).

3. **Multi-day chart unmount fix** — Removed `!loading` condition from chart rendering in MultiDayView. Charts were unmounting during data fetch, causing fullscreen exit. Charts now stay visible while new data loads.

4. **Removed opacity transition** — Removed loading opacity effect that caused a visual flash (briefly showing underlying view superimposed on fullscreen).

**Files Modified:**
- `src/components/Stats/charts/HRBoxPlotChart.jsx` — Custom `boxplotWhisker` interaction mode, imported `Interaction` from chart.js
- `src/components/Stats/FullscreenChart.jsx` — Changed buttons to divs, added touch handlers and CSS
- `src/components/Stats/StatsTab.css` — Added iOS touch CSS properties to nav/close buttons
- `src/components/Stats/MultiDayView.jsx` — Removed `!loading` condition, removed opacity transition

---

### 2026-01-30 - Multi-Day Enhancements + R/S Ratio Graph + Sheet Sorting (Session 52)

**Session Summary:**
Extended multi-day stats with R/S ratio visualization, improved fullscreen UX, added automatic sheet sorting, and fixed step tooltip mobile touch issues.

**Accomplishments:**

1. **Step tooltip mobile fix** — Extended touch detection range from +/-1 to +/-2 minutes in CombinedChart to handle touch imprecision on iOS. Steps now correctly prioritize over sleep when overlapping.

2. **Multi-day fullscreen navigation** — Added `onPrev`, `onNext`, `canNext`, and `date` props to all FullscreenChart instances. Date range now displays in fullscreen title. Added preventDefault/stopPropagation to nav buttons.

3. **R/S Ratio graph** — Added new multi-day chart showing ECG R/S ratio from ECG_Readings sheet. Uses `pointsOnly` mode (no connecting lines). Tooltip shows both R/S ratio and ECG HR (averaged if multiple readings per day).

4. **Chart reordering** — Multi-day charts now display in order: Feet on Ground → Steps → Sleep → Heart Rate → HRV → R/S Ratio → Brain Time.

5. **Sleep tooltip percentages** — SleepStackedBar tooltip now shows percentage of total sleep for each segment (e.g., "Deep: 1h 30m (25%)").

6. **MetricLineChart enhancements** — Added `pointsOnly` prop (no line/fill, larger points) and `tooltipExtra` prop for additional tooltip content.

7. **Automatic sheet sorting** — Added `sortSheetByDateDesc()` function to sort all data sheets by most recent first. Applied to Health_Hourly, Health_Daily, ECG_Readings, ECG_Waveforms, and Sheet1 in their respective webhook handlers.

**Files Modified:**
- `src/components/Stats/charts/CombinedChart.jsx` — Extended step tooltip range to +/-2 min
- `src/components/Stats/MultiDayView.jsx` — Chart reordering, fullscreen props, R/S ratio chart, hasEcgData check
- `src/components/Stats/FullscreenChart.jsx` — Added preventDefault + onTouchStart to nav buttons
- `src/components/Stats/charts/MetricLineChart.jsx` — Added pointsOnly and tooltipExtra props
- `src/components/Stats/charts/SleepStackedBar.jsx` — Added percentage to tooltip
- `src/components/Stats/charts/HRBoxPlotChart.jsx` — Removed interaction mode (reverted to default)
- `api/get-hourly-data.js` — Added ECG_Readings fetch and ecgByDate aggregation
- `api/health-webhook.js` — Refactored sortHourlySheet to generic sortSheetByDateDesc, added Health_Daily sorting
- `api/ecg-webhook.js` — Added sortSheetByDateDesc for ECG_Readings and ECG_Waveforms
- `api/submit-entry.js` — Added sortSheetByDateDesc for Sheet1

---

### 2026-01-30 - Fullscreen Chart UI + Sleep Data Accuracy (Session 51)

**Session Summary:**
Fixed fullscreen chart usability on portrait phones, corrected sleep data discrepancies between single-day and multi-day/history views, and improved display formatting.

**Accomplishments:**

1. **Step tooltip rounding** — Added `Math.round()` to step count tooltip in CombinedChart so values display as whole numbers instead of decimals.

2. **Force landscape in fullscreen** — Added CSS `@media (orientation: portrait)` rule that rotates the fullscreen container 90deg via `transform: rotate(90deg)`. This ensures the chart always appears in landscape layout regardless of phone orientation, fixing the X-close-button not working in portrait mode.

3. **Shared sleep validation library** — Created `lib/sleepValidation.js` extracting the cluster + awake-score + best-session algorithm into a shared module used by both API endpoints. Mirrors client-side `statsDataService.js`.

4. **Multi-day sleep accuracy** — Updated `get-hourly-data.js` multi-day mode to compute sleep from raw `Health_Hourly` data using the validated algorithm, instead of reading stale pre-computed values from `Health_Daily`. Fixed Jan 27 showing 4h38m → now shows 5h3m (matching single-day view).

5. **History tab sleep accuracy + format** — Updated `get-entries.js` to compute validated sleep from `Health_Hourly`. Changed sleep display from decimal hours ("4.6 hrs") to "Xh Ym" format ("5h 3m").

**Files Created:**
- `lib/sleepValidation.js` — Shared sleep validation (clusterSleepSessions, findBestSessionInCluster, computeValidatedSleepByDate)

**Files Modified:**
- `src/components/Stats/charts/CombinedChart.jsx` — Step tooltip rounding
- `src/components/Stats/StatsTab.css` — Portrait→landscape CSS rotation for fullscreen
- `api/get-hourly-data.js` — Validated sleep in multi-day mode
- `api/get-entries.js` — Validated sleep + Health_Hourly fetch
- `src/components/EntryHistory.jsx` — formatSleepMinutes helper, updated sleep display
- `docs/scriptReferences.md` — Added lib/ section

**Architecture Note:**
All three views (single-day, multi-day, history) now compute sleep from raw `Health_Hourly` data using the same validated algorithm, eliminating discrepancies from stale `Health_Daily` values.

---

### 2026-01-30 - Sleep Validation Bug Fixes + Step Tooltip (Session 50)

**Session Summary:**
Fixed three critical sleep display bugs from Session 49 and added step count tooltips to the combined chart.

**Accomplishments:**

1. **Sequential session handling** — Fixed `clusterSleepSessions` to use strict overlap (`<` instead of `<=`). Back-to-back sessions that touch at a boundary (e.g., 4:48–5:56 PM and 5:56–10:12 PM) are now separate clusters. Added nested-vs-sequential detection in `findBestSessionInCluster`: sequential sessions pick the one with highest `totalSleepMin` instead of the inner-to-outer gap walk.

2. **Sparse-data guard for cross-midnight sessions** — Added HR data coverage check to `computeAwakeScore`. If a gap is >30 min but has <2 HR readings per hour, it returns "inconclusive" (score 3), preventing false parent expansion. This correctly rejects the 6:03 PM–1:13 AM overnight parent (only 12 HR readings over 7.2h gap, all clustered in last hour) while correctly accepting the 6:49 AM–4:26 PM daytime sleep (116 HR readings over 8h gap).

3. **API cluster siblings for spillover** — Modified `handleSingleDay` in `get-hourly-data.js` to include cluster siblings (overlapping sleep_analysis sessions from date+1) alongside spillover sessions. Previously, viewing Jan 28 only got the overnight parent without its children, making validation impossible.

4. **Step count tooltip** — Added `stepCounts` array (per-minute step counts) to `processSingleDayData`. CombinedChart now shows step count on hover over green walking bars. Tooltip priority: HR (built-in) > steps > sleep.

**Files Modified:**
- `src/utils/statsDataService.js` — Strict overlap clustering, nested/sequential detection, sparse-data guard, stepCounts array
- `api/get-hourly-data.js` — Cluster sibling inclusion for spillover sessions
- `api/health-webhook.js` — Same clustering + sparse-data fixes (server-side)
- `scripts/validate_sleep_sessions.js` — Same clustering + sparse-data fixes (offline tool)
- `src/components/Stats/charts/CombinedChart.jsx` — Step count tooltip, HR>steps>sleep priority
- `src/components/Stats/SingleDayView.jsx` — Pass stepCounts prop to CombinedChart

**Status at End of Session:**
- Sleep validation working correctly across nested, sequential, and cross-midnight sessions
- Tested on Jan 28 (daytime sleep + overnight spillover) and Jan 29 (overnight + afternoon)
- Step count tooltip functional on green walking bars

### 2026-01-30 - Sleep Session Validation via HR/Step Data (Session 49)

**Session Summary:**
Investigated and partially fixed sleep time discrepancies between single-day and multi-day views. Discovered that Apple Watch records nested parent/child sleep sessions, and the parent is not always accurate. Built an HR/step-based validation algorithm that walks from innermost session outward, checking each exclusive gap for awake evidence (elevated HR, step activity). Replaced the NSD (Nested Session Differencing) visual algorithm with validated-session-only marking.

**Accomplishments:**

1. **Sleep validation algorithm** — Created `computeAwakeScore()` and `findBestSessionInCluster()` in `statsDataService.js`. Uses time-normalized thresholds: avgHR > 70 (+2), maxHR > 85 (+1), sigStepsPerHour > 1 (+2), stepsPerHour > 20 (+2). Score ≥ 3 = awake.

2. **Validation script** — Created `scripts/validate_sleep_sessions.js` for offline analysis of sleep session clusters against HR/step data from `new_hourly.txt`. Confirmed correct results across 4 test clusters.

3. **API spillover sessions** — Modified `api/get-hourly-data.js` single-day mode to also return sleep_analysis rows from date+1 that start on the target date, tagged with `spillover: true`.

4. **health-webhook.js** — Changed `totalMins` to include awake time (`(pTotal + pAwake) * 60`). Replaced naive overlap-merge with cluster→validate→best-session approach using the same awake-score algorithm.

5. **CombinedChart.jsx** — Tooltip now uses `fullStart`, `fullEnd`, `fullDurationMin` from validated session metadata instead of computing from clipped block times.

6. **Replaced NSD with validated marking** — Instead of running NSD on all sessions (which painted blue for invalidated parent regions), now only marks ASLEEP minutes from validated best sessions clipped to midnight-to-midnight. Removed the entire `differenceCluster()` function.

**Known Issues (for next session):**
- **Spillover visual still showing on Jan 29 evening**: The parent session from a Jan 29 evening cluster appears to still be rendered. Likely a data/caching issue — need to investigate whether the API is returning stale data or if there's a second cluster being processed.
- **Missed afternoon sleep on Jan 29**: A session from ~4:48 PM–10:12 PM is not showing as sleep. The validation algorithm may be incorrectly classifying this cluster's gap as "awake" or the session may not be reaching the client at all. Needs investigation.

**Files Created:**
- `scripts/validate_sleep_sessions.js`

**Files Modified:**
- `api/get-hourly-data.js` — Spillover sleep session detection
- `api/health-webhook.js` — Awake included in sleep total, cluster validation
- `src/utils/statsDataService.js` — Awake-score validation, removed NSD, validated-only visual marking
- `src/components/Stats/charts/CombinedChart.jsx` — Tooltip uses validated session metadata

**Status at End of Session:**
- Sleep validation algorithm works correctly in offline testing
- Two visual bugs remain: stale spillover rendering, missed afternoon sleep
- Need to debug with live API data and potentially adjust validation thresholds or spillover logic

### 2026-01-29 - Multi-Day Stats View (Session 48)

**Session Summary:**
Built the complete Multi-Day Stats view (Phases C + D from `stats_feature_plan.md`). Created server-side aggregation endpoint, 3 chart components, and the MultiDayView container with date range navigation and metric toggles.

**Accomplishments:**

1. **API Endpoint** — Added multi-day mode to `api/get-hourly-data.js` (merged to stay within Vercel's 12-function Hobby limit). Fetches Health_Hourly (HR box plot 5-number summary), Health_Daily (sleep/steps/HRV), and Sheet1 (Feet on Ground, Brain Time) in parallel, merges by date.

2. **HRBoxPlotChart.jsx** — Custom box plot implementation using Chart.js floating bars + canvas whisker plugin. No external boxplot dependency needed (the old `chartjs-chart-box-and-violin-plot` was incompatible with Chart.js v4). Shows min/Q1/median/Q3/max per day.

3. **SleepStackedBar.jsx** — Stacked bar chart showing Deep (blue), REM (purple), Core (grey-blue), and Awake (amber) sleep stages in hours per day. Legend at bottom.

4. **MetricLineChart.jsx** — Reusable line chart used for 4 metrics: Steps (green), HRV (cyan), Feet on Ground (amber), Brain Time (purple). Supports `valueKey` or `valueExtractor` for flexible data access. Gaps for missing days (no interpolation).

5. **MultiDayView.jsx** — Container with date range navigation (prev/next arrows), quick selectors (7D/30D/3M/6M pills), metric visibility toggles (checkboxes), and 6 stacked charts each wrapped in FullscreenChart.

6. **Vercel Function Limit Fix** — Consolidated `get-health-stats.js` into `get-hourly-data.js` as a second mode routed by query params (`?date=` vs `?startDate=&endDate=`).

**Files Created:**
- `src/components/Stats/MultiDayView.jsx`
- `src/components/Stats/charts/HRBoxPlotChart.jsx`
- `src/components/Stats/charts/SleepStackedBar.jsx`
- `src/components/Stats/charts/MetricLineChart.jsx`

**Files Modified:**
- `api/get-hourly-data.js` — Added multi-day stats mode
- `src/utils/api.js` — Added `getHealthStats()` function
- `src/components/Stats/StatsTab.jsx` — Wired MultiDayView (replaced placeholder)
- `src/components/Stats/StatsTab.css` — Multi-day presets, toggles, chart stack styles

**Status at End of Session:**
- Multi-Day view is functionally complete, needs visual testing with real data
- Next: Polish pass (responsive testing, fullscreen behavior, edge cases, loading states)

### 2026-01-29 - Single Day Polish & Multi-Day Planning (Session 47)

**Session Summary:**
Fixed three remaining Single Day view issues: sleep tooltip accuracy, min/max HR labels in fullscreen, and replaced the large "Close" button with a compact X. Single Day view is now complete.

**Accomplishments:**

1. **Sleep Tooltip Fix** — Tooltips now show the full contiguous blue region duration, not individual sub-segments from the differencing algorithm. Added a merge step in `statsDataService.js` that scans the `activityMinutes` array to consolidate adjacent ASLEEP minutes into single blocks.

2. **Min/Max HR Labels Fix** — Labels were not appearing in fullscreen because the Chart.js plugin used closure variables that became stale. Converted to ref-based approach (matching the pattern used by `activityPlugin`) and added a `useEffect` to force chart redraw when `isFullscreen` changes.

3. **Fullscreen UI Overhaul** — Replaced the large bottom "Close" button (iOS PWA fallback) with a small circular X at top-right. Positioned nav arrows at ~25% from edges so they don't overlap the title or the X. Removed black stroke outline from min/max labels.

**Files Modified:**
- `src/utils/statsDataService.js` — Merged sleep block computation
- `src/components/Stats/charts/CombinedChart.jsx` — Ref-based min/max plugin, removed stroke, fixed tooltip
- `src/components/Stats/FullscreenChart.jsx` — X close button, removed bottom Close
- `src/components/Stats/StatsTab.css` — New `.fs-close-btn`, repositioned nav arrows

**Status at End of Session:**
- Single Day view is complete and polished
- Ready to begin Multi-Day view (Phase C/D from `stats_feature_plan.md`)

### 2026-01-29 - Stats Single Day View Implementation (Session 45)

**Session Summary:**
Built the complete Stats tab with Single Day view (Phases A + B from `stats_feature_plan.md`). Installed charting dependencies, created API endpoint, implemented the Nested Session Differencing algorithm, and wired up all UI components.

**Accomplishments:**

1. **Chart Dependencies Installed**
   - `chart.js` ^4.4.7, `react-chartjs-2` ^5.3.0, `chartjs-chart-box-and-violin-plot` ^4.0.0
   - Fixed version mismatch: box-and-violin-plot latest is 4.0.0, not 4.4.3 as originally planned

2. **API Endpoint: `api/get-hourly-data.js`**
   - Fetches all Health_Hourly rows for a single date (YYYY-MM-DD)
   - Handles both `M/D/YYYY` and `YYYY-MM-DD` date formats from the sheet
   - Returns structured objects: timestamp, date, hour, metric, value, min, max, source, rawData

3. **Data Processing: `src/utils/statsDataService.js`**
   - `processSingleDayData()` — main processing function
   - **Nested Session Differencing Algorithm**: clusters overlapping sleep_analysis sessions, computes density per segment, applies 50% threshold to classify ASLEEP vs BLANK
   - **Two-layer step suppression**: suppresses steps during sleep session windows + noise filter (< 2 steps/min)
   - HR point extraction with minute-of-day precision from raw data timestamps
   - Summary computation: total sleep, steps, walking time, avg HR, avg HRV, HR count
   - Helper formatters: `formatMinutes()`, `formatTime()`

4. **Stats Components (7 new files under `src/components/Stats/`)**
   - `StatsTab.jsx` — Top-level container with Single/Multi Day segmented toggle, dark mode via `useSyncExternalStore`
   - `SingleDayView.jsx` — Date navigation (arrows, Today indicator), data fetching, composition of charts + summary
   - `charts/HRScatterChart.jsx` — 24h Chart.js scatter plot (X: 0-1440 minutes, Y: BPM), tap-for-tooltip
   - `charts/ActivityBar.jsx` — Canvas-rendered broken bar (1440 minute slots: blue=ASLEEP, green=WALKING, transparent=BLANK)
   - `FullscreenChart.jsx` — Fullscreen API wrapper with webkit prefix, landscape lock attempt, CSS fallback
   - `StatsTab.css` — Complete styling: toggle, date nav, charts, summary grid, fullscreen, dark/light mode

5. **App.jsx Integration**
   - Added Stats as 4th navigation tab: Today | History | Stats | Settings
   - Imported StatsTab component

**Files Created:**
- `api/get-hourly-data.js`
- `src/utils/statsDataService.js`
- `src/components/Stats/StatsTab.jsx`
- `src/components/Stats/StatsTab.css`
- `src/components/Stats/SingleDayView.jsx`
- `src/components/Stats/FullscreenChart.jsx`
- `src/components/Stats/charts/HRScatterChart.jsx`
- `src/components/Stats/charts/ActivityBar.jsx`

**Files Modified:**
- `package.json` — Added chart.js, react-chartjs-2, chartjs-chart-box-and-violin-plot
- `src/App.jsx` — Added Stats tab (4th nav item)

**Build & Lint:**
- Production build passes (379KB JS, 23.5KB CSS)
- Zero lint errors in all new files

**Status at End of Session:**
- ✅ Stats tab visible in navigation
- ✅ Single Day view with HR scatter, activity bar, summary stats
- ✅ Date navigation (left/right arrows, Today detection)
- ✅ Nested Session Differencing algorithm implemented
- ✅ Fullscreen chart wrapper ready
- ⏳ Needs Vercel manual deployment for live testing
- ⏳ Multi Day view stubbed as "coming soon" (Phase C/D)

### 2026-01-29 - Stats Feature Planning (Session 44)

**Session Summary:**
Planning-only session. Designed the Stats feature in detail through an interactive interview process. No code changes — only documentation.

**Accomplishments:**

1. **Comprehensive Stats Feature Plan** (`docs/stats_feature_plan.md`)
   - Analyzed real Health_Hourly data (1.4MB, ~40 days) to understand data shapes, gaps, and quirks
   - Designed Single Day view: 24h HR scatter plot + activity broken bar (ASLEEP/WALKING/BLANK)
   - Designed Multi Day view: 6 stacked metric charts (Feet on Ground, Brain Time, HR box plots, Sleep stacked bars, Steps, HRV)
   - Chose Chart.js + react-chartjs-2 over Recharts for mobile Canvas performance
   - Planned 2 new API endpoints (`get-hourly-data.js`, `get-health-stats.js`) with server-side aggregation
   - Designed component architecture: 7 new files under `src/components/Stats/`

2. **Nested Session Differencing Algorithm** (key innovation)
   - Discovered that overlapping `sleep_analysis` sessions from Apple Watch can be subtracted from each other to determine which time segments had dense vs sparse sleep
   - Example: Jan 29 parent session spans 11 hours, but differencing reveals only 3h 45m was solid sleep (1:13-4:59 AM); the other 7+ hours was mostly awake/resting
   - Uses a 50% density threshold to classify segments as ASLEEP vs BLANK
   - Prevents massive overestimation of sleep that would occur from using raw session boundaries

3. **False-Positive Step Suppression Design**
   - Two-layer filter: suppress steps during sleep sessions + suppress steps < 2/minute as sensor noise
   - Addresses known issue of Apple Watch recording wrist movements as steps during sleep

4. **Key Design Decisions** (from user interview)
   - Navigation: Today | History | Stats | Settings
   - Orientation: Fullscreen button per chart (Fullscreen API + landscape lock)
   - Offline: Online only (no caching needed)
   - HR multi-day: Box plots (min/Q1/median/Q3/max)
   - Time range: Full 24 hours (midnight to midnight)
   - Data sources: Mix manual + automated metrics in multi-day view
   - Medications: Not in v1
   - Touch: Tap for tooltip (not drag cursor)

**Files Modified:**
- `docs/stats_feature_plan.md` - Complete rewrite with finalized plan

**Status at End of Session:**
- ✅ Stats feature fully planned and documented
- ✅ Ready to implement in Session 45

### 2026-01-29 - Stats Improvements & Bug Fixes (Session 46)

**Session Summary:**
Refined the Stats Single Day view based on user feedback. Implemented "Steps on Top" visualization, fixed sleep tooltips to show full session duration, and optimized Fullscreen mode with side-by-side navigation arrows and better layout.

**Accomplishments:**

1.  **Combined Chart Implementation**
    -   Merged HR scatter and Activity bars into a single canvas-based chart using custom filtering.
    -   **Steps on Top**: Steps (Green) now render ON TOP of Sleep (Blue) to ensure activity bursts during sleep are visible.
    -   **Smart Tooltips**: Touch interaction prioritizes HR points. If no point is hit, shows "Sleep Duration Tooltip" with the *complete* session time (Start - End) even if tapping a middle segment.

2.  **Chart Visualization Enhancements**
    -   **Min/Max Labels**: Large, bold labels for Min and Max HR with smart collision detection.
    -   **Fullscreen Header**: Added date display and reduced vertical padding.
    -   **Side-by-Side Arrows**: Navigation arrows in fullscreen are now centered side-by-side for easier reach.
    -   **Persistent State**: Navigating between dates in fullscreen mode no longer unmounts the component, preventing accidental exit.

3.  **Sleep Data Parsing Fix**
    -   Fixed `parseTimestamp` logic in `statsDataService.js` to handle `YYYY-MM-DD HH:mm:ss -ZZZZ` format robustly.
    -   Resolved "0m Sleep" bug for Jan 28.

4.  **Local Development Fix**
    -   Added `npm run dev:api` script to use `vercel dev` for correct serverless function emulation.

**Files Modified:**
-   `src/utils/statsDataService.js` - Data layering (Walking vs Sleep), date parsing.
-   `src/components/Stats/charts/CombinedChart.jsx` - Canvas rendering order (Green > Blue), tooltip priority logic.
-   `src/components/Stats/FullscreenChart.jsx` - Date header, navigation persistence.
-   `src/components/Stats/StatsTab.css` - Side-by-side arrows, improved fullscreen layout.
-   `src/components/Stats/SingleDayView.jsx` - State preservation.
-   `package.json` - Added `dev:api` script.

**Files Deleted (Cleanup):**
-   `src/components/Stats/charts/ActivityBar.jsx` (Replaced by CombinedChart)
-   `src/components/Stats/charts/HRScatterChart.jsx` (Replaced by CombinedChart)

**Status at End of Session:**
-   ✅ Sleep data visible and correct.
-   ✅ Steps now clearly visible on top of sleep segments.
-   ✅ Fullscreen navigation works perfectly (persistent & side-by-side arrows).
-   ✅ Min/Max labels visible and legible.
-   ✅ Tooltips behave intuitively on touch.
-   ✅ **Performance**: Fixed stale data on day switch and removed animation lag.
-   ✅ **Stability**: Fixed production crash (missing import).

**Next Steps (Session 48):**
1.  **Multi-Day API**: Create `api/get-health-stats.js` — server-side aggregation endpoint (Phase C from `stats_feature_plan.md`)
2.  **Multi-Day Charts**: Build `MetricLineChart.jsx`, `HRBoxPlotChart.jsx`, `SleepStackedBar.jsx`, `MultiDayView.jsx` (Phase D)
3.  **Date Range Controls**: Quick range selectors (7D/30D/3M/6M) + date range navigation



### 2026-01-28 - Health Data Sorting & Sleep Verification (Session 43)

**Session Summary:**
Addressed user requests to reorganize the Health_Hourly sheet sorting and verify sleep data aggregation for Jan 27, 2026. Confirmed accurate sleep aggregation logic despite corrupted source data for that specific date.

**Accomplishments:**
1.  **Health_Hourly Sorting Update**
    -   Modified `api/health-webhook.js` to change the sort order of `Health_Hourly` from `ASCENDING` to `DESCENDING`.
    -   Most recent hourly data will now appear at the top of the sheet, improving readability.

2.  **Sleep Data Aggregation Verification (Jan 27, 2026)**
    -   Investigation revealed that the aggregation logic correctly calculated 278 minutes of sleep.
    -   **Finding:** The source data contained two distinct sessions:
        -   Morning Nap (97 min): Ends 5:25 AM.
        -   Evening Sleep (181 min): Ends 5:30 PM. (Logic correctly merged 3 overlapping records by taking the max value).
    -   **Data Quality Issue:** The specific `sleep_analysis` row for Jan 27 contained "undefined" in the `Raw Data` column, preventing programmatic re-calculation in the verification script, though the daily aggregate value (278) was correct on the sheet.

3.  **Manual Sleep Calculation Tool**
    -   Created `scripts/manual_sleep_calc.js` to manually parse, deduplicate, and sum sleep rows from the raw hourly text file.
    -   Provides a step-by-step breakdown of sleep sessions to transparently explain the total to the user.

**Files Modified:**
-   `api/health-webhook.js` - Changed sort order to `DESCENDING`.
-   `scripts/manual_sleep_calc.js` (Created) - Tool for manual sleep data verification.

**Status at End of Session:**
-   ✅ Health_Hourly sorting updated.
-   ✅ Jan 27 Sleep aggregation verified and explained.
-   ✅ Apple sets de-duplication confirmed (yes, handled by HealthKit).

**Next Steps:**
1.  Monitor future data to see if "undefined" raw data persists in `sleep_analysis` rows.

### 2026-01-26 - Duplicate Daily Rows Fix & Sleep Overlap Handling (Session 42)

**Session Summary:**
Fixed the root cause of duplicate daily rows (an off-by-one row index bug) and implemented overlap-aware sleep session merging to correctly handle multiple Apple Watch sleep sessions per day — critical for CFS patients who nap frequently.

**Bug Fixes:**

1. **Off-By-One Row Index Bug (Root Cause of Duplicate Daily Rows)**
   - **Root Cause:** `Health_Daily!A:A` range included the header row, making `dailyDates[0]` = "Date" (header). The formula `rowIndex + 2` was then off by one — every update wrote to the row BELOW the intended target, creating a duplicate. The sort at the end masked this by reordering rows, but the misplaced write persisted.
   - **Fix:** Changed fetch range to `Health_Daily!A2:A` (skips header), so `dailyDates[0]` = first data row (sheet row 2). Now `index + 2` correctly maps to the actual sheet row.
   - **Additional:** New dates now use the Sheets `append` API instead of calculated row indices, preventing race conditions from concurrent webhook requests.

2. **Removed Health_Daily Sort from Webhook**
   - The sort was causing row index chaos when concurrent webhook requests arrived — one request's sort would invalidate another request's pre-calculated row indices.
   - Health_Daily is no longer sorted per-webhook. Data uses append for new rows and update-in-place for existing rows, so row order doesn't affect correctness.
   - Health_Hourly sort is preserved (append-only sheet, no update conflicts).

3. **Overlapping Sleep Session Double-Counting**
   - **Problem:** Apple Watch records separate `sleep_analysis` entries for each detected sleep session. When a sub-session overlaps a longer session (e.g., wake-up detection mid-sleep creates a nested session), the old code summed ALL sessions, giving Jan 26 a total of 521 min (~8.7 hrs) when actual sleep was 329 min (~5.5 hrs).
   - **Fix:** New overlap merge algorithm:
     - Collects all `sleep_analysis` entries with their `sleepStart`/`sleepEnd` timestamps.
     - Sorts by start time, then merges overlapping sessions (keeps the longer one's data).
     - Non-overlapping sessions (genuine naps) are correctly summed.
     - Component data (deep/rem/core/awake) is now sourced from `sleep_analysis` JSON rather than exploded rows, preventing double-counting.
   - **Verified:** Jan 26 data now correctly shows 329 min (5.5 hrs) instead of 521 min (8.7 hrs). Non-overlapping nap+night test also passes.

**Files Modified:**
- `api/health-webhook.js` — Off-by-one fix (A2:A range), append API for new rows, sleep overlap merge, removed daily sort, renamed `sortSheetsByDate` → `sortHourlySheet`.

**Status at End of Session:**
- ✅ Off-by-one bug fixed and verified with unit test
- ✅ Sleep overlap merge tested with real Jan 26 data
- ✅ Non-overlapping nap scenario tested
- ✅ Build and lint pass cleanly
- ✅ Self-healing dedup retained as safety net
- ⏳ Needs Vercel deployment and monitoring of next webhook

**Next Steps:**
1. Deploy to Vercel and monitor next Health Auto Export webhook
2. Verify Jan 25/26 duplicate rows get cleaned by self-healing on next data sync
3. Verify Jan 26 sleep total corrects to ~329 min on next re-aggregation

### 2026-01-26 - Daily Data Deduplication Fix (Session 41)

**Session Summary:**
Implemented robust deduplication in local health webhook processing to resolve permanent duplicate rows in the Daily tab caused by race conditions. The system now self-heals by identifying all duplicate rows for a given date, updating the primary one, and clearing the others.

**Accomplishments:**
1. **Robust Deduplication Logic**
   - Modified `api/health-webhook.js` to scan for ALL rows matching a date instead of just the first.
   - Updates the first occurrence found.
   - Clears content of any subsequent duplicate rows (sets to empty strings).
   - Ensures that next update cycle restores a clean single-row state.

2. **Concurrency Mitigation**
   - Addressed issue where rapid-fire updates (common with Health Auto Export) could race to append duplicate rows before the first one was indexed.
   - The new logic serves as a "cleanup on write" mechanism.

**Files Modified:**
- `api/health-webhook.js` - Added multi-index duplicate detection and clearing logic.

**Status at End of Session:**
- ✅ Validated logic changes.
- ✅ Committed fix to repo.
- ✅ Ready for deployment.

**Next Steps:**
1. Monitor the next automated health sync (or manual trigger) to confirm duplicates are resolved.
2. Verify that the "Self-Healing" logic clears the secondary rows in `Health_Daily` as expected.

### 2026-01-25 - Sleep Data Verification & Fixes (Session 40)

**Session Summary:**
Verified and fixed sleep data granularity. Confirmed that Apple Health sleep stages (Core, Deep, REM) are mutually exclusive and exhaustive. Updated webhook to use `sleepEnd` timestamps and break down sleep data into individual rows for detailed tracking.

**Accomplishments:**
1. **Sleep Data Schema Verification**
   - Confirmed `totalSleep` = `core` + `deep` + `rem` exactly.
   - Validated that `asleep` (unspecified) is not being used when detailed stages are available.
   - Verified via web search and data analysis script.

2. **Granular Data Logging**
   - Updated `api/health-webhook.js` to "explode" sleep analysis into separate rows:
     - `sleep_deep`, `sleep_rem`, `sleep_core`, `sleep_awake`.
   - Ensures distinct tracking for each sleep stage in `Health_Hourly`.

3. **Timestamp Fixes**
   - Updated webhook to use `sleepEnd` time for sleep records (instead of start time).
   - Created and ran `scripts/fix-sync-issues-v2.js` to:
     - Remove persistent duplicate rows.
     - Retroactively update timestamps for Jan 24/25 sleep data.

**Files Modified:**
- `api/health-webhook.js` - Added granular sleep row generation and `sleepEnd` timestamp logic.
- `scripts/fix-sync-issues.js` & `v2` (Created) - cleanup tools.

**Status at End of Session:**
- ✅ Sleep data now shows detailed breakup in hourly sheet.
- ✅ Timestamps align with wake-up time (sleepEnd).
- ✅ Duplicate daily rows resolved.

### 2026-01-25 - Health Data Ingestion Fixes (Session 39)

**Session Summary:**
Fixed critical logic errors in health data aggregation that were causing step count double-counting and missing sleep analysis. Implemented robust deduplication and re-aggregation logic.

**Accomplishments:**
1.  **Fixed Data Aggregation Logic**
    -   Implemented **Deduplication**: Webhook now checks against existing `Health_Hourly` records to prevent double-counting.
    -   Implemented **Re-aggregation**: Daily stats are now recalculated from the full hourly history for the affected day, ensuring accuracy even with out-of-order data.
    -   Fixed **Step Count Inflation**: Validated that daily steps now match the sum of hourly records (102 vs 265 previously).

2.  **Sleep Analysis Parsing**
    -   Added parsing for `sleep_analysis` JSON metric.
    -   Correctly extracts Core, Deep, REM, and Total Sleep durations.
    -   Handles multiple sleep sessions per day (sums them up).
    -   Verified correct extraction (e.g., 188 mins for Jan 25).

3.  **Verification Tooling**
    -   Created `scripts/investigate-data.js` to reproduce discrepancies.
    -   Created `scripts/verify-fix.js` to validate the new logic against static data.

**Files Modified:**
-   `api/health-webhook.js` - Complete rewrite of aggregation logic.
-   `scripts/investigate-data.js` (Created)
-   `scripts/verify-fix.js` (Created)

**Status at End of Session:**
-   ✅ Step counts are now accurate.
-   ✅ Sleep data is correctly populating.
-   ✅ System handles duplicates and overlaps gracefully.

### 2026-01-24 - Health Data Quality & Backup System (Session 37)

**Session Summary:**
Enhanced health webhook data quality with NULL handling, timezone fixes, and device parsing. Added Health sheets to backup system with 30-day retention and safe archival tool for long-term storage management.

**Accomplishments:**

1. **Health Webhook Data Quality Improvements**
   - Fixed NULL handling: Empty cells instead of sentinel values (999/0) for missing data
   - Fixed timezone: All timestamps and hour extraction now use ET (was UTC on Vercel)
   - Intelligent device source parsing:
     - Heart Rate/HRV/Sleep → Shows "Apple Watch"
     - Steps → Shows "iPhone" (prioritized as primary walking source)
     - Clean device names without possessive or model numbers
   - Chronological sorting: Both sheets auto-sorted after each update
   - Only writes values when actual data exists (no more zeros for empty fields)

2. **Steps Distribution Investigation**
   - Investigated identical fractional step values (e.g., 20.869 repeated)
   - Confirmed as **expected Health Auto Export behavior**
   - App distributes step totals evenly across time intervals
   - Not a bug - this is how the export app works

3. **Backup System Integration**
   - Added `Health_Hourly` and `Health_Daily` to daily backup routine
   - 30-day retention with automatic pruning
   - Monthly email backups include Health data as CSV attachments
   - Same robust safety checks as existing backup system

4. **Safe Archival System** (NEW)
   - Created `/api/archive-health-data` endpoint
   - Dry-run mode to preview what would be archived
   - Requires explicit confirmation to proceed
   - Only archives data older than threshold (default: 90 days)
   - Creates verified archive BEFORE deleting any data
   - Multiple safety checks (95% threshold, verification)
   - Moves old data to `Health_Hourly_Archive_YYYY` sheets
   - Detailed logging and error handling
   - Nothing is ever lost - all data preserved in archives

5. **Documentation**
   - Created `docs/HEALTH_DATA_ARCHIVAL.md` with complete usage guide
   - Includes dry-run examples, safety features, troubleshooting

**Files Modified:**
- `api/health-webhook.js` - Data quality improvements (NULL handling, timezone, sorting, device parsing)
- `api/backup-data.js` - Added Health sheets to backup system
- `api/archive-health-data.js` - **NEW** Safe archival endpoint

**Files Created:**
- `docs/HEALTH_DATA_ARCHIVAL.md` - **NEW** Archival documentation

**Storage Analysis:**
- Health_Hourly: ~140 rows/day × 365 days = ~51,000 rows/year
- Health_Daily: 1 row/day × 365 days = 365 rows/year
- Google Sheets limit: 40,000 rows per sheet
- Timeline: First archival needed in ~6-10 months

**Status at End of Session:**
- ✅ Health webhook data quality significantly improved
- ✅ NULL handling, timezone, and device parsing fixed
- ✅ Backups running automatically (daily + monthly email)
- ✅ Archival tool deployed and documented
- ✅ Ready for production use with long-term storage strategy

**Next Steps:**
1. Monitor Health_Hourly row count over time
2. Run first archival when approaching 35,000 rows (~6-10 months)
3. Continue testing health metrics display in app

### 2026-01-24 - Health Data "Awake Minutes" Bug Fix (Session 38)

**Session Summary:**
Fixed a bug where "Awake Minutes" was being zeroed out when partial health data (like steps) arrived without sleep data. Extended API to correctly surface new health metrics.

**Accomplishments:**
1. **Fixed "Awake Minutes" Zeroing Bug**
   - Modified `api/health-webhook.js` to only update "Awake Minutes" when value > 0
   - Prevents overwriting existing empty cells with 0 during intra-day updates
   - Preserves existing data integrity

2. **Extended API Schema**
   - Updated `api/get-entries.js` to fetch full 15 columns (A-O)
   - Mapped new fields: `hrCount` (Col M), `hrvCount` (Col N), `awakeMinutes` (Col O)
   - App can now display these metrics if needed

**Files Modified:**
- `api/health-webhook.js` - Added conditional check for awake minutes
- `api/get-entries.js` - Extended range and added new field mappings

**Status at End of Session:**
- ✅ Awake minutes no longer overwritten by empty updates
- ✅ API returning full set of health metrics
- ✅ Lint checks passed

### 2026-01-24 - Health Webhook Fixes & Schema Enhancement (Session 37)

**Session Summary:**
Fixed webhook deployment issue and enhanced health data schema to properly capture heart rate Min/Max values. Webhook now successfully receives and processes data from iPhone.

**Accomplishments:**
1. **Fixed Webhook Deployment Issue**
   - Identified cause of 500 error: `GOOGLE_SHEET_ID` in Vercel had trailing newline character (`%0A`)
   - User corrected environment variable in Vercel dashboard
   - Webhook now successfully connects to Google Sheets

2. **Enhanced Health Data Schema**
   - **Health_Hourly**: Added Min and Max columns for heart rate data (now 9 columns total: A-I)
   - **Health_Daily**: Added missing headers for columns M, N, O: "HR Sample Count", "HRV Sample Count", "Awake Minutes"
   - Updated `scripts/setup-health-sheets.js` to reflect new schema

3. **Improved Heart Rate Parsing**
   - Modified webhook to extract `Avg`, `Min`, and `Max` from Apple Watch heart rate format
   - Heart rate data structure: `{Avg: 72, Min: 70, Max: 75, date: "..."}`
   - Now populates Value (Avg), Min, and Max columns separately for easy analysis

4. **Data Analysis Insights**
   - Confirmed Apple Health automatically deduplicates steps from iPhone + Apple Watch
   - Identified that HRV is only measured during rest/sleep periods (typically 3-5 readings per day)
   - Verified step count distribution across individual minutes is normal behavior

**Files Modified:**
- `api/health-webhook.js` - Enhanced HR parsing with Min/Max support
- `scripts/setup-health-sheets.js` - Updated headers for both Health sheets

**Status at End of Session:**
- ✅ Webhook deployment complete and verified working
- ✅ Schema updated with Min/Max heart rate columns
- ⏳ Ready for user to clear test data and run fresh automation test
- ⏳ Daily aggregations need verification
- ⏳ App UI needs testing to ensure health metrics display correctly

**Next Session Tasks:**
1. Clear test data from Health_Hourly and Health_Daily sheets
2. Run Health Auto Export automation to send fresh data
3. Verify daily aggregations calculate correctly (Avg HR, Min HR, Max HR)
4. Test History view in app to confirm health metrics display
5. Check for any edge cases with null/missing data

### 2026-01-24 - Health Data Integration Deployment (Session 35)

**Session Summary:**
Started verification of Health Data Integration with real iPhone data. Configured Health Auto Export automation and deployed health webhook to production.

**Accomplishments:**
1. **Health Auto Export Configuration**
   - Guided user through iPhone configuration
   - Set up webhook URL and authentication secret
   - Changed format from CSV to JSON (webhook currently JSON-only)
   - Selected health metrics: Steps, Heart Rate, HRV, Resting HR, Sleep

2. **Production Deployment Fix**
   - Discovered `api/health-webhook.js` wasn't deployed to production (404 error)
   - Added health-webhook configuration to `vercel.json` (maxDuration: 30s)
   - Committed and pushed changes for manual Vercel deployment

3. **Documentation Updates**
   - Added note about manual Vercel deployment (not auto-deployed from GitHub)

**Files Modified:**
- `vercel.json` - Added health-webhook function configuration

---

### 2026-01-23 - Health Data Integration (Session 34)

**Session Summary:**
Implemented automated tracking for Heart Rate, Steps, Sleep, and HRV using Health Auto Export. Data flows from Apple Watch → Webhook → Google Sheets and displays in the App history.

**New Features:**
1. **Automated Health Webhook (`api/health-webhook.js`)**
   - Receives JSON payload from Health Auto Export app.
   - Stores granular data in `Health_Hourly` sheet.
   - Aggregates daily stats (Steps, Avg HR, Sleep Duration, HRV) in `Health_Daily` sheet.
   - Intelligently merges new data with existing daily stats.

2. **Health Data Display**
   - Updated History view to show:
     - ❤️ Avg Heart Rate
     - 👣 Daily Steps
     - 📊 HRV (Heart Rate Variability)
     - 😴 Sleep Duration
   - Merges manual entry data + ECG data + Health data into a single verified view.

3. **Infrastructure**
   - Created `Health_Daily` and `Health_Hourly` sheets.
   - Updated `api/get-entries.js` to fetch and merge all 3 data sources.

**Files Created/Modified:**
- `api/health-webhook.js` - New endpoint for health data.
- `api/get-entries.js` - Logic to merge health data.
- `src/components/EntryHistory.jsx` - UI for health metrics.
- `src/components/EntryHistory.css` - Styles for health grid.
- `scripts/setup-health-sheets.js` (Used & Deleted) - Setup script.

**Configuration Required:**
- User needs to configure "Health Auto Export" app on iPhone to send data to `/api/health-webhook`.
- See `health_config_guide.md` for details.

---

### 2026-01-21 - Data Security & Backup System (Session 33)

**Session Summary:**
Implemented comprehensive data backup and redundancy system to protect against accidental data loss in Google Sheets.

**New Features:**

1. **Automated Daily Backups (`api/backup-data.js`)**
   - Backs up 3 sheets: Sheet1, ECG_Readings, ECG_Waveforms
   - Creates timestamped backup sheets: `Backup_YYYY-MM-DD`, `ECG_Backup_YYYY-MM-DD`, `Waveform_Backup_YYYY-MM-DD`
   - 30-day retention with automatic pruning of old backups
   - Runs daily at 5 AM ET via Vercel cron
   - Includes anomaly detection (warns if row count drops unexpectedly)

2. **Write-Ahead Audit Logging (`api/submit-entry.js`)**
   - Logs every entry submission to `AuditLog` sheet BEFORE writing to Sheet1
   - Stores full JSON payload for data replay capability
   - Enables recovery if Sheet1 is ever corrupted

3. **Monthly Email Backups**
   - On 1st of each month, emails CSV attachments to both addresses
   - Includes all 3 data sheets as separate CSV files
   - Requires `RESEND_API_KEY` env var (not yet configured)

**Files Created:**
- `api/backup-data.js` - New backup serverless function

**Files Modified:**
- `api/submit-entry.js` - Added audit logging
- `vercel.json` - Added daily backup cron job
- `docs/ARCHITECTURE.md` - Added "Data Backup & Redundancy" section

**Testing:**
- ✅ Daily backup creates all 3 backup sheets
- ✅ Audit logging creates AuditLog sheet on first submission
- ✅ 30-day pruning logic verified
- ⏳ Monthly email backup pending RESEND_API_KEY setup

---

### 2026-01-17 - Brain Time Display Bug Fix (Session 32)

**Session Summary:**
Fixed bug where "Brain time" (and other numeric fields) were not displaying their documented values when navigating between days in the Today screen.

**Bug Fixed:**
- **Root Cause:** In `api/get-entries.js`, JavaScript's `||` operator was treating `0` as falsy, converting numeric values of `0` to `null`.
- **Symptom:** When `brainTime` was documented as `0`, the API returned `null`, and the UI defaulted to `1`.
- **Fix:** Changed from `||` to `??` (nullish coalescing) for all numeric fields: `hours`, `brainTime`, `oxaloacetate`, `exercise`, `ecgHR`, `ecgRSRatio`.

**Files Modified:**
- `api/get-entries.js` - Fixed falsy value handling for numeric fields.

---

### 2026-01-08 - Manual Alert System (Session 31)

**Session Summary:**
Implemented manual alert trigger in the Settings page, allowing the user (parent) to send custom push notifications to their son's PWA.

**New Features:**
1. **Manual Alert Trigger:**
   - Added "Manual Alert" section to Settings page.
   - Allows sending custom messages (or random jokes).
   - Works for any user with the correct Auth Token, even if not subscribed on that device.

2. **Backend Custom Messages:**
   - Updated `api/send-notification.js` to accept `req.body.message`.
   - Preserved existing cron job functionality (random jokes).
   - Refined logic to combine custom message with random joke.
   - Added support for `includeJoke` flag to support "message only" alerts.

**Files Modified:**
- `src/components/Settings.jsx` - Added UI and logic for manual alerts.
- `api/send-notification.js` - Added custom message handling.

**Testing:**
- Verified manual alert sends custom message.
- Verified existing test notification still works.

---

### 2025-12-31 - Medication Bug Fixes & Change Indicators (Session 30)

**Session Summary:**
Fixed two critical medication bugs and added visual change indicators to medication history display.

**Bugs Fixed:**

1. **Missing Medication Carry-Forward**
   - Root cause: `api/get-entries.js` only fetched columns up to S, missing T, U, V
   - Senna (column T), Melatonin (column U), and Metoprolol (column V) were not being loaded
   - Fix: Extended sheet range from A:S to A:V
   - Result: All 12 medications now properly carry forward their last documented doses

2. **Deprecated Columns in History Cards**
   - Root cause: History was displaying old modafinil (column H) and oxaloacetate (column E)
   - These columns were deprecated in Session 29 in favor of new columns P and N
   - Fix: Removed old column references, added comprehensive medication list (K-V)
   - Result: History cards now show all 12 medications with correct doses, only when taken

**New Feature - Medication Change Indicators:**
- Medications that changed from the previous day display with subtle pink background
- Detects both dose changes and OFF→ON transitions
- Same grey text color as unchanged medications, only background differs
- Helps user quickly identify medication adjustments in history

**Files Modified:**
- `api/get-entries.js` - Extended range to A:V, added senna/melatonin/metoprolol fields, renamed oxaloacetate to oxaloacetateNew
- `src/components/EntryHistory.jsx` - Removed deprecated med display, added comprehensive med list with change detection
- `src/components/EntryHistory.css` - Added `.med-changed` styling with pink background

**Testing:**
- ✅ All 12 medications display correctly in Today view with carry-forward
- ✅ History cards show all medications taken on each day
- ✅ Change indicators work correctly (pink background for changed meds)

---

### 2025-12-29 - Medications Feature (Session 29)

**Session Summary:**
Implemented "Medications" section in Today's entry view. Users can now track detailed medication doses with a minimized documentation approach.

**Key Features:**
1.  **Medication Cards (A-Z):** Amitriptyline, DayQuil, Dextromethorphan, Melatonin, Metoprolol, Modafinil, NyQuil, Oxaloacetate, Senna, Tirzepatide, Venlafaxine, Vitamin D.
2.  **Smart Defaults & Persistence:**
    - App remembers the last *documented dose* even if the med was switched "Off" for a few days.
    - Default status for Modafinil is "On" (1 pill).
    - Default status for Oxaloacetate is "Off" (1g).
3.  **On/Off Toggle:**
    - "Off" saves as "Off" string in the sheet.
    - "On" saves the dose text.
    - Visual distinction (grayed out vs. active).
4.  **Minimizing Documentation:**
    - If status was "On" yesterday, it defaults to "On" today with the same dose.
    - If status was "Off", it defaults to "Off" today, but remembers the dose from the last "On" day for easy re-enabling.

**Files Modified:**
- `api/submit-entry.js` - Extended to support columns K-S.
- `api/get-entries.js` - Extended to fetch columns A-S and map new fields.
- `src/components/DailyEntry.jsx` - Replaced old inputs with new Medication cards and history fetch logic.
- `src/App.css` - Added styles for medication cards.

**Google Sheets Updates Needed:**
- **Add Headers K-V:**
    - K: Vitamin D
    - L: Venlafaxine
    - M: Tirzepatide
    - N: Oxaloacetate
    - O: NyQuil
    - P: Modafinil
    - Q: Dextromethorphan
    - R: DayQuil
    - S: Amitriptyline
    - T: Senna
    - U: Melatonin
    - V: Metoprolol

---

### 2025-12-28 - R-Peak Detection Fix & Sync ECG Button (Session 28)

**Session Summary:**
Fixed R-peak detection algorithm for accurate HR calculation and added "Sync ECG Data" button to trigger Health Auto Export sync.

**R-Peak Detection Algorithm Iterations:**

| Version | Threshold | Min Distance | Result |
|---------|-----------|--------------|--------|
| Original | 35% global max | 250ms | Missed peaks at high HR |
| v1 | 25% adaptive | 200ms | Detected T-waves as R-peaks (double count) |
| v2 | 30% + slope/prominence | 350ms | Too strict, missed R-peaks |
| **v3 (final)** | **30% global max** | **320ms** | **Works well for all HR** |

**Key Insight:** T-waves occur ~300ms after R-peaks. Using 320ms minimum distance skips T-waves while still supporting up to 187 BPM.

**New Feature: "Sync ECG Data" Button**
- Appears for 10 seconds after saving daily entry
- Tapping opens Health Auto Export via URL scheme (`com.HealthExport://`)
- Opening the app triggers cached ECG data to sync
- Solves iOS background sync limitation (iOS throttles background app refresh)

**Background Sync Investigation:**
- Health Auto Export background sync works intermittently (iOS limitation)
- iOS aggressively throttles background activity to save battery
- Solution: User taps "Sync ECG Data" button after saving, which opens the app and guarantees sync

**Files Modified:**
- `api/ecg-webhook.js` - Simplified R-peak detection (30% threshold, 320ms min distance)
- `src/components/DailyEntry.jsx` - Added "Sync ECG Data" button after save
- `src/App.css` - Styling for sync button

---

### 2025-12-28 - Multi-ECG Fix & History Layout (Session 27)

**Session Summary:**
Fixed the multi-ECG merging bug and improved History view layout.

**Bugs Fixed:**

1. **Multi-ECG Merging Bug**
   - Root cause: CSV parser wasn't detecting when multiple ECGs were bundled together
   - Symptom: Two ECGs taken back-to-back resulted in one row with doubled samples (30,722 instead of 15,361)
   - Fix: Added logic to detect repeated "Start" keys in CSV and split into separate ECG blocks
   - Added `parseCSVBlock()` function to parse individual ECG records

2. **ECG "Most Recent" Selection Bug**
   - Root cause: Used Column A (received timestamp) instead of Column B (actual ECG time)
   - Symptom: History showed wrong ECG when multiple taken same day (showed earlier one)
   - Fix: Changed `get-entries.js` to use Column B for determining "most recent"

**UI Improvements:**

1. **History Layout Reorganized**
   - Row 1: hrs upright + hrs brain (daily metrics)
   - Row 2: HR bpm + R/S ratio (ECG metrics, side by side)
   - Brain time now always displays (defaults to 0 if not set)

**Files Modified:**
- `api/ecg-webhook.js` - Multi-ECG parsing with block detection
- `api/get-entries.js` - Use actual ECG time for "most recent" selection
- `src/components/EntryHistory.jsx` - Two-row layout, always show brain time
- `src/components/EntryHistory.css` - Added `.entry-ecg-metrics` styling

---

### 2025-12-28 - ECG History Display & UI Redesign (Session 26)

**Session Summary:**
Completed Feature #21 - ECG data now displays in the History view with a redesigned card layout.

**Changes Made:**

1. **Enhanced History View**
   - Redesigned `EntryHistory.jsx` with new card layout
   - Shows 10 cards instead of 7
   - Main metrics grid: hrs upright, hrs brain, HR (bpm), R/S ratio
   - Secondary details: modafinil, exercise, oxaloacetate, comments
   - ECG-only days get special blue left border styling
   - "ECG data only" notice for days with only ECG data

2. **ECG Data Integration**
   - Modified `api/get-entries.js` to fetch ECG_Readings alongside daily entries
   - Merges three data sources: daily entries, ECG readings, ECG plan intentions
   - Uses most recent ECG per day when multiple exist
   - ECG data attributed to collection date (from timestamp)

3. **"Will do ECG" Button**
   - Added toggle button in DailyEntry.jsx +details section (under Modafinil)
   - Column I: "Will Do ECG" (Yes or empty)
   - Column J: "ECG Plan Date" (today's date when intention recorded)
   - Attributed to documentation date (today), NOT dateFor

4. **Date Attribution Logic**
   - Daily entry data → attributed to `dateFor` (date being documented)
   - ECG readings → attributed to collection timestamp
   - "Will do ECG" → attributed to documentation date (today)

**Files Modified:**
- `api/get-entries.js` - Fetch ECG data, merge by date, handle three data sources
- `api/submit-entry.js` - Added Column I (willDoECG) and Column J (ECG Plan Date)
- `src/components/EntryHistory.jsx` - New card layout with ECG metrics
- `src/components/EntryHistory.css` - New grid-based styling
- `src/components/DailyEntry.jsx` - Added "Will do ECG" toggle button
- `src/App.css` - Added ECG button styles

**Google Sheets Updates Needed:**
- Sheet1 Column I: "Will Do ECG"
- Sheet1 Column J: "ECG Plan Date"

---

### 2025-12-28 - ECG Webhook Fixes Complete (Session 25)

**Session Summary:**
Fixed all remaining issues with the ECG webhook. Health Auto Export automation is now fully functional - ECGs sync automatically with correct data and no duplicates.

**Issues Fixed:**

1. **`ecgData is not defined` Error (500)**
   - Root cause: Variable declared inside `else` block but referenced outside
   - Fix: Moved `let ecgData = null` declaration before the if/else block
   - File: `api/ecg-webhook.js`

2. **Multipart Form-Data Parsing**
   - Root cause: Health Auto Export sends CSV inside multipart boundaries (`--Boundary-...`)
   - Fix: Added `extractFromMultipart()` function to strip boundary headers
   - Detection: Added `multipart/form-data` and `--Boundary-` prefix checks

3. **Key-Value CSV Format Parsing**
   - Root cause: CSV uses `Key,Value` per line, NOT columnar format with headers
   - Actual format:
     ```
     Start,2025-12-27 23:15:55 -0500
     Classification,Sinus Rhythm
     Avg. Heart Rate (count/min),72.0
     Voltage Measurements,0.001,0.002,...
     ```
   - Fix: Rewrote `parseCSVData()` to parse key-value pairs and extract voltage array

4. **R-Peak Detection Missing Beats**
   - Symptom: Calculated HR was 28 BPM, Apple reported 71 BPM
   - Root cause: 60% threshold was too aggressive, missing 2/3 of R peaks
   - Fix: Lowered threshold from 60% to 35%, min distance from 300ms to 250ms
   - Result: Now detecting correct number of beats, HR validation passing (✓)

5. **Duplicate ECG Rows**
   - Symptom: Same ECG appearing 3+ times in spreadsheet despite "Since Last Sync"
   - Root cause: Date-based duplicate detection had timezone mismatch
     - Stored: `12/28/2025, 12:28:24 AM` (no timezone, parsed as UTC)
     - Incoming: `2025-12-28 00:28:24 -0500` (with timezone, parsed as ET)
   - Fix: Changed to ECG_ID-based detection (column L)
   - ECG_ID format: `ECG_1766899704000` (timestamp in milliseconds, unique per ECG)

**Files Modified:**
- `api/ecg-webhook.js` - All fixes above (~50 lines changed)

**Test Results:**
- ✅ ECG data parsing: Classification, HR, all metadata extracted
- ✅ Voltage measurements: 15,361 samples parsed correctly
- ✅ R/S ratio calculation: Working (e.g., 1.38)
- ✅ HR validation: Calculated HR matches Apple HR (99 vs 99, ✓)
- ✅ Waveform storage: Data saved to ECG_Waveforms sheet
- ⏳ Duplicate prevention: Deployed, awaiting verification

**Health Auto Export Settings (Working Configuration):**
- Format: CSV
- Date Range: "Since Last Sync" (or specific date range)
- Batch Requests: OFF
- Include Samples: ON
- Data Type: Electrocardiogram only
- Webhook URL: `https://amiel-cfs-documentation-app.vercel.app/api/ecg-webhook`

**Next Steps:**
1. Verify duplicate prevention is working (wait for Health Auto Export to re-sync)
2. Clean up any duplicate rows in ECG_Readings and ECG_Waveforms
3. (Optional) Build ECG history display in the app (Feature #21)

---

### 2025-12-28 - ECG CSV Format & Payload Issues (Session 24)

**Session Summary:**
Continued troubleshooting the ECG webhook to handle Health Auto Export data automatically. Made significant progress understanding the payload size limits and data format issues.

**Key Issues Identified:**

1. **413 Payload Too Large - Root Cause Found**
   - Health Auto Export **accumulates ALL ECGs** into one export file, regardless of date filter settings
   - Even with "Batch Requests OFF" and "Today" or "Since Last Sync" filters, the app bundles multiple ECGs
   - Single ECG with waveform data = ~400KB (JSON) → works
   - Multiple ECGs = exceeds Vercel Hobby's **4.5MB limit** → 413 error
   - The same export file ID (`F155B2FD-...`) appears repeatedly in logs

2. **CSV Format Partially Working**
   - Switched from JSON to CSV to reduce payload size (~40-50% smaller)
   - CSV requests now get through (no more 413 errors)
   - BUT: Metadata not being extracted properly (classification, HR, R/S ratio all null)
   - BUT: Voltage data not being parsed from CSV columns correctly
   - BUT: ECG_Waveforms sheet not being populated

3. **"Since Last Sync" Not Working as Expected**
   - Setting date range to "Since Last Sync" still sends data every few minutes
   - Creating duplicate rows with empty data (no voltage measurements)
   - See ECG_Readings rows from 11:40-11:45 PM with 0 samples

4. **Date Parsing Issues**
   - Some dates correct: `2025-12-27 20:07:53 -0500` (from JSON export)
   - Some dates wrong: `12/27/2025, 11:40:20 PM` (using receive time as ECG date - CSV parsing issue)

**Code Changes Made:**

1. **Added CSV Support to Webhook** (`api/ecg-webhook.js`)
   - Disabled automatic body parsing (`bodyParser: false`)
   - Added `getRawBody()` function to read raw request body
   - Added `parseCSVData()` function to parse CSV format
   - Added `parseCSVLine()` function for proper CSV parsing with quoted values
   - Auto-detects JSON vs CSV based on Content-Type header

2. **Multi-ECG Processing**
   - `extractAllECGData()` - processes ALL ECGs in JSON payload (not just last one)
   - `getExistingECGDates()` - checks for duplicates by ECG timestamp
   - Skips already-processed ECGs based on date (within 1 minute)

3. **Updated vercel.json**
   - Added `maxDuration: 30` for ECG webhook function

**Current ECG_Readings State (end of session):**
```
Row 1: JSON format - GOOD (classification, HR, R/S ratio all present)
Row 2: JSON format - GOOD
Row 3: JSON format - GOOD (Inconclusive Poor Recording)
Rows 4-7: CSV format - BAD (all metadata null, 0 voltage samples)
```

**What's Working:**
- ✅ JSON format with single-day manual export works perfectly
- ✅ R/S ratio calculation validated (matches Apple HR within 1 BPM)
- ✅ Duplicate detection prevents re-processing same ECG
- ✅ CSV requests get through (no 413 errors)

**What's NOT Working:**
- ❌ CSV parsing not extracting metadata (classification, HR, sampling rate)
- ❌ CSV voltage data not being parsed (voltage1-4 columns)
- ❌ ECG_Waveforms not populated for CSV exports
- ❌ "Since Last Sync" keeps re-syncing repeatedly
- ❌ Automatic background sync still problematic

**Next Session Tasks (Priority Order):**

1. **Debug CSV Format Structure**
   - Add logging to see actual CSV headers received
   - Verify column names match what we're looking for
   - The voltage columns may be named differently than expected

2. **Fix CSV Voltage Parsing**
   - Health Auto Export CSV may have different structure than assumed
   - Each voltage column contains ~4000 values as quoted comma-separated string
   - Need to see actual data to fix parser

3. **Consider Alternative Approaches:**
   - **Option A:** Keep JSON format, delete old ECGs from Health app after successful sync
   - **Option B:** Use manual single-day exports (works reliably)
   - **Option C:** Upgrade Vercel to Pro ($20/mo) for 100MB limit
   - **Option D:** Fix CSV parsing to reduce payload size

4. **Investigate "Since Last Sync" Behavior**
   - Why does it keep syncing every few minutes?
   - Is Health Auto Export not tracking "last sync" correctly?
   - May need to use a different trigger (scheduled vs "when new data")

5. **Clean Up Test Data**
   - Delete the empty rows (4-7) from ECG_Readings
   - Delete corresponding ECG_Waveforms rows if any

**Health Auto Export Settings That Worked (JSON, single ECG):**
- Format: JSON
- Date Range: Manual selection of single day
- Batch Requests: OFF
- Include Samples: ON
- Data Type: Electrocardiogram only

**Webhook URL:** `https://amiel-cfs-documentation-app.vercel.app/api/ecg-webhook`
**Webhook Secret:** `a2a44fdf253e623efcf0cbf4d1c8fd00e1b4e5ee6a4732c6292298a35de92751`

**Files Modified This Session:**
- `api/ecg-webhook.js` - CSV parsing, raw body handling, multi-ECG support
- `vercel.json` - maxDuration for webhook function

---

### 2025-12-27 - ECG Webhook Fixes & Enhancements (Session 23)

**Major Accomplishments:**

1. **Fixed Health Auto Export Data Parsing**
   - Discovered actual format: `data.ecg` array (not `data.electrocardiogram`)
   - Voltage field is `.voltage` (not `.microVolts`)
   - Successfully parsing and calculating R/S ratio from real ECG data

2. **Added Raw Waveform Storage in Google Sheets**
   - Replaced failed Google Drive storage with Sheets-based approach
   - All 15,360 voltage samples stored as comma-separated strings
   - Split across 4 columns (45K chars each, under 50K cell limit)
   - ECG_ID links ECG_Readings to ECG_Waveforms for data retrieval

3. **Added HR Validation Sanity Check**
   - Calculate HR from R-R intervals: `60 / (avg interval in seconds)`
   - Compare to Apple's reported `averageHeartRate`
   - Flag as valid (✓) if within 10 BPM, invalid (✗) if not
   - New columns: Calc HR, HR Valid, Beats Detected, HR Diff

4. **Diagnosed 413 Payload Too Large Error**
   - Caused by "Batch Requests" ON in Health Auto Export
   - Solution: Turn OFF Batch Requests to send one ECG at a time

**Files Modified:**
- `api/ecg-webhook.js` - Parsing fix, Sheets waveform storage, HR validation

**New ECG_Readings Schema (15 columns):**
A: Timestamp, B: Date, C: Classification, D: Avg HR (Apple), E: R/S Ratio, F: R Amp, G: S Amp, H: Calc HR, I: HR Valid, J: Beats, K: Notes, L: ECG_ID, M: Samples, N: Sampling_Freq, O: HR Diff

**New ECG_Waveforms Schema (6 columns):**
A: ECG_ID, B: Sampling_Freq, C-F: Voltage data chunks

**Tested & Verified:**
- ECG data parsing works with real Health Auto Export payloads
- R/S ratio calculation: 7.46-8.45 (realistic values)
- HR validation ready for testing

**Next Session Tasks:**
1. Create ECG_Waveforms sheet tab with headers
2. Update ECG_Readings headers to new 15-column schema
3. Turn OFF Batch Requests in Health Auto Export
4. Deploy with `vercel --prod`
5. Test full end-to-end with new ECG

---

### 2025-12-27 - ECG Webhook Implementation (Session 22)

**Major Accomplishments:**

1. **Google Cloud & Drive Setup** - COMPLETE
   - Enabled Google Drive API in Cloud Console
   - Created `CFS-ECG-Data` folder in Google Drive
   - Shared folder with service account: `cfs-tracker-service@cfs-tracker-481603.iam.gserviceaccount.com`
   - Folder ID: `14_1fgPKdRqHIl6Bvd8tyx3ay0y1SaX3Y`

2. **ECG_Readings Sheet** - COMPLETE
   - Created new sheet tab with columns: Timestamp, Date, Classification, Avg Heart Rate, R/S Ratio, R Amplitude, S Amplitude, Notes, Waveform URL, Sample Count

3. **Environment Variables Added to Vercel:**
   - `GOOGLE_DRIVE_FOLDER_ID`: `14_1fgPKdRqHIl6Bvd8tyx3ay0y1SaX3Y`
   - `ECG_WEBHOOK_SECRET`: `a2a44fdf253e623efcf0cbf4d1c8fd00e1b4e5ee6a4732c6292298a35de92751`

4. **ECG Webhook Endpoint** - COMPLETE (`api/ecg-webhook.js`)
   - Authenticates via `X-Webhook-Secret` header
   - Parses multiple ECG data formats from Health Auto Export
   - **R/S Ratio Calculation Algorithm:**
     - Moving average baseline removal (200ms window)
     - R-peak detection (60% threshold, 300ms minimum distance)
     - S-wave detection (minimum within 100ms after R peak)
     - Returns median R/S ratio across all beats
   - Tested with simulated data: R/S ratio = 1.49, R = 1077 µV, S = 725 µV
   - Saves metadata to Google Sheets ECG_Readings tab

5. **Google Drive Storage** - PARTIAL
   - Code written to store raw waveform as CSV
   - **Issue:** Service accounts don't have storage quota on personal Google accounts
   - Added `supportsAllDrives: true` parameter - needs testing
   - Wrapped in try/catch so Sheets storage continues even if Drive fails

6. **Health Auto Export App** - PURCHASED
   - User purchased app on iPhone
   - Automation configuration not yet complete

**Files Created/Modified:**
- `api/ecg-webhook.js` - New webhook endpoint (300+ lines)
- `.env.local` - Added ECG_WEBHOOK_SECRET and GOOGLE_DRIVE_FOLDER_ID

**Testing Verified:**
- Webhook authentication works
- R/S ratio calculation works with simulated ECG data
- Data saves to Google Sheets ECG_Readings tab

**Next Session - Remaining Tasks:**

1. **Check Google Drive Storage**
   - Look in `CFS-ECG-Data` folder for CSV files from test
   - If empty, need alternative: store raw data in Sheets or use different storage

2. **Configure Health Auto Export Automation:**
   - Open Health Auto Export app → Automations → + New
   - URL: `https://amiel-cfs-documentation-app.vercel.app/api/ecg-webhook`
   - Method: POST, Format: JSON
   - Header: `X-Webhook-Secret` = `a2a44fdf253e623efcf0cbf4d1c8fd00e1b4e5ee6a4732c6292298a35de92751`
   - Data: Select only Electrocardiogram, enable "Include samples"
   - Trigger: "When new data is available"

3. **Test End-to-End with Real ECG**
   - Take ECG on Apple Watch
   - Verify data appears in ECG_Readings sheet
   - Confirm R/S ratio is calculated

4. **If Drive Storage Failed - Alternative Solutions:**
   - Option A: Store raw voltage data as JSON in Sheets (new column)
   - Option B: Use Cloudinary or Firebase Storage
   - Option C: Domain-wide delegation (complex, requires Google Workspace)

**Webhook Secret (for Health Auto Export setup):**
```
a2a44fdf253e623efcf0cbf4d1c8fd00e1b4e5ee6a4732c6292298a35de92751
```

**Webhook URL:**
```
https://amiel-cfs-documentation-app.vercel.app/api/ecg-webhook
```

---

### 2025-12-26 - ECG Capture Feature Planning (Session 20)

**Research & Planning for ECG Integration:**

Completed comprehensive research on adding daily ECG capture to the CFS tracker, with a focus on **minimal daily effort** for the user (critical for CFS patients).

**Key Findings:**

1. **R/S Ratio Confirmed:** The R/S ratio (ratio of R-wave to S-wave amplitude in ECG) is the target metric. Useful for tracking cardiac changes over time.

2. **PWA Limitation:** The app is a PWA, so cannot directly access Apple HealthKit. Required third-party solution.

3. **Recommended Solution:** Health Auto Export app ($2.99 one-time)
   - Automatically syncs Apple Watch ECG data to our webhook
   - Zero daily effort after initial setup
   - Provides full voltage waveform (~15,000 samples per ECG)

4. **Data Storage Plan:**
   - Full waveform → Google Drive (as CSV, ~15KB per ECG)
   - Metadata + R/S ratio → Google Sheets (ECG_Readings tab)

**Implementation Phases Defined:**

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Basic ECG fields (manual entry) | 1-2 hours |
| 2 | PDF/image upload to Google Drive | 4-6 hours |
| 3 | Health Auto Export webhook + auto R/S calculation | 8-12 hours |

**Documents Created:**
- `docs/ECG-CAPTURE-PLANNING.md` - Full research, options analysis, cost breakdown
- `docs/ECG-IMPLEMENTATION-GUIDE.md` - Detailed step-by-step guide for developers

**R/S Ratio Algorithm:**
- Baseline removal via moving average filter
- R-peak detection (threshold-based)
- S-wave detection (local minimum after R)
- Median R/S ratio across all detected beats

**Prerequisites Identified:**
- Enable Google Drive API in Cloud Console
- Create shared Drive folder for ECG data
- Purchase Health Auto Export app on user's iPhone
- Generate webhook secret for authentication

**Next Steps:**
1. Enable Google Drive API and create ECG folder
2. Create webhook endpoint with R/S ratio calculation
3. Configure Health Auto Export on iPhone
4. Test end-to-end automatic sync

**Note:** Removed all manual entry phases - user cannot be expected to enter R/S ratio manually. Solution is fully automatic from the start.

---

### 2025-12-20 - UI Overhaul & Data Integrity (Session 18)

**Major UI Changes:**
- Removed midodrine section from Today page (replaced with modafinil)
- Added modafinil slider to +details area (None/¼/½/Whole options)
- Promoted "Productive brain time" to main section with slider (default 1h)
- Renamed "Hours feet on ground" to "Feet on the ground"
- Added haptic feedback for sliders (Android only - iOS doesn't support vibration API)
- Fixed slider overlap issue with brain time label (added padding/border separator)

**Data Integrity Improvements:**
- **One Row Per Day**: API now checks if today's entry exists and UPDATES it instead of appending new row
- **Subscription Deduplication**: Subscribe API now matches by domain (e.g., `web.push.apple.com`) instead of exact endpoint URL, since iOS generates new endpoints on each enable/disable

**Google Sheets Column H:**
- Changed from "Midodrine" to "Modafinil" (values: quarter, half, whole, or empty)

**Files Modified:**
- `package.json` - Added `update-icons` script
- `update_icons.js` - Created script
- `public/pwa-*.png`, `public/apple-touch-icon.png` - Updated with F15 icon

---

### 2025-12-20 - Notification Bug Fixes & PWA Icon (Session 19)

**Critical Bug Fix - Duplicate Notifications:**
- **Root Cause**: The 15-minute time window was too wide for the 5-minute cron interval
- With `remainder < 15` check, cron would trigger 3-4 times per reminder (at 0, 5, 10 min after scheduled time)
- **Fix**: Changed window from 15 minutes to 5 minutes (`CRON_INTERVAL = 5`) in `api/cron-trigger.js`
- Now sends exactly 1 notification per scheduled reminder time

**UI Fix - Slider Overlap:**
- Removed `border-top` separator line from `.brain-time-section` in `src/App.css`
- The line was visually overlapping with the slider thumb

**PWA Icon Update:**
- Replaced placeholder icons with F16 fighter jet icon
- Updated: `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/apple-touch-icon.png`
- Users need to delete and re-add PWA to home screen to see new icon (iOS caches aggressively)

**Subscription Duplication Explanation:**
- The 5 duplicate subscription rows were caused by deployment timing during testing
- Domain-based deduplication code was deployed mid-testing session
- **Cleanup**: User should delete extra rows in Subscriptions sheet, keep only most recent

**Files Modified:**
- `api/cron-trigger.js` - Fixed 15→5 minute window for duplicate notification bug
- `src/App.css` - Removed brain-time-section border-top
- `public/pwa-192x192.png` - F16 icon
- `public/pwa-512x512.png` - F16 icon
- `public/apple-touch-icon.png` - F16 icon

---

### 2025-12-20 - UI Overhaul & Data Integrity (Session 18)

**Major UI Changes:**
- Removed midodrine section from Today page (replaced with modafinil)
- Added modafinil slider to +details area (None/¼/½/Whole options)
- Promoted "Productive brain time" to main section with slider (default 1h)
- Renamed "Hours feet on ground" to "Feet on the ground"
- Added haptic feedback for sliders (Android only - iOS doesn't support vibration API)
- Fixed slider overlap issue with brain time label (added padding/border separator)

**Data Integrity Improvements:**
- **One Row Per Day**: API now checks if today's entry exists and UPDATES it instead of appending new row
- **Subscription Deduplication**: Subscribe API now matches by domain (e.g., `web.push.apple.com`) instead of exact endpoint URL, since iOS generates new endpoints on each enable/disable

**Google Sheets Column H:**
- Changed from "Midodrine" to "Modafinil" (values: quarter, half, whole, or empty)

**Files Modified:**
- `src/components/DailyEntry.jsx` - New UI with modafinil slider, brain time promoted
- `src/App.css` - Modafinil slider styles, layout fixes
- `api/submit-entry.js` - One-row-per-day logic, modafinil instead of midodrine
- `api/subscribe.js` - Domain-based subscription matching

---

### 2025-12-19 - UI Fixes & Midodrine Tracking (Session 17)

**Bug Fixes:**
- Fixed overlapping "Disable Notifications" and "Send Test Notification" buttons in Settings page
- Added `.subscribed-actions` CSS class with proper flex-wrap for responsive button layout

**UI Improvements:**
- Reordered +details fields: Brain time (top), Comments, Exercise, Oxaloacetate, Midodrine (new)
- Changed oxaloacetate placeholder from "100" to "2" (more realistic dosage)

**New Feature - Midodrine Tracking:**
- Added "Midodrine (mg)" input field in DailyEntry +details section
- Updated `api/submit-entry.js` to save midodrine to Google Sheets column H
- Field allows 0.5 mg increments
- **Note:** User needs to add "Midodrine" header to column H in Google Sheets

**Verified:**
- Schedule changes do NOT require re-enabling notifications (schedule is stored separately from push subscription)

**Files Modified:**
- `src/components/Settings.css` - Added `.subscribed-actions` styles
- `src/components/Settings.jsx` - Removed inline margin style
- `src/components/DailyEntry.jsx` - Reordered fields, added midodrine
- `api/submit-entry.js` - Added midodrine to column H

---

### 2025-12-19 - iOS Push Notification FIX + UI Improvements (Session 16)

#### **iOS PUSH NOTIFICATIONS: ROOT CAUSE FOUND AND FIXED**

**The Problem:**
- iOS (Apple Push Notification Service / APNs) consistently returned `403 Forbidden` with `{"reason":"BadJwtToken"}`
- Desktop Chrome (FCM) worked perfectly with the exact same VAPID keys
- This issue persisted through multiple debugging sessions and key regenerations

**Root Cause: Trailing Newline in VAPID_EMAIL Environment Variable**

The `VAPID_EMAIL` environment variable in Vercel had an invisible trailing newline character (`\n`). When the JWT was generated for the VAPID authentication, the `sub` (subject) claim contained:
```
"sub": "mailto:ari.robicsek@gmail.com\n"
```
Instead of the correct:
```
"sub": "mailto:ari.robicsek@gmail.com"
```

**Why Chrome Worked but Apple Didn't:**
- Google's FCM is lenient and ignores/trims whitespace in JWT claims
- Apple's APNs is strict and rejects any malformed JWT, including those with trailing whitespace

**The Fix:**
Added `.trim()` when reading the `VAPID_EMAIL` environment variable in `api/send-notification.js`:
```javascript
let vapidSubject = process.env.VAPID_EMAIL ? process.env.VAPID_EMAIL.trim() : null;
```

**How We Found It:**
1. Added JWT debugging code to log the actual Authorization header being sent
2. Used `webpush.generateRequestDetails()` to inspect the JWT before sending
3. Decoded the JWT payload (base64) to see the actual claims
4. Discovered the `\n` in the `sub` claim in the logs:
   ```
   JWT Payload (decoded): {"aud":"https://web.push.apple.com","exp":1766216805,"sub":"mailto:ari.robicsek@gmail.com\n"}
   ```

**Prevention for Future:**
- ALWAYS `.trim()` environment variables that go into JWT claims
- The JWT debug logging is still in place (`=== APPLE JWT DEBUG ===`) for future troubleshooting
- Consider adding a startup validation that checks for whitespace in critical env vars

---

#### **Other Changes This Session:**

**UI Improvements:**
- **Fixed button visibility in Settings page**: Buttons were white-on-white in light mode. Changed CSS from undefined `var(--color-primary)` to `var(--accent, #3b82f6)` with fallback
- **Reorganized Settings page sections**:
  1. Reminder Schedule (removed Vercel hobby plan note)
  2. Push Notifications
  3. Authentication Token
  4. About

**New Feature - Productive Brain Time:**
- Added "Productive brain time (hours)" field in DailyEntry +details section
- Updated `api/submit-entry.js` to save to Google Sheets column G
- Field allows 0.5 hour increments, 0-24 range
- **Note:** User needs to add "Brain Time" header to column G in Google Sheets

**Snooze Button Enabled:**
- Uncommented notification action buttons in `send-notification.js`
- Added auth token to notification data payload for service worker to use
- Updated `sw-custom.js` to read token from notification data
- iOS notification action buttons may require long-press/expand to see

**Files Modified:**
- `api/send-notification.js` - JWT fix, snooze action, debug logging
- `api/submit-entry.js` - Added brainTime column
- `src/components/Settings.jsx` - Reorganized sections
- `src/components/Settings.css` - Fixed button colors
- `src/components/DailyEntry.jsx` - Added brainTime field
- `public/sw-custom.js` - Token from notification data

**Known Issue:**
- Desktop notifications not working at session end (not investigated yet)

---

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

**NEXT: Stats Multi-Day View (Session 46)**

Phases A + B complete (Session 45). Full plan in `docs/stats_feature_plan.md`.

**Immediate: Deploy & verify Single Day view**
- ⏳ Manual Vercel deployment required to test Single Day view live
- Test against Jan 28 data: expect 1545 HR readings, ~465 min sleep, ~1450 steps

**Phase C: Multi-Day API + View**
1. Create `api/get-health-stats.js` — server-side aggregation (HR box plots, sleep, steps, etc.)
2. Modify `api/get-entries.js` — add date range filtering for Feet on Ground / Brain Time
3. Create multi-day charts: `MetricLineChart.jsx`, `HRBoxPlotChart.jsx`, `SleepStackedBar.jsx`
4. Compose `MultiDayView.jsx` with metric toggles + date range selector

**Phase D: Polish**
5. Responsive testing on iPhone
6. Fullscreen landscape lock behavior
7. Edge cases: days with no data, partial data

**Phase 4: ECG Integration - COMPLETE!**

All ECG features are now functional:
- ✅ ECG webhook with R/S ratio calculation
- ✅ Health Auto Export automation
- ✅ ECG data in History view (HR + R/S ratio)
- ✅ "Will do ECG" button in Today page
- ✅ Multi-ECG parsing (fixed Session 27)
- ✅ R-peak detection fixed for accurate HR calculation (Session 28)
- ✅ "Sync ECG Data" button to trigger Health Auto Export (Session 28)

---

### Background Sync Status (RESOLVED - Session 28)

**Issue:** Health Auto Export background sync is unreliable due to iOS throttling background app refresh.

**Solution:** Added "Sync ECG Data" button that appears after saving daily entry. Tapping it opens Health Auto Export via URL scheme, which triggers the cached ECG data to sync immediately.

**Workflow:**
1. Take ECG on Apple Watch
2. Open CFS Tracker, save daily entry
3. Tap "Sync ECG Data" button → Health Auto Export opens → data syncs

---

### Other Tasks

**Google Sheets Updates Needed:**
- Sheet1 Column I header: "Will Do ECG"
- Sheet1 Column J header: "ECG Plan Date"

**Phase 3 Polish is ON HOLD:**
- Feature #16: Data trends/charts (7-day visualization)
- Feature #17: Streak animations (motivation feature)

---

## Blockers / Notes

### ⚠️ IMPORTANT: Manual Vercel Deployment Required

**Vercel is NOT connected to the GitHub repository.** When code changes are pushed to GitHub, they do NOT automatically deploy to production.

**Deployment Process:**
1. Make code changes locally
2. Commit and push to GitHub
3. **User must manually deploy via Vercel dashboard or CLI**
4. Wait for deployment to complete before testing

**Why This Matters:**
- Changes to API endpoints won't be available until manually deployed
- Frontend changes won't be visible until manually deployed
- Always verify deployment status before testing new features

---

### iOS Push Notification Troubleshooting Guide

If iOS notifications fail with `403 BadJwtToken`, check these in order:

1. **Environment Variable Whitespace** (MOST LIKELY)
   - Vercel environment variables can have hidden newlines
   - Check `VAPID_EMAIL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   - Solution: Ensure all are `.trim()`ed before use
   - The fix is in `api/send-notification.js` line ~56

2. **JWT Debug Logging**
   - Send a test notification and check Vercel logs
   - Look for `=== APPLE JWT DEBUG ===` section
   - Decode the JWT payload and check for:
     - `sub` claim should be exactly `mailto:email@example.com` (no `\n`)
     - `aud` claim should be `https://web.push.apple.com`
     - `exp` claim should be < 24 hours from now

3. **Apple vs Chrome Strictness**
   - Chrome/FCM is lenient with JWT format
   - Apple/APNs rejects ANY malformed JWT
   - If Chrome works but Apple doesn't, it's almost always a formatting issue

4. **VAPID Key Mismatch**
   - Frontend `VITE_VAPID_PUBLIC_KEY` must match backend `VAPID_PUBLIC_KEY`
   - The test notification response shows if keys match
   - If mismatched, user must re-enable notifications to get new subscription

5. **Subscription Corruption**
   - Clear the Subscriptions sheet in Google Sheets
   - Have user disable then re-enable notifications
   - This forces a fresh subscription with current keys

### Scheduled Notifications - RESOLVED (Session 19)

**Root Cause Found:** The 15-minute time window was too wide for the 5-minute cron interval. With `remainder < 15`, the cron would trigger 3-4 times per scheduled reminder.

**Fix:** Changed `CRON_INTERVAL` from 15 to 5 in `api/cron-trigger.js` line 222.

**Multiple subscriptions:** Were caused by deployment timing during testing - domain-based deduplication was deployed mid-session. Clean up extra rows manually.

### Other Notes

- **Authentication & Configuration**: **RESOLVED** - Fixed whitespace handling in both Auth Token and Sheet ID.
- **Pending Entries Issue**: **RESOLVED** - Fixed auth token trimming, added visible error feedback, and manual retry button.
- **Vercel Cron Job Limitation**: **RESOLVED** - Replaced with Google Apps Script triggering endpoint every 5 minutes.
- **Production API URL**: **RESOLVED** - Created .env.production file for relative URLs.
- **Timestamp Timezone Issues**: **RESOLVED** - All timestamps use Eastern Time.
- **VAPID Key Padding Error**: **RESOLVED** - Added automatic trimming and padding removal.
- **iOS Push Notifications**: **RESOLVED** - Fixed trailing newline in VAPID_EMAIL (Session 16).
- **Notification Action Buttons**: Snooze button may not be visible in all browser/OS combinations. iOS may require long-press/expand.
- **PWA Icons**: **UPDATED** - F16 fighter jet icon (Session 19). Delete & re-add PWA to home screen to see new icon.
- **Local Development**: Use `vercel dev` to run both frontend and API functions locally (not `npm run dev`)
- **Windows Notifications**: Users must enable Chrome/browser notifications in Windows Settings → System → Notifications
- **Google Apps Script Trigger**: Currently set to 5 minutes for testing. Change to 15 minutes after verification.
- **Desktop Notifications**: May not be working as of Session 16 end - needs investigation.

---

## Status Legend

| Status | Meaning |
|--------|---------|
| DONE | Feature complete and tested |
| SCAFFOLD | Code structure in place, needs completion |
| TODO | Not started |
| BLOCKED | Cannot proceed (see Blockers section) |
