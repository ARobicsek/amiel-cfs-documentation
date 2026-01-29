# Stats Feature Plan (Session 44 - Finalized)

## Overview

Add a **Stats** tab to the PWA with two views:
1. **Single Day** - 24-hour timeline showing HR scatter plot + activity bar (sleeping/walking/blank)
2. **Multi Day** - Trends dashboard with configurable date ranges and multiple stacked metric charts

**Navigation**: Today | History | **Stats** | Settings

---

## Decisions Log (from planning interview)

| Topic | Decision |
|-------|----------|
| Sleep granularity | Session-level data only (no per-minute stages). Show sleeping vs awake vs walking. Design to support granular data later if available. |
| Data sources | Mix manual (Feet on Ground, Brain Time) + automated (HR, Steps, Sleep, HRV) in multi-day view |
| Orientation | Fullscreen button per chart (Fullscreen API + landscape lock if supported) |
| Offline | Online only. Show "No connection" when offline. |
| False step suppression | Suppress steps during sleep sessions + suppress steps < 2/minute outside sleep |
| Step intervals | Show full distributed interval as "walking" (all minutes in the interval marked) |
| Date range limit | No limit. Paginate/progressively load if needed. |
| Chart library | Developer's choice (see analysis below) |
| Touch interaction | Tap for tooltip (not drag cursor) |
| HR multi-day | Box plots (min/Q1/median/Q3/max) |
| Medications | Not in v1 |
| Step threshold | < 2 steps/minute treated as noise |
| Time range (single day) | Full 24 hours (midnight to midnight) |

---

## Part 1: Data Challenges & Solutions

### 1.1 Sleep Detection (Session-Level Approximation)

**Problem**: We only have session-level sleep data, not minute-by-minute.

**What we have** (from `sleep_analysis` rows in Health_Hourly):
```json
{
  "sleepStart": "2026-01-28 06:49:53 -0500",
  "sleepEnd": "2026-01-28 16:26:57 -0500",
  "totalSleep": 7.74,    // hours actually asleep
  "deep": 0.86,           // hours
  "rem": 1.29,
  "core": 3.91,
  "awake": 0.20,          // hours awake WITHIN the session
  "asleep": 1.69          // hours of unspecified sleep
}
```

**Key insight**: Session spans 577 minutes but only 465 minutes of actual sleep. The other 112 minutes within the session, the user was awake. We don't know WHICH minutes.

**Algorithm: "Nested Session Differencing" (uses overlapping sessions for accuracy)**

Apple Watch frequently reports multiple overlapping `sleep_analysis` sessions for the same sleep period. Sub-sessions are nested within parent sessions. By comparing these, we can determine which time segments had dense sleep vs sparse sleep.

**Example (Jan 29 data):**
| Session | Start | End | Total Sleep | Span |
|---------|-------|-----|-------------|------|
| A (parent) | Jan 28, 6:03 PM | Jan 29, 4:59 AM | 385 min | 659 min |
| B (sub) | Jan 29, 1:13 AM | Jan 29, 4:59 AM | 225 min | 225 min |

By subtracting B from A:
- **1:13 AM - 4:59 AM** (B's window): 225/225 min = **100% sleep density** → ASLEEP
- **6:03 PM - 1:13 AM** (exclusive part of A): (385-225)/430 min = **37% density** → NOT asleep (resting in bed)

Without this technique, we'd mark the entire 11-hour window as "sleeping" — a massive overestimate.

**Algorithm steps:**

1. Parse all `sleep_analysis` rows for the day (filter to `Metric == 'sleep_analysis'` only; ignore `sleep_deep`/`sleep_rem`/etc explosion rows)
2. Sort sessions by `sleepStart` time (ascending)
3. Group overlapping sessions: sessions that share the same `sleepEnd` (or whose time ranges overlap) form a "cluster"
4. For each cluster, compute **segment sleep density**:
   a. Sort sessions in cluster by start time (earliest first)
   b. Working from the innermost (shortest) session outward:
      - Innermost session: density = `totalSleep / (sleepEnd - sleepStart)`
      - Each outer layer: exclusive sleep = `outerTotalSleep - innerTotalSleep`, exclusive span = `outerStart to innerStart`, density = exclusive sleep / exclusive span
5. Apply **density threshold** to classify each segment:
   - Density >= 50% → mark all minutes in segment as `ASLEEP`
   - Density < 50% → mark as `BLANK` (user was in bed but mostly awake)
6. Non-overlapping sessions (e.g., a standalone morning nap with no sub-sessions): use full session window as `ASLEEP` (density is typically high for non-overlapping sessions)

**Why 50% threshold?** At 37% density (like the Jan 29 evening example), the user was awake more than asleep — marking it as sleep would be misleading. At 84% density (like Jan 27 afternoon), the user was genuinely sleeping with brief awakenings. 50% is a reasonable boundary.

**Edge cases:**
- Sessions with no sub-sessions: treat the entire session as ASLEEP (we can't differentiate further)
- Sessions that span midnight: split at midnight, attribute minutes to correct calendar day
- Multiple independent sleep sessions (nap + night): process each cluster independently

**Future improvement**: If Health Auto Export can be configured to send per-minute sleep stage samples, swap in granular data without changing the UI. The minute-array data structure supports this upgrade path.

### 1.2 False-Positive Step Suppression

**Problem**: Steps are sometimes recorded during sleep (wrist movement) and very small step counts outside sleep may be sensor noise.

**Algorithm: Two-layer filter**

```
For each step_count entry:
  1. Is this minute within a sleep session window?
     → YES: Suppress (mark as ASLEEP, not WALKING)
  2. Is the step count < 2 per minute?
     → YES: Suppress (treat as sensor noise, mark as BLANK)
  3. Otherwise: Mark as WALKING
```

### 1.3 Step Count Distribution

**Problem**: Health Auto Export distributes step totals evenly across time intervals. Example: 266 steps distributed as 38.08 across 7 consecutive minutes at 1-minute intervals.

**Solution**: Accept the distribution as-is. If any minute has steps >= 2, mark the full minute as WALKING. This slightly overestimates walking duration but is honest about data resolution. The visual result is a solid block during walking periods, which is actually quite readable.

### 1.4 Sparse Data Handling

**Problem**: Many days (especially Dec 2025) have only step data, no HR/sleep/HRV. HR sample counts vary wildly (24 to 1545/day).

**Solution**:
- Single Day: Show whatever data exists. Empty charts for missing metrics (with "No data" message).
- Multi Day: Leave gaps in line charts for missing days (no interpolation). Show empty columns in box plots. Show "No data" for days without any health data.

### 1.5 Duplicate Sleep Rows

**Problem**: The "sleep_analysis_explosion" creates duplicate `sleep_deep`, `sleep_rem`, etc. rows with identical timestamps.

**Solution**: The Single Day view uses only the `sleep_analysis` parent rows (which contain the JSON with `sleepStart`/`sleepEnd`). Ignore the explosion rows for single-day visualization. Multi-day view uses Health_Daily aggregates which are already deduplicated.

---

## Part 2: Architecture

### 2.1 Charting Library: Chart.js + react-chartjs-2

**Rationale** (over Recharts):
- **Mobile performance**: Chart.js uses Canvas (not SVG), which is significantly faster for scatter plots with hundreds of points
- **Touch support**: Built-in touch event handling, pinch-to-zoom plugin available
- **Bundle size**: Chart.js (~60KB gzipped) vs Recharts (~45KB) - comparable, but Chart.js handles large datasets better
- **Box plots**: `chartjs-chart-box-and-violin-plot` plugin provides box plots out of the box
- **Tooltip on tap**: Native support for tap-to-show-tooltip on mobile

**Dependencies to install**:
```
npm install chart.js react-chartjs-2 chartjs-chart-box-and-violin-plot
```

### 2.2 Component Structure

```
src/components/Stats/
  StatsTab.jsx           # Top-level container with Single/Multi toggle
  StatsTab.css           # Styles for stats components
  SingleDayView.jsx      # 24h HR scatter + activity bar
  MultiDayView.jsx       # Trends dashboard with stacked charts
  FullscreenChart.jsx    # Wrapper: fullscreen button + Fullscreen API logic
  charts/
    HRScatterChart.jsx   # Single-day HR scatter plot
    ActivityBar.jsx      # Single-day sleep/walking/blank broken bar
    HRBoxPlotChart.jsx   # Multi-day HR box plots
    SleepStackedBar.jsx  # Multi-day sleep stages stacked bar
    MetricLineChart.jsx  # Reusable line chart for Steps, Feet on Ground, Brain Time
```

### 2.3 API Endpoints

#### [NEW] `api/get-hourly-data.js`
- **Purpose**: Fetch raw hourly data for a single day (Single Day view)
- **Parameters**: `date` (YYYY-MM-DD)
- **Returns**: All Health_Hourly rows for that date
- **Processing**: Client-side (single day = ~35 rows, fast enough)

#### [NEW] `api/get-health-stats.js`
- **Purpose**: Aggregated health data for Multi-Day views
- **Parameters**: `startDate`, `endDate`
- **Returns** (per day):
```json
{
  "date": "2026-01-28",
  "hr": { "min": 49, "q1": 65, "median": 78, "q3": 92, "max": 122, "count": 1545 },
  "steps": 1450,
  "sleep": { "total": 465, "deep": 52, "rem": 77, "core": 235, "awake": 12 },
  "hrv": { "avg": 57.7, "count": 13 },
  "feetOnGround": 6,
  "brainTime": 2
}
```
- **Logic**:
  1. Fetch Health_Hourly rows within date range
  2. **HR Box Plot aggregation**: Group HR readings by day. For each day, compute 5-number summary (min, Q1, median, Q3, max) directly from all readings (no need for minute-mean intermediate step - the readings are already point-in-time samples)
  3. Fetch Health_Daily for sleep/steps/HRV aggregates (already computed)
  4. Fetch Sheet1 for Feet on Ground (Col C) and Brain Time (Col G)
  5. Merge by date and return

- **Performance**: Pagination strategy for large date ranges:
  - Fetch Health_Hourly in chunks if > 10,000 rows
  - Or: compute aggregates server-side as data streams in, don't load all rows into memory at once
  - Google Sheets API returns max 10,000 rows per request; use `startRow`/`endRow` if needed

#### [MODIFY] `api/get-entries.js`
- Add optional `startDate`/`endDate` query parameters for date-range filtering
- Used by Multi-Day view to get Sheet1 data (Feet on Ground, Brain Time)

### 2.4 Client-Side Data Processing

#### [NEW] `src/utils/statsDataService.js`

**Single Day Processing** (`processSingleDayData(hourlyRows)`):
```
Input: Raw Health_Hourly rows for one day
Output: {
  hrPoints: [{ minuteOfDay: 540, bpm: 78 }, ...],
  activityMinutes: Array(1440) of 'ASLEEP' | 'WALKING' | 'BLANK',
  sleepSessions: [{ start, end, density, totalSleep }, ...],  // for summary display
  summary: { totalSleepMin, totalSteps, avgHR, avgHRV }
}

Algorithm:
1. Initialize 1440-element array, all BLANK
2. Parse sleep_analysis rows → extract sleepStart/sleepEnd/totalSleep
3. Group into overlapping clusters and apply Nested Session Differencing (see 1.1)
4. For each segment with density >= 50%: mark those minutes as ASLEEP
5. Parse step_count rows:
   a. If minute is ASLEEP → skip (false positive suppression)
   b. If qty < 2 → skip (noise threshold)
   c. Else → mark minute as WALKING
6. Parse heart_rate rows → collect { minuteOfDay, bpm } points
7. Compute summary stats from the processed data
8. Return all datasets
```

**Multi Day Processing** (`processMultiDayData(statsResponse)`):
- Mostly pass-through from API response
- Format dates for chart labels
- Handle missing days (insert nulls)

---

## Part 3: UI Specification

### 3.1 StatsTab.jsx

```
┌─────────────────────────────┐
│  [ Single Day | Multi Day ] │  ← Segmented control / toggle
├─────────────────────────────┤
│                             │
│  <SingleDayView />          │
│      or                     │
│  <MultiDayView />           │
│                             │
└─────────────────────────────┘
```

- Default view: Single Day
- Toggle persists in component state (not URL)

### 3.2 SingleDayView.jsx

```
┌─────────────────────────────┐
│   ◀  Wed, January 28  ▶    │  ← Date navigator
├─────────────────────────────┤
│                             │
│   HR Scatter Plot           │  ← ~250px height
│   Y: BPM (auto range)      │
│   X: 00:00 ─────── 23:59   │
│   Points: individual HR     │
│   readings as dots          │
│                             │
├─────────────────────────────┤
│ ░░░░░░█████░░░██░░░░░█░░░░ │  ← ~80px height
│ SLEEP  WALK SLEEP WALK     │     Activity bar
│ (grey) (pink)              │
├─────────────────────────────┤
│  12AM  4AM  8AM  12PM 4PM  │  ← Shared X-axis labels
│                    8PM 12AM │
├─────────────────────────────┤
│  Summary:                   │
│  Sleep: 7h 45m              │
│  Steps: 1,450               │
│  Avg HR: 84 bpm             │
│  HRV: 57.7 ms              │
│  [⛶ Fullscreen]            │  ← Fullscreen button
└─────────────────────────────┘
```

**Interaction**: Tapping a data point shows a tooltip with the exact time and value.

**Date Navigation**:
- Left/right arrows navigate by day
- Default: today (or most recent day with data)
- Disable right arrow if already at today

### 3.3 MultiDayView.jsx

```
┌─────────────────────────────┐
│  ◀  Jan 21 - 27, 2026  ▶   │  ← Date range navigator
│  [ 7D ] [ 30D ] [ 3M ] [6M]│  ← Quick range selectors
├─────────────────────────────┤
│  Metrics: (toggleable)      │
│  [✓] Feet  [✓] Brain       │
│  [✓] HR    [✓] Sleep       │
│  [✓] Steps [✓] HRV         │
├─────────────────────────────┤
│                             │
│  ── Feet on Ground ──       │  ← Line chart, Y: hours
│  [⛶]                       │
│                             │
├─────────────────────────────┤
│  ── Brain Time ──           │  ← Line chart, Y: hours
│  [⛶]                       │
│                             │
├─────────────────────────────┤
│  ── Heart Rate ──           │  ← Box plot per day
│  [⛶]                       │
│                             │
├─────────────────────────────┤
│  ── Sleep ──                │  ← Stacked bar (deep/rem/core)
│  [⛶]                       │     Y: hours
│                             │
├─────────────────────────────┤
│  ── Steps ──                │  ← Line chart, Y: count
│  [⛶]                       │     Gaps for missing days
│                             │
├─────────────────────────────┤
│  ── HRV ──                  │  ← Line chart, Y: ms (SDNN)
│  [⛶]                       │
│                             │
└─────────────────────────────┘
```

**Each chart has**:
- Title
- Fullscreen button (⛶) in top-right corner
- Tap-for-tooltip interaction
- Shared X-axis across all visible charts

**Metric Toggles**: Unchecking a metric hides its chart entirely (not just greys it out).

**Missing Data**: Days with no data show as gaps in lines / empty columns in bar charts. No interpolation.

### 3.4 FullscreenChart.jsx

Wrapper component that:
1. Renders a fullscreen button (⛶ icon) in the top-right of the chart container
2. On tap: uses `Element.requestFullscreen()` API
3. Attempts `screen.orientation.lock('landscape')` if available (works on Android, may not on iOS)
4. In fullscreen mode: chart fills the entire screen, background goes dark, shows a close (✕) button
5. Exits on ✕ tap or device back gesture
6. Falls back gracefully if Fullscreen API not supported (button hidden)

### 3.5 Visual Style

- **Theme**: Follow existing app dark/light mode (auto system preference)
- **Dark mode colors**:
  - Background: match existing app dark background
  - Chart background: slightly lighter than page background
  - HR points: coral/orange (#FF6B6B)
  - Sleep bars: muted blue (#6B8DB5)
  - Walking bars: soft green (#7BC67E)
  - Box plot boxes: blue (#4A90D9)
  - Line charts: use distinct colors per metric
- **Light mode**: Invert appropriately, ensure contrast
- **Font**: Match existing app monospace/system font

---

## Part 4: Implementation Plan (Build Order)

### Phase A: Foundation (Session 45)

1. **Install dependencies**: `chart.js`, `react-chartjs-2`, `chartjs-chart-box-and-violin-plot`
2. **Create `api/get-hourly-data.js`**: Simple endpoint to fetch Health_Hourly for one date
3. **Create `src/utils/statsDataService.js`**: Data processing utilities
   - `processSingleDayData()` with sleep detection + step filtering
   - Unit-testable with sample data from `new_hourly.txt`
4. **Create `StatsTab.jsx`** with Single/Multi toggle
5. **Add Stats tab to App.jsx** navigation (4th tab)
6. **Test**: Tab appears, toggle works, data loads

### Phase B: Single Day View (Session 45-46)

7. **Create `HRScatterChart.jsx`**: 24h scatter plot of HR readings
8. **Create `ActivityBar.jsx`**: Broken bar showing ASLEEP/WALKING/BLANK
9. **Create `SingleDayView.jsx`**: Compose charts + date navigation + summary stats
10. **Create `FullscreenChart.jsx`**: Fullscreen wrapper
11. **Create `StatsTab.css`**: All styling
12. **Test**: Visual check against known days (Jan 28 has good data: 1545 HR readings, 465 min sleep, 1450 steps)

### Phase C: Multi-Day API (Session 46)

13. **Create `api/get-health-stats.js`**: Server-side aggregation endpoint
    - HR box plot computation
    - Sleep/Steps from Health_Daily
    - Feet on Ground / Brain Time from Sheet1
14. **Modify `api/get-entries.js`**: Add date range filtering
15. **Test**: API returns correct aggregates for known date ranges

### Phase D: Multi-Day View (Session 46-47)

16. **Create `MetricLineChart.jsx`**: Reusable line chart
17. **Create `HRBoxPlotChart.jsx`**: Box plot chart
18. **Create `SleepStackedBar.jsx`**: Stacked bar chart
19. **Create `MultiDayView.jsx`**: Compose all charts + controls
20. **Test**: Full visual verification across different date ranges

### Phase E: Polish (Session 47)

21. **Responsive testing**: Verify on actual iPhone
22. **Fullscreen on mobile**: Test landscape lock behavior
23. **Performance**: Test with full dataset (6+ months once available)
24. **Edge cases**: Days with no data, days with only steps, single-day ranges
25. **Loading states**: Skeleton screens while data loads

---

## Part 5: Additional Considerations

### 5.1 Performance Budgets

- **Single Day API call**: Should return in < 2s (single day = ~35-150 rows)
- **Multi Day API call (7 days)**: Should return in < 3s
- **Multi Day API call (30 days)**: Should return in < 5s
- **Multi Day API call (90+ days)**: May need pagination. Strategy: fetch in 30-day chunks, render progressively.
- **Chart rendering**: Canvas-based (Chart.js) handles thousands of points well. HR scatter for a day with 1545 readings should render instantly.

### 5.2 Google Sheets API Rate Limits

- 100 requests per 100 seconds per user
- Each API call should minimize number of Sheets requests
- `get-health-stats.js` should batch: fetch Health_Hourly, Health_Daily, and Sheet1 in parallel (3 concurrent requests)

### 5.3 Fullscreen API Compatibility

- **Chrome/Android**: Full support including `screen.orientation.lock()`
- **Safari/iOS**: `requestFullscreen()` requires `webkitRequestFullscreen()` prefix
- **iOS PWA**: Fullscreen API may not work in standalone PWA mode. Fallback: expand chart to 100vh/100vw with fixed positioning and hide other UI elements.

### 5.4 Future Enhancements (Not in v1)

- Medication change markers on timeline
- Drag-cursor interaction for Single Day view
- Granular sleep stage visualization (if data becomes available)
- Export charts as images
- Offline caching of last-viewed stats
- ECG R/S ratio trend in multi-day view
- Correlation analysis (e.g., "sleep vs next-day steps")

---

## Part 6: Data Validation Checklist

Before building, verify these against actual Google Sheets:

- [ ] Health_Hourly columns match: Timestamp, Date, Hour, Metric, Value, Min, Max, Source, Raw Data
- [ ] Health_Daily columns match: Date, Steps, Avg HR, Resting HR, Min HR, Max HR, Avg HRV, Sleep Duration, Sleep Efficiency, Deep Sleep, REM Sleep, Last Updated, HR Sample Count, HRV Sample Count, Awake Minutes
- [ ] Sheet1 columns: Col C = hours (Feet on Ground), Col G = Brain Time
- [ ] sleep_analysis Raw Data JSON always contains sleepStart, sleepEnd, totalSleep
- [ ] step_count Value field contains the qty (fractional steps per minute)
- [ ] heart_rate Value field contains Avg BPM

---

## Appendix: Sample Data Shapes

### Health_Hourly Row (heart_rate)
```
Timestamp: 1/29/2026, 9:27:08 AM
Date: 1/29/2026
Hour: 9
Metric: heart_rate
Value: 60
Min: 60
Max: 60
Source: Amiel's Apple Watch
Raw Data: {"date":"2026-01-29 09:27:08 -0500","Max":60,"source":"Amiel's Apple Watch","Min":60,"Avg":60}
```

### Health_Hourly Row (step_count)
```
Timestamp: 1/29/2026, 9:19:09 AM
Date: 1/29/2026
Hour: 9
Metric: step_count
Value: 8.695834216
Source: Amiel's Apple Watch
Raw Data: {"date":"2026-01-29 09:19:09 -0500","qty":8.695834216158723,"source":"Amiel's Apple Watch"}
```

### Health_Hourly Row (sleep_analysis)
```
Timestamp: 1/28/2026, 4:26:57 PM
Date: 1/28/2026
Hour: 16
Metric: sleep_analysis
Value: 465
Source: Amiel's Apple Watch
Raw Data: {"totalSleep":7.744608124627008,"sleepStart":"2026-01-28 06:49:53 -0500","sleepEnd":"2026-01-28 16:26:57 -0500","deep":0.8596,"rem":1.2851,"core":3.9140,"awake":0.2002,...}
```

### Health_Daily Row
```
Date: 1/28/2026
Steps: 1450.44
Avg HR: 84
Resting HR: 55
Min HR: 49
Max HR: 122
Avg HRV: 57.7
Sleep Duration: 465
Sleep Efficiency: 97%
Deep Sleep: 52
REM Sleep: 77
HR Sample Count: 1545
HRV Sample Count: 13
Awake Minutes: 12
```
