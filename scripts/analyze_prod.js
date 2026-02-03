#!/usr/bin/env node
/**
 * Debug script to analyze raw Multi-Day API response
 * Shows detailed stage analysis to understand date attribution
 */

import dotenv from 'dotenv';
dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN;
const PRODUCTION_URL = 'https://amiel-cfs-documentation-app.vercel.app';

async function fetchRawData(baseUrl, date) {
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

async function main() {
    const date = '2026-01-28';
    const fs = await import('fs');

    console.log('=== PRODUCTION ANALYSIS ===');

    // Get raw single-day data
    const singleDayData = await fetchRawData(PRODUCTION_URL, date);
    console.log(`Single-day rows: ${singleDayData.rows.length}`);

    // Count sleep_stage rows
    const sleepStages = singleDayData.rows.filter(r => r.metric === 'sleep_stage');
    console.log(`Sleep stage rows: ${sleepStages.length}`);

    // Get multi-day data for Jan 27-29
    const multiDayData = await fetchMultiDay(PRODUCTION_URL, '2026-01-27', '2026-01-29');
    console.log(`\nMulti-day response for Jan 27-29:`);
    for (const day of multiDayData.days) {
        const s = day.sleep;
        if (s) {
            console.log(`  ${day.date}: total=${s.total}min (deep=${s.deep}, rem=${s.rem}, core=${s.core}, awake=${s.awake})`);
        } else {
            console.log(`  ${day.date}: No sleep data`);
        }
    }

    // Analyze stage attribution
    console.log('\n=== Stage Attribution Analysis ===');
    // Group stages by their END date
    const byEndDate = {};
    for (const row of sleepStages) {
        try {
            const raw = JSON.parse(row.rawData);
            const endDate = new Date(raw.endDate);
            const endIso = endDate.toISOString().split('T')[0];
            if (!byEndDate[endIso]) byEndDate[endIso] = [];
            byEndDate[endIso].push({
                stage: raw.stage,
                startDate: raw.startDate,
                endDate: raw.endDate,
                durationMins: raw.durationMins
            });
        } catch { }
    }

    for (const [endIso, stages] of Object.entries(byEndDate)) {
        const totalMins = stages
            .filter(s => s.stage?.toLowerCase().includes('asleep') || ['deep', 'rem', 'core'].includes(s.stage?.toLowerCase()))
            .reduce((sum, s) => sum + (s.durationMins || 0), 0);
        console.log(`Stages ending on ${endIso}: ${stages.length} stages, ${Math.round(totalMins)} sleep minutes`);
    }

    // Save detailed data
    fs.writeFileSync('./scripts/prod_analysis.json', JSON.stringify({
        singleDayRowCount: singleDayData.rows.length,
        sleepStageCount: sleepStages.length,
        multiDayResult: multiDayData.days,
        stagesByEndDate: byEndDate
    }, null, 2));

    console.log('\nResults saved to: ./scripts/prod_analysis.json');
}

main().catch(console.error);
