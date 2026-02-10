/**
 * Stats Data Processing Service
 *
 * Processes raw Health_Hourly rows into chart-ready datasets.
 * Implements the "Nested Session Differencing" algorithm for sleep detection
 * and false-positive step suppression.
 */

/**
 * Parse a date string like "2026-01-28 06:49:53 -0500" into a Date object.
 */
/**
 * Parse a date string like "2026-01-28 06:49:53 -0500" into a Date object.
 * Robust implementation to handle custom format across all browsers (especially Safari).
 */
function parseTimestamp(str) {
  if (!str) return null;

  // 1. Try manual regex parsing for the known Health Auto Export format: "YYYY-MM-DD HH:mm:ss -ZZZZ"
  // Example: "2026-01-28 18:03:53 -0500"
  const regex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/;
  const match = str.match(regex);

  if (match) {
    // Construct ISO 8601 string: "YYYY-MM-DDTHH:mm:ss+/-HH:mm"
    // This is universally supported by new Date() in modern browsers.
    const isoString = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}${match[8]}:${match[9]}`;
    const d = new Date(isoString);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Fallback to standard Date parsing (e.g. for "1/29/2026, 4:59:12 AM" or ISO strings)
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  // 3. Last resort fallback: try replacing space with T if it looks like partial ISO
  try {
    let iso = str.trim();
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:/.test(iso)) {
      iso = iso.replace(' ', 'T');
    }
    const d2 = new Date(iso);
    return isNaN(d2.getTime()) ? null : d2;
  } catch {
    return null;
  }
}

/**
 * Get minute-of-day (0-1439) from a Date object, using the date's local timezone.
 * We extract the hour/minute from the timestamp string directly to avoid timezone issues.
 */
function minuteOfDayFromTimestamp(timestampStr) {
  if (!timestampStr) return null;

  // Try to extract time from formats like "2026-01-28 06:49:53 -0500"
  const match = timestampStr.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  // Try to extract from "1/28/2026, 4:26:57 PM" format
  const match2 = timestampStr.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (match2) {
    let hour = parseInt(match2[1], 10);
    const min = parseInt(match2[2], 10);
    const ampm = match2[4].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return hour * 60 + min;
  }

  return null;
}

/**
 * Parse the Raw Data JSON from a sleep_analysis row.
 * Returns { sleepStart, sleepEnd, totalSleep (minutes), deep, rem, core, awake } or null.
 */
function parseSleepRawData(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    if (!data.sleepStart || !data.sleepEnd) return null;

    const sleepStart = parseTimestamp(data.sleepStart);
    const sleepEnd = parseTimestamp(data.sleepEnd);
    if (!sleepStart || !sleepEnd) return null;

    return {
      sleepStart,
      sleepEnd,
      totalSleepMin: (data.totalSleep || 0) * 60, // hours -> minutes
      deep: (data.deep || 0) * 60,
      rem: (data.rem || 0) * 60,
      core: (data.core || 0) * 60,
      awake: (data.awake || 0) * 60,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the Raw Data JSON from a sleep_stage row (granular sleep data).
 * Returns { startDate, endDate, stage, durationMins } or null.
 */
function parseSleepStageRawData(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    if (!data.startDate || !data.endDate) return null;

    const startDate = parseTimestamp(data.startDate);
    const endDate = parseTimestamp(data.endDate);
    if (!startDate || !endDate) return null;

    return {
      startDate,
      endDate,
      stage: data.stage || 'unknown',
      durationMins: data.durationMins || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the Raw Data JSON from a heart_rate row.
 * Returns { date (timestamp string), avg, min, max } or null.
 */
function parseHRRawData(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    return {
      dateStr: data.date || null,
      avg: data.Avg ?? data.avg ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the Raw Data JSON from a step_count row.
 * Returns { date (timestamp string), qty } or null.
 */
function parseStepRawData(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    return {
      dateStr: data.date || null,
      qty: data.qty ?? null,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Nested Session Differencing Algorithm
// ============================================================

/**
 * Cluster overlapping sleep sessions.
 * Sessions overlap if one's time range intersects another's.
 */
function clusterSleepSessions(sessions) {
  if (sessions.length === 0) return [];

  // Sort by start time
  const sorted = [...sessions].sort((a, b) => a.sleepStart.getTime() - b.sleepStart.getTime());

  const clusters = [];
  let current = [sorted[0]];
  let clusterEnd = sorted[0].sleepEnd.getTime();

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.sleepStart.getTime() < clusterEnd) {
      // Overlaps with current cluster
      current.push(s);
      clusterEnd = Math.max(clusterEnd, s.sleepEnd.getTime());
    } else {
      // New cluster
      clusters.push(current);
      current = [s];
      clusterEnd = s.sleepEnd.getTime();
    }
  }
  clusters.push(current);
  return clusters;
}

// ============================================================
// Sleep Validation: HR/Step-based awake detection
// ============================================================

/**
 * Compute an "awake score" for a time range using HR and step data.
 * Scores 0-7: 0 = likely asleep, ≥3 = likely awake.
 * Thresholds are normalized by duration to handle long sleep periods.
 *
 * @param {number} startMs - Start of range (epoch ms)
 * @param {number} endMs - End of range (epoch ms)
 * @param {Array} tsHrReadings - [{ ts (Date), bpm }] sorted by ts
 * @param {Array} tsStepReadings - [{ ts (Date), qty }] sorted by ts
 */
function computeAwakeScore(startMs, endMs, tsHrReadings, tsStepReadings) {
  const hrs = tsHrReadings.filter(r => r.ts >= startMs && r.ts < endMs);
  const steps = tsStepReadings.filter(r => r.ts >= startMs && r.ts < endMs);
  const spanMin = (endMs - startMs) / 60000;
  const spanHours = spanMin / 60;

  // If the gap is > 30 min but has very sparse HR data (< 2 readings/hour),
  // we can't reliably determine sleep/awake — likely a cross-midnight gap where
  // HR data from the other day is missing. Default to "inconclusive" = don't expand.
  if (spanMin > 30 && hrs.length < spanHours * 2) return 3;

  const totalSteps = steps.reduce((sum, s) => sum + s.qty, 0);
  const significantSteps = steps.filter(s => s.qty > 2);
  const avgHR = hrs.length > 0 ? hrs.reduce((s, r) => s + r.bpm, 0) / hrs.length : null;
  const maxHR = hrs.length > 0 ? Math.max(...hrs.map(r => r.bpm)) : null;

  const stepsPerHour = spanMin > 0 ? (totalSteps / spanMin) * 60 : 0;
  const sigStepsPerHour = spanMin > 0 ? (significantSteps.length / spanMin) * 60 : 0;

  return (avgHR && avgHR > 70 ? 2 : 0) +
    (maxHR && maxHR > 85 ? 1 : 0) +
    (sigStepsPerHour > 1 ? 2 : 0) +
    (stepsPerHour > 20 ? 2 : 0);
}

/**
 * For a cluster of overlapping sleep sessions, find the "best" session
 * by walking from innermost outward and stopping when a gap shows awake activity.
 *
 * @param {Array} cluster - Array of parsed sleep sessions (with sleepStart, sleepEnd, etc.)
 * @param {Array} tsHrReadings - [{ ts (Date), bpm }]
 * @param {Array} tsStepReadings - [{ ts (Date), qty }]
 * @returns {Object} The best session from the cluster
 */
function findBestSessionInCluster(cluster, tsHrReadings, tsStepReadings) {
  if (cluster.length === 1) return cluster[0];

  // Check if sessions are truly nested (one contains another) or sequential.
  // Nested: parent.start <= child.start && parent.end >= child.end
  // Sequential: sessions touch or partially overlap but neither fully contains the other.
  const sorted = [...cluster].sort((a, b) => a.sleepStart.getTime() - b.sleepStart.getTime());
  const isNested = sorted.length >= 2 &&
    sorted[0].sleepEnd.getTime() >= sorted[sorted.length - 1].sleepEnd.getTime();

  if (!isNested) {
    // Sequential or partially overlapping — return the longest session by totalSleepMin
    let best = cluster[0];
    for (let i = 1; i < cluster.length; i++) {
      if (cluster[i].totalSleepMin > best.totalSleepMin) {
        best = cluster[i];
      }
    }
    return best;
  }

  // Nested sessions: sort by span length (longest first = parent)
  const bySpan = [...cluster].sort((a, b) => {
    const spanA = a.sleepEnd.getTime() - a.sleepStart.getTime();
    const spanB = b.sleepEnd.getTime() - b.sleepStart.getTime();
    return spanB - spanA;
  });

  // Start with innermost, expand outward while gaps look like sleep
  let best = bySpan[bySpan.length - 1];
  for (let i = bySpan.length - 2; i >= 0; i--) {
    const outer = bySpan[i];
    const inner = bySpan[i + 1];
    if (outer.sleepStart.getTime() >= inner.sleepStart.getTime()) continue;

    const score = computeAwakeScore(
      outer.sleepStart.getTime(),
      inner.sleepStart.getTime(),
      tsHrReadings,
      tsStepReadings
    );

    if (score < 3) {
      best = outer; // Gap looks like sleep → expand outward
    } else {
      break; // Gap shows awake → stop expanding
    }
  }
  return best;
}

// ============================================================
// Main Processing Function
// ============================================================

/**
 * Process raw Health_Hourly rows for a single day into chart-ready data.
 *
 * @param {Array} rows - Array of { timestamp, date, hour, metric, value, min, max, source, rawData }
 * @param {string} dateStr - The target date in YYYY-MM-DD format
 * @returns {Object} { hrPoints, activityMinutes, sleepSessions, summary }
 */
export function processSingleDayData(rows, dateStr) {
  // 1. Initialize 1440-element arrays
  const activityMinutes = new Array(1440).fill('BLANK'); // SLEEP layer
  const walkingMinutes = new Array(1440).fill(false);    // STEPS layer
  const stepCounts = new Array(1440).fill(0);            // Steps per minute

  // 1b. Early pass: collect timestamped HR and step readings for sleep validation.
  // These are used by the awake-score algorithm to determine whether a sleep
  // session's exclusive region shows actual sleep or awake activity.
  const tsHrReadings = [];
  const tsStepReadings = [];
  rows.forEach(row => {
    if (row.metric === 'heart_rate') {
      const parsed = parseHRRawData(row.rawData);
      const bpm = parsed?.avg ?? row.value;
      if (bpm === null || bpm === undefined) return;
      const ts = parsed?.dateStr ? parseTimestamp(parsed.dateStr) : null;
      if (ts) tsHrReadings.push({ ts: ts.getTime(), bpm });
    } else if (row.metric === 'step_count') {
      const parsed = parseStepRawData(row.rawData);
      if (!parsed) return;
      const ts = parsed.dateStr ? parseTimestamp(parsed.dateStr) : null;
      const qty = parsed.qty ?? row.value ?? 0;
      if (ts) tsStepReadings.push({ ts: ts.getTime(), qty });
    }
  });

  // 2. Parse sleep_analysis rows and track which sessions end on the target date.
  // Spillover rows (from date+1 that start on this date) are included for the
  // visual but do NOT count toward this day's sleep total.
  const targetDate = new Date(dateStr + 'T00:00:00');
  const targetDayNum = targetDate.getDate();
  const targetMonthNum = targetDate.getMonth();
  const targetYearNum = targetDate.getFullYear();

  const sleepSessions = [];
  const granularStages = []; // Granular sleep_stage rows (more accurate)

  rows.forEach(row => {
    if (row.metric === 'sleep_analysis') {
      const parsed = parseSleepRawData(row.rawData);
      if (parsed) {
        // A session "ends on this date" if sleepEnd is on the target calendar day
        const endsOnTarget = parsed.sleepEnd.getFullYear() === targetYearNum &&
          parsed.sleepEnd.getMonth() === targetMonthNum &&
          parsed.sleepEnd.getDate() === targetDayNum;
        parsed.endsOnTarget = endsOnTarget;
        parsed.isSpillover = !!row.spillover;
        // Full session duration including awake time
        parsed.fullDurationMin = parsed.totalSleepMin + parsed.awake;
        sleepSessions.push(parsed);
      }
    } else if (row.metric === 'sleep_stage') {
      // Granular sleep stage data with exact start/end times
      const parsed = parseSleepStageRawData(row.rawData);
      if (parsed) {
        granularStages.push(parsed);
      }
    }
  });

  // 3a. Deduplicate granular stages (handles duplicate uploads)
  // Use startTime + endTime + stage as unique key
  const seenStages = new Set();
  const dedupedStages = granularStages.filter(stage => {
    const key = `${stage.startDate.getTime()}-${stage.endDate.getTime()}-${stage.stage}`;
    if (seenStages.has(key)) return false;
    seenStages.add(key);
    return true;
  });
  // Replace with deduplicated array
  granularStages.length = 0;
  granularStages.push(...dedupedStages);

  // 3a. Determine if we have granular sleep data
  const hasGranularData = granularStages.length > 0;

  const dayStartMs = targetDate.getTime();
  const dayEndMs = dayStartMs + 1440 * 60000;

  // Initialize validatedClusters at outer scope (used by OLD path)
  let validatedClusters = [];

  if (hasGranularData) {
    // 3b. GRANULAR PATH: Use exact sleep stage times for overlay
    // Only mark "asleep" stages (asleepCore, asleepDeep, asleepREM), not "awake" or "inBed"
    for (const stage of granularStages) {
      // Skip awake and inBed stages
      if (stage.stage === 'awake' || stage.stage === 'inBed') continue;

      const sStart = Math.max(stage.startDate.getTime(), dayStartMs);
      const sEnd = Math.min(stage.endDate.getTime(), dayEndMs);
      if (sStart >= sEnd) continue;

      const startMin = Math.floor((sStart - dayStartMs) / 60000);
      const endMin = Math.ceil((sEnd - dayStartMs) / 60000);
      for (let m = startMin; m < endMin && m < 1440; m++) {
        if (m >= 0) activityMinutes[m] = 'ASLEEP';
      }
    }
  } else {
    // 3c. AGGREGATED PATH: Cluster overlapping sessions and validate each cluster
    // using HR/step data (existing logic for session-level data)
    const clusters = clusterSleepSessions(sleepSessions);
    validatedClusters = clusters.map(cluster =>
      findBestSessionInCluster(cluster, tsHrReadings, tsStepReadings)
    );

    // 4. Mark ASLEEP minutes using only validated best sessions, clipped to this day.
    for (const best of validatedClusters) {
      const sStart = Math.max(best.sleepStart.getTime(), dayStartMs);
      const sEnd = Math.min(best.sleepEnd.getTime(), dayEndMs);
      if (sStart >= sEnd) continue;

      const startMin = Math.floor((sStart - dayStartMs) / 60000);
      const endMin = Math.ceil((sEnd - dayStartMs) / 60000);
      for (let m = startMin; m < endMin && m < 1440; m++) {
        if (m >= 0) activityMinutes[m] = 'ASLEEP';
      }
    }
  }

  // 4b. Merge contiguous ASLEEP regions into consolidated sleep blocks for tooltips.
  const mergedSleepBlocks = [];
  let blockStart = -1;
  for (let m = 0; m < 1440; m++) {
    if (activityMinutes[m] === 'ASLEEP') {
      if (blockStart === -1) blockStart = m;
    } else {
      if (blockStart !== -1) {
        mergedSleepBlocks.push({ startMin: blockStart, endMin: m, isAsleep: true });
        blockStart = -1;
      }
    }
  }
  if (blockStart !== -1) {
    mergedSleepBlocks.push({ startMin: blockStart, endMin: 1440, isAsleep: true });
  }

  // Annotate each merged block with the validated best session's metadata.
  for (const block of mergedSleepBlocks) {
    const blockStartMs = dayStartMs + block.startMin * 60000;
    const blockEndMs = dayStartMs + block.endMin * 60000;
    let bestSession = null;
    let bestSpan = -1;
    for (const s of validatedClusters) {
      const sStart = s.sleepStart.getTime();
      const sEnd = s.sleepEnd.getTime();
      if (sStart < blockEndMs && sEnd > blockStartMs) {
        const span = sEnd - sStart;
        if (span > bestSpan) {
          bestSpan = span;
          bestSession = s;
        }
      }
    }
    if (bestSession) {
      block.fullStart = bestSession.sleepStart;
      block.fullEnd = bestSession.sleepEnd;
      block.fullDurationMin = Math.round(bestSession.fullDurationMin);
    }
  }

  // 5. Parse step_count rows and apply two-layer filter
  let totalSteps = 0;
  rows.forEach(row => {
    if (row.metric === 'step_count') {
      const parsed = parseStepRawData(row.rawData);
      if (!parsed) return;

      const min = minuteOfDayFromTimestamp(parsed.dateStr);
      const qty = parsed.qty ?? row.value ?? 0;
      totalSteps += qty;

      if (min === null) return;

      // Accumulate step count for this minute
      stepCounts[min] += qty;

      // Layer 2: Suppress steps < 2 per minute (sensor noise)
      if (qty < 2) return;

      // Mark as WALKING in the overlay layer
      walkingMinutes[min] = true;
    }
  });

  // 6. Parse heart_rate rows → collect { minuteOfDay, bpm }
  // Aggregate multiple readings per minute into an average
  const hrMap = new Map(); // minute -> { sum, count }

  rows.forEach(row => {
    if (row.metric === 'heart_rate') {
      const parsed = parseHRRawData(row.rawData);
      const bpm = parsed?.avg ?? row.value;
      if (bpm === null || bpm === undefined) return;

      const min = minuteOfDayFromTimestamp(parsed?.dateStr || '');
      // Fallback: use the hour from the row
      const minuteOfDay = min !== null ? min : (row.hour !== null ? row.hour * 60 : null);
      if (minuteOfDay === null) return;

      if (!hrMap.has(minuteOfDay)) {
        hrMap.set(minuteOfDay, { sum: 0, count: 0 });
      }
      const entry = hrMap.get(minuteOfDay);
      entry.sum += bpm;
      entry.count += 1;
    }
  });

  // Convert map to array of averages
  const hrPoints = Array.from(hrMap.entries())
    .map(([minuteOfDay, { sum, count }]) => ({
      minuteOfDay,
      bpm: Math.round(sum / count)
    }))
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay);

  // 7. Compute summary stats
  // Sleep total: Calculate fractional durations (same as Multi-Day)
  // This ensures Single Day and Multi-Day produce identical totals
  let totalSleepMin = 0;
  if (hasGranularData) {
    // Sum clipped fractional durations for actual sleep stages
    for (const stage of granularStages) {
      const s = stage.stage?.toLowerCase() || '';
      // Count only actual sleep stages (exclude awake/inBed)
      if (s.includes('asleep') || s === 'deep' || s === 'rem' || s === 'core') {
        // Clip to day boundaries (same as Multi-Day)
        const sStart = Math.max(stage.startDate.getTime(), dayStartMs);
        const sEnd = Math.min(stage.endDate.getTime(), dayEndMs);
        if (sStart < sEnd) {
          totalSleepMin += (sEnd - sStart) / 60000;
        }
      }
    }
    totalSleepMin = Math.round(totalSleepMin);
  } else {
    // OLD PATH: Sum validated session durations, excluding awake
    for (const best of validatedClusters) {
      const endsOnTarget = best.sleepEnd.getFullYear() === targetYearNum &&
        best.sleepEnd.getMonth() === targetMonthNum &&
        best.sleepEnd.getDate() === targetDayNum;
      if (endsOnTarget) {
        const sleepOnlyMin = best.totalSleepMin || 0;
        totalSleepMin += Math.round(sleepOnlyMin);
      }
    }
  }

  // Count walking minutes from the separate array
  const totalWalkingMin = walkingMinutes.filter(isWalking => isWalking).length;

  const avgHR = hrPoints.length > 0
    ? Math.round(hrPoints.reduce((sum, p) => sum + p.bpm, 0) / hrPoints.length)
    : null;

  // Split HR into awake vs asleep using activityMinutes
  const hrAwakePoints = hrPoints.filter(p => activityMinutes[p.minuteOfDay] !== 'ASLEEP');
  const hrAsleepPoints = hrPoints.filter(p => activityMinutes[p.minuteOfDay] === 'ASLEEP');

  const avgHR_awake = hrAwakePoints.length > 0
    ? Math.round(hrAwakePoints.reduce((s, p) => s + p.bpm, 0) / hrAwakePoints.length)
    : null;
  const avgHR_asleep = hrAsleepPoints.length > 0
    ? Math.round(hrAsleepPoints.reduce((s, p) => s + p.bpm, 0) / hrAsleepPoints.length)
    : null;

  // Parse HRV data
  let hrvValues = [];
  rows.forEach(row => {
    if (row.metric === 'heart_rate_variability') {
      const val = row.value;
      if (val !== null && val !== undefined) {
        hrvValues.push(val);
      }
    }
  });
  const avgHRV = hrvValues.length > 0
    ? Math.round(hrvValues.reduce((sum, v) => sum + v, 0) / hrvValues.length * 10) / 10
    : null;

  return {
    hrPoints,
    activityMinutes, // Contains only SLEEP and BLANK
    walkingMinutes,  // Contains booleans for steps layer
    stepCounts,      // Steps per minute (0-1439)
    sleepSessions: mergedSleepBlocks,
    summary: {
      totalSleepMin,
      totalSteps: Math.round(totalSteps),
      totalWalkingMin,
      avgHR,
      avgHR_awake,
      avgHR_asleep,
      avgHRV,
      hrCount: hrPoints.length,
      hrvCount: hrvValues.length,
    },
  };
}

/**
 * Format minutes to "Xh Ym" display string.
 */
export function formatMinutes(min) {
  if (min === null || min === undefined) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format a minute-of-day (0-1439) to "HH:MM" time string.
 */
export function formatTime(minuteOfDay) {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
