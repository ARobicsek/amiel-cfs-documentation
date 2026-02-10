
import { google } from 'googleapis';
import dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: '.env' });

const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new google.auth.GoogleAuth({
    credentials: keyData,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/**
 * Backfill HR-Awake and HR-Asleep (columns P and Q) for ALL dates in Health_Daily.
 * 
 * Algorithm:
 * 1. Fetch all Health_Hourly rows
 * 2. For each date in Health_Daily, build sleep period ranges from sleep_stage rows
 * 3. Classify each HR reading as awake or asleep
 * 4. Write avg HR awake and avg HR asleep to columns P and Q
 */
async function backfillHrAwakeAsleep() {
    console.log('Starting HR Awake/Asleep backfill...\n');

    // 1. Fetch Health_Hourly
    console.log('Fetching Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A2:I',
    });
    const hourlyRows = hourlyRes.data.values || [];
    console.log(`Fetched ${hourlyRows.length} hourly rows.`);

    // 2. Fetch Health_Daily dates (column A)
    console.log('Fetching Health_Daily...');
    const dailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A2:A',
    });
    const dailyDates = (dailyRes.data.values || []).map(r => r[0]);
    console.log(`Found ${dailyDates.length} dates in Health_Daily.\n`);

    // 3. Index hourly rows by date
    const rowsByDate = {};
    for (const row of hourlyRows) {
        const dateStr = row[1]; // Column B = date
        if (!dateStr) continue;
        if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
        rowsByDate[dateStr].push(row);
    }

    // 4. For each date, compute HR awake/asleep
    const updates = [];
    let processedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < dailyDates.length; i++) {
        const dateStr = dailyDates[i];
        if (!dateStr) continue;
        processedCount++;

        const daysRows = rowsByDate[dateStr] || [];
        if (daysRows.length === 0) continue;

        // Build sleep periods from sleep_stage rows
        const sleepPeriods = [];
        for (const row of daysRows) {
            const metric = row[3];
            if (metric === 'sleep_stage') {
                try {
                    const raw = JSON.parse(row[8] || '{}');
                    if (raw.startDate && raw.endDate) {
                        const stage = (raw.stage || '').toLowerCase();
                        if (stage === 'awake' || stage === 'inbed') continue;
                        const sMs = new Date(raw.startDate).getTime();
                        const eMs = new Date(raw.endDate).getTime();
                        if (!isNaN(sMs) && !isNaN(eMs)) {
                            sleepPeriods.push({ startMs: sMs, endMs: eMs });
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }

        // Classify HR readings
        let hrAwakeSum = 0, hrAwakeCount = 0;
        let hrAsleepSum = 0, hrAsleepCount = 0;

        for (const row of daysRows) {
            if (row[3] !== 'heart_rate') continue;
            const val = Number(row[4]);
            if (isNaN(val)) continue;

            let hrTs = null;
            try {
                const raw = JSON.parse(row[8] || '{}');
                if (raw.date) hrTs = new Date(raw.date).getTime();
            } catch (e) { /* fallback */ }
            if (!hrTs) {
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

        const hrAwake = hrAwakeCount > 0 ? Math.round(hrAwakeSum / hrAwakeCount) : '';
        const hrAsleep = hrAsleepCount > 0 ? Math.round(hrAsleepSum / hrAsleepCount) : '';

        // Only update if we have at least one value
        if (hrAwake !== '' || hrAsleep !== '') {
            const sheetRow = i + 2; // index 0 = sheet row 2
            updates.push({
                range: `Health_Daily!P${sheetRow}:Q${sheetRow}`,
                values: [[hrAwake, hrAsleep]]
            });
            updatedCount++;

            if (updatedCount <= 5) {
                console.log(`  ${dateStr}: Awake=${hrAwake || '--'} (${hrAwakeCount} pts), Asleep=${hrAsleep || '--'} (${hrAsleepCount} pts)`);
            }
        }
    }

    if (updatedCount > 5) {
        console.log(`  ... and ${updatedCount - 5} more dates`);
    }

    console.log(`\nProcessed ${processedCount} dates, ${updatedCount} have HR data to update.`);

    if (updates.length === 0) {
        console.log('No updates needed.');
        return;
    }

    // 5. Batch update
    console.log('Writing to Google Sheets...');

    // Google Sheets API limits batchUpdate to ~100 ranges at a time
    const BATCH_SIZE = 100;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: batch
            }
        });
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${batch.length} rows`);
    }

    console.log('\n✅ Backfill complete!');
}

backfillHrAwakeAsleep().catch(console.error);
