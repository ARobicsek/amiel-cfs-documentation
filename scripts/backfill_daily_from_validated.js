
import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { computeValidatedSleepByDate } from '../lib/sleepValidation.js';

// Load env vars (try .env first, fallback to .env.local)
dotenv.config({ path: '.env' });

// Get Auth
const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new google.auth.GoogleAuth({
    credentials: keyData,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const TARGET_DATE = '2026-02-03';

async function backfillDailyStats() {
    console.log(`Starting backfill for ${TARGET_DATE}...`);

    // 1. Fetch Health_Hourly
    console.log('Fetching Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A2:I',
    });
    const hourlyRows = hourlyRes.data.values || [];
    console.log(`Fetched ${hourlyRows.length} hourly rows.`);

    // 2. Compute Validated Sleep
    // Filter function for target date
    const isInRangeFn = (dateStr) => {
        // Basic normalized check
        if (!dateStr) return false;
        // Check if it matches TARGET_DATE (YYYY-MM-DD or M/D/YYYY)
        if (dateStr.includes(TARGET_DATE)) return true; // Lazy check
        // Normalize and check
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const iso = d.toISOString().split('T')[0];
        return iso === TARGET_DATE;
    };

    const parseDateFn = (dateStr) => {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    const validatedData = computeValidatedSleepByDate(hourlyRows, isInRangeFn, parseDateFn);
    const correctStats = validatedData[TARGET_DATE];

    if (!correctStats) {
        console.error(`Could not calculate validated stats for ${TARGET_DATE}. No data found?`);
        return;
    }

    console.log(`\nComputed Correct Stats for ${TARGET_DATE}:`);
    console.log(`  Total Sleep: ${correctStats.totalMin} min`);
    console.log(`  Deep: ${correctStats.deepMin} min`);
    console.log(`  REM: ${correctStats.remMin} min`);
    console.log(`  Core: ${correctStats.coreMin} min`);
    console.log(`  Awake: ${correctStats.awakeMin} min`);

    // 3. Find row in Health_Daily
    console.log('\nFetching Health_Daily dates...');
    const dailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A2:A',
    });
    const dailyDates = (dailyRes.data.values || []).map(r => r[0]);

    // Find index (A2 corresponds to index 0, so Row 2)
    let rowIndex = -1;
    for (let i = 0; i < dailyDates.length; i++) {
        const dStr = dailyDates[i];
        if (isInRangeFn(dStr)) {
            rowIndex = i;
            break;
        }
    }

    if (rowIndex === -1) {
        console.error(`Date ${TARGET_DATE} not found in Health_Daily! Cannot update.`);
        return;
    }

    const sheetRow = rowIndex + 2;
    console.log(`Found ${TARGET_DATE} at row ${sheetRow}.`);

    // 4. Update Columns
    // SleepDur(7)=H, Eff(8)=I, Deep(9)=J, REM(10)=K, Awake(14)=O

    // Prepare values
    const totalMin = correctStats.totalMin;
    const deepMin = correctStats.deepMin;
    const remMin = correctStats.remMin;
    const awakeMin = correctStats.awakeMin;

    let efficiency = '';
    if ((totalMin + awakeMin) > 0) {
        efficiency = Math.round((totalMin / (totalMin + awakeMin)) * 100) + '%';
    }

    const updates = [
        // Sleep Duration, Efficiency, Deep, REM (Cols H, I, J, K -> indices 7, 8, 9, 10)
        // Actually simpler to update individual cells or a range
        // H:K is contiguous
        {
            range: `Health_Daily!H${sheetRow}:K${sheetRow}`,
            values: [[totalMin, efficiency, deepMin, remMin]]
        },
        // Awake (Col O -> index 14)
        {
            range: `Health_Daily!O${sheetRow}`,
            values: [[awakeMin]]
        }
    ];

    console.log('Sending updates to Google Sheets...');
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });

    console.log('✅ Update complete.');
}

backfillDailyStats().catch(console.error);
