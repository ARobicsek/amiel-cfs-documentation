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

            for (const row of daysRows) {
                const metric = row[3];
                const val = Number(row[4]);
                const rawJson = row[8] ? JSON.parse(row[8]) : {};

                if (metric === 'step_count' && !isNaN(val)) {
                    totalSteps += val;
                } else if (metric === 'heart_rate' && !isNaN(val)) {
                    hrSum += val;
                    hrCount++;
                    const rowMin = row[5] !== '' ? Number(row[5]) : val;
                    const rowMax = row[6] !== '' ? Number(row[6]) : val;
                    if (hrMin === null || rowMin < hrMin) hrMin = rowMin;
                    if (hrMax === null || rowMax > hrMax) hrMax = rowMax;
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

                    let totalMins = 0;
                    if (pTotal > 0) totalMins = pTotal * 60;
                    else if (pAsleep > 0) totalMins = pAsleep * 60;
                    else totalMins = (pDeep + pRem + pCore) * 60;

                    sleepSessions.push({
                        sleepStart: rawJson.sleepStart ? new Date(rawJson.sleepStart) : null,
                        sleepEnd: rawJson.sleepEnd ? new Date(rawJson.sleepEnd) : null,
                        totalMins,
                        deepMins: pDeep * 60,
                        remMins: pRem * 60,
                        coreMins: pCore * 60,
                        awakeMins: pAwake * 60
                    });
                }
                // sleep_deep, sleep_rem, sleep_core, sleep_awake rows are intentionally
                // ignored for daily aggregation — component data comes from sleep_analysis
                // JSON above. This prevents double-counting with overlapping sessions.
            }

            // --- MERGE OVERLAPPING SLEEP SESSIONS ---
            // Apple Watch records separate sleep_analysis entries per session.
            // CFS patients often sleep multiple times per day (naps).
            // Some sessions overlap (a sub-session within a longer sleep period).
            // Non-overlapping sessions (nap + night) are summed.
            // Overlapping sessions (sub-period inside a larger one) are merged
            // by keeping the longer session's data.
            let sleepMinutes = 0;
            let deepMinutes = 0;
            let remMinutes = 0;
            let awakeMinutes = 0;

            if (sleepSessions.length > 0) {
                sleepSessions.sort((a, b) => {
                    if (!a.sleepStart) return -1;
                    if (!b.sleepStart) return 1;
                    return a.sleepStart - b.sleepStart;
                });

                const merged = [{ ...sleepSessions[0] }];
                for (let i = 1; i < sleepSessions.length; i++) {
                    const current = sleepSessions[i];
                    const last = merged[merged.length - 1];

                    if (last.sleepEnd && current.sleepStart && current.sleepStart < last.sleepEnd) {
                        // Overlapping — keep the session with more total sleep
                        if (current.totalMins > last.totalMins) {
                            merged[merged.length - 1] = { ...current };
                        }
                        // Extend end time if the current session ends later
                        if (current.sleepEnd && current.sleepEnd > merged[merged.length - 1].sleepEnd) {
                            merged[merged.length - 1].sleepEnd = current.sleepEnd;
                        }
                    } else {
                        // Non-overlapping (separate nap or sleep period)
                        merged.push({ ...current });
                    }
                }

                for (const s of merged) {
                    sleepMinutes += s.totalMins;
                    deepMinutes += s.deepMins;
                    remMinutes += s.remMins;
                    awakeMinutes += s.awakeMins;
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

        // 7. SORT HOURLY SHEET ONLY
        // Health_Daily is NOT sorted here to prevent race conditions from concurrent
        // webhook requests reordering rows mid-flight. Daily data uses append for new
        // rows and update-in-place for existing rows, so row order is not critical.
        await sortHourlySheet(sheets, SHEET_ID);

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

async function sortHourlySheet(sheets, spreadsheetId) {
    try {
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const sheetsList = spreadsheet.data.sheets || [];
        const hourlySheet = sheetsList.find(s => s.properties.title === 'Health_Hourly');

        if (hourlySheet) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        sortRange: {
                            range: {
                                sheetId: hourlySheet.properties.sheetId,
                                startRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex: 9
                            },
                            sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }]
                        }
                    }]
                }
            });
        }
    } catch (error) {
        console.error('Error sorting hourly sheet:', error);
    }
}
