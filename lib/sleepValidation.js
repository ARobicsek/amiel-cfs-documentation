/**
 * Shared Sleep Validation Algorithm
 *
 * Clusters overlapping sleep sessions and validates each cluster
 * using HR/step data to find the best session per cluster.
 * Used by both get-hourly-data.js (multi-day) and get-entries.js (history).
 *
 * This mirrors the client-side algorithm in statsDataService.js.
 */

/**
 * Cluster overlapping sleep sessions.
 * Uses strict overlap (< not <=) so back-to-back sessions stay separate.
 *
 * @param {Array} sessions - [{ sleepStart (ms), sleepEnd (ms), ... }]
 * @returns {Array<Array>} clusters
 */
export function clusterSleepSessions(sessions) {
  if (sessions.length === 0) return [];

  const sorted = [...sessions].sort((a, b) => a.sleepStart - b.sleepStart);
  const clusters = [];
  let current = [sorted[0]];
  let clusterEnd = sorted[0].sleepEnd;

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.sleepStart < clusterEnd) {
      current.push(s);
      clusterEnd = Math.max(clusterEnd, s.sleepEnd);
    } else {
      clusters.push(current);
      current = [s];
      clusterEnd = s.sleepEnd;
    }
  }
  clusters.push(current);
  return clusters;
}

/**
 * Compute awake score for a time range.
 * 0 = likely asleep, >=3 = likely awake.
 */
function computeAwakeScore(startMs, endMs, hrReadings, stepReadings) {
  const hrs = hrReadings.filter(r => r.ts >= startMs && r.ts < endMs);
  const steps = stepReadings.filter(r => r.ts >= startMs && r.ts < endMs);
  const spanMin = (endMs - startMs) / 60000;
  const spanHours = spanMin / 60;

  // Sparse HR data = inconclusive, don't expand
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
 * Find the best session in a cluster of overlapping sessions.
 * For nested clusters: walk innermost → outward, stop when gap shows awake.
 * For sequential clusters: pick the one with highest totalMins.
 */
export function findBestSessionInCluster(cluster, hrReadings, stepReadings) {
  if (cluster.length === 1) return cluster[0];

  const sorted = [...cluster].sort((a, b) => a.sleepStart - b.sleepStart);
  const isNested = sorted.length >= 2 &&
    sorted[0].sleepEnd >= sorted[sorted.length - 1].sleepEnd;

  if (!isNested) {
    let best = cluster[0];
    for (let i = 1; i < cluster.length; i++) {
      if (cluster[i].totalMins > best.totalMins) best = cluster[i];
    }
    return best;
  }

  // Nested: sort by span (longest first = parent)
  const bySpan = [...cluster].sort((a, b) =>
    (b.sleepEnd - b.sleepStart) - (a.sleepEnd - a.sleepStart)
  );

  let best = bySpan[bySpan.length - 1];
  for (let i = bySpan.length - 2; i >= 0; i--) {
    const outer = bySpan[i];
    const inner = bySpan[i + 1];
    if (outer.sleepStart >= inner.sleepStart) continue;

    const score = computeAwakeScore(outer.sleepStart, inner.sleepStart, hrReadings, stepReadings);
    if (score < 3) {
      best = outer;
    } else {
      break;
    }
  }
  return best;
}

/**
 * Parse a sleep_analysis row's rawData JSON into a session object.
 *
 * @param {string} rawDataStr - JSON string from Health_Hourly column I
 * @returns {Object|null} { sleepStart (ms), sleepEnd (ms), totalMins, deepMins, remMins, coreMins, awakeMins }
 */
export function parseSleepSession(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    if (!data.sleepStart || !data.sleepEnd) return null;

    const sleepStart = new Date(data.sleepStart).getTime();
    const sleepEnd = new Date(data.sleepEnd).getTime();
    if (isNaN(sleepStart) || isNaN(sleepEnd)) return null;

    const pTotal = data.totalSleep || 0;
    const pDeep = data.deep || 0;
    const pRem = data.rem || 0;
    const pCore = data.core || 0;
    const pAwake = data.awake || 0;
    const pAsleep = data.asleep || 0;

    // Include awake time in total (same logic as health-webhook.js)
    let totalMins = 0;
    if (pTotal > 0) totalMins = (pTotal + pAwake) * 60;
    else if (pAsleep > 0) totalMins = (pAsleep + pAwake) * 60;
    else totalMins = (pDeep + pRem + pCore + pAwake) * 60;

    return {
      sleepStart,
      sleepEnd,
      totalMins,
      deepMins: pDeep * 60,
      remMins: pRem * 60,
      coreMins: pCore * 60,
      awakeMins: pAwake * 60,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the local date (YYYY-MM-DD) from a timestamp string that includes timezone offset.
 * Format: "2026-01-28 20:53:08 -0500"
 * 
 * This is needed because `new Date().getDate()` returns the date in the SERVER's timezone,
 * but we want the date in the ORIGINAL timezone (Eastern Time from Apple Health data).
 * On Vercel (UTC), 8:53 PM ET on Jan 28 = 1:53 AM UTC on Jan 29, which would be wrong.
 *
 * @param {string} timestampStr - Timestamp with timezone like "2026-01-28 20:53:08 -0500"
 * @returns {string|null} Local date as "YYYY-MM-DD" or null if parsing fails
 */
function extractLocalDateFromTimestamp(timestampStr) {
  if (!timestampStr) return null;

  // Pattern: "YYYY-MM-DD HH:mm:ss +/-HHMM"
  const regex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/;
  const match = timestampStr.match(regex);

  if (match) {
    // The date portion of the string IS the local date (no conversion needed)
    // "2026-01-28 20:53:08 -0500" means 8:53 PM on Jan 28 in ET, so the local date is Jan 28
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  // Fallback: Try to parse as Date and use its UTC representation
  // This won't be timezone-aware but is better than nothing
  const d = new Date(timestampStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a sleep_stage row's rawData JSON into a stage object.
 * Granular sleep data with exact start/end times per stage.
 *
 * @param {string} rawDataStr - JSON string from Health_Hourly column I
 * @returns {Object|null} { startDate (ms), endDate (ms), stage, durationMins, endDateStr }
 */
export function parseSleepStage(rawDataStr) {
  if (!rawDataStr) return null;
  try {
    const data = JSON.parse(rawDataStr);
    if (!data.startDate || !data.endDate) return null;

    const startDate = new Date(data.startDate).getTime();
    const endDate = new Date(data.endDate).getTime();
    if (isNaN(startDate) || isNaN(endDate)) return null;

    return {
      startDate,
      endDate,
      endDateStr: data.endDate, // Keep original string for timezone-aware date extraction
      stage: data.stage || 'unknown',
      durationMins: data.durationMins || ((endDate - startDate) / 60000),
    };
  } catch {
    return null;
  }
}

/**
 * Check if a stage should be counted as sleep (not awake/inBed).
 * Valid sleep stages: asleepDeep, asleepREM, asleepCore, asleep
 */
function isSleepStage(stage) {
  if (!stage) return false;
  const s = stage.toLowerCase();
  return s.includes('asleep') || s === 'deep' || s === 'rem' || s === 'core';
}

/**
 * Map a stage string to its category for breakdown.
 * Returns 'deep', 'rem', 'core', or 'other' (for generic 'asleep')
 */
function categorizeStage(stage) {
  if (!stage) return 'other';
  const s = stage.toLowerCase();
  if (s.includes('deep')) return 'deep';
  if (s.includes('rem')) return 'rem';
  if (s.includes('core')) return 'core';
  return 'other'; // Generic 'asleep' without specific stage
}

/**
 * Compute validated sleep totals from raw Health_Hourly rows for a set of dates.
 * 
 * NEW BEHAVIOR (Session 57):
 * - Prefers granular `sleep_stage` data when available (more accurate)
 * - Excludes "awake" stages from sleep totals
 * - Falls back to OLD `sleep_analysis` algorithm when no granular data exists
 *
 * @param {Array} hourlyRows - Raw Health_Hourly rows [timestamp, date, hour, metric, value, min, max, source, rawData]
 * @param {Function} isInRangeFn - (dateStr) => boolean, filters rows to target date range
 * @param {Function} parseDateFn - (dateStr) => ISO date string (YYYY-MM-DD)
 * @returns {Object} { [isoDate]: { totalMin, deepMin, remMin, coreMin, awakeMin } }
 */
export function computeValidatedSleepByDate(hourlyRows, isInRangeFn, parseDateFn) {
  // Collect sleep data by date: granular stages, aggregated sessions, HR, steps
  const granularByDate = {};  // NEW: sleep_stage rows
  const sleepByDate = {};     // OLD: sleep_analysis rows
  const hrByDate = {};
  const stepsByDate = {};
  const seenStageKeys = new Set(); // For deduplicating sleep_stage entries

  for (const row of hourlyRows) {
    const dateStr = row[1];
    const metric = row[3];
    const rawDataStr = row[8] || '';

    // Handle sleep_stage separately - filter by STAGE END DATE, not row date
    // This ensures overnight sleep (starts Jan 27, ends Jan 28) counts for Jan 28
    if (metric === 'sleep_stage') {
      const stage = parseSleepStage(rawDataStr);
      if (stage) {
        // Deduplicate: create unique key from startTime + endTime + stage
        const stageKey = `${stage.startDate}-${stage.endDate}-${stage.stage}`;
        if (seenStageKeys.has(stageKey)) continue; // Skip duplicate
        seenStageKeys.add(stageKey);

        // Attribute sleep to the date the stage ENDS on (using original timezone)
        // Use the original timestamp string to extract the local date, avoiding server timezone issues
        const stageIsoDate = extractLocalDateFromTimestamp(stage.endDateStr);
        // Only include if the END date is in the requested range
        if (isInRangeFn(stageIsoDate)) {
          if (!granularByDate[stageIsoDate]) granularByDate[stageIsoDate] = [];
          granularByDate[stageIsoDate].push(stage);
        }
      }
      continue; // Skip the standard row-date filtering below
    }

    // For all other metrics, use standard row date filtering
    if (!isInRangeFn(dateStr)) continue;

    const isoDate = parseDateFn(dateStr);
    if (!isoDate) continue;

    if (metric === 'sleep_analysis') {
      // OLD aggregated sleep session data
      const session = parseSleepSession(rawDataStr);
      if (session) {
        if (!sleepByDate[isoDate]) sleepByDate[isoDate] = [];
        sleepByDate[isoDate].push(session);
      }
    } else if (metric === 'heart_rate') {
      try {
        const raw = rawDataStr ? JSON.parse(rawDataStr) : {};
        if (raw.date) {
          const ts = new Date(raw.date).getTime();
          if (!isNaN(ts)) {
            if (!hrByDate[isoDate]) hrByDate[isoDate] = [];
            hrByDate[isoDate].push({ ts, bpm: raw.Avg ?? raw.avg ?? parseFloat(row[4]) });
          }
        }
      } catch { /* skip */ }
    } else if (metric === 'step_count') {
      try {
        const raw = rawDataStr ? JSON.parse(rawDataStr) : {};
        if (raw.date) {
          const ts = new Date(raw.date).getTime();
          if (!isNaN(ts)) {
            if (!stepsByDate[isoDate]) stepsByDate[isoDate] = [];
            stepsByDate[isoDate].push({ ts, qty: raw.qty ?? parseFloat(row[4]) ?? 0 });
          }
        }
      } catch { /* skip */ }
    }
  }

  // Merge all dates from both granular and aggregated sources
  const allDates = new Set([...Object.keys(granularByDate), ...Object.keys(sleepByDate)]);
  const result = {};

  for (const isoDate of allDates) {
    const granularStages = granularByDate[isoDate] || [];
    const aggregatedSessions = sleepByDate[isoDate] || [];

    // Calculate day boundaries for clipping overnight stages
    // IMPORTANT: Sleep timestamps are in ET (e.g., "2026-01-28 20:36:36 -0500").
    // JavaScript parses these to UTC (adding the offset).
    // So "2026-01-28 00:00:00 -0500" -> UTC timestamp is 5 AM on Jan 28.
    // We need day boundaries in UTC that represent midnight-to-midnight ET.
    //
    // For ET (-0500): dayStart = midnight ET = 05:00 UTC
    //                 dayEnd = 23:59:59 ET = 04:59:59 UTC next day
    // Note: This assumes standard time (-0500). DST (-0400) would shift by 1 hour.
    // For simplicity, we use EST (-0500) consistently.
    const [year, month, day] = isoDate.split('-').map(Number);
    const ET_OFFSET_MS = 5 * 60 * 60 * 1000; // ET is UTC-5, so midnight ET = 5 AM UTC
    const dayStartUTC = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + ET_OFFSET_MS;
    const dayEndUTC = Date.UTC(year, month - 1, day, 23, 59, 59, 999) + ET_OFFSET_MS;

    let totalMin = 0, deepMin = 0, remMin = 0, coreMin = 0, awakeMin = 0;

    if (granularStages.length > 0) {
      // NEW PATH: Use granular sleep_stage data (preferred)
      // Clip each stage to day boundaries to handle overnight sleep correctly
      for (const stage of granularStages) {
        const category = categorizeStage(stage.stage);

        // Clip stage to this day's boundaries (same logic as Single Day)
        const sStart = Math.max(stage.startDate, dayStartUTC);
        const sEnd = Math.min(stage.endDate, dayEndUTC);
        if (sStart >= sEnd) continue;

        // Calculate clipped duration in minutes
        const clippedMins = (sEnd - sStart) / 60000;

        if (isSleepStage(stage.stage)) {
          // Count as sleep (using clipped duration)
          totalMin += clippedMins;
          if (category === 'deep') deepMin += clippedMins;
          else if (category === 'rem') remMin += clippedMins;
          else if (category === 'core') coreMin += clippedMins;
          else {
            // 'other' (generic asleep without specific stage) - add to core for bar chart
            // This ensures stacked bar (deep+rem+core+awake) matches total
            coreMin += clippedMins;
          }
        } else if (stage.stage && stage.stage.toLowerCase().includes('awake')) {
          // Track awake for informational purposes but don't add to total
          awakeMin += clippedMins;
        }
        // Skip 'inBed' entirely
      }
    } else if (aggregatedSessions.length > 0) {
      // OLD PATH: Fall back to aggregated sleep_analysis with cluster validation
      const hrReadings = hrByDate[isoDate] || [];
      const stepReadings = stepsByDate[isoDate] || [];
      const clusters = clusterSleepSessions(aggregatedSessions);

      for (const cluster of clusters) {
        const best = findBestSessionInCluster(cluster, hrReadings, stepReadings);
        // OLD algorithm included awake in totalMins; we now exclude it
        const sleepOnlyMins = best.totalMins - best.awakeMins;
        totalMin += sleepOnlyMins > 0 ? sleepOnlyMins : 0;
        deepMin += best.deepMins;
        remMin += best.remMins;
        coreMin += best.coreMins;
        awakeMin += best.awakeMins;
      }
    }

    result[isoDate] = {
      totalMin: Math.round(totalMin),
      deepMin: Math.round(deepMin),
      remMin: Math.round(remMin),
      coreMin: Math.round(coreMin),
      awakeMin: Math.round(awakeMin),
    };
  }

  return result;
}
