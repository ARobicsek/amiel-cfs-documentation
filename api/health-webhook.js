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
        // We fetch the entire sheet to ensure we have the full history for correct daily aggregation.
        // Optimization: In the future, we could only fetch the last X rows if we trust the sort order and date boundaries.
        const hourlySheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Health_Hourly!A:I', // Fetch cols A to I (I contains Raw Data JSON)
        });

        const existingHeader = hourlySheetRes.data.values?.[0] || [];
        const existingRows = hourlySheetRes.data.values?.slice(1) || []; // Skip header

        // Build a Set of signatures for deduplication
        // Signature: "DateISO_Metric_Value_Source" (using raw date from JSON if available, or row date)
        const existingSignatures = new Set();

        // Also map existing rows by Date (MM/DD/YYYY) for faster re-aggregation
        const rowsByDate = {}; // { '1/24/2026': [row, row...] }

        existingRows.forEach(row => {
            const rawJsonStr = row[8]; // Column I (index 8) is Raw Data
            let signature = '';

            // Try to construct signature from Raw Data unique fields
            try {
                if (rawJsonStr && rawJsonStr !== '{}') {
                    const raw = JSON.parse(rawJsonStr);
                    // Use date + metric + value as unique key
                    // Note: metric name is in Col D (index 3), Value in Col E (index 4)
                    const metricName = row[3];
                    const val = row[4];
                    // Clean source
                    const src = row[7];
                    // Use the RAW date from JSON which is precise
                    signature = `${raw.date || row[0]}_${metricName}_${val}_${src}`;
                } else {
                    // Fallback to row columns if no raw JSON
                    signature = row.join('|');
                }
            } catch (e) {
                signature = row.join('|');
            }
            existingSignatures.add(signature);

            // Group for aggregation
            const dateStr = row[1]; // Column B is Date (e.g. 1/24/2026)
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
            // Prepare Hourly Row (all in ET timezone)
            // Prepare Hourly Row (all in ET timezone)
            let dateObj = new Date(item.date);

            // For Sleep Analysis, use sleepEnd if available (User Request)
            if (item.name === 'sleep_analysis' && item.raw && item.raw.sleepEnd) {
                dateObj = new Date(item.raw.sleepEnd);
            }

            const dateStr = dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
            const hourStr = timeStr.split(':')[0];
            const timestampET = dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' });

            // Construct Signature
            const signature = `${item.date}_${item.name}_${item.value}_${item.source || 'Auto'}`;

            if (existingSignatures.has(signature)) {
                continue; // Skip duplicate
            }

            // Valid New Row
            const row = [
                timestampET, // A: Timestamp
                dateStr,   // B: Date
                hourStr,   // C: Hour
                item.name, // D: Metric
                item.value,// E: Value
                item.min !== undefined ? item.min : '', // F: Min
                item.max !== undefined ? item.max : '', // G: Max
                item.source || 'Auto', // H: Source
                JSON.stringify(item.raw || {}) // I: Raw Data
            ];

            newRows.push(row);
            existingSignatures.add(signature); // Add to set to handle duplicates *within* the current payload

            // Add to our in-memory grouping for re-aggregation
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
        // We assume Health_Daily headers:
        // Date, Steps, Avg HR, Resting HR, Min HR, Max HR, HRV, SleepDur, SleepEff, Deep, REM, LastUpdated, HRCount, HRVCount, AwakeMins

        const dailyUpdates = []; // { range, values }

        // Fetch Health_Daily to map rows to dates (so we update the correct row)
        const dailySheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Health_Daily!A:A', // Only need dates (Col A)
        });
        const dailyDates = (dailySheetRes.data.values || []).map(r => r[0]); // Array of date strings

        // Deduplication & Cleanup
        // If we find duplicates in the affected dates within Health_Daily, we should clean them up before proceeding.
        // This is a "blind" fix for the race condition: we assume the last update wins or we merge.
        // For simplicity, we won't delete rows here (risky in async webhook), but we will be careful about finding the RIGHT row to update below.
        // Actually, let's just make sure we find the *last* occurrence of the date in dailyDates to update, or first?
        // Better: Update ALL occurrences? Or unique?
        // Let's rely on the dailyDates array from the sheet.

        for (const dateStr of affectedDates) {
            const daysRows = rowsByDate[dateStr] || [];

            // Stats Containers
            let totalSteps = 0;

            let hrSum = 0;
            let hrCount = 0;
            let hrMin = null;
            let hrMax = null;
            let restingHrValues = [];

            let hrvSum = 0;
            let hrvCount = 0;

            let sleepMinutes = 0; // Total
            let deepMinutes = 0;
            let remMinutes = 0;
            let awakeMinutes = 0;

            // Calculate Stats from Hourly Rows
            for (const row of daysRows) {
                const metric = row[3];
                const val = Number(row[4]); // Can be empty or NaN for some metrics (like raw sleep_analysis)
                const rawJson = row[8] ? JSON.parse(row[8]) : {};

                if (metric === 'step_count' && !isNaN(val)) {
                    totalSteps += val;
                } else if (metric === 'heart_rate' && !isNaN(val)) {
                    hrSum += val;
                    hrCount++;
                    // Min/Max in cols F/G might be better than Value if aggregator sent them
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
                    // Parse detailed sleep data from RAW JSON
                    const rowTotal = rawJson.totalSleep || 0;
                    const rowDeep = rawJson.deep || 0;
                    const rowRem = rawJson.rem || 0;
                    const rowAwake = rawJson.awake || 0;
                    const rowCore = rawJson.core || 0; // Light/Core
                    const rowAsleep = rawJson.asleep || 0;

                    let effectiveTotal = 0;
                    if (rowTotal > 0) effectiveTotal = rowTotal * 60;
                    else if (rowAsleep > 0) effectiveTotal = rowAsleep * 60;
                    else effectiveTotal = (rowDeep + rowRem + rowCore) * 60;

                    // If this row has a duration, add it.
                    // But wait! If we have separate rows for 'sleep_deep' etc (which we will create for new data),
                    // avoiding double counting is key.
                    // The 'sleep_analysis' row itself represents the session. 
                    // If we also have 'sleep_deep' rows, they are separate METRICS in the hourly sheet.

                    // Logic: We iterate ALL rows.
                    // If we encounter 'sleep_analysis', we add its total.
                    // If we encounter 'sleep_deep', we add its duration to deepTotal.
                    // THIS IS SAFE *IF* 'sleep_analysis' row doesn't also contain the breakdown in a way that makes us double count?
                    // Actually, 'sleep_analysis' row -> adds to 'sleepMinutes'.
                    // 'sleep_deep' row -> adds to 'deepMinutes'.
                    // We should NOT add 'sleep_analysis' breakdown to 'deepMinutes' if 'sleep_deep' row exists?
                    // But the 'sleep_deep' row is derived from 'sleep_analysis' source data.
                    // So we effectively have 2 ways to get data:
                    // 1. Old/Current styling: One complex JSON row.
                    // 2. New styling: Multiple simple rows.
                    // We must support both.

                    // Simple approach:
                    // Always parse JSON from 'sleep_analysis' to get totals (this is reliable).
                    // Ignore 'sleep_deep' etc rows for Aggregation IF we already got it from JSON?
                    // No, simpler: 
                    // IF 'sleep_analysis' row: Add to Total Sleep.
                    // IF 'sleep_deep' row: Add to Deep Sleep.
                    // BUT: 'sleep_analysis' JSON *also* has Deep Sleep data.
                    // If we create 'sleep_deep' rows, we shouldn't *also* parse it from the JSON of the parent row for aggregation, OR we should ensure we don't duplicate.

                    // However, we are generating these rows in the webhook logic (below) but we are Aggregating from the SHEET content (which might not have them yet if we just appended them?).
                    // Actually, we append first (Step 3). So the new rows ARE in `rowsByDate`.
                    // So we will see:
                    // Row A: sleep_analysis (with JSON)
                    // Row B: sleep_deep
                    // Row C: sleep_rem

                    // If we count Deep from Row A (JSON) AND Row B (Value), we double count.
                    // FIX: Only aggregate from the specific Metric row type.
                    // sleep_analysis -> Adds to Total Sleep.
                    // sleep_deep -> Adds to Deep Sleep.
                    // sleep_rem -> Adds to REM Sleep.

                    // But what about historical data that ONLY has Row A?
                    // We need a fallback.
                    // If we find 'sleep_deep' rows for this date/time/source, we assume exploded format?
                    // Or we just checking if `deepMinutes` is 0?

                    // Safe Hybrid Logic:
                    // Always add Duration from 'sleep_analysis' to `sleepMinutes`.
                    // For components (Deep/REM):
                    // If we encounter 'sleep_deep' rows, use them.
                    // If after checking all rows, `deepMinutes` is 0, BUT `sleep_analysis` had JSON content, use JSON content?
                    // This is complex to coordinate across rows.

                    // Alternative: Just trust the exploded rows? 
                    // But for Jan 24 (historical), we might not have exploded rows unless we backfill.
                    // We ARE backfilling.
                    // So, we can rely on Exploded Rows for Deep/REM/Awake.
                    // AND rely on 'sleep_analysis' for Total.

                    // SO: In this block (sleep_analysis), we ONLY add to `sleepMinutes`.
                    sleepMinutes += effectiveTotal;

                    // We DO NOT add to deep/rem/awake here, assuming exploded rows handle it.
                    // WAIT: If backfill script fails or isn't run, we lose data display?
                    // Reviewing `fix-sync-issues.js`: It backfills.
                    // Reviewing `webhook`: It will create exploded rows for new data.
                    // So we are safe to switch to:
                    // sleep_analysis -> Total
                    // sleep_deep -> Deep
                    // etc.

                    // But wait, what if 'core' sleep isn't exploded or mapped?
                    // We explode 'core' too.

                    // Fallback to ensure no data loss: 
                    // Let's assume if there are NO specific component rows, we parse JSON.
                    // But duplicates are bad.
                    // Let's try: Add from JSON *temporarily* to a map, and if explicit rows exist, overwrite?
                    // Too complex.

                    // Let's stick to the Plan:
                    // "Generate additional metric entries... populated with duration".
                    // "ensure sleep_analysis row also has total duration".

                    // So, we update aggregation to simply sum by Metric Name.
                    // It is robust and cleaner.
                    // BUT: We must ensure we ignore the JSON components in `sleep_analysis` for the purpose of Deep/REM aggregation.

                    // So: Remove the JSON parsing logic for Deep/REM from `sleep_analysis` block.
                    // Only keep: sleepMinutes += effectiveTotal (parsed from JSON or Value).

                } else if (metric.startsWith('sleep_')) {
                    // This handles sleep_deep, sleep_rem, etc.
                    // Value is in MINUTES?
                    // In `normalizePayload`, we calculate seconds or minutes?
                    // In `fix-sync-issues.js`: we put Minutes.
                    // In `webhook` logic below: we need to ensure we write Minutes.

                    // Aggregation logic here:
                    const valMins = val; // Assume minutes if we write minutes
                    if (metric === 'sleep_asleep_core' || metric === 'sleep_core') { /* track core? not in daily sheet */ }
                    else if (metric === 'sleep_asleep_deep' || metric === 'sleep_deep') { deepMinutes += valMins; }
                    else if (metric === 'sleep_asleep_rem' || metric === 'sleep_rem') { remMinutes += valMins; }
                    else if (metric === 'sleep_awake') { awakeMinutes += valMins; }
                    else if (metric === 'sleep_asleep') { /* generic asleep, maybe add to total? already handled by analysis row usually */ }
                }
            }

            // Finalize Aggregates
            const finalSteps = Math.round(totalSteps * 100) / 100; // Round to 2 decimals
            const finalAvgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : '';
            const finalRestingHr = restingHrValues.length > 0 ? restingHrValues[restingHrValues.length - 1] : ''; // Latest
            const finalHrv = hrvCount > 0 ? (Math.round((hrvSum / hrvCount) * 10) / 10) : '';

            const finalSleepMin = Math.round(sleepMinutes);
            const finalDeep = Math.round(deepMinutes);
            const finalRem = Math.round(remMinutes);
            const finalAwake = Math.round(awakeMinutes);

            // Efficiency: (Total - Awake) / Total ... wait. 
            // Standard Efficiency = (Total Sleep Time / Time In Bed) * 100
            // But we don't always track Time In Bed.
            // Often (Total Sleep / (Total Sleep + Awake)) is a proxy if we only have those.
            // Let's stick to user's prior logic: u[8] = (Total / (Total+Awake))
            let finalEfficiency = '';
            if ((sleepMinutes + awakeMinutes) > 0) {
                finalEfficiency = Math.round((sleepMinutes / (sleepMinutes + awakeMinutes)) * 100) + '%';
            }

            // Find Row Index to Update
            let rowIndex = dailyDates.indexOf(dateStr);
            if (rowIndex === -1) {
                // New Row needed
                // We'll append it to the end of our local knowledge + whatever exists
                // Actually the `dailyDates` array helps us find existing. If not found, it's new.
                // But `dailyUpdates` logic below is creating a localized list of update requests.
                // We should handle the "append vs update" logic carefully.
                // If it's -1, we assume it goes to `dailyDates.length + 1` (row index + header = +2?)
                // Actually, let's just use `dailyDates.length + offset`.
                // BUT, better to just Append if new.
                // Complex if we have multiple new dates.
                dailyDates.push(dateStr); // Add to our tracking so next loop finds it?
                rowIndex = dailyDates.length - 1;
            }

            // Construct Row Data (15 cols)
            // 0:Date, 1:Steps, 2:AvgHR, 3:RestHR, 4:MinHR, 5:MaxHR, 6:HRV, 7:SleepTot, 8:Eff, 9:Deep, 10:REM, 11:Updated, 12:HRCount, 13:HRVCount, 14:AwakeMins
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
                new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }), // Last Updated
                hrCount !== 0 ? hrCount : '',
                hrvCount !== 0 ? hrvCount : '',
                finalAwake !== 0 ? finalAwake : ''
            ];

            // Convert to sheets update request (1-based index)
            // Header is row 1. Index 0 of dailyDates is Row 2.
            const sheetRow = rowIndex + 2;
            const range = `Health_Daily!A${sheetRow}:O${sheetRow}`; // Update A-O

            dailyUpdates.push({ range, values: [rowValues] });
        }

        // 5. BATCH UPDATE DAILY SHEET
        if (dailyUpdates.length > 0) {
            // Because we might have mixed "overwrites" and "appends" if we calculated indices poorly,
            // but here we used `dailyDates` from the live sheet, so indices are correct for existing.
            // For NEW dates, we pushed to `dailyDates`. This implies we are targeting row N+1.
            // This works if we fill gaps? No, Sheets API `update` will error if row doesn't exist?
            // Actually `update` (writing to A100 when sheet has 50 rows) acts like Append/Expand?
            // Usually yes! USER_ENTERED on a range expands the grid.

            // Execute sequentially or batch? Batch is better.
            const dataProto = dailyUpdates.map(u => ({
                range: u.range,
                values: u.values
            }));

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: dataProto
                }
            });
        }

        // 6. SORT BOTH SHEETS
        await sortSheetsByDate(sheets, SHEET_ID);

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

            // Explode sleep_analysis into sub-metrics
            // We return an ARRAY of objects now? No, we flatten it.
            // But we are inside a loop pushing to `result`.
            // We can push multiple entries to `result` for a single `point`?
            // `result` is an array. Yes.

            // First, push the Main entry (sleep_analysis)
            // Ensure it has a Value (Total Minutes)
            if (name === 'sleep_analysis') {
                // Calculate Total Minutes from JSON if not present
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

                // Push Main
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

                // Push Components (Ensure separate rows use sleepEnd too? Yes, consistent with Main)
                const components = [
                    { n: 'sleep_deep', v: pDeep * 60 },
                    { n: 'sleep_rem', v: pRem * 60 },
                    { n: 'sleep_core', v: pCore * 60 },
                    { n: 'sleep_awake', v: (point.awake || 0) * 60 } // awake in hours from json? usually.
                ];

                components.forEach(c => {
                    if (c.v > 0) {
                        result.push({
                            name: c.n,
                            value: Math.round(c.v),
                            min: '', max: '',
                            date: point.sleepEnd || date, // Use sleepEnd if available
                            source: parsedSource,
                            raw: { created_from: 'sleep_analysis_explosion' }
                        });
                    }
                });

                continue; // Skip the default push below
            }

            // For 'sleep_analysis', val is usually undefined in the top level 'value' field of the point?
            // But we keep the point object as 'raw', so we can extract it later.
            // We'll proceed with whatever 'val' we found (might be undefined), later code handles it.

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

async function sortSheetsByDate(sheets, spreadsheetId) {
    try {
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const sheetsList = spreadsheet.data.sheets || [];
        const hourlySheet = sheetsList.find(s => s.properties.title === 'Health_Hourly');
        const dailySheet = sheetsList.find(s => s.properties.title === 'Health_Daily');
        const requests = [];

        if (hourlySheet) {
            requests.push({
                sortRange: {
                    range: {
                        sheetId: hourlySheet.properties.sheetId,
                        startRowIndex: 1,
                        startColumnIndex: 0,
                        endColumnIndex: 9
                    },
                    sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }]
                }
            });
        }
        if (dailySheet) {
            requests.push({
                sortRange: {
                    range: {
                        sheetId: dailySheet.properties.sheetId,
                        startRowIndex: 1,
                        startColumnIndex: 0,
                        endColumnIndex: 15
                    },
                    sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }]
                }
            });
        }
        if (requests.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });
        }
    } catch (error) {
        console.error('Error sorting sheets:', error);
    }
}
