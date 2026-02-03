/**
 * Compare Health_Daily pre-aggregated sleep totals vs. validated granular sleep data.
 * 
 * This script reads:
 * - docs/new_daily.txt (Health_Daily sheet export)
 * - docs/new_hourly_2.txt (Health_Hourly sheet export with granular sleep_stage data)
 * 
 * And compares the sleep totals for each date to identify discrepancies.
 * 
 * Usage: node scripts/compare_daily_vs_validated.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeValidatedSleepByDate } from '../lib/sleepValidation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Date range to analyze
const START_DATE = '2026-01-27';
const END_DATE = '2026-02-02';

// ================================
// 1. Parse Health_Daily data
// ================================

function parseDailyFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Health_Daily columns:
    // Date(0), Steps(1), AvgHR(2), RestHR(3), MinHR(4), MaxHR(5), HRV(6), 
    // SleepDur(7), Eff(8), Deep(9), REM(10), LastUpd(11), HRCount(12), HRVCount(13), Awake(14)
    const result = {};

    for (const line of lines) {
        // Split by tab
        const cols = line.split('\t');
        if (cols.length < 2) continue;

        const dateStr = cols[0];
        // Skip header
        if (dateStr === 'Date' || !dateStr) continue;

        // Normalize date to YYYY-MM-DD
        const isoDate = normalizeDateToISO(dateStr);
        if (!isoDate) continue;
        if (isoDate < START_DATE || isoDate > END_DATE) continue;

        result[isoDate] = {
            sleepMinutes: cols[7] ? parseFloat(cols[7]) : null,
            deepMinutes: cols[9] ? parseFloat(cols[9]) : null,
            remMinutes: cols[10] ? parseFloat(cols[10]) : null,
            awakeMinutes: cols[14] ? parseFloat(cols[14]) : null,
        };
    }

    return result;
}

function normalizeDateToISO(dateStr) {
    if (!dateStr) return null;

    // Handle M/D/YYYY format
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const [m, d, y] = parts;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
    }

    // Already YYYY-MM-DD
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        return dateStr.split(' ')[0];
    }

    return null;
}

// ================================
// 2. Parse Health_Hourly and compute validated sleep
// ================================

function parseHourlyFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Health_Hourly columns:
    // Timestamp(0), Date(1), Hour(2), Metric(3), Value(4), Min(5), Max(6), Source(7), RawData(8)
    const rows = [];

    for (const line of lines) {
        // Tab-separated
        const cols = line.split('\t');
        if (cols.length < 4) continue;

        // Skip header
        if (cols[0] === 'Timestamp') continue;

        // Return as array matching what computeValidatedSleepByDate expects
        rows.push(cols);
    }

    return rows;
}

function parseDateFn(dateStr) {
    const iso = normalizeDateToISO(dateStr);
    return iso;
}

function isInRangeFn(dateStr) {
    const iso = normalizeDateToISO(dateStr);
    return iso && iso >= START_DATE && iso <= END_DATE;
}

// ================================
// 3. Main comparison
// ================================

async function main() {
    const docsDir = path.join(__dirname, '..', 'docs');
    const dailyPath = path.join(docsDir, 'new_daily.txt');
    const hourlyPath = path.join(docsDir, 'new_hourly_2.txt');

    console.log('='.repeat(70));
    console.log('Health_Daily vs Validated Sleep Comparison');
    console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
    console.log('='.repeat(70));
    console.log();

    // Check files exist
    if (!fs.existsSync(dailyPath)) {
        console.error(`ERROR: ${dailyPath} not found!`);
        console.log('Please export Health_Daily from Google Sheets as TSV.');
        process.exit(1);
    }
    if (!fs.existsSync(hourlyPath)) {
        console.error(`ERROR: ${hourlyPath} not found!`);
        console.log('Please export Health_Hourly from Google Sheets as TSV.');
        process.exit(1);
    }

    // Parse data
    console.log('Parsing Health_Daily...');
    const dailyData = parseDailyFile(dailyPath);
    console.log(`  Found ${Object.keys(dailyData).length} dates in range\n`);

    console.log('Parsing Health_Hourly and computing validated sleep...');
    const hourlyRows = parseHourlyFile(hourlyPath);
    console.log(`  Loaded ${hourlyRows.length} total rows`);

    const validatedData = computeValidatedSleepByDate(hourlyRows, isInRangeFn, parseDateFn);
    console.log(`  Computed validated sleep for ${Object.keys(validatedData).length} dates\n`);

    // Merge dates
    const allDates = new Set([...Object.keys(dailyData), ...Object.keys(validatedData)]);
    const sortedDates = [...allDates].sort();

    // Print comparison table
    console.log('COMPARISON TABLE');
    console.log('-'.repeat(70));
    console.log('Date          | Daily (min) | Validated (min) | Diff (min) | Status');
    console.log('-'.repeat(70));

    let totalDiscrepancy = 0;
    let discrepancyCount = 0;

    for (const date of sortedDates) {
        const daily = dailyData[date];
        const validated = validatedData[date];

        const dailyTotal = daily?.sleepMinutes ?? 0;
        const validatedTotal = validated?.totalMin ?? 0;

        const diff = Math.round(validatedTotal - dailyTotal);
        const status = diff === 0 ? '✅ Match' :
            Math.abs(diff) < 5 ? '⚠️ Close' :
                '❌ Mismatch';

        if (diff !== 0) {
            totalDiscrepancy += Math.abs(diff);
            discrepancyCount++;
        }

        console.log(
            `${date}    | ${String(Math.round(dailyTotal)).padStart(11)} | ${String(Math.round(validatedTotal)).padStart(15)} | ${String(diff).padStart(10)} | ${status}`
        );

        // Show breakdown if there's a mismatch
        if (Math.abs(diff) >= 5) {
            console.log(`              | Deep: ${daily?.deepMinutes ?? '--'} | Deep: ${validated?.deepMin ?? '--'}`);
            console.log(`              | REM:  ${daily?.remMinutes ?? '--'} | REM:  ${validated?.remMin ?? '--'}`);
            console.log(`              | Awake: ${daily?.awakeMinutes ?? '--'} | Awake: ${validated?.awakeMin ?? '--'}`);
            console.log(`              | Core: -- | Core: ${validated?.coreMin ?? '--'}`);
        }
    }

    console.log('-'.repeat(70));
    console.log(`\nSUMMARY:`);
    console.log(`  Total dates compared: ${sortedDates.length}`);
    console.log(`  Dates with discrepancies: ${discrepancyCount}`);
    console.log(`  Total discrepancy: ${totalDiscrepancy} minutes`);
    console.log(`  Average discrepancy: ${discrepancyCount ? Math.round(totalDiscrepancy / discrepancyCount) : 0} minutes`);

    if (discrepancyCount === 0) {
        console.log('\n✅ All dates match! No fix needed.');
    } else {
        console.log('\n❌ Discrepancies found. Recommendation:');
        console.log('   - The validated granular data is more accurate');
        console.log('   - API endpoints (get-entries.js, get-hourly-data.js) already override Health_Daily with validated data');
        console.log('   - Consider: Update health-webhook.js to write correct values at ingestion time');
    }
}

main().catch(console.error);
