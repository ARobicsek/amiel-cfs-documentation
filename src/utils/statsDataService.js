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
    if (s.sleepStart.getTime() <= clusterEnd) {
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

/**
 * Apply Nested Session Differencing to a cluster of overlapping sessions.
 *
 * Returns an array of segments: { startMin, endMin, density, isAsleep }
 * where startMin/endMin are minute-of-day values (0-1439).
 *
 * For a given target date (YYYY-MM-DD), we only return segments that fall on that date.
 */
function differenceCluster(cluster, targetDateStr) {
  // Parse target date boundaries (midnight to midnight)
  const targetDate = new Date(targetDateStr + 'T00:00:00');
  const targetStart = targetDate.getTime();
  const targetEnd = targetStart + 24 * 60 * 60 * 1000;

  const DENSITY_THRESHOLD = 0.5;

  if (cluster.length === 1) {
    // Single session - mark entire session as ASLEEP
    const s = cluster[0];
    const segStart = Math.max(s.sleepStart.getTime(), targetStart);
    const segEnd = Math.min(s.sleepEnd.getTime(), targetEnd);
    if (segEnd <= segStart) return [];

    const startMinOfDay = Math.floor((segStart - targetStart) / 60000);
    const endMinOfDay = Math.floor((segEnd - targetStart) / 60000);

    return [{
      startMin: Math.max(0, startMinOfDay),
      endMin: Math.min(1440, endMinOfDay),
      density: 1.0,
      isAsleep: true,
    }];
  }

  // Multiple overlapping sessions - apply differencing
  // Sort by span length (longest first = parent)
  const sorted = [...cluster].sort((a, b) => {
    const spanA = a.sleepEnd.getTime() - a.sleepStart.getTime();
    const spanB = b.sleepEnd.getTime() - b.sleepStart.getTime();
    return spanB - spanA; // Longest first
  });

  const segments = [];

  // Process from innermost (shortest) to outermost
  // Build up "accounted sleep" as we go outward
  let accountedSleepMin = 0;
  let innermostStart = sorted[sorted.length - 1].sleepStart.getTime();

  for (let i = sorted.length - 1; i >= 0; i--) {
    const session = sorted[i];
    const sessionStart = session.sleepStart.getTime();
    const sessionEnd = session.sleepEnd.getTime();

    if (i === sorted.length - 1) {
      // Innermost session: density = totalSleep / span
      const spanMin = (sessionEnd - sessionStart) / 60000;
      const density = spanMin > 0 ? session.totalSleepMin / spanMin : 0;

      const segStart = Math.max(sessionStart, targetStart);
      const segEnd = Math.min(sessionEnd, targetEnd);
      if (segEnd > segStart) {
        segments.push({
          startMin: Math.max(0, Math.floor((segStart - targetStart) / 60000)),
          endMin: Math.min(1440, Math.floor((segEnd - targetStart) / 60000)),
          density,
          isAsleep: density >= DENSITY_THRESHOLD,
        });
      }

      accountedSleepMin = session.totalSleepMin;
      innermostStart = sessionStart;
    } else {
      // Outer layer: exclusive region is from this session's start to the inner's start
      const exclusiveSleep = session.totalSleepMin - accountedSleepMin;
      const exclusiveStart = sessionStart;
      const exclusiveEnd = innermostStart; // Up to where inner session begins
      const exclusiveSpanMin = (exclusiveEnd - exclusiveStart) / 60000;

      if (exclusiveSpanMin > 0 && exclusiveSleep >= 0) {
        const density = exclusiveSleep / exclusiveSpanMin;

        const segStart = Math.max(exclusiveStart, targetStart);
        const segEnd = Math.min(exclusiveEnd, targetEnd);
        if (segEnd > segStart) {
          segments.push({
            startMin: Math.max(0, Math.floor((segStart - targetStart) / 60000)),
            endMin: Math.min(1440, Math.floor((segEnd - targetStart) / 60000)),
            density,
            isAsleep: density >= DENSITY_THRESHOLD,
          });
        }
      }

      // Also handle the tail (after innermost session ends to this session's end)
      // if this session extends beyond the innermost
      if (sessionEnd > sorted[sorted.length - 1].sleepEnd.getTime()) {
        const tailStart = sorted[sorted.length - 1].sleepEnd.getTime();
        const tailEnd = sessionEnd;
        const tailSpanMin = (tailEnd - tailStart) / 60000;
        // Remaining sleep attributed to tail
        const tailSleep = Math.max(0, exclusiveSleep - (exclusiveSpanMin > 0 ? exclusiveSleep * (exclusiveSpanMin / (exclusiveSpanMin + tailSpanMin)) : 0));
        const tailDensity = tailSpanMin > 0 ? tailSleep / tailSpanMin : 0;

        const segStart = Math.max(tailStart, targetStart);
        const segEnd = Math.min(tailEnd, targetEnd);
        if (segEnd > segStart) {
          segments.push({
            startMin: Math.max(0, Math.floor((segStart - targetStart) / 60000)),
            endMin: Math.min(1440, Math.floor((segEnd - targetStart) / 60000)),
            density: tailDensity,
            isAsleep: tailDensity >= DENSITY_THRESHOLD,
          });
        }
      }

      accountedSleepMin = session.totalSleepMin;
      innermostStart = sessionStart;
    }
  }

  return segments;
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

  // 2. Parse sleep_analysis rows (only the parent rows, not explosion rows)
  const sleepSessions = [];
  rows.forEach(row => {
    if (row.metric === 'sleep_analysis') {
      const parsed = parseSleepRawData(row.rawData);
      if (parsed) {
        sleepSessions.push(parsed);
      }
    }
  });

  // 3. Cluster overlapping sessions and apply Nested Session Differencing
  const clusters = clusterSleepSessions(sleepSessions);
  const allSegments = [];

  clusters.forEach(cluster => {
    const segments = differenceCluster(cluster, dateStr);
    allSegments.push(...segments);
  });

  // 4. Mark ASLEEP minutes in the base activity layer
  allSegments.forEach(seg => {
    if (seg.isAsleep) {
      for (let m = seg.startMin; m < seg.endMin && m < 1440; m++) {
        if (m >= 0) activityMinutes[m] = 'ASLEEP';
      }
    }
  });

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
  const totalSleepMin = activityMinutes.filter(m => m === 'ASLEEP').length;
  // Count walking minutes from the separate array
  const totalWalkingMin = walkingMinutes.filter(isWalking => isWalking).length;

  const avgHR = hrPoints.length > 0
    ? Math.round(hrPoints.reduce((sum, p) => sum + p.bpm, 0) / hrPoints.length)
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
    sleepSessions: allSegments,
    summary: {
      totalSleepMin,
      totalSteps: Math.round(totalSteps),
      totalWalkingMin,
      avgHR,
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
