import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Fix Seattle timezone skewed records (-0800 offset)
// This will retroactively correct the Timestamp to match the local time.

async function main() {
    console.log('--- Starting Seattle timezone fix script ---');

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
        const timestampStr = row[0]; // Column A Timestamp
        const dateStr = row[1]; // Column B Date
        const hourStr = row[2]; // Column C Hour
        const rawJsonStr = row[8]; // Column I Raw

        if (rawJsonStr && rawJsonStr !== '{}') {
            try {
                const raw = JSON.parse(rawJsonStr);
                const rawDateStr = raw.date || raw.startDate || null;

                if (rawDateStr) {
                    // Match pattern: YYYY-MM-DD HH:mm:ss -0800
                    const localMatch = rawDateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+-0800/);
                    if (localMatch) {
                        const parts = localMatch[1].split('-');
                        const correctDate = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}/${parts[0]}`;
                        const correctHourStr = localMatch[2];
                        const correctHour = parseInt(correctHourStr, 10).toString();

                        const hourNum = parseInt(correctHourStr, 10);
                        const isPM = hourNum >= 12;
                        const h12 = hourNum % 12 || 12;
                        const correctTimestamp = `${correctDate}, ${h12}:${localMatch[3]}:${localMatch[4]} ${isPM ? 'PM' : 'AM'}`;

                        // If the currently registered Timestamp diverges from the derived PST local time
                        if (row[0] !== correctTimestamp) {
                            console.log(`Row ${i + 1}: Fixing ${row[0]} -> ${correctTimestamp}`);
                            // We need to update Col A, B, and C at row i + 1
                            updates.push({
                                range: `Health_Hourly!A${i + 1}:C${i + 1}`,
                                values: [[correctTimestamp, correctDate, correctHour]]
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
        console.log(`Found ${updates.length} rows to update in Health_Hourly.`);
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
        console.log('No rows found that required timezone fixing for -0800.');
    }
}

main().catch(console.error);
