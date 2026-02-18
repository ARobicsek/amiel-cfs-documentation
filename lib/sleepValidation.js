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
      startDateStr: data.startDate, // Needed for timezone-aware extraction
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

    // Handle sleep_stage separately - filter by STAGE DATES (Multi-Bucket)
    // Attribute sleep to ALL dates it overlaps with (e.g., if 23:00-07:00, add to both days)
    // The clipping logic below will handle calculating the correct duration for each day.
    // console.log(`Processing row: ${metric} ${dateStr} ${row[8]?.substring(0, 20)}`);
    if (metric === 'sleep_stage') {
      const stage = parseSleepStage(rawDataStr);
      // console.log(`Parsed stage:`, stage);
      if (stage) {
        // Deduplicate: create unique key from startTime + endTime + stage
        const stageKey = `${stage.startDate}-${stage.endDate}-${stage.stage}`;
        if (seenStageKeys.has(stageKey)) continue; // Skip duplicate
        seenStageKeys.add(stageKey);

        const startIso = extractLocalDateFromTimestamp(stage.startDateStr);
        const endIso = extractLocalDateFromTimestamp(stage.endDateStr);

        if (startIso && endIso) {
          // Add to all dates in range [startIso, endIso]
          let current = new Date(startIso);
          const end = new Date(endIso);

          let loopCount = 0;
          const maxLoops = 20;

          while (current <= end && loopCount < maxLoops) {
            const dateIso = current.toISOString().split('T')[0];
            console.log(`[SleepDebug] Assigning stage ${stageKey} to ${dateIso}`);
            // Only include if this date is in the requested range
            if (isInRangeFn(dateIso)) {
              if (!granularByDate[dateIso]) granularByDate[dateIso] = [];
              granularByDate[dateIso].push(stage);
            }
            current.setDate(current.getDate() + 1);
            loopCount++;
          }
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
    // Use exact next-day midnight (same as client-side dayEndMs = dayStartMs + 1440*60000)
    const dayEndUTC = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) + ET_OFFSET_MS;

    let totalMin = 0, deepMin = 0, remMin = 0, coreMin = 0, awakeMin = 0;

    if (granularStages.length > 0) {
      // NEW PATH: Use granular sleep_stage data (preferred).
      // Use minute-resolution Sets to count unique sleep minutes per category.
      // This correctly handles overlapping/duplicate stages from multiple data sources
      // (e.g., Apple Watch + iPhone both reporting the same sleep session with
      // slightly different timestamps that survive deduplication).
      const sleepMinSet = new Set();
      const deepMinSet = new Set();
      const remMinSet = new Set();
      const coreMinSet = new Set();
      const awakeMinSet = new Set();

      for (const stage of granularStages) {
        // Clip stage to this day's boundaries
        const sStart = Math.max(stage.startDate, dayStartUTC);
        const sEnd = Math.min(stage.endDate, dayEndUTC);
        if (sStart >= sEnd) continue;

        const startMin = Math.floor((sStart - dayStartUTC) / 60000);
        const endMin = Math.ceil((sEnd - dayStartUTC) / 60000);

        if (isSleepStage(stage.stage)) {
          const category = categorizeStage(stage.stage);
          for (let m = startMin; m < endMin && m < 1440; m++) {
            if (m >= 0) {
              sleepMinSet.add(m);
              if (category === 'deep') deepMinSet.add(m);
              else if (category === 'rem') remMinSet.add(m);
              else coreMinSet.add(m); // 'core' or 'other' (generic asleep)
            }
          }
        } else if (stage.stage && stage.stage.toLowerCase().includes('awake')) {
          for (let m = startMin; m < endMin && m < 1440; m++) {
            if (m >= 0) awakeMinSet.add(m);
          }
        }
        // Skip 'inBed' entirely
      }

      totalMin = sleepMinSet.size;
      deepMin = deepMinSet.size;
      remMin = remMinSet.size;
      coreMin = coreMinSet.size;
      awakeMin = awakeMinSet.size;
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

/**
 * Compute avg HR-Awake and HR-Asleep per date from raw Health_Hourly rows.
 *
 * Uses the same cross-midnight sleep stage attribution as computeValidatedSleepByDate,
 * so overnight sleep stages (stored under the previous day's date) correctly classify
 * early-morning HR readings as asleep — fixing the discrepancy between the single-day
 * summary and the multi-day graphs.
 *
 * @param {Array} hourlyRows - Raw Health_Hourly rows [timestamp, date, hour, metric, value, min, max, source, rawData]
 * @param {Function} isInRangeFn - (dateStr) => boolean, filters HR rows to target date range
 * @param {Function} parseDateFn - (dateStr) => YYYY-MM-DD string
 * @returns {Object} { [isoDate]: { avgHR_awake, avgHR_asleep } }
 */
export function computeHRAwakeAsleepByDate(hourlyRows, isInRangeFn, parseDateFn) {
  const sleepWindowsByDate = {};  // date -> [{ startMs, endMs }]
  const hrReadingsByDate = {};    // date -> [{ ts, bpm }]
  const seenStageKeys = new Set();

  for (const row of hourlyRows) {
    const dateStr = row[1];
    const metric = row[3];
    const rawDataStr = row[8] || '';

    if (metric === 'sleep_stage') {
      const stage = parseSleepStage(rawDataStr);
      if (!stage) continue;
      if (!isSleepStage(stage.stage)) continue; // Skip awake and inBed stages

      // Deduplicate exact duplicate stage uploads
      const key = `${stage.startDate}-${stage.endDate}-${stage.stage}`;
      if (seenStageKeys.has(key)) continue;
      seenStageKeys.add(key);

      // Attribute this stage's sleep window to all calendar dates it spans.
      // This is the key fix: an overnight stage starting on date N-1 and ending on
      // date N gets added to sleepWindowsByDate[N], so HR readings on date N that
      // fall within the stage's time range are correctly classified as asleep.
      const startIso = extractLocalDateFromTimestamp(stage.startDateStr);
      const endIso = extractLocalDateFromTimestamp(stage.endDateStr);
      if (!startIso || !endIso) continue;

      let current = new Date(startIso);
      const end = new Date(endIso);
      let loopCount = 0;
      while (current <= end && loopCount < 20) {
        const dateIso = current.toISOString().split('T')[0];
        if (!sleepWindowsByDate[dateIso]) sleepWindowsByDate[dateIso] = [];
        // Store the full (non-clipped) stage window — HR timestamps are absolute
        // so we compare them directly against the stage's full time range.
        sleepWindowsByDate[dateIso].push({ startMs: stage.startDate, endMs: stage.endDate });
        current.setDate(current.getDate() + 1);
        loopCount++;
      }
      continue;
    }

    // HR readings: collect only for dates in the requested range
    if (!isInRangeFn(dateStr)) continue;
    const isoDate = parseDateFn(dateStr);
    if (!isoDate) continue;

    if (metric === 'heart_rate') {
      try {
        const raw = rawDataStr ? JSON.parse(rawDataStr) : {};
        if (raw.date) {
          const ts = new Date(raw.date).getTime();
          const bpm = raw.Avg ?? raw.avg ?? parseFloat(row[4]);
          if (!isNaN(ts) && !isNaN(bpm)) {
            if (!hrReadingsByDate[isoDate]) hrReadingsByDate[isoDate] = [];
            hrReadingsByDate[isoDate].push({ ts, bpm });
          }
        }
      } catch { /* skip unparseable rows */ }
    }
  }

  // Classify each date's HR readings as awake or asleep
  const result = {};
  for (const [isoDate, hrReadings] of Object.entries(hrReadingsByDate)) {
    const sleepWindows = sleepWindowsByDate[isoDate] || [];

    let awakeSum = 0, awakeCount = 0;
    let asleepSum = 0, asleepCount = 0;

    for (const { ts, bpm } of hrReadings) {
      const isDuringSleep = sleepWindows.some(w => ts >= w.startMs && ts < w.endMs);
      if (isDuringSleep) {
        asleepSum += bpm;
        asleepCount++;
      } else {
        awakeSum += bpm;
        awakeCount++;
      }
    }

    result[isoDate] = {
      avgHR_awake: awakeCount > 0 ? Math.round(awakeSum / awakeCount) : null,
      avgHR_asleep: asleepCount > 0 ? Math.round(asleepSum / asleepCount) : null,
    };
  }

  return result;
}
