#!/usr/bin/env node
/**
 * Check for duplicate stages in raw data
 */

import dotenv from 'dotenv';
dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN;
const PRODUCTION_URL = 'https://amiel-cfs-documentation-app.vercel.app';

async function main() {
    const fs = await import('fs');
    const response = await globalThis.fetch(
        `${PRODUCTION_URL}/api/get-hourly-data?date=2026-01-28`,
        { headers: { 'Authorization': `Bearer ${SECRET_TOKEN}` } }
    );
    const data = await response.json();

    const sleepStages = data.rows.filter(r => r.metric === 'sleep_stage');

    // Check for duplicates
    const seen = new Map(); // key -> count
    const stages = [];

    for (const row of sleepStages) {
        try {
            const raw = JSON.parse(row.rawData);
            if (!raw.startDate || !raw.endDate) continue;

            const key = `${raw.startDate}-${raw.endDate}-${raw.stage}`;
            seen.set(key, (seen.get(key) || 0) + 1);

            stages.push({
                key,
                stage: raw.stage,
                durationMins: raw.durationMins,
                startDate: raw.startDate,
                endDate: raw.endDate
            });
        } catch { }
    }

    const duplicates = [...seen.entries()].filter(([k, count]) => count > 1);
    console.log(`Total sleep_stage rows: ${stages.length}`);
    console.log(`Unique stages: ${seen.size}`);
    console.log(`Duplicate keys (count > 1): ${duplicates.length}`);

    // Calculate totals
    const rawTotal = stages.reduce((sum, s) => sum + (s.durationMins || 0), 0);
    console.log(`\nRaw total (with duplicates): ${Math.round(rawTotal)} min`);

    // Calculate unique total
    const uniqueStages = [];
    const usedKeys = new Set();
    for (const s of stages) {
        if (!usedKeys.has(s.key)) {
            usedKeys.add(s.key);
            uniqueStages.push(s);
        }
    }

    const isSleepStage = (stage) => {
        const st = stage?.toLowerCase() || '';
        return st.includes('asleep') || st === 'deep' || st === 'rem' || st === 'core';
    };

    const uniqueSleepTotal = uniqueStages
        .filter(s => isSleepStage(s.stage))
        .reduce((sum, s) => sum + (s.durationMins || 0), 0);

    console.log(`Unique sleep total (excl awake): ${Math.round(uniqueSleepTotal)} min`);

    // List all unique sleep stages
    console.log('\nUnique sleep stages:');
    const sleepOnlyStages = uniqueStages.filter(s => isSleepStage(s.stage));
    for (const s of sleepOnlyStages) {
        console.log(`  ${s.stage}: ${s.durationMins}min`);
    }

    fs.writeFileSync('./scripts/duplicate_debug.json', JSON.stringify({
        totalRows: stages.length,
        uniqueCount: seen.size,
        duplicateCount: duplicates.length,
        rawTotalMins: Math.round(rawTotal),
        uniqueSleepTotalMins: Math.round(uniqueSleepTotal),
        duplicates: duplicates.map(([k, count]) => ({ key: k, count })),
        uniqueStages: uniqueStages
    }, null, 2));
    console.log('\nSaved to ./scripts/duplicate_debug.json');
}

main().catch(console.error);
