import { google } from 'googleapis';

// Helper to get Google Auth
function getGoogleAuth() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb', // Allow larger payloads for batch syncs
        },
    },
};

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Auth
    const webhookSecret = req.headers['x-webhook-secret'];
    const expectedSecret = process.env.ECG_WEBHOOK_SECRET?.trim(); // Reusing the secret for now
    if (!webhookSecret || webhookSecret !== expectedSecret) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    try {
        const data = req.body;
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const SHEET_ID = process.env.GOOGLE_SHEET_ID;

        // 1. FETCH EXISTING HOURLY DATA (For Deduplication & Re-aggregation)
        const hourlySheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Health_Hourly!A:I',
        });

        const existingHeader = hourlySheetRes.data.values?.[0] || [];
        const existingRows = hourlySheetRes.data.values?.slice(1) || [];

        // Build a Set of signatures for deduplication
        const existingSignatures = new Set();
        const rowsByDate = {};

        existingRows.forEach(row => {
            const rawJsonStr = row[8];
            let signature = '';
            try {
                if (rawJsonStr && rawJsonStr !== '{}') {
                    const raw = JSON.parse(rawJsonStr);
                    const metricName = row[3];
                    const val = row[4];
                    const src = row[7];
                    signature = `${raw.date || row[0]}_${metricName}_${val}_${src}`;
                } else {
                    signature = row.join('|');
                }
            } catch (e) {
                signature = row.join('|');
            }
            existingSignatures.add(signature);

            const dateStr = row[1];
            if (dateStr) {
                if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
                rowsByDate[dateStr].push(row);
            }
        });

        // 2. NORMALIZE & DEDUPLICATE INCOMING DATA
        const incomingData = normalizePayload(data);
        const newRows = [];
        const affectedDates = new Set();

        for (const item of incomingData) {
            let dateObj = new Date(item.date);

            // For Sleep Analysis, use sleepEnd if available
            if (item.name === 'sleep_analysis' && item.raw && item.raw.sleepEnd) {
                dateObj = new Date(item.raw.sleepEnd);
            }

            const dateStr = dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
            const hourStr = timeStr.split(':')[0];
            const timestampET = dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' });

            const signature = `${item.date}_${item.name}_${item.value}_${item.source || 'Auto'}`;

            if (existingSignatures.has(signature)) {
                continue;
            }

            const row = [
                timestampET,
                dateStr,
                hourStr,
                item.name,
                item.value,
                item.min !== undefined ? item.min : '',
                item.max !== undefined ? item.max : '',
                item.source || 'Auto',
                JSON.stringify(item.raw || {})
            ];

            newRows.push(row);
            existingSignatures.add(signature);

            if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
            rowsByDate[dateStr].push(row);

            affectedDates.add(dateStr);
        }

        // 3. APPEND NEW HOURLY ROWS
        if (newRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'Health_Hourly!A:I',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: newRows },
            });
        }

        // 4. RE-AGGREGATE DAILY STATS (For affected dates)
        // Health_Daily headers (row 1): Date, Steps, Avg HR, Resting HR, Min HR, Max HR,
        //   HRV, SleepDur, SleepEff, Deep, REM, LastUpdated, HRCount, HRVCount, AwakeMins
        const dailyUpdates = []; // Updates for existing rows
        const newDailyRows = []; // New date rows (will use append API)

        // Fetch Health_Daily dates — A2:A skips the header row.
        // This means index 0 = sheet row 2, index N = sheet row N+2.
        const dailySheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Health_Daily!A2:A',
        });
        const dailyDates = (dailySheetRes.data.values || []).map(r => r[0]);

        for (const dateStr of affectedDates) {
            const daysRows = rowsByDate[dateStr] || [];

            // --- Non-sleep stats ---
            let totalSteps = 0;
            let hrSum = 0;
            let hrCount = 0;
            let hrMin = null;
            let hrMax = null;
            let restingHrValues = [];
            let hrvSum = 0;
            let hrvCount = 0;
            const sleepSessions = []; // Collect sleep_analysis entries for overlap detection
            // Timestamped HR/step readings for sleep validation
            const tsHrReadings = [];
            const tsStepReadings = [];

            for (const row of daysRows) {
                const metric = row[3];
                const val = Number(row[4]);
                const rawJson = row[8] ? JSON.parse(row[8]) : {};

                if (metric === 'step_count' && !isNaN(val)) {
                    totalSteps += val;
                    // Collect timestamped step for sleep validation
                    if (rawJson.date) {
                        const ts = new Date(rawJson.date);
                        if (!isNaN(ts.getTime())) {
                            tsStepReadings.push({ ts: ts.getTime(), qty: rawJson.qty ?? val });
                        }
                    }
                } else if (metric === 'heart_rate' && !isNaN(val)) {
                    hrSum += val;
                    hrCount++;
                    const rowMin = row[5] !== '' ? Number(row[5]) : val;
                    const rowMax = row[6] !== '' ? Number(row[6]) : val;
                    if (hrMin === null || rowMin < hrMin) hrMin = rowMin;
                    if (hrMax === null || rowMax > hrMax) hrMax = rowMax;
                    // Collect timestamped HR for sleep validation
                    if (rawJson.date) {
                        const ts = new Date(rawJson.date);
                        if (!isNaN(ts.getTime())) {
                            tsHrReadings.push({ ts: ts.getTime(), bpm: rawJson.Avg ?? rawJson.avg ?? val });
                        }
                    }
                } else if (metric === 'resting_heart_rate' && !isNaN(val)) {
                    restingHrValues.push(val);
                } else if (metric === 'heart_rate_variability' && !isNaN(val)) {
                    hrvSum += val;
                    hrvCount++;
                } else if (metric === 'sleep_analysis') {
                    // Collect sleep sessions for overlap merging (processed after loop).
                    // Component data (deep/rem/core/awake) is extracted from the JSON here
                    // rather than from exploded sleep_deep/sleep_rem rows, to avoid
                    // double-counting when sessions overlap.
                    const pTotal = rawJson.totalSleep || 0;
                    const pDeep = rawJson.deep || 0;
                    const pRem = rawJson.rem || 0;
                    const pCore = rawJson.core || 0;
                    const pAwake = rawJson.awake || 0;
                    const pAsleep = rawJson.asleep || 0;

                    // Include awake time in sleep total — awake periods within
                    // a sleep session count as part of that session's duration.
                    let totalMins = 0;
                    if (pTotal > 0) totalMins = (pTotal + pAwake) * 60;
                    else if (pAsleep > 0) totalMins = (pAsleep + pAwake) * 60;
                    else totalMins = (pDeep + pRem + pCore + pAwake) * 60;

                    sleepSessions.push({
                        sleepStart: rawJson.sleepStart ? new Date(rawJson.sleepStart) : null,
                        sleepEnd: rawJson.sleepEnd ? new Date(rawJson.sleepEnd) : null,
                        totalMins,
                        deepMins: pDeep * 60,
                        remMins: pRem * 60,
                        coreMins: pCore * 60,
                        awakeMins: pAwake * 60
                    });
                } else if (metric === 'sleep_stage') {
                    // GRANULAR sleep stage data — each row is one sleep segment
                    // with exact start/end times. These are more accurate than session aggregates.
                    const stage = rawJson.stage || row[4]; // e.g., "asleepCore", "asleepDeep", "awake", "inBed"
                    const durationMins = rawJson.durationMins || 0;
                    const startDate = rawJson.startDate ? new Date(rawJson.startDate) : null;
                    const endDate = rawJson.endDate ? new Date(rawJson.endDate) : null;

                    // Track granular stages for building sleep windows
                    sleepSessions.push({
                        sleepStart: startDate,
                        sleepEnd: endDate,
                        totalMins: stage !== 'awake' && stage !== 'inBed' ? durationMins : 0,
                        deepMins: stage === 'asleepDeep' ? durationMins : 0,
                        remMins: stage === 'asleepREM' ? durationMins : 0,
                        coreMins: stage === 'asleepCore' ? durationMins : 0,
                        awakeMins: stage === 'awake' ? durationMins : 0,
                        isGranular: true  // Flag to identify granular data
                    });
                }
                // sleep_deep, sleep_rem, sleep_core, sleep_awake rows are intentionally
                // ignored for daily aggregation — component data comes from sleep_analysis
                // JSON above. This prevents double-counting with overlapping sessions.
            }

            // --- VALIDATE & MERGE OVERLAPPING SLEEP SESSIONS ---
            // Apple Watch records nested sleep_analysis entries per session.
            // For overlapping sessions, use HR/step data to determine which
            // session best represents actual sleep (innermost-outward walk).
            // Non-overlapping sessions (separate naps) are summed.
            let sleepMinutes = 0;
            let deepMinutes = 0;
            let remMinutes = 0;
            let awakeMinutes = 0;

            if (sleepSessions.length > 0) {
                // Check if we have granular sleep_stage data
                const hasGranular = sleepSessions.some(s => s.isGranular);

                if (hasGranular) {
                    // GRANULAR PATH: Simply sum all segments by stage type
                    // Granular data doesn't overlap — each segment is a distinct time period
                    for (const seg of sleepSessions) {
                        if (!seg.isGranular) continue; // Skip any session-level data if mixed
                        sleepMinutes += seg.totalMins || 0;
                        deepMinutes += seg.deepMins || 0;
                        remMinutes += seg.remMins || 0;
                        awakeMinutes += seg.awakeMins || 0;
                    }
                } else {
                    // AGGREGATED PATH: Existing cluster/overlap logic for session-level data
                    sleepSessions.sort((a, b) => {
                        if (!a.sleepStart) return -1;
                        if (!b.sleepStart) return 1;
                        return a.sleepStart - b.sleepStart;
                    });

                    // Cluster overlapping sessions
                    const clusters = [];
                    let currentCluster = [sleepSessions[0]];
                    let clusterEnd = sleepSessions[0].sleepEnd ? sleepSessions[0].sleepEnd.getTime() : 0;

                    for (let i = 1; i < sleepSessions.length; i++) {
                        const s = sleepSessions[i];
                        if (s.sleepStart && s.sleepStart.getTime() < clusterEnd) {
                            currentCluster.push(s);
                            if (s.sleepEnd) clusterEnd = Math.max(clusterEnd, s.sleepEnd.getTime());
                        } else {
                            clusters.push(currentCluster);
                            currentCluster = [s];
                            clusterEnd = s.sleepEnd ? s.sleepEnd.getTime() : 0;
                        }
                    }
                    clusters.push(currentCluster);

                    // For each cluster, find the best session using HR/step validation
                    for (const cluster of clusters) {
                        let best;
                        if (cluster.length === 1) {
                            best = cluster[0];
                        } else {
                            // Check if sessions are truly nested or sequential
                            const byStart = [...cluster].sort((a, b) =>
                                (a.sleepStart ? a.sleepStart.getTime() : 0) - (b.sleepStart ? b.sleepStart.getTime() : 0));
                            const isNested = byStart.length >= 2 && byStart[0].sleepEnd &&
                                byStart[byStart.length - 1].sleepEnd &&
                                byStart[0].sleepEnd.getTime() >= byStart[byStart.length - 1].sleepEnd.getTime();

                            if (!isNested) {
                                // Sequential — pick session with most totalMins
                                best = cluster[0];
                                for (let i = 1; i < cluster.length; i++) {
                                    if (cluster[i].totalMins > best.totalMins) best = cluster[i];
                                }
                            } else {
                                // Nested: sort by span (longest first)
                                const sorted = [...cluster].sort((a, b) => {
                                    const spanA = (a.sleepEnd ? a.sleepEnd.getTime() : 0) - (a.sleepStart ? a.sleepStart.getTime() : 0);
                                    const spanB = (b.sleepEnd ? b.sleepEnd.getTime() : 0) - (b.sleepStart ? b.sleepStart.getTime() : 0);
                                    return spanB - spanA;
                                });

                                // Walk from innermost outward, expanding while gaps look like sleep
                                best = sorted[sorted.length - 1];
                                for (let i = sorted.length - 2; i >= 0; i--) {
                                    const outer = sorted[i];
                                    const inner = sorted[i + 1];
                                    if (!outer.sleepStart || !inner.sleepStart) continue;
                                    if (outer.sleepStart.getTime() >= inner.sleepStart.getTime()) continue;

                                    // Compute awake score for the exclusive gap
                                    const gapStart = outer.sleepStart.getTime();
                                    const gapEnd = inner.sleepStart.getTime();
                                    const gapSpanMin = (gapEnd - gapStart) / 60000;
                                    const gapSpanHours = gapSpanMin / 60;

                                    const gapHR = tsHrReadings.filter(r => r.ts >= gapStart && r.ts < gapEnd);

                                    // Sparse HR data (>30min gap, <2 readings/hr) = inconclusive, don't expand
                                    if (gapSpanMin > 30 && gapHR.length < gapSpanHours * 2) break;

                                    const gapSteps = tsStepReadings.filter(r => r.ts >= gapStart && r.ts < gapEnd);
                                    const gapTotalSteps = gapSteps.reduce((sum, s) => sum + s.qty, 0);
                                    const gapSigSteps = gapSteps.filter(s => s.qty > 2);
                                    const gapAvgHR = gapHR.length > 0 ? gapHR.reduce((s, r) => s + r.bpm, 0) / gapHR.length : null;
                                    const gapMaxHR = gapHR.length > 0 ? Math.max(...gapHR.map(r => r.bpm)) : null;
                                    const stepsPerHour = gapSpanMin > 0 ? (gapTotalSteps / gapSpanMin) * 60 : 0;
                                    const sigStepsPerHour = gapSpanMin > 0 ? (gapSigSteps.length / gapSpanMin) * 60 : 0;

                                    const awakeScore =
                                        (gapAvgHR && gapAvgHR > 70 ? 2 : 0) +
                                        (gapMaxHR && gapMaxHR > 85 ? 1 : 0) +
                                        (sigStepsPerHour > 1 ? 2 : 0) +
                                        (stepsPerHour > 20 ? 2 : 0);

                                    if (awakeScore < 3) {
                                        best = outer; // Gap looks like sleep → expand
                                    } else {
                                        break; // Gap shows awake → stop
                                    }
                                }
                            }
                        }

                        sleepMinutes += best.totalMins;
                        deepMinutes += best.deepMins;
                        remMinutes += best.remMins;
                        awakeMinutes += best.awakeMins;
                    }
                }
            }

            // Finalize Aggregates
            const finalSteps = Math.round(totalSteps * 100) / 100;
            const finalAvgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : '';
            const finalRestingHr = restingHrValues.length > 0 ? restingHrValues[restingHrValues.length - 1] : '';
            const finalHrv = hrvCount > 0 ? (Math.round((hrvSum / hrvCount) * 10) / 10) : '';

            const finalSleepMin = Math.round(sleepMinutes);
            const finalDeep = Math.round(deepMinutes);
            const finalRem = Math.round(remMinutes);
            const finalAwake = Math.round(awakeMinutes);

            let finalEfficiency = '';
            if ((sleepMinutes + awakeMinutes) > 0) {
                finalEfficiency = Math.round((sleepMinutes / (sleepMinutes + awakeMinutes)) * 100) + '%';
            }

            // Find existing row for this date
            const matchingIndices = [];
            dailyDates.forEach((d, index) => {
                if (d && d.trim() === dateStr) {
                    matchingIndices.push(index);
                }
            });

            const rowValues = [
                dateStr,
                finalSteps,
                finalAvgHr,
                finalRestingHr,
                hrMin !== null ? hrMin : '',
                hrMax !== null ? hrMax : '',
                finalHrv,
                finalSleepMin !== 0 ? finalSleepMin : '',
                finalEfficiency,
                finalDeep !== 0 ? finalDeep : '',
                finalRem !== 0 ? finalRem : '',
                new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
                hrCount !== 0 ? hrCount : '',
                hrvCount !== 0 ? hrvCount : '',
                finalAwake !== 0 ? finalAwake : ''
            ];

            if (matchingIndices.length === 0) {
                // New date — use append API to avoid row index conflicts
                newDailyRows.push(rowValues);
            } else {
                // Existing row — update in place
                // index + 2 because we fetched A2:A (index 0 = sheet row 2)
                const sheetRow = matchingIndices[0] + 2;
                dailyUpdates.push({
                    range: `Health_Daily!A${sheetRow}:O${sheetRow}`,
                    values: [rowValues]
                });

                // Self-healing: clear any duplicate rows for this date
                if (matchingIndices.length > 1) {
                    for (let k = 1; k < matchingIndices.length; k++) {
                        const dupSheetRow = matchingIndices[k] + 2;
                        dailyUpdates.push({
                            range: `Health_Daily!A${dupSheetRow}:O${dupSheetRow}`,
                            values: [Array(15).fill('')]
                        });
                    }
                }
            }
        }

        // 5. BATCH UPDATE EXISTING DAILY ROWS
        if (dailyUpdates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: dailyUpdates.map(u => ({ range: u.range, values: u.values }))
                }
            });
        }

        // 6. APPEND NEW DAILY ROWS (avoids row index conflicts from concurrent requests)
        if (newDailyRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'Health_Daily!A:O',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: newDailyRows }
            });
        }

        // 7. SORT SHEETS by date descending (most recent first)
        await sortSheetByDateDesc(sheets, SHEET_ID, 'Health_Hourly', 9);
        await sortSheetByDateDesc(sheets, SHEET_ID, 'Health_Daily', 15);

        return res.status(200).json({
            success: true,
            processed: newRows.length,
            datesUpdated: Array.from(affectedDates)
        });

    } catch (error) {
        console.error('Health Webhook Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------
function normalizePayload(body) {
    const result = [];
    const metrics = body.data?.metrics || [];

    for (const metric of metrics) {
        const name = metric.name; // Keep original name
        if (!metric.data) continue;

        for (const point of metric.data) {
            let val = point.qty !== undefined ? point.qty : point.value;
            const date = point.date || point.startDate;
            let minVal, maxVal;

            if (name === 'heart_rate' && point.Avg !== undefined) {
                val = point.Avg;
                minVal = point.Min;
                maxVal = point.Max;
            }

            if (name.startsWith('sleep_') && name !== 'sleep_analysis') {
                if (point.startDate && point.endDate) {
                    const start = new Date(point.startDate);
                    const end = new Date(point.endDate);
                    val = (end - start) / 1000 / 60; // Minutes
                }
            }

            // Explode sleep_analysis into sub-metrics for hourly detail
            if (name === 'sleep_analysis') {
                // Check for GRANULAR sleep stage data (non-aggregated export)
                // Health Auto Export sends simple stage names: "Asleep", "Core", "REM", "Deep", "Awake", "InBed"
                const valStr = String(point.value || '');
                const granularStages = ['Asleep', 'Core', 'REM', 'Deep', 'Awake', 'InBed'];
                const isGranular = granularStages.includes(valStr) && point.startDate && point.endDate;

                if (isGranular) {
                    // Map the simple stage name to our internal format
                    // "Core" -> "asleepCore", "REM" -> "asleepREM", "Deep" -> "asleepDeep", 
                    // "Asleep" -> "asleep" (generic), "Awake" -> "awake", "InBed" -> "inBed"
                    let stage;
                    if (valStr === 'Core') stage = 'asleepCore';
                    else if (valStr === 'REM') stage = 'asleepREM';
                    else if (valStr === 'Deep') stage = 'asleepDeep';
                    else if (valStr === 'Asleep') stage = 'asleep';
                    else if (valStr === 'Awake') stage = 'awake';
                    else if (valStr === 'InBed') stage = 'inBed';
                    else stage = valStr.toLowerCase();

                    const startDt = new Date(point.startDate);
                    const endDt = new Date(point.endDate);
                    const durationMins = (endDt - startDt) / 1000 / 60;

                    const rawSource = point.sourceName || point.source || 'Auto';
                    const parsedSource = parseSource(rawSource, name);

                    // Store as sleep_stage metric with full timing info
                    result.push({
                        name: 'sleep_stage',
                        value: stage,  // e.g., "asleepCore", "asleepDeep", "awake", "inBed"
                        min: '',
                        max: '',
                        date: point.endDate,  // Use endDate as the primary timestamp (attributes to wake-up day)
                        source: parsedSource,
                        raw: {
                            stage,
                            startDate: point.startDate,
                            endDate: point.endDate,
                            durationMins: Math.round(durationMins * 100) / 100,
                            source: parsedSource
                        }
                    });

                    continue; // Skip the aggregated logic below
                }

                // AGGREGATED sleep_analysis (existing logic for session-level data)
                let calculatedTotal = 0;
                const pTotal = point.totalSleep || 0;
                const pAsleep = point.asleep || 0;
                const pDeep = point.deep || 0;
                const pRem = point.rem || 0;
                const pCore = point.core || 0;

                if (pTotal > 0) calculatedTotal = pTotal * 60;
                else if (pAsleep > 0) calculatedTotal = pAsleep * 60;
                else calculatedTotal = (pDeep + pRem + pCore) * 60;

                if (calculatedTotal > 0) val = Math.round(calculatedTotal);

                const rawSource = point.sourceName || point.source || 'Auto';
                const parsedSource = parseSource(rawSource, name);

                result.push({
                    name,
                    value: val,
                    min: minVal,
                    max: maxVal,
                    date: date,
                    source: parsedSource,
                    raw: point
                });

                // Push component rows for hourly detail
                const components = [
                    { n: 'sleep_deep', v: pDeep * 60 },
                    { n: 'sleep_rem', v: pRem * 60 },
                    { n: 'sleep_core', v: pCore * 60 },
                    { n: 'sleep_awake', v: (point.awake || 0) * 60 }
                ];

                components.forEach(c => {
                    if (c.v > 0) {
                        result.push({
                            name: c.n,
                            value: Math.round(c.v),
                            min: '', max: '',
                            date: point.sleepEnd || date,
                            source: parsedSource,
                            raw: { created_from: 'sleep_analysis_explosion' }
                        });
                    }
                });

                continue; // Skip the default push below
            }

            const rawSource = point.sourceName || point.source || 'Auto';
            const parsedSource = parseSource(rawSource, name);

            result.push({
                name,
                value: val,
                min: minVal,
                max: maxVal,
                date: date,
                source: parsedSource,
                raw: point
            });
        }
    }
    return result;
}

function parseSource(rawSource, metricName) {
    if (!rawSource || rawSource === 'Auto') return 'Auto';
    const devices = rawSource.split('|').map(d => d.trim());
    const watchMetrics = ['heart_rate', 'heart_rate_variability', 'resting_heart_rate'];
    const sleepMetrics = ['sleep_analysis', 'sleep_asleep', 'sleep_awake', 'sleep_in_bed',
        'sleep_asleep_core', 'sleep_asleep_deep', 'sleep_asleep_rem'];

    if (watchMetrics.includes(metricName) || sleepMetrics.some(m => metricName.startsWith('sleep_'))) {
        const watch = devices.find(d => d.includes('Watch'));
        if (watch) return cleanDeviceName(watch);
    }
    if (metricName === 'step_count') {
        const iphone = devices.find(d => d.includes('iPhone'));
        if (iphone) return cleanDeviceName(iphone);
    }
    if (devices.length === 1) {
        return cleanDeviceName(devices[0]);
    } else {
        return devices.map(d => cleanDeviceName(d)).join(' + ');
    }
}

function cleanDeviceName(deviceStr) {
    let cleaned = deviceStr.replace(/\([^)]*\)/g, '').trim();
    if (cleaned.includes("'s ")) {
        cleaned = cleaned.split("'s ")[1] || cleaned;
    }
    return cleaned;
}

/**
 * Sort a sheet by column A (date/timestamp) in descending order (most recent first).
 * @param {object} sheets - Google Sheets API instance
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} sheetName - Name of the sheet to sort
 * @param {number} endColumnIndex - Number of columns in the sheet
 */
async function sortSheetByDateDesc(sheets, spreadsheetId, sheetName, endColumnIndex = 15) {
    try {
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const sheetsList = spreadsheet.data.sheets || [];
        const targetSheet = sheetsList.find(s => s.properties.title === sheetName);

        if (targetSheet) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        sortRange: {
                            range: {
                                sheetId: targetSheet.properties.sheetId,
                                startRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex
                            },
                            sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }]
                        }
                    }]
                }
            });
        }
    } catch (error) {
        console.error(`Error sorting ${sheetName} sheet:`, error);
    }
}
