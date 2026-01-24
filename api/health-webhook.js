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

        // 1. Process Hourly Data (Append to Health_Hourly)
        // Flatten the incoming data into rows
        const hourlyRows = [];
        const metrics = data.data?.metrics || []; // Health Auto Export v8 structure

        // Note: Structure varies. Let's handle common "Health Auto Export" JSON format.
        // Usually: { data: { metrics: [ { name: "heart_rate", units: "count/min", data: [...] } ] } }

        // We'll normalize incoming data first
        const incomingData = normalizePayload(data);

        // Group by Date for Daily Aggregation later
        const dailyUpdates = {}; // { "YYYY-MM-DD": { steps: 0, distinctHours: Set... } }

        for (const item of incomingData) {
            // item = { name: 'heart_rate', date: 'ISO', value: 72, unit: 'bpm', source: 'Apple Watch' }

            // Prepare Hourly Row
            const dateObj = new Date(item.date);
            const dateStr = dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
            const hourStr = dateObj.getHours().toString();

            hourlyRows.push([
                item.date, // Timestamp (ISO)
                dateStr,   // US Date
                hourStr,   // Hour (0-23)
                item.name, // Metric Name
                item.value,// Value
                item.source || 'Auto',
                JSON.stringify(item.raw || {}) // Raw data if any
            ]);

            // Accumulate for Daily Stats
            if (!dailyUpdates[dateStr]) {
                dailyUpdates[dateStr] = {
                    count: 0,

                    // Steps
                    steps: 0,

                    // Heart Rate
                    hrSum: 0,
                    hrCount: 0,
                    hrMin: 999,
                    hrMax: 0,

                    // HRV
                    hrvSum: 0,
                    hrvCount: 0,

                    // Sleep
                    sleepMinutes: 0,
                    deepSleepMinutes: 0,
                    remSleepMinutes: 0,
                    awakeMinutes: 0,
                };
            }

            const day = dailyUpdates[dateStr];
            day.count++;

            if (item.name === 'step_count') {
                day.steps += Number(item.value);
            }
            else if (item.name === 'heart_rate') {
                const val = Number(item.value);
                day.hrSum += val;
                day.hrCount++;
                if (val < day.hrMin) day.hrMin = val;
                if (val > day.hrMax) day.hrMax = val;
            }
            else if (item.name === 'heart_rate_variability') {
                day.hrvSum += Number(item.value);
                day.hrvCount++;
            }
            else if (item.name === 'resting_heart_rate') {
                // Resting HR is usually one value per day, but we might get multiple updates.
                // We'll just take the latest average or non-zero.
                day.restingHr = Number(item.value);
            }
            else if (item.name === 'sleep_analysis') {
                // Sleep items usually have a 'value' like 'asleep', 'inBed' etc and a duration
                // We need to parse duration.
                // Normalized item.value might be the duration or the stage string?
                // Let's assume normalizePayload handles this or we handle it here.
                // Actually, let's rely on normalizePayload to give us:
                // name='sleep_core', value=minutes
                if (item.name.startsWith('sleep_')) {
                    const mins = Number(item.value) / 60; // usually seconds

                    if (item.name === 'sleep_in_bed') { /* ignore total for now, calc from stages? */ }
                    else if (item.name === 'sleep_asleep_core') day.sleepMinutes += mins; // Core is part of total app sleep? 
                    else if (item.name === 'sleep_asleep_deep') { day.deepSleepMinutes += mins; day.sleepMinutes += mins; }
                    else if (item.name === 'sleep_asleep_rem') { day.remSleepMinutes += mins; day.sleepMinutes += mins; }
                    else if (item.name === 'sleep_awake') { day.awakeMinutes += mins; }
                    else if (item.name === 'sleep_asleep') { day.sleepMinutes += mins; } // Generic 'asleep'
                }
            }
        }

        // A. APPEND HOURLY DATA
        if (hourlyRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'Health_Hourly!A:G', // Append to cols A-G
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: hourlyRows },
            });
        }

        // B. UPDATE DAILY DATA (Upsert)
        // 1. Fetch existing Daily sheet to find rows
        const dailySheet = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Health_Daily!A:L',
        });

        const existingRows = dailySheet.data.values || [];
        const headers = existingRows[0]; // Assume row 1 is headers
        const updates = [];

        // For each date we have new data for...
        for (const [dateStr, newStats] of Object.entries(dailyUpdates)) {
            let rowIndex = existingRows.findIndex(row => row[0] === dateStr);
            let rowData = [];

            if (rowIndex === -1) {
                // New Row
                rowIndex = existingRows.length + updates.length; // virtual index
                // Initialize empty row based on schema
                // Date, Steps, Avg HR, Resting HR, Min HR, Max HR, HRV, Sleep Dur, Sleep Eff, Deep, REM, LastUpdate
                rowData = [dateStr, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ''];
                updates.push({ index: rowIndex, date: dateStr, isNew: true, data: rowData });
            } else {
                // Existing Row
                rowData = [...existingRows[rowIndex]]; // Copy
                // Ensure length
                while (rowData.length < 12) rowData.push('');
                updates.push({ index: rowIndex, date: dateStr, isNew: false, data: rowData });
            }

            const u = updates[updates.length - 1].data;

            // Helper to get/set
            // 0:Date, 1:Steps, 2:AvgHR, 3:RestHR, 4:MinHR, 5:MaxHR, 6:HRV, 7:SleepTot, 8:Eff, 9:Deep, 10:REM, 11:Updated

            // MERGE LOGIC
            // We store "Counts" in a hidden way? Or just recalculate simple weighted avg?
            // Since we don't store sample counts in the Sheet (except implicit logic), perfect weighted avg is hard across multiple syncs without storing count.
            // Users asked for "Sample Count" in my plan? 
            // Plan said: "HRV (SDNN)" etc.
            // Task list said: "sample count" in Health_Daily schema? Actually I put it in the script:
            // 'Date', 'Steps', 'Avg HR', 'Resting HR', 'Min HR', 'Max HR', 'HRV (SDNN)', 'Sleep Duration (min)', 'Sleep Efficiency', 'Deep Sleep (min)', 'REM Sleep (min)', 'Last Updated'

            // ISSUE: If I just have "72" as Avg HR, I don't know if that's from 1 sample or 1000.
            // SOLVE: I will add a hidden "Metadata" column or just accept that "Approximations are fine for PWA homebrews".
            // BETTER SOLVE: Read the `Health_Hourly` sheet? Too slow.
            // COMPROMISE: We will assume the "Value" in the sheet is the "Current Running Total / Average" and we might drift slightly if we do pure averaging.
            // BUT: Health Auto Export often sends the *accumulated* daily total for Steps.
            // For HR, it sends samples. 
            // Let's implement a "Smart Merge": 
            // If "Steps" > current sheet steps, take the larger (since it's likely cumulative).
            // For HR: Just (OldAvg + NewAvg) / 2 is bad.
            // Let's just Overwrite "Min/Max" with strict min/max.
            // For Avg HR: Let's just update it with the new batch's average if the new batch has > 10 samples, otherwise ignore?
            // actually, let's keep it simple: Just REPLACE the daily stats with the aggregates from *this payload* merged with *existing extremes*.
            // Or better: relying on the fact that syncs are "new data".

            // STEPS: Additive
            u[1] = Number(u[1] || 0) + newStats.steps;

            // MIN/MAX HR: Comparative
            const currentMin = parseFloat(u[4]) || 999;
            const currentMax = parseFloat(u[5]) || 0;
            u[4] = Math.min(currentMin, newStats.hrMin); // Min
            u[5] = Math.max(currentMax, newStats.hrMax); // Max

            // AVG HR: Weighted Average (We need count...)
            // Let's use column M (13th, index 12) for "HR Sample Count" (hidden-ish)
            // Check if existing row has it
            const currentHrCount = Number(u[12] || 0);
            const currentHrAvg = Number(u[2] || 0);

            let newTotalHr = (currentHrAvg * currentHrCount) + newStats.hrSum;
            let newTotalCount = currentHrCount + newStats.hrCount;
            u[2] = newTotalCount > 0 ? Math.round(newTotalHr / newTotalCount) : 0; // Avg HR
            u[12] = newTotalCount; // Store count in Col M

            // Resting HR: Take latest non-zero
            if (newStats.restingHr) u[3] = newStats.restingHr;

            // HRV: Same weighted avg logic
            // Use column N (14th, index 13) for "HRV Count"
            const currentHrvCount = Number(u[13] || 0);
            const currentHrvAvg = Number(u[6] || 0);

            let newTotalHrv = (currentHrvAvg * currentHrvCount) + newStats.hrvSum;
            let newTotalHrvCount = currentHrvCount + newStats.hrvCount;
            u[6] = newTotalHrvCount > 0 ? Math.round((newTotalHrv / newTotalHrvCount) * 10) / 10 : 0;
            u[13] = newTotalHrvCount;

            // Sleep: Additive (Assuming sync sends non-duplicated intervals? Health Auto Export usually sends *new* samples)
            u[7] = Number(u[7] || 0) + newStats.sleepMinutes;
            u[9] = Number(u[9] || 0) + newStats.deepSleepMinutes;
            u[10] = Number(u[10] || 0) + newStats.remSleepMinutes;

            // Sleep Efficiency: (Total - Awake) / Total? Or just use Core+Deep+Rem / Total?
            // Let's just store simple calc:
            // Eff = (TotalSleep / (TotalSleep + Awake)) * 100
            const awake = Number(u[14] || 0) + newStats.awakeMinutes;
            u[14] = awake; // Store awake mins in Col O

            const totalSleep = u[7]; // already sums the sleep phases
            if (totalSleep + awake > 0) {
                u[8] = Math.round((totalSleep / (totalSleep + awake)) * 100) + '%';
            }

            u[11] = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
        }

        // Write Updates (Batch Update would be better but simple loops work for low volume)
        // We will do a `valueInputOption: USER_ENTERED` update for each row.
        // Optimization: If we have multiple updates, we can do one `batchUpdate`.

        // BUT we need to write to specific rows (some new, some existing).
        // Let's just loop.
        for (const update of updates) {
            const rowNum = update.index + 1; // 1-based
            const range = `Health_Daily!A${rowNum}:O${rowNum}`; // Writing up to Col O (15 cols)

            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [update.data] },
            });
        }

        return res.status(200).json({
            success: true,
            processed: incomingData.length,
            dailyUpdates: Object.keys(dailyUpdates)
        });

    } catch (error) {
        console.error('Health Webhook Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// --------------------------------------------------------
// Helpers to Normalize Health Auto Export JSON
// --------------------------------------------------------
function normalizePayload(body) {
    const result = [];

    // Health Auto Export typically sends: { data: { metrics: [...] } }
    // metrics is array of: { name: 'heart_rate', units: 'bpm', data: [ {date, value, ...}, ... ] }

    const metrics = body.data?.metrics || [];

    for (const metric of metrics) {
        const name = normalizeName(metric.name); // 'heart_rate'

        if (!metric.data) continue;

        for (const point of metric.data) {
            // point = { date: '...', qty: 72, ... }
            // Sometimes it's 'qty', sometimes 'value'? App uses 'qty' usually.
            let val = point.qty !== undefined ? point.qty : point.value;
            const date = point.date || point.startDate; // Sleep often has startDate/endDate

            // Sleep specific handling for duration
            if (name.startsWith('sleep_')) {
                // If sleep, we care about duration.
                // Usually payload is: { startDate:..., endDate:..., value: 'asleep' }
                // OR metric based: { name: 'sleep_analysis', data: [{date, qty, ...}] }
                // Let's assume point contains duration logic if it's aggregated, or calculate it.
                if (point.startDate && point.endDate) {
                    const start = new Date(point.startDate);
                    const end = new Date(point.endDate);
                    val = (end - start) / 1000; // seconds
                }
            }

            result.push({
                name,
                value: val,
                date: date,
                source: point.sourceName || point.source || 'Auto',
                raw: point
            });
        }
    }
    return result;
}

function normalizeName(rawName) {
    // Map Apple Health names to our internal keys
    // e.g. "heart_rate" -> "heart_rate"
    // "step_count" -> "step_count"
    // "sleep_analysis" -> split into "sleep_X" based on value?
    // Actually the payload often splits them or provides 'sleep_analysis' with sub-values.
    // We'll trust the prep done by 'normalizePayload' logic or just pass through.
    return rawName;
}
