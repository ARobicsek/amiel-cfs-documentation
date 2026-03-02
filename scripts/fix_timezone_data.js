import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Fix March 1 and March 2 timezone skewed records
const TARGET_DATES = ['3/2/2026', '3/1/2026', '3/3/2026'];

async function main() {
    console.log('--- Starting timezone fix script ---');

    // 1. Auth setup
    const keyPath = path.resolve('.env');
    let credentialsStr;
    try {
        const envFile = fs.readFileSync(keyPath, 'utf8');
        // Extract everything after GOOGLE_SERVICE_ACCOUNT_KEY=
        const match = envFile.match(/GOOGLE_SERVICE_ACCOUNT_KEY=(\{.*?\})/s);
        if (!match) throw new Error("Could not find GOOGLE_SERVICE_ACCOUNT_KEY in .env");
        credentialsStr = match[1];
    } catch (e) {
        console.error('Error reading credentials:', e);
        process.exit(1);
    }

    const credentials = JSON.parse(credentialsStr);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // We get the Sheet ID from env file too
    const envFileFull = fs.readFileSync(keyPath, 'utf8');
    const sheetMatch = envFileFull.match(/GOOGLE_SHEET_ID=(.*?)\r?\n/);
    const SHEET_ID = sheetMatch ? sheetMatch[1] : '';

    if (!SHEET_ID) {
        console.error("Could not find GOOGLE_SHEET_ID");
        process.exit(1);
    }

    console.log(`Using Sheet ID: ${SHEET_ID}`);

    // Fetch the Health_Hourly sheet
    console.log('Fetching Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A:I',
    });

    const rows = hourlyRes.data.values || [];
    if (rows.length < 2) {
        console.log('Sheet empty or no data.');
        return;
    }

    const updates = [];
    let fixCount = 0;

    // Loop through the rows. Note: index 0 is header
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const dateStr = row[1]; // Column B Date
        const rawJsonStr = row[8]; // Column I Raw

        // We only want to look at March 1, March 2, March 3 
        // because the skew shifted data forward, so March 1 data might be under March 2, etc.
        if (TARGET_DATES.includes(dateStr) && rawJsonStr && rawJsonStr !== '{}') {
            try {
                const raw = JSON.parse(rawJsonStr);
                const rawDateStr = raw.date || raw.startDate || null;

                if (rawDateStr) {
                    // Match pattern: YYYY-MM-DD HH:mm:ss
                    const localMatch = rawDateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
                    if (localMatch) {
                        const parts = localMatch[1].split('-');
                        const correctDate = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}/${parts[0]}`;
                        const correctHour = parseInt(localMatch[2], 10).toString();

                        // If the currently registered Date or Hour diverges from what the raw json says it actually is...
                        if (row[1] !== correctDate || row[2] !== correctHour) {
                            console.log(`Row ${i + 1}: Fixing ${row[1]} ${row[2]} -> ${correctDate} ${correctHour}`);
                            // We need to update Col B (Date) and Col C (Hour) at row i + 1
                            updates.push({
                                range: `Health_Hourly!B${i + 1}:C${i + 1}`,
                                values: [[correctDate, correctHour]]
                            });
                            fixCount++;
                        }
                    }
                }
            } catch (err) {
                // Ignore parse errors on individual rows
            }
        }
    }

    if (updates.length > 0) {
        console.log(`Pushing ${updates.length} row updates to Health_Hourly...`);
        // We'll chunk to avoid too large payloads
        const CHUNK_SIZE = 500;
        for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
            const chunk = updates.slice(i, i + CHUNK_SIZE);
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: chunk
                }
            });
            console.log(`Pushed chunk ${i / CHUNK_SIZE + 1} / ${Math.ceil(updates.length / CHUNK_SIZE)}`);
        }

        console.log('--- Finished fixing Health_Hourly data ---');
        console.log(`Updated ${fixCount} records.`);
        console.log('Note: Re-calculating Health_Daily totals will naturally fix itself when the daily aggregation triggers again to sort the sheet.');
    } else {
        console.log('No rows found that required timezone fixing.');
    }
}

main().catch(console.error);
