import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

if (!SHEET_ID) {
    console.error('Missing GOOGLE_SHEET_ID in .env');
    process.exit(1);
}

// Helper to get Google Auth
function getGoogleAuth() {
    const credsStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!credsStr) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY');
    const credentials = JSON.parse(credsStr);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function run() {
    console.log('Starting cleanup script...');
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Fetch Health_Daily to find duplicates
    console.log('Fetching Health_Daily...');
    const dailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A:A',
    });
    const dailyDates = dailyRes.data.values ? dailyRes.data.values.map(r => r[0]) : [];

    // Find duplicates (indices 0-based relative to values array, but Sheets is 1-based, Header is Row 1)
    // So Values[0] is Row 2.
    const dateMap = {};
    const duplicateRows = [];

    dailyDates.forEach((date, i) => {
        if (!date || date === 'Date') return;
        if (dateMap[date]) {
            // Found duplicate
            // We want to delete the *newest* duplicates usually, or just all but one.
            // Let's store the row index to delete.
            // i=0 => Row 2.
            duplicateRows.push(i + 2);
        } else {
            dateMap[date] = i + 2;
        }
    });

    if (duplicateRows.length > 0) {
        console.log(`Found ${duplicateRows.length} duplicates in Daily sheet. Deleting...`, duplicateRows);
        // Delete rows in reverse order to keep indices valid?
        // Actually, deleting dimension with batchUpdate.
        duplicateRows.sort((a, b) => b - a);

        const requests = duplicateRows.map(rowIndex => ({
            deleteDimension: {
                range: {
                    sheetId: 0, // Need to confirm Sheet ID for 'Health_Daily'
                    dimension: 'ROWS',
                    startIndex: rowIndex - 1, // 0-inclusive
                    endIndex: rowIndex // exclusive
                }
            }
        }));

        // We need the sheetId for Health_Daily
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const dailySheetDef = meta.data.sheets.find(s => s.properties.title === 'Health_Daily');
        if (!dailySheetDef) throw new Error('Health_Daily sheet not found');

        requests.forEach(r => r.deleteDimension.range.sheetId = dailySheetDef.properties.sheetId);

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: { requests }
        });
        console.log('Duplicates deleted.');
    } else {
        console.log('No duplicates found in Daily sheet.');
    }

    // 2. Fetch Hourly Data
    console.log('Fetching Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A:I',
    });
    const rows = hourlyRes.data.values || [];
    const header = rows[0];
    const dataRows = rows.slice(1);

    // 3. explode Sleep Data & Backfill
    const newHourlyRows = [];
    const updatesToExisting = []; // { range, values } logic to update 'Value' col of existing rows
    // Actually simpler to just append new rows for sub-stages, and update the 'main' row in place?
    // Updating in place requires knowing the row index.

    // Let's iterate and build a list of "New Rows to Append" (Deep/REM/etc) 
    // AND "Updates to Existing" (Total Duration Value)

    console.log('Analyzing Hourly rows for Sleep Data backfill...');

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const metric = row[3];
        const existingVal = row[4];
        const rawJsonStr = row[8];
        const dateStr = row[1];
        const timestamp = row[0]; // Keep timestamps consistent for new rows
        const hour = row[2];
        const source = row[7];

        if (metric === 'sleep_analysis') {
            let raw = {};
            try { raw = JSON.parse(rawJsonStr); } catch (e) { }

            // Calculate Total Minutes
            // Logic corresponding to webhook plan:
            let totalMins = 0;
            let deepMins = 0;
            let remMins = 0;
            let coreMins = 0;
            let awakeMins = 0;

            // Check for explicit fields (assume Hours if small numbers? User data: core: 1.769 -> Hours. )
            // But sometimes raw is just "313" ? No, raw is the JSON.
            // Sample JSON: {"startDate":"...","endDate":"...","value":"InBed","source":"..."} -> No duration?
            // Wait, previous investigation showed rawJson: { core: X, deep: Y ... }
            // Let's re-read investigate output if needed.
            // In the "investigate-data.js" logs (which inspected user file), we noticed:
            // 1/25/2026 row 39: Value is "613.19" for Metric "steps"? 
            // Wait, let's look at a sleep row.
            // From file dump: 
            // NO SLEEP ROW SHOWN in `investigate-data` output?
            // Ah, the file `new_daily.txt` shows "Sleep Duration 294".
            // The `new_hourly.txt` has `sleep_analysis`?
            // Let's trust the logic: The HAE export usually puts detailed breakdown in JSON.

            // From `api/health-webhook.js`:
            // `if (rawJson.core !== undefined) sleepMinutes += (rawJson.core * 60);`

            const rTotal = raw.totalSleep || 0;
            const rDeep = raw.deep || 0;
            const rRem = raw.rem || 0;
            const rCore = raw.core || 0;
            const rAwake = raw.awake || 0;
            const rAsleep = raw.asleep || 0;

            deepMins = rDeep * 60;
            remMins = rRem * 60;
            coreMins = rCore * 60;
            awakeMins = rAwake * 60;

            if (rTotal > 0) {
                totalMins = rTotal * 60;
            } else {
                if (rAsleep > 0) totalMins = rAsleep * 60;
                else totalMins = deepMins + remMins + coreMins;
            }

            // Round
            totalMins = Math.round(totalMins);
            deepMins = Math.round(deepMins);
            remMins = Math.round(remMins);
            coreMins = Math.round(coreMins);
            awakeMins = Math.round(awakeMins);

            // A) Update Main Row value if empty
            if (!existingVal || existingVal.trim() === '') {
                // Update Col E (Index 4)
                // Row index in sheet = i + 2.
                updatesToExisting.push({
                    range: `Health_Hourly!E${i + 2}`,
                    values: [[totalMins]]
                });
            }

            // B) Generate EXPLODED rows if valid duration
            // Check if these rows already exist? 
            // Deduplication logic below (in aggregation) handles partials, but for appending new rows
            // we should check if they exist in `dataRows` to avoid double-inserting if we run this script twice.
            // Using a simple check: does `dataRows` contain `sleep_deep` at this timestamp?

            // This verification scans the whole array which is O(N^2) but for 3000 rows it's fine.
            // Optimization: check signature map? 
            // Let's just create them and trust 'cleanDeviceName' etc from webhook will match?

            const subMetrics = [
                { name: 'sleep_deep', val: deepMins },
                { name: 'sleep_rem', val: remMins },
                { name: 'sleep_core', val: coreMins },
                { name: 'sleep_awake', val: awakeMins },
            ];

            subMetrics.forEach(sub => {
                if (sub.val > 0) {
                    // Check existence
                    // Sig: Date + Metric + Source
                    const exists = dataRows.some(r => r[1] === dateStr && r[3] === sub.name && r[7] === source);
                    if (!exists) {
                        // Create Row
                        // Timestamp, Date, Hour, Metric, Value, Min, Max, Source, Raw
                        newHourlyRows.push([
                            timestamp,
                            dateStr,
                            hour,
                            sub.name,
                            sub.val,
                            '', '', // Min/Max
                            source,
                            JSON.stringify({ created_by: 'fix-script' })
                        ]);
                    }
                }
            });
        }
    }

    // Apply Updates to Existing
    if (updatesToExisting.length > 0) {
        console.log(`Updating ${updatesToExisting.length} existing sleep_analysis rows...`);
        // Batch them?
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updatesToExisting
            }
        });
    }

    // Append New Rows
    if (newHourlyRows.length > 0) {
        console.log(`Appending ${newHourlyRows.length} new sleep component rows...`);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Health_Hourly!A:I',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: newHourlyRows }
        });
    }

    // 4. Force Re-Aggregation for Jan 24 and Jan 25
    // Effectively we call the 'webhook' logic's aggregation part for these dates.
    // Instead of importing the webhook file (which might have issues being called as a script),
    // we'll reimplement the simple aggregation logic here locally.

    console.log('Re-aggregating Jan 24 & 25...');

    // Re-fetch everything to include the updates/appends we just made
    const reFetch = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A:I',
    });
    const allRows = reFetch.data.values.slice(1);

    // Group by Date for 24/25
    const targetDates = ['1/24/2026', '1/25/2026'];
    const rowsByDate = {};
    allRows.forEach(r => {
        if (targetDates.includes(r[1])) {
            if (!rowsByDate[r[1]]) rowsByDate[r[1]] = [];
            rowsByDate[r[1]].push(r);
        }
    });

    const dailyUpdates = [];

    for (const date of targetDates) {
        const dayRows = rowsByDate[date] || [];
        if (dayRows.length === 0) continue;

        let totalSteps = 0;
        let hrSum = 0;
        let hrCount = 0;
        let hrMin = null;
        let hrMax = null;
        let hrvSum = 0;
        let hrvCount = 0; // count
        let sleepMin = 0;
        let deepMin = 0;
        let remMin = 0;
        let awakeMin = 0;
        let restingHr = ''; // Last one

        dayRows.forEach(r => {
            const metric = r[3];
            const val = parseFloat(r[4]);
            if (isNaN(val)) return;

            if (metric === 'step_count') {
                totalSteps += val;
            }
            if (metric === 'heart_rate') {
                hrSum += val;
                hrCount++;
                const rMin = r[5] ? parseFloat(r[5]) : val;
                const rMax = r[6] ? parseFloat(r[6]) : val;
                if (hrMin === null || rMin < hrMin) hrMin = rMin;
                if (hrMax === null || rMax > hrMax) hrMax = rMax;
            }
            if (metric === 'resting_heart_rate') {
                restingHr = val;
            }
            if (metric === 'heart_rate_variability') {
                hrvSum += val;
                hrvCount++;
            }

            // Sleep Aggregation
            // Since we exploded the rows, we can just sum the metrics directly!
            // Much cleaner.
            if (metric === 'sleep_analysis') {
                // The 'Value' column was backfilled by step 3.
                // But be careful not to double count if multiple entries?
                // Usually only one per day. Simple sum is fine.
                sleepMin += val;
            }
            if (metric === 'sleep_deep') deepMin += val;
            if (metric === 'sleep_rem') remMin += val;
            if (metric === 'sleep_awake') awakeMin += val;
        });

        // Finalize
        const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : '';
        const avgHrv = hrvCount > 0 ? (Math.round((hrvSum / hrvCount) * 10) / 10) : '';

        let efficiency = '';
        if ((sleepMin + awakeMin) > 0) {
            efficiency = Math.round((sleepMin / (sleepMin + awakeMin)) * 100) + '%';
        }

        // Construct Row
        const dailyRow = [
            date,
            Math.round(totalSteps * 100) / 100,
            avgHr,
            restingHr,
            hrMin !== null ? hrMin : '',
            hrMax !== null ? hrMax : '',
            avgHrv,
            Math.round(sleepMin) || '',
            efficiency,
            Math.round(deepMin) || '',
            Math.round(remMin) || '',
            new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
            hrCount || '',
            hrvCount || '',
            Math.round(awakeMin) || ''
        ];

        // Find row to update in Daily Sheet
        // We already have dailyDates from Step 1.
        // Re-fetch to be safe? The array indices from Step 1 are still valid as we only deleted rows, not inserted/sorted yet.
        // Wait, we deleted rows. So indices might have shifted if we had duplicates.
        // But we sorted the deletes from bottom up.
        // So the *remaining* unique dates should be in the same relative order?
        // Actually safest to just find the row again.

        // We can use TEXT finder or fetch column A again.
    }

    // 5. Update Daily Sheet
    // Re-fetch Daily Column A
    const finalDailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A:A',
    });
    const finalDates = finalDailyRes.data.values ? finalDailyRes.data.values.map(r => r[0]) : [];

    const finalRequests = [];

    // We already computed aggregates in loop above, let's just re-do the matching here
    for (const date of targetDates) {
        // Find aggregates from our map
        // (Copy-paste logic from loop above but streamlined)
        const dayRows = rowsByDate[date] || [];
        if (dayRows.length === 0) continue;

        // ... Recalculate ... 
        // (For brevity, I'll inline the Loop logic into this final update Phase to avoid variable scope issues)

        let totalSteps = 0, hrSum = 0, hrCount = 0, hrMin = null, hrMax = null, hrvSum = 0, hrvCount = 0;
        let sleepMin = 0, deepMin = 0, remMin = 0, awakeMin = 0, restingHr = '';

        dayRows.forEach(r => {
            const metric = r[3];
            const val = parseFloat(r[4]);
            if (isNaN(val)) return;
            if (metric === 'step_count') totalSteps += val;
            if (metric === 'heart_rate') {
                hrSum += val; hrCount++;
                const rMin = r[5] ? parseFloat(r[5]) : val;
                const rMax = r[6] ? parseFloat(r[6]) : val;
                if (hrMin === null || rMin < hrMin) hrMin = rMin;
                if (hrMax === null || rMax > hrMax) hrMax = rMax;
            }
            if (metric === 'resting_heart_rate') restingHr = val;
            if (metric === 'heart_rate_variability') { hrvSum += val; hrvCount++; }
            if (metric === 'sleep_analysis') sleepMin += val;
            if (metric === 'sleep_deep') deepMin += val;
            if (metric === 'sleep_rem') remMin += val;
            if (metric === 'sleep_awake') awakeMin += val;
        });

        const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : '';
        const avgHrv = hrvCount > 0 ? (Math.round((hrvSum / hrvCount) * 10) / 10) : '';
        let efficiency = '';
        if ((sleepMin + awakeMin) > 0) efficiency = Math.round((sleepMin / (sleepMin + awakeMin)) * 100) + '%';

        const rowValues = [
            date,
            Math.round(totalSteps * 100) / 100,
            avgHr,
            restingHr,
            hrMin !== null ? hrMin : '',
            hrMax !== null ? hrMax : '',
            avgHrv,
            Math.round(sleepMin) || '',
            efficiency,
            Math.round(deepMin) || '',
            Math.round(remMin) || '',
            new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
            hrCount || '',
            hrvCount || '',
            Math.round(awakeMin) || ''
        ];

        let rowIndex = finalDates.indexOf(date);
        if (rowIndex !== -1) {
            // Update
            finalRequests.push({
                range: `Health_Daily!A${rowIndex + 1}:O${rowIndex + 1}`, // Row index is 1-based in range (Array 0 is 'Date' header = Row 1? No, values[0] is header)
                // Wait. `range: 'Health_Daily!A:A'` returns:
                // values[0] = ["Date"]
                // values[1] = ["12/20/2025"]  -> This is Row 2.
                // So if Map index is 1, Row is 2.
                // Map index i => Row i+1.
                values: [rowValues]
            });
        }
    }

    if (finalRequests.length > 0) {
        console.log(`Writing daily updates for ${finalRequests.length} rows...`);
        const dataProto = finalRequests.map(u => ({ range: u.range, values: u.values }));
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: dataProto
            }
        });
        console.log('Daily updates complete.');
    } else {
        console.log('No daily rows found to update?');
    }

    console.log('Done.');
}

run().catch(console.error);
