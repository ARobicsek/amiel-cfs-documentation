/**
 * One-off script: Remove duplicate rows from Health_Hourly and re-aggregate Health_Daily.
 * 
 * Usage: node scripts/cleanup_hourly_duplicates.js
 * 
 * Requires: GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_SHEET_ID env vars
 *           (load via .env or set manually)
 * 
 * What it does:
 * 1. Reads ALL rows from Health_Hourly
 * 2. Deduplicates using (timestamp + metric + value + source) as the key
 * 3. Overwrites Health_Hourly with deduplicated rows
 * 4. Re-aggregates Health_Daily step totals for affected dates
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { computeValidatedSleepByDate } from '../lib/sleepValidation.js';

function getAuth() {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

function parseDateToIso(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

async function main() {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const SHEET_ID = process.env.GOOGLE_SHEET_ID.trim();

    // ── 1. Read Health_Hourly ──
    console.log('Reading Health_Hourly...');
    const hourlyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A:I',
    });

    const header = hourlyRes.data.values?.[0] || [];
    const allRows = hourlyRes.data.values?.slice(1) || [];
    console.log(`  Total rows (with header): ${allRows.length}`);

    // ── 2. Deduplicate ──
    // Key: timestamp (col 0) + metric (col 3) + value (col 4) + source (col 7)
    const seen = new Set();
    const dedupedRows = [];
    let dupCount = 0;
    const affectedDates = new Set();

    for (const row of allRows) {
        const timestamp = (row[0] || '').trim();
        const metric = (row[3] || '').trim();
        const value = (row[4] || '').trim();
        const source = (row[7] || '').trim();

        const key = `${timestamp}|${metric}|${value}|${source}`;

        if (seen.has(key)) {
            dupCount++;
            const dateStr = (row[1] || '').trim();
            if (dateStr) affectedDates.add(dateStr);
            continue;
        }

        seen.add(key);
        dedupedRows.push(row);
    }

    console.log(`  Unique rows: ${dedupedRows.length}`);
    console.log(`  Duplicates removed: ${dupCount}`);
    console.log(`  Affected dates: ${[...affectedDates].sort().join(', ')}`);

    if (dupCount === 0) {
        console.log('\nNo duplicates found. Nothing to do.');
        return;
    }

    // ── 3. Overwrite Health_Hourly ──
    console.log('\nClearing Health_Hourly data rows...');

    // Get sheet metadata for the clear
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets(properties(sheetId,title))',
    });
    const hourlySheet = spreadsheet.data.sheets.find(
        s => s.properties.title === 'Health_Hourly'
    );

    if (!hourlySheet) {
        throw new Error('Health_Hourly sheet not found!');
    }

    // Clear all rows below header
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: 'Health_Hourly!A2:I',
    });

    // Write back deduplicated rows
    console.log(`Writing ${dedupedRows.length} deduplicated rows...`);

    // Write in batches of 5000 to avoid API limits
    const BATCH_SIZE = 5000;
    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
        const batch = dedupedRows.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Health_Hourly!A:I',
            valueInputOption: 'RAW',
            requestBody: { values: batch },
        });
        console.log(`  Written rows ${i + 1}–${Math.min(i + BATCH_SIZE, dedupedRows.length)}`);
    }

    // ── 4. Re-aggregate Health_Daily for affected dates ──
    console.log('\nRe-aggregating Health_Daily for affected dates...');

    // Read existing Health_Daily dates
    const dailyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Health_Daily!A2:A',
    });
    const dailyDates = (dailyRes.data.values || []).map(r => r[0]);

    // Group deduplicated hourly rows by date
    const rowsByDate = {};
    for (const row of dedupedRows) {
        const dateStr = (row[1] || '').trim();
        if (!dateStr) continue;
        if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
        rowsByDate[dateStr].push(row);
    }

    const dailyUpdates = [];

    for (const dateStr of affectedDates) {
        const daysRows = rowsByDate[dateStr] || [];

        // Steps (with dedup — but rows are already deduplicated)
        let totalSteps = 0;
        let hrSum = 0, hrCount = 0, hrMin = null, hrMax = null;
        let restingHrValues = [];
        let hrvSum = 0, hrvCount = 0;

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
        }

        // Validated sleep
        const isoDateStr = parseDateToIso(dateStr);
        const sleepResult = computeValidatedSleepByDate(
            dedupedRows,
            (d) => parseDateToIso(d) === isoDateStr,
            parseDateToIso
        );
        const validatedSleep = sleepResult[isoDateStr] || { totalMin: 0, deepMin: 0, remMin: 0, coreMin: 0, awakeMin: 0 };

        // HR Awake/Asleep
        const sleepPeriods = [];
        for (const row of daysRows) {
            if (row[3] === 'sleep_stage') {
                try {
                    const raw = JSON.parse(row[8] || '{}');
                    if (raw.startDate && raw.endDate) {
                        const stage = (raw.stage || '').toLowerCase();
                        if (stage === 'awake' || stage === 'inbed') continue;
                        const sMs = new Date(raw.startDate).getTime();
                        const eMs = new Date(raw.endDate).getTime();
                        if (!isNaN(sMs) && !isNaN(eMs)) sleepPeriods.push({ startMs: sMs, endMs: eMs });
                    }
                } catch (e) { /* skip */ }
            }
        }

        let hrAwakeSum = 0, hrAwakeCount = 0, hrAsleepSum = 0, hrAsleepCount = 0;
        for (const row of daysRows) {
            if (row[3] !== 'heart_rate') continue;
            const val = Number(row[4]);
            if (isNaN(val)) continue;
            let hrTs = null;
            try {
                const raw = JSON.parse(row[8] || '{}');
                if (raw.date) hrTs = new Date(raw.date).getTime();
            } catch (e) { /* skip */ }
            if (!hrTs) hrTs = new Date(row[0]).getTime();
            if (isNaN(hrTs)) continue;
            const isDuringSleep = sleepPeriods.some(p => hrTs >= p.startMs && hrTs < p.endMs);
            if (isDuringSleep) { hrAsleepSum += val; hrAsleepCount++; }
            else { hrAwakeSum += val; hrAwakeCount++; }
        }

        const finalSteps = Math.round(totalSteps * 100) / 100;
        const finalAvgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : '';
        const finalRestingHr = restingHrValues.length > 0 ? restingHrValues[restingHrValues.length - 1] : '';
        const finalHrv = hrvCount > 0 ? (Math.round((hrvSum / hrvCount) * 10) / 10) : '';
        const sleepMinutes = validatedSleep.totalMin;
        const awakeMinutes = validatedSleep.awakeMin;
        const finalSleepMin = Math.round(sleepMinutes);
        const finalDeep = Math.round(validatedSleep.deepMin);
        const finalRem = Math.round(validatedSleep.remMin);
        const finalAwake = Math.round(awakeMinutes);
        let finalEfficiency = '';
        if ((sleepMinutes + awakeMinutes) > 0) {
            finalEfficiency = Math.round((sleepMinutes / (sleepMinutes + awakeMinutes)) * 100) + '%';
        }
        const finalHrAwake = hrAwakeCount > 0 ? Math.round(hrAwakeSum / hrAwakeCount) : '';
        const finalHrAsleep = hrAsleepCount > 0 ? Math.round(hrAsleepSum / hrAsleepCount) : '';

        const lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
        const rowValues = [
            dateStr, finalSteps, finalAvgHr, finalRestingHr,
            hrMin !== null ? hrMin : '', hrMax !== null ? hrMax : '',
            finalHrv,
            finalSleepMin !== 0 ? finalSleepMin : '', finalEfficiency,
            finalDeep !== 0 ? finalDeep : '', finalRem !== 0 ? finalRem : '',
            lastUpdated,
            hrCount !== 0 ? hrCount : '', hrvCount !== 0 ? hrvCount : '',
            finalAwake !== 0 ? finalAwake : '',
            finalHrAwake, finalHrAsleep,
        ];

        // Find row index for this date
        const dateIdx = dailyDates.findIndex(d => d && d.trim() === dateStr);
        if (dateIdx >= 0) {
            const sheetRow = dateIdx + 2;
            dailyUpdates.push({
                range: `Health_Daily!A${sheetRow}:Q${sheetRow}`,
                values: [rowValues],
            });
            console.log(`  ${dateStr}: steps ${finalSteps} (row ${sheetRow})`);
        } else {
            console.log(`  ${dateStr}: steps ${finalSteps} (no existing Daily row — skipping)`);
        }
    }

    if (dailyUpdates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: dailyUpdates,
            },
        });
        console.log(`  Updated ${dailyUpdates.length} Health_Daily rows`);
    }

    // ── 5. Sort sheets ──
    console.log('\nSorting sheets...');
    const hourlySheetId = hourlySheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: [{
                sortRange: {
                    range: {
                        sheetId: hourlySheetId,
                        startRowIndex: 1,
                        startColumnIndex: 0,
                        endColumnIndex: 9,
                    },
                    sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }],
                },
            }],
        },
    });

    console.log('\n✅ Cleanup complete!');
    console.log(`   Removed ${dupCount} duplicate rows from Health_Hourly`);
    console.log(`   Re-aggregated ${dailyUpdates.length} Health_Daily rows`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
