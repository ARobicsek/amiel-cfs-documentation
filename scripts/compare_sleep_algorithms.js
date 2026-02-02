/**
 * compare_sleep_algorithms.js (v4 - CORRECT DATA SOURCES)
 *
 * Compares OLD vs NEW sleep detection algorithms for January 24 – February 1, 2026.
 *
 * OLD algorithm: Uses new_hourly.txt (aggregated sleep_analysis sessions)
 * NEW algorithm: Uses new_hourly_2.txt (granular sleep_stage data from Session 55)
 *
 * Usage: node scripts/compare_sleep_algorithms.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../docs');

// Separate data sources for each algorithm
const oldDataFile = path.join(docsDir, 'new_hourly.txt');   // OLD: aggregated sessions
const newDataFile = path.join(docsDir, 'new_hourly_2.txt'); // NEW: granular stages

function readTSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
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
    return rows;
}

const oldRows = readTSV(oldDataFile);
const newRows = readTSV(newDataFile);

// Target date range: Jan 24 – Feb 1, 2026
const targetDates = [
    '1/24/2026', '1/25/2026', '1/26/2026', '1/27/2026',
    '1/28/2026', '1/29/2026', '1/30/2026', '1/31/2026', '2/1/2026'
];

// --- Timestamp parsing ---
function parseTS(str) {
    if (!str) return null;
    const regex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/;
    const match = str.match(regex);
    if (match) {
        const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}${match[8]}:${match[9]}`;
        const d = new Date(iso);
        if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function parseRawDate(rawStr) {
    try {
        const data = JSON.parse(rawStr);
        return parseTS(data.date) || parseTS(data.dateStr);
    } catch { return null; }
}

// --- Collect HR and step readings from OLD data (for awake scoring) ---
const hrReadings = [];
const stepReadings = [];

for (const row of oldRows) {
    if (row.metric === 'heart_rate') {
        const ts = parseRawDate(row.rawData);
        let bpm = row.value;
        try {
            const data = JSON.parse(row.rawData);
            bpm = data.Avg ?? data.avg ?? data.qty ?? row.value;
        } catch { }
        if (ts && !isNaN(bpm)) hrReadings.push({ ts: ts.getTime(), bpm });
    } else if (row.metric === 'step_count') {
        const ts = parseRawDate(row.rawData);
        let qty = row.value;
        try {
            const data = JSON.parse(row.rawData);
            qty = data.qty ?? row.value;
        } catch { }
        if (ts && !isNaN(qty)) stepReadings.push({ ts: ts.getTime(), qty });
    }
}

hrReadings.sort((a, b) => a.ts - b.ts);
stepReadings.sort((a, b) => a.ts - b.ts);

// --- OLD Algorithm: Collect aggregated sleep_analysis sessions ---
const sleepSessions = [];
for (const row of oldRows) {
    if (row.metric !== 'sleep_analysis') continue;
    try {
        const data = JSON.parse(row.rawData);
        if (!data.sleepStart || !data.sleepEnd) continue;
        const sleepStart = parseTS(data.sleepStart);
        const sleepEnd = parseTS(data.sleepEnd);
        if (!sleepStart || !sleepEnd) continue;

        const windowDurationMin = (sleepEnd - sleepStart) / 60000;

        sleepSessions.push({
            date: row.date,
            sleepStart,
            sleepEnd,
            windowDurationMin,
            totalSleepMin: (data.totalSleep ?? 0) * 60,
            awakeMin: (data.awake ?? 0) * 60,
            deepMin: (data.deep ?? 0) * 60,
            remMin: (data.rem ?? 0) * 60,
            coreMin: (data.core ?? 0) * 60,
        });
    } catch { }
}

// --- NEW Algorithm: Collect granular sleep_stage records ---
const sleepStages = [];
for (const row of newRows) {
    if (row.metric !== 'sleep_stage') continue;
    try {
        const data = JSON.parse(row.rawData);
        const start = parseTS(data.sleepStart || data.startDate);
        const end = parseTS(data.sleepEnd || data.endDate);
        const stage = data.sleepStage || data.stage || data.value || 'unknown';
        if (!start || !end) continue;
        sleepStages.push({
            date: row.date,
            start,
            end,
            stage,
            durationMin: (end - start) / 60000,
        });
    } catch { }
}

console.log('Data loaded:');
console.log(`  OLD (new_hourly.txt): ${sleepSessions.length} aggregated sessions, ${hrReadings.length} HR, ${stepReadings.length} steps`);
console.log(`  NEW (new_hourly_2.txt): ${sleepStages.length} granular sleep_stage records`);
console.log();

// --- Awake scoring ---
function computeAwakeScore(startMs, endMs) {
    const hrs = hrReadings.filter(r => r.ts >= startMs && r.ts < endMs);
    const steps = stepReadings.filter(r => r.ts >= startMs && r.ts < endMs);
    const spanMin = (endMs - startMs) / 60000;
    const spanHours = spanMin / 60;

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

// --- Cluster overlapping sessions ---
function clusterSessions(sessions) {
    if (sessions.length === 0) return [];
    const sorted = [...sessions].sort((a, b) => a.sleepStart - b.sleepStart);
    const clusters = [];
    let current = [sorted[0]];
    let currentEnd = sorted[0].sleepEnd.getTime();

    for (let i = 1; i < sorted.length; i++) {
        const s = sorted[i];
        if (s.sleepStart.getTime() <= currentEnd) {
            current.push(s);
            currentEnd = Math.max(currentEnd, s.sleepEnd.getTime());
        } else {
            clusters.push(current);
            current = [s];
            currentEnd = s.sleepEnd.getTime();
        }
    }
    clusters.push(current);
    return clusters;
}

// --- Find best session in nested cluster ---
function findBestSessionInCluster(cluster) {
    if (cluster.length === 1) return cluster[0];

    const sorted = [...cluster].sort((a, b) => a.sleepStart - b.sleepStart);
    const isNested = sorted.length >= 2 &&
        sorted[0].sleepEnd.getTime() >= sorted[sorted.length - 1].sleepEnd.getTime();

    if (!isNested) {
        return cluster.reduce((best, s) => s.windowDurationMin > best.windowDurationMin ? s : best);
    }

    const bySpan = [...cluster].sort((a, b) => b.windowDurationMin - a.windowDurationMin);
    let best = bySpan[bySpan.length - 1];

    for (let i = bySpan.length - 2; i >= 0; i--) {
        const outer = bySpan[i];
        const inner = bySpan[i + 1];
        if (outer.sleepStart.getTime() >= inner.sleepStart.getTime()) continue;

        const score = computeAwakeScore(outer.sleepStart.getTime(), inner.sleepStart.getTime());
        if (score < 3) {
            best = outer;
        } else {
            break;
        }
    }
    return best;
}

// --- Process OLD algorithm ---
function processOldAlgorithm(dateStr) {
    const dateSessions = sleepSessions.filter(s => {
        const endDate = `${s.sleepEnd.getMonth() + 1}/${s.sleepEnd.getDate()}/${s.sleepEnd.getFullYear()}`;
        return endDate === dateStr;
    });

    if (dateSessions.length === 0) return null;

    const clusters = clusterSessions(dateSessions);
    const validatedSessions = clusters.map(c => findBestSessionInCluster(c));

    let totalMins = 0;
    for (const s of validatedSessions) {
        totalMins += s.windowDurationMin;
    }

    return {
        totalMins: Math.round(totalMins),
        sessionCount: validatedSessions.length,
        sessions: validatedSessions,
    };
}

// --- Process NEW algorithm ---
function processNewAlgorithm(dateStr) {
    const dateStages = sleepStages.filter(s => {
        const endDate = `${s.end.getMonth() + 1}/${s.end.getDate()}/${s.end.getFullYear()}`;
        return endDate === dateStr;
    });

    if (dateStages.length === 0) return null;

    let totalMins = 0;
    let deepMins = 0, remMins = 0, coreMins = 0, awakeMins = 0, asleepMins = 0;

    for (const s of dateStages) {
        totalMins += s.durationMin;
        const stageLower = s.stage.toLowerCase();
        if (stageLower.includes('deep')) deepMins += s.durationMin;
        else if (stageLower.includes('rem')) remMins += s.durationMin;
        else if (stageLower.includes('core')) coreMins += s.durationMin;
        else if (stageLower.includes('awake')) awakeMins += s.durationMin;
        else if (stageLower === 'asleep') asleepMins += s.durationMin;
    }

    return {
        totalMins: Math.round(totalMins),
        deepMins: Math.round(deepMins),
        remMins: Math.round(remMins),
        coreMins: Math.round(coreMins),
        awakeMins: Math.round(awakeMins),
        asleepMins: Math.round(asleepMins),
        stageCount: dateStages.length,
    };
}

// --- Format helpers ---
function fmtTime(d) {
    if (!d) return 'N/A';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtMins(m) {
    if (m === null || m === undefined || m === 0) return '—';
    const hrs = Math.floor(m / 60);
    const mins = Math.round(m % 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

// --- Run comparison ---
console.log('='.repeat(90));
console.log('SLEEP VALIDATION ALGORITHM COMPARISON');
console.log('OLD = Aggregated sessions from new_hourly.txt (pre-Session 55)');
console.log('NEW = Granular sleep_stage from new_hourly_2.txt (Session 55 fix)');
console.log('='.repeat(90));
console.log();

console.log('-'.repeat(70));
console.log('| Date       | OLD         | NEW         | Diff    | Status   |');
console.log('-'.repeat(70));

const results = [];

for (const dateStr of targetDates) {
    const oldResult = processOldAlgorithm(dateStr);
    const newResult = processNewAlgorithm(dateStr);

    const oldTotal = oldResult?.totalMins ?? 0;
    const newTotal = newResult?.totalMins ?? 0;
    const diff = newTotal - oldTotal;
    const diffStr = diff === 0 ? '—' : (diff > 0 ? `+${diff}m` : `${diff}m`);
    const absDiff = Math.abs(diff);
    const status = oldTotal === 0 && newTotal === 0 ? 'No data' :
        absDiff <= 15 ? '✓ Match' :
            absDiff <= 60 ? '~ Close' : '⚠ Check';

    console.log(
        `| ${dateStr.padEnd(10)} | ` +
        `${fmtMins(oldTotal).padEnd(11)} | ` +
        `${fmtMins(newTotal).padEnd(11)} | ` +
        `${diffStr.padEnd(7)} | ` +
        `${status.padEnd(8)} |`
    );

    results.push({ dateStr, oldResult, newResult, diff });
}

console.log('-'.repeat(70));
console.log();

// Detailed breakdown
console.log('='.repeat(90));
console.log('DETAILED BREAKDOWN');
console.log('='.repeat(90));

for (const { dateStr, oldResult, newResult } of results) {
    if (!oldResult && !newResult) continue;

    console.log(`\n--- ${dateStr} ---`);

    if (oldResult) {
        console.log(`  OLD: ${fmtMins(oldResult.totalMins)} (${oldResult.sessionCount} session(s))`);
        for (const s of oldResult.sessions) {
            console.log(`    ${fmtTime(s.sleepStart)} → ${fmtTime(s.sleepEnd)}`);
        }
    }

    if (newResult) {
        console.log(`  NEW: ${fmtMins(newResult.totalMins)} (${newResult.stageCount} stages)`);
        if (newResult.asleepMins > 0) console.log(`    Asleep (generic): ${fmtMins(newResult.asleepMins)}`);
        if (newResult.deepMins > 0) console.log(`    Deep: ${fmtMins(newResult.deepMins)}`);
        if (newResult.remMins > 0) console.log(`    REM: ${fmtMins(newResult.remMins)}`);
        if (newResult.coreMins > 0) console.log(`    Core: ${fmtMins(newResult.coreMins)}`);
        if (newResult.awakeMins > 0) console.log(`    Awake: ${fmtMins(newResult.awakeMins)}`);
    }
}

console.log('\n' + '='.repeat(90));
console.log('END OF REPORT');
console.log('='.repeat(90));
