#!/usr/bin/env node
/**
 * Test production API only (compare Multi-Day with Single Day calculations)
 */

import dotenv from 'dotenv';
dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN;
const PRODUCTION_URL = 'https://amiel-cfs-documentation-app.vercel.app';

async function fetchSingleDay(baseUrl, date) {
    const url = `${baseUrl}/api/get-hourly-data?date=${date}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${SECRET_TOKEN}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function fetchMultiDay(baseUrl, startDate, endDate) {
    const url = `${baseUrl}/api/get-hourly-data?startDate=${startDate}&endDate=${endDate}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${SECRET_TOKEN}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

// Calculate sleep from raw Single Day data (client-side logic)
function calculateSleepFromRaw(rows, targetDate) {
    const stages = [];
    const seenKeys = new Set();

    const [year, month, day] = targetDate.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

    for (const row of rows) {
        if (row.metric !== 'sleep_stage') continue;

        try {
            const raw = JSON.parse(row.rawData);
            if (!raw.startDate || !raw.endDate) continue;

            const startDate = new Date(raw.startDate).getTime();
            const endDate = new Date(raw.endDate).getTime();
            const key = `${startDate}-${endDate}-${raw.stage}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            // Extract local date from endDate string
            const localDate = raw.endDate.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
            if (localDate !== targetDate) continue;

            const stage = raw.stage?.toLowerCase() || '';
            if (!stage.includes('asleep') && stage !== 'deep' && stage !== 'rem' && stage !== 'core') continue;

            // Clip to day boundaries
            const sStart = Math.max(startDate, dayStart);
            const sEnd = Math.min(endDate, dayEnd);
            if (sStart >= sEnd) continue;

            const clippedMins = (sEnd - sStart) / 60000;
            stages.push({ stage: raw.stage, clippedMins });
        } catch { }
    }

    return Math.round(stages.reduce((sum, s) => sum + s.clippedMins, 0));
}

async function main() {
    const dates = ['2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-02-01', '2026-02-02'];
    const fs = await import('fs');

    console.log('=== Production Multi-Day vs Single Day ===');

    // Get Multi-Day for all dates
    const multiData = await fetchMultiDay(PRODUCTION_URL, '2026-01-27', '2026-02-02');
    const multiByDate = {};
    for (const day of multiData.days) {
        multiByDate[day.date] = day.sleep?.total || 0;
    }

    // Get Single-Day and manually calculate for comparison
    const results = [];
    for (const date of dates) {
        const singleData = await fetchSingleDay(PRODUCTION_URL, date);
        const calculatedFromRaw = calculateSleepFromRaw(singleData.rows, date);
        const multiDayValue = multiByDate[date] || 0;

        const match = calculatedFromRaw === multiDayValue;
        results.push({
            date,
            multiDay: multiDayValue,
            singleDayCalc: calculatedFromRaw,
            match
        });

        console.log(`${date}: Multi=${multiDayValue}min, SingleCalc=${calculatedFromRaw}min, Match=${match ? '✅' : '❌'}`);
    }

    fs.writeFileSync('./scripts/prod_test.json', JSON.stringify(results, null, 2));
    console.log('\nResults saved to ./scripts/prod_test.json');
}

main().catch(console.error);
