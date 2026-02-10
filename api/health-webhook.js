import { google } from 'googleapis';
import { computeValidatedSleepByDate } from '../lib/sleepValidation.js';

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

            // --- Non-sleep stats (steps, HR, HRV) ---
            let totalSteps = 0;
            let hrSum = 0;
            let hrCount = 0;
            let hrMin = null;
            let hrMax = null;
            let restingHrValues = [];
            let hrvSum = 0;
            let hrvCount = 0;

            for (const row of daysRows) {
                const metric = row[3];
                const val = Number(row[4]);

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
                }
                // Sleep metrics (sleep_analysis, sleep_stage) are processed by
                // computeValidatedSleepByDate below — not collected inline here.
            }

            // --- COMPUTE VALIDATED SLEEP STATS ---
            // Use shared validation algorithm (same as lib/sleepValidation.js used by visualizations)
            // This handles deduplication, day-boundary clipping, and multi-bucket attribution.
            // We need to compute it for THIS specific date using all hourly rows.

            // Convert existingRows + newRows to format expected by computeValidatedSleepByDate
            // existingRows has: [timestamp, dateStr, hourStr, metric, value, min, max, source, rawJson]
            const allHourlyRows = [...existingRows, ...newRows];

            // Compute sleep for just this date
            const isoDateStr = parseDateToIso(dateStr);
            const sleepResult = computeValidatedSleepByDate(
                allHourlyRows,
                (d) => parseDateToIso(d) === isoDateStr, // isInRangeFn
                parseDateToIso // parseDateFn
            );

            const validatedSleep = sleepResult[isoDateStr] || { totalMin: 0, deepMin: 0, remMin: 0, coreMin: 0, awakeMin: 0 };
            const sleepMinutes = validatedSleep.totalMin;
            const deepMinutes = validatedSleep.deepMin;
            const remMinutes = validatedSleep.remMin;
            const awakeMinutes = validatedSleep.awakeMin;

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

            // --- COMPUTE HR AWAKE / ASLEEP ---
            // Build sleep period ranges from sleep_stage rows for this date,
            // then classify each HR reading as awake or asleep.
            const sleepPeriods = []; // [{ startMs, endMs }]
            for (const row of daysRows) {
                const metric = row[3];
                if (metric === 'sleep_stage') {
                    try {
                        const raw = JSON.parse(row[8] || '{}');
                        if (raw.startDate && raw.endDate) {
                            const stage = (raw.stage || '').toLowerCase();
                            // Only count actual sleep stages (not awake/inBed)
                            if (stage === 'awake' || stage === 'inbed' || stage === 'inBed') continue;
                            const sMs = new Date(raw.startDate).getTime();
                            const eMs = new Date(raw.endDate).getTime();
                            if (!isNaN(sMs) && !isNaN(eMs)) {
                                sleepPeriods.push({ startMs: sMs, endMs: eMs });
                            }
                        }
                    } catch (e) { /* skip bad rows */ }
                }
            }

            let hrAwakeSum = 0, hrAwakeCount = 0;
            let hrAsleepSum = 0, hrAsleepCount = 0;
            for (const row of daysRows) {
                const metric = row[3];
                if (metric !== 'heart_rate') continue;
                const val = Number(row[4]);
                if (isNaN(val)) continue;
                // Get HR timestamp from raw data
                let hrTs = null;
                try {
                    const raw = JSON.parse(row[8] || '{}');
                    if (raw.date) hrTs = new Date(raw.date).getTime();
                } catch (e) { /* use fallback */ }
                if (!hrTs) {
                    // Fallback: parse the row timestamp (column 0)
                    hrTs = new Date(row[0]).getTime();
                }
                if (isNaN(hrTs)) continue;

                const isDuringSleep = sleepPeriods.some(p => hrTs >= p.startMs && hrTs < p.endMs);
                if (isDuringSleep) {
                    hrAsleepSum += val;
                    hrAsleepCount++;
                } else {
                    hrAwakeSum += val;
                    hrAwakeCount++;
                }
            }

            const finalHrAwake = hrAwakeCount > 0 ? Math.round(hrAwakeSum / hrAwakeCount) : '';
            const finalHrAsleep = hrAsleepCount > 0 ? Math.round(hrAsleepSum / hrAsleepCount) : '';

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
                finalAwake !== 0 ? finalAwake : '',
                finalHrAwake,
                finalHrAsleep
            ];

            if (matchingIndices.length === 0) {
                // New date — use append API to avoid row index conflicts
                newDailyRows.push(rowValues);
            } else {
                // Existing row — update in place
                // index + 2 because we fetched A2:A (index 0 = sheet row 2)
                const sheetRow = matchingIndices[0] + 2;
                dailyUpdates.push({
                    range: `Health_Daily!A${sheetRow}:Q${sheetRow}`,
                    values: [rowValues]
                });

                // Self-healing: clear any duplicate rows for this date
                if (matchingIndices.length > 1) {
                    for (let k = 1; k < matchingIndices.length; k++) {
                        const dupSheetRow = matchingIndices[k] + 2;
                        dailyUpdates.push({
                            range: `Health_Daily!A${dupSheetRow}:Q${dupSheetRow}`,
                            values: [Array(17).fill('')]
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
                range: 'Health_Daily!A:Q',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: newDailyRows }
            });
        }

        // 7. SORT SHEETS by date descending (most recent first)
        await sortSheetByDateDesc(sheets, SHEET_ID, 'Health_Hourly', 9);
        await sortSheetByDateDesc(sheets, SHEET_ID, 'Health_Daily', 17);

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

/**
 * Parse date string to ISO format (YYYY-MM-DD).
 * Handles "M/D/YYYY" and "MM/DD/YYYY" formats from toLocaleDateString.
 * @param {string} dateStr - Date string like "2/3/2026" or "02/03/2026"
 * @returns {string} ISO date string "2026-02-03"
 */
function parseDateToIso(dateStr) {
    if (!dateStr) return '';
    // Handle ISO format already
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Handle M/D/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

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
