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
 * Compute validated sleep totals from raw Health_Hourly rows for a set of dates.
 *
 * @param {Array} hourlyRows - Raw Health_Hourly rows [timestamp, date, hour, metric, value, min, max, source, rawData]
 * @param {Function} isInRangeFn - (dateStr) => boolean, filters rows to target date range
 * @param {Function} parseDateFn - (dateStr) => ISO date string (YYYY-MM-DD)
 * @returns {Object} { [isoDate]: { totalMin, deepMin, remMin, coreMin, awakeMin } }
 */
export function computeValidatedSleepByDate(hourlyRows, isInRangeFn, parseDateFn) {
  // Collect sleep sessions, HR readings, and step readings per date
  const sleepByDate = {};
  const hrByDate = {};
  const stepsByDate = {};

  for (const row of hourlyRows) {
    const dateStr = row[1];
    if (!isInRangeFn(dateStr)) continue;

    const isoDate = parseDateFn(dateStr);
    if (!isoDate) continue;

    const metric = row[3];
    const rawDataStr = row[8] || '';

    if (metric === 'sleep_analysis') {
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

  // Validate each date's sleep sessions
  const result = {};
  for (const isoDate of Object.keys(sleepByDate)) {
    const sessions = sleepByDate[isoDate];
    const hrReadings = hrByDate[isoDate] || [];
    const stepReadings = stepsByDate[isoDate] || [];

    const clusters = clusterSleepSessions(sessions);
    let totalMin = 0, deepMin = 0, remMin = 0, coreMin = 0, awakeMin = 0;

    for (const cluster of clusters) {
      const best = findBestSessionInCluster(cluster, hrReadings, stepReadings);
      totalMin += best.totalMins;
      deepMin += best.deepMins;
      remMin += best.remMins;
      coreMin += best.coreMins;
      awakeMin += best.awakeMins;
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
