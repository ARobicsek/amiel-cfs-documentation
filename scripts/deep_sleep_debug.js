#!/usr/bin/env node
/**
 * Deep debug: Compare all sleep calculation paths
 */

import dotenv from 'dotenv';
dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN;
const PRODUCTION_URL = 'https://amiel-cfs-documentation-app.vercel.app';

async function fetch(baseUrl, params) {
    const url = `${baseUrl}/api/get-hourly-data?${params}`;
    const response = await globalThis.fetch(url, {
        headers: { 'Authorization': `Bearer ${SECRET_TOKEN}` },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response.json();
}

async function main() {
    const date = '2026-01-28';
    console.log(`=== Deep Sleep Debug for ${date} ===\n`);

    // 1. Get Single-Day data with summary
    const singleDayData = await fetch(PRODUCTION_URL, `date=${date}`);

    // Summary from statsDataService processHourlyData
    console.log('Single-Day API Response Summary:');
    console.log(`  Sleep entries in summary: ${singleDayData.summary?.totalSleepMin ?? 'N/A'}`);

    // Count sleep_stage rows
    const sleepStageRows = (singleDayData.rows || []).filter(r => r.metric === 'sleep_stage');
    console.log(`  Raw sleep_stage rows returned: ${sleepStageRows.length}`);

    // Group by local date from endDate string
    const byLocalDate = {};
    for (const row of sleepStageRows) {
        try {
            const raw = JSON.parse(row.rawData);
            const localDate = raw.endDate?.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0] || 'unknown';
            if (!byLocalDate[localDate]) byLocalDate[localDate] = [];
            byLocalDate[localDate].push({
                stage: raw.stage,
                durationMins: raw.durationMins,
                startDate: raw.startDate,
                endDate: raw.endDate
            });
        } catch { }
    }

    console.log('\n  Stages by LOCAL endDate:');
    for (const [localDate, stages] of Object.entries(byLocalDate)) {
        const sleepMins = stages
            .filter(s => {
                const st = s.stage?.toLowerCase() || '';
                return st.includes('asleep') || st === 'deep' || st === 'rem' || st === 'core';
            })
            .reduce((sum, s) => sum + (s.durationMins || 0), 0);
        console.log(`    ${localDate}: ${stages.length} stages, ${Math.round(sleepMins)} sleep minutes`);
    }

    // 2. Get Multi-Day data
    const multiDayData = await fetch(PRODUCTION_URL, `startDate=${date}&endDate=${date}`);
    console.log('\n\nMulti-Day API Response for same date:');
    const dayResult = multiDayData.days?.[0];
    if (dayResult?.sleep) {
        console.log(`  Total: ${dayResult.sleep.total}min`);
        console.log(`  Deep: ${dayResult.sleep.deep}min, REM: ${dayResult.sleep.rem}min, Core: ${dayResult.sleep.core}min`);
    } else {
        console.log('  No sleep data');
    }

    // 3. The critical question: Does Single-Day return stages that END on a different date?
    const wrongDateStages = sleepStageRows.filter(r => {
        const raw = JSON.parse(r.rawData);
        const localDate = raw.endDate?.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
        return localDate && localDate !== date;
    });

    console.log(`\n\nStages returned for ${date} but ending on a DIFFERENT local date: ${wrongDateStages.length}`);
    for (const row of wrongDateStages.slice(0, 5)) {
        const raw = JSON.parse(row.rawData);
        console.log(`  ${raw.stage}: ${raw.startDate} -> ${raw.endDate} (${raw.durationMins}min)`);
    }

    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('./scripts/deep_debug_output.json', JSON.stringify({
        date,
        singleDaySummary: singleDayData.summary,
        sleepStageCount: sleepStageRows.length,
        byLocalDate: Object.fromEntries(
            Object.entries(byLocalDate).map(([d, stages]) => [
                d,
                {
                    count: stages.length,
                    sleepMins: Math.round(stages.filter(s => {
                        const st = s.stage?.toLowerCase() || '';
                        return st.includes('asleep') || st === 'deep' || st === 'rem' || st === 'core';
                    }).reduce((sum, s) => sum + (s.durationMins || 0), 0))
                }
            ])
        ),
        multiDayResult: dayResult?.sleep,
        wrongDateStageCount: wrongDateStages.length
    }, null, 2));
    console.log('\nSaved to ./scripts/deep_debug_output.json');
}

main().catch(console.error);
