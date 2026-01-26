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
    console.log('Starting cleanup script V2...');
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Fetch Health_Daily to find stubborn duplicates
    console.log('Fetching Health_Daily...');
    const dailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A:A',
    });
    const dailyDates = dailyRes.data.values ? dailyRes.data.values.map(r => r[0]) : [];

    // Find duplicates with strict string comparison AND trimmed comparison
    // Logic: Keep the LAST row for each unique date (assuming it's the most recent/correct from my previous script).
    const uniqueMap = {}; // Date -> Last Index

    // Scan everything
    dailyDates.forEach((rawDate, i) => {
        if (!rawDate || rawDate === 'Date') return;
        const date = rawDate.trim(); // Normalize
        uniqueMap[date] = i + 2; // Store row index (1-based), overwriting previous occurrences
    });

    const rowsToDelete = [];
    dailyDates.forEach((rawDate, i) => {
        if (!rawDate || rawDate === 'Date') return;
        const date = rawDate.trim();
        const rowIdx = i + 2;
        // If this row is NOT the last one we saw for this date, delete it.
        if (uniqueMap[date] !== rowIdx) {
            rowsToDelete.push(rowIdx);
        }
    });

    if (rowsToDelete.length > 0) {
        console.log(`Found ${rowsToDelete.length} duplicates to delete.`, rowsToDelete);
        rowsToDelete.sort((a, b) => b - a); // Delete bottom up just in case, though batch delete works by logic

        // We need the sheetId for Health_Daily
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const dailySheetDef = meta.data.sheets.find(s => s.properties.title === 'Health_Daily');
        if (!dailySheetDef) throw new Error('Health_Daily sheet not found');

        const requests = rowsToDelete.map(rowIndex => ({
            deleteDimension: {
                range: {
                    sheetId: dailySheetDef.properties.sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex - 1,
                    endIndex: rowIndex
                }
            }
        }));

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: { requests }
        });
        console.log('Duplicates deleted.');
    } else {
        console.log('No duplicates found in Daily sheet (Validation succeeded).');
    }

    // 2. Fetch Hourly Data to fix Sleep Timestamps for recent rows (Jan 24 onwards)
    console.log('Fetching Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A:I',
    });
    const dataRows = hourlyRes.data.values || [];

    const updates = [];

    for (let i = 1; i < dataRows.length; i++) {
        const row = dataRows[i];
        const metric = row[3];
        const rawJsonStr = row[8];
        const currentDate = row[1];

        // Only target sleep rows for Jan 24/25+ to apply timestamp fix
        if (metric.startsWith('sleep_') && (currentDate.includes('1/24/2026') || currentDate.includes('1/25/2026') || currentDate.includes('1/26/2026'))) {
            try {
                const raw = JSON.parse(rawJsonStr);
                // Look for sleepEnd in raw JSON (if exploded from webhook or original)
                // Note: My previous script didn't inject `sleepEnd` into the new rows' JSON? 
                // Ah, I injected `{ created_by: 'fix-script' }`.
                // But `sleep_analysis` main row HAS it.
                // If I want to fix timestamp for exploded rows, I might need to find the parent `sleep_analysis`?
                // OR: Just fix `sleep_analysis` timestamp?
                // User asked: "timestamp for all sleep fields is the time of sleepEnd".
                // I can only fix it IF I validly know the sleepEnd.

                let sleepEnd = raw.sleepEnd;
                // If this is an exploded row (created_by: fix-script), we don't have sleepEnd in JSON.
                // We'd have to look it up.
                // Complex... can we lookup from the 'sleep_analysis' row for same date/source?
                // Let's settle for fixing `sleep_analysis` rows first, as those have the JSON.

                if (sleepEnd) {
                    // Update Column A (Timestamp)
                    // Row index i + 1.
                    const dateObj = new Date(sleepEnd);
                    const newTimestamp = dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' });

                    // Also update Date/Hour Columns B/C to match sleepEnd
                    const newDateStr = dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
                    const newTimeStr = dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
                    const newHourStr = newTimeStr.split(':')[0];

                    updates.push({
                        range: `Health_Hourly!A${i + 1}:C${i + 1}`,
                        values: [[newTimestamp, newDateStr, newHourStr]]
                    });
                }
            } catch (e) { }
        }
    }

    if (updates.length > 0) {
        console.log(`Updating timestamps for ${updates.length} sleep rows...`);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
        console.log('Timestamps updated.');
    } else {
        console.log('No timestamps needed update.');
    }

    console.log('Done.');
}

run().catch(console.error);
