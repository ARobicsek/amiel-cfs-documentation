/**
 * validate_sleep_sessions.js
 *
 * Reads new_hourly.txt and analyzes each sleep_analysis session by checking
 * HR and step data during the session's time range. Determines whether the
 * parent (broadest) or child (innermost) session better represents actual sleep.
 *
 * Usage: node scripts/validate_sleep_sessions.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hourlyPath = join(__dirname, '..', 'docs', 'new_hourly.txt');

// --- Parse the hourly data file ---
const lines = readFileSync(hourlyPath, 'utf8').split('\n');
const header = lines[0].split('\t');
const rows = [];

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split('\t');
  if (cols.length < 5) continue;
  rows.push({
    timestamp: cols[0],
    date: cols[1],
    hour: parseInt(cols[2], 10),
    metric: cols[3],
    value: parseFloat(cols[4]),
    rawData: cols[8] || '',
  });
}

// --- Parse timestamps ---
function parseTS(str) {
  if (!str) return null;
  // "2026-01-28 06:49:53 -0500" format
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}${m[8]}:${m[9]}`;
    return new Date(iso);
  }
  // "1/28/2026, 11:41:10 PM" format
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseRawDate(rawStr) {
  try {
    const data = JSON.parse(rawStr);
    const dateStr = data.date || data.dateStr;
    return dateStr ? parseTS(dateStr) : null;
  } catch { return null; }
}

// --- Collect all sleep sessions ---
const sleepSessions = [];
for (const row of rows) {
  if (row.metric !== 'sleep_analysis') continue;
  try {
    const data = JSON.parse(row.rawData);
    if (!data.sleepStart || !data.sleepEnd) continue;
    const sleepStart = parseTS(data.sleepStart);
    const sleepEnd = parseTS(data.sleepEnd);
    if (!sleepStart || !sleepEnd) continue;
    sleepSessions.push({
      date: row.date,
      sleepStart,
      sleepEnd,
      totalSleepHrs: data.totalSleep || 0,
      totalSleepMin: (data.totalSleep || 0) * 60,
      awakeMin: (data.awake || 0) * 60,
      deepMin: (data.deep || 0) * 60,
      remMin: (data.rem || 0) * 60,
      coreMin: (data.core || 0) * 60,
      spanMin: (sleepEnd - sleepStart) / 60000,
    });
  } catch { continue; }
}

// --- Collect all HR readings and step readings with timestamps ---
const hrReadings = [];
const stepReadings = [];

for (const row of rows) {
  if (row.metric === 'heart_rate') {
    const ts = parseRawDate(row.rawData);
    if (ts && !isNaN(row.value)) {
      hrReadings.push({ ts, bpm: row.value });
    }
  } else if (row.metric === 'step_count') {
    const ts = parseRawDate(row.rawData);
    let qty = row.value;
    try {
      const data = JSON.parse(row.rawData);
      qty = data.qty ?? row.value;
    } catch {}
    if (ts && !isNaN(qty)) {
      stepReadings.push({ ts, qty });
    }
  }
}

hrReadings.sort((a, b) => a.ts - b.ts);
stepReadings.sort((a, b) => a.ts - b.ts);

// --- For each time range, compute "awake evidence" score ---
// Normalized by duration so long sleep periods aren't penalized for sparse movements.
function analyzeTimeRange(startMs, endMs) {
  const hrs = hrReadings.filter(r => r.ts >= startMs && r.ts < endMs);
  const steps = stepReadings.filter(r => r.ts >= startMs && r.ts < endMs);

  const spanMin = (endMs - startMs) / 60000;
  const totalSteps = steps.reduce((sum, s) => sum + s.qty, 0);
  const significantSteps = steps.filter(s => s.qty > 2);
  const avgHR = hrs.length > 0 ? hrs.reduce((s, r) => s + r.bpm, 0) / hrs.length : null;
  const maxHR = hrs.length > 0 ? Math.max(...hrs.map(r => r.bpm)) : null;

  // Normalized rates
  const stepsPerHour = spanMin > 0 ? (totalSteps / spanMin) * 60 : 0;
  const sigStepsPerHour = spanMin > 0 ? (significantSteps.length / spanMin) * 60 : 0;

  // Awake indicators (time-normalized):
  // - avgHR > 70: elevated for a resting person
  // - maxHR > 85: spike indicating sustained activity
  // - sigStepsPerHour > 1: more than 1 significant step burst per hour
  // - stepsPerHour > 20: meaningful walking per hour
  const awakeScore =
    (avgHR && avgHR > 70 ? 2 : 0) +
    (maxHR && maxHR > 85 ? 1 : 0) +
    (sigStepsPerHour > 1 ? 2 : 0) +
    (stepsPerHour > 20 ? 2 : 0);

  return {
    spanMin: Math.round(spanMin),
    hrCount: hrs.length,
    avgHR: avgHR ? Math.round(avgHR * 10) / 10 : null,
    maxHR,
    stepCount: steps.length,
    significantSteps: significantSteps.length,
    totalSteps: Math.round(totalSteps),
    stepsPerHour: Math.round(stepsPerHour * 10) / 10,
    sigStepsPerHour: Math.round(sigStepsPerHour * 10) / 10,
    awakeScore,  // 0 = likely asleep, 7 = definitely awake
  };
}

// --- Group sessions into overlapping clusters ---
function clusterSessions(sessions) {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => a.sleepStart - b.sleepStart);
  const clusters = [];
  let current = [sorted[0]];
  let clusterEnd = sorted[0].sleepEnd.getTime();

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].sleepStart.getTime() < clusterEnd) {
      current.push(sorted[i]);
      clusterEnd = Math.max(clusterEnd, sorted[i].sleepEnd.getTime());
    } else {
      clusters.push(current);
      current = [sorted[i]];
      clusterEnd = sorted[i].sleepEnd.getTime();
    }
  }
  clusters.push(current);
  return clusters;
}

// --- Analyze ---
const clusters = clusterSessions(sleepSessions);

console.log('='.repeat(100));
console.log('SLEEP SESSION VALIDATION REPORT');
console.log('='.repeat(100));

for (const cluster of clusters) {
  if (cluster.length === 1) {
    // Single session - no parent/child ambiguity
    const s = cluster[0];
    const analysis = analyzeTimeRange(s.sleepStart.getTime(), s.sleepEnd.getTime());
    console.log(`\n--- Single Session (${s.date}) ---`);
    console.log(`  ${fmtDT(s.sleepStart)} → ${fmtDT(s.sleepEnd)} (${Math.round(s.spanMin)}min span, ${Math.round(s.totalSleepMin)}min sleep)`);
    console.log(`  HR: avg=${analysis.avgHR}, max=${analysis.maxHR}, count=${analysis.hrCount}`);
    console.log(`  Steps: total=${analysis.totalSteps}, significant=${analysis.significantSteps}`);
    console.log(`  Awake score: ${analysis.awakeScore}/7 ${analysis.awakeScore >= 3 ? '⚠ LIKELY AWAKE' : '✓ Looks like sleep'}`);
    continue;
  }

  // Multi-session cluster
  const sorted = [...cluster].sort((a, b) => (b.sleepEnd - b.sleepStart) - (a.sleepEnd - a.sleepStart));
  const parent = sorted[0];
  const innermost = sorted[sorted.length - 1];

  // Check if truly nested (earliest start contains latest end)
  const byStart = [...cluster].sort((a, b) => a.sleepStart - b.sleepStart);
  const isNested = byStart[0].sleepEnd.getTime() >= byStart[byStart.length - 1].sleepEnd.getTime();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`CLUSTER (${parent.date}): ${cluster.length} ${isNested ? 'nested' : 'sequential'} sessions`);
  console.log(`${'='.repeat(80)}`);

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const label = i === 0 ? 'PARENT (broadest)' : i === sorted.length - 1 ? 'INNERMOST (narrowest)' : `MIDDLE #${i}`;
    const analysis = analyzeTimeRange(s.sleepStart.getTime(), s.sleepEnd.getTime());
    console.log(`\n  [${label}]`);
    console.log(`    ${fmtDT(s.sleepStart)} → ${fmtDT(s.sleepEnd)}`);
    console.log(`    Span: ${Math.round(s.spanMin)}min | totalSleep: ${Math.round(s.totalSleepMin)}min | awake: ${Math.round(s.awakeMin)}min | deep: ${Math.round(s.deepMin)}min | rem: ${Math.round(s.remMin)}min`);
    console.log(`    HR: avg=${analysis.avgHR}, max=${analysis.maxHR}, readings=${analysis.hrCount}`);
    console.log(`    Steps: total=${analysis.totalSteps} (${analysis.stepsPerHour}/hr), sigSteps=${analysis.significantSteps} (${analysis.sigStepsPerHour}/hr)`);
    console.log(`    Awake score: ${analysis.awakeScore}/7`);
  }

  if (!isNested) {
    // Sequential sessions — pick longest by totalSleepMin
    let bestSession = cluster[0];
    for (let i = 1; i < cluster.length; i++) {
      if (cluster[i].totalSleepMin > bestSession.totalSleepMin) bestSession = cluster[i];
    }
    console.log(`\n  VERDICT (sequential — pick longest by totalSleep):`);
    console.log(`    → Best session: ${fmtDT(bestSession.sleepStart)} → ${fmtDT(bestSession.sleepEnd)}`);
    console.log(`    → Recommended sleep total: ${Math.round(bestSession.totalSleepMin + bestSession.awakeMin)}min`);
    console.log(`    → Apple totalSleep: ${Math.round(bestSession.totalSleepMin)}min, awake: ${Math.round(bestSession.awakeMin)}min`);
    continue;
  }

  // Analyze each layer's EXCLUSIVE region (from layer start to next-inner layer start).
  // Walk from INNERMOST outward, expanding as long as each gap looks like sleep.
  // Stop expanding when a gap shows awake activity.
  console.log(`\n  --- Layer-by-layer exclusive region analysis ---`);
  let bestSession = sorted[sorted.length - 1]; // start with innermost
  // Walk from inner to outer (i goes from length-2 down to 0)
  for (let i = sorted.length - 2; i >= 0; i--) {
    const outer = sorted[i];
    const inner = sorted[i + 1];
    if (outer.sleepStart.getTime() >= inner.sleepStart.getTime()) continue;

    const exclSpan = Math.round((inner.sleepStart - outer.sleepStart) / 60000);
    const outerLabel = i === 0 ? 'PARENT' : `MIDDLE #${i}`;
    const innerLabel = i + 1 === sorted.length - 1 ? 'INNERMOST' : `MIDDLE #${i + 1}`;

    const exclAnalysis = analyzeTimeRange(outer.sleepStart.getTime(), inner.sleepStart.getTime());
    const exclSpanHours = exclSpan / 60;

    console.log(`\n  [${outerLabel} → ${innerLabel} exclusive gap]`);
    console.log(`    ${fmtDT(outer.sleepStart)} → ${fmtDT(inner.sleepStart)} (${exclSpan}min)`);
    console.log(`    HR: avg=${exclAnalysis.avgHR}, max=${exclAnalysis.maxHR}, readings=${exclAnalysis.hrCount}`);
    console.log(`    Steps: total=${exclAnalysis.totalSteps} (${exclAnalysis.stepsPerHour}/hr), sigSteps=${exclAnalysis.significantSteps} (${exclAnalysis.sigStepsPerHour}/hr)`);

    // Sparse HR data = inconclusive (likely cross-midnight gap with missing data)
    if (exclSpan > 30 && exclAnalysis.hrCount < exclSpanHours * 2) {
      console.log(`    Awake score: N/A — sparse HR data (${exclAnalysis.hrCount} readings for ${exclSpan}min gap), stop expanding`);
      break;
    }

    console.log(`    Awake score: ${exclAnalysis.awakeScore}/7 ${exclAnalysis.awakeScore >= 3 ? '⚠ AWAKE' : '✓ SLEEP'}`);

    if (exclAnalysis.awakeScore < 3) {
      // Gap looks like sleep → expand outward to this session
      bestSession = outer;
    } else {
      // Gap shows awake activity → stop expanding, inner session is the boundary
      break;
    }
  }

  console.log(`\n  VERDICT (nested — HR/step validation):`);
  console.log(`    → Best session: ${fmtDT(bestSession.sleepStart)} → ${fmtDT(bestSession.sleepEnd)}`);
  console.log(`    → Recommended sleep total: ${Math.round(bestSession.totalSleepMin + bestSession.awakeMin)}min`);
  console.log(`    → Apple totalSleep: ${Math.round(bestSession.totalSleepMin)}min, awake: ${Math.round(bestSession.awakeMin)}min`);
}

function fmtDT(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
}

console.log('\n' + '='.repeat(100));
console.log('END OF REPORT');
console.log('='.repeat(100));
