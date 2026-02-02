# Apple Watch Sleep Data Documentation

This document explains the sleep data formats we receive from the Apple Watch via Health Auto Export and how to interpret them.

## Data Sources

| File | Description | Used For |
|------|-------------|----------|
| `new_hourly.txt` | Original aggregated export | OLD algorithm (pre-Session 56) |
| `new_hourly_2.txt` | Granular export (Session 55 fix) | NEW algorithm with sleep stages |

## Sleep Data Formats

### 1. Aggregated `sleep_analysis` (OLD)

Found in `new_hourly.txt`. Contains session-level summaries:

```json
{
  "sleepStart": "2026-01-28 06:49:53 -0500",
  "sleepEnd": "2026-01-28 16:26:57 -0500",
  "totalSleep": 7.74,           // HOURS (not minutes!)
  "deep": 0.86,                 // hours
  "rem": 1.29,                  // hours
  "core": 3.91,                 // hours
  "awake": 0.20,                // hours
  "asleep": 1.69,               // hours (generic/unclassified)
  "inBed": 0,                   // hours
  "inBedStart": "...",
  "inBedEnd": "..."
}
```

**Key notes:**
- `totalSleep`, `deep`, `rem`, `core`, `awake` are in **HOURS**
- Window duration = `sleepEnd` - `sleepStart` (this is the sleep window, not `totalSleep`)
- Multiple sessions may be nested (inner within outer)

### 2. Granular `sleep_stage` (NEW)

Found in `new_hourly_2.txt`. Contains individual stage records:

```json
{
  "stage": "asleepCore",        // or asleepDeep, asleepREM, awake, asleep
  "startDate": "2026-01-28 06:49:53 -0500",
  "endDate": "2026-01-28 07:15:22 -0500",
  "durationMins": 25.48
}
```

**Stage values:**
| Stage | Meaning |
|-------|---------|
| `asleepDeep` | Deep sleep |
| `asleepREM` | REM sleep |
| `asleepCore` | Core/light sleep |
| `asleep` | Generic sleep (unclassified) |
| `awake` | Awake in bed |

## Key Insights from Session 56 Analysis

1. **Both algorithms produce similar totals** – Differences typically within 1 hour
2. **NEW captures more detail** – 200 stage records vs 25 aggregated sessions
3. **NEW includes "awake" time** – Explicitly tracks in-bed awake periods
4. **No overcalling detected** – All NEW sleep stages have appropriate HR/step patterns

## Recommendations for Implementation

1. **Use NEW granular data** (`sleep_stage` metric) for all sleep calculations
2. **Exclude "awake" stages** from sleep totals to represent true sleep
3. **Sum individual stage durations** rather than relying on session windows
4. **Stage breakdown visualization**: Show Deep, REM, Core separately

## Calculation Example

```javascript
// Get sleep stages for a date (excluding awake)
const sleepStages = stages.filter(s => {
  const stage = s.stage.toLowerCase();
  return !stage.includes('awake');
});

// Sum durations
const totalSleepMin = sleepStages.reduce((sum, s) => sum + s.durationMin, 0);
```

## Related Files

- `src/services/statsDataService.js` – Sleep data processing
- `src/services/sleepValidation.js` – HR/step validation logic
- `scripts/compare_sleep_algorithms.js` – Analysis script (reference)
