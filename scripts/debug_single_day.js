#!/usr/bin/env node
/**
 * Debug script to test Single Day API responses and compare sleep calculation
 * 
 * Usage:
 *   node scripts/debug_single_day.js 2026-01-27
 */

import dotenv from 'dotenv';
dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN;
if (!SECRET_TOKEN) {
    console.error('ERROR: SECRET_TOKEN not found in .env');
    process.exit(1);
}

const PRODUCTION_URL = 'https://amiel-cfs-documentation-app.vercel.app';
const LOCAL_URL = 'http://localhost:3000';

const targetDate = process.argv[2] || '2026-02-02';

async function fetchSingleDay(baseUrl, date) {
    const url = `${baseUrl}/api/get-hourly-data?date=${date}`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${SECRET_TOKEN}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response.json();
}

function parseSleepStage(rawDataStr) {
    if (!rawDataStr) return null;
    try {
        const data = JSON.parse(rawDataStr);
        if (!data.startDate || !data.endDate) return null;
        return {
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            stage: data.stage || 'unknown',
            durationMins: data.durationMins || 0,
        };
    } catch {
        return null;
    }
}

function isSleepStage(stage) {
    if (!stage) return false;
    const s = stage.toLowerCase();
    return s.includes('asleep') || s === 'deep' || s === 'rem' || s === 'core';
}

function analyzeData(data, date) {
    const stages = [];
    const seenStageKeys = new Set();
    let dupeCount = 0;

    // Parse day boundaries
    const [year, month, day] = date.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

    for (const row of data.rows || []) {
        if (row.metric === 'sleep_stage') {
            const stage = parseSleepStage(row.rawData);
            if (stage) {
                const stageKey = `${stage.startDate.getTime()}-${stage.endDate.getTime()}-${stage.stage}`;
                if (seenStageKeys.has(stageKey)) {
                    dupeCount++;
                    continue;
                }
                seenStageKeys.add(stageKey);

                // Attribute to day based on END date
                const endDate = stage.endDate;
                const stageIsoDate = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

                if (stageIsoDate === date && isSleepStage(stage.stage)) {
                    // Clip to day boundaries
                    const sStart = Math.max(stage.startDate.getTime(), dayStart);
                    const sEnd = Math.min(stage.endDate.getTime(), dayEnd);
                    if (sStart < sEnd) {
                        const clippedMins = (sEnd - sStart) / 60000;
                        stages.push({
                            stage: stage.stage,
                            startDate: new Date(sStart).toISOString(),
                            endDate: new Date(sEnd).toISOString(),
                            durationMins: stage.durationMins,
                            clippedMins: Math.round(clippedMins * 100) / 100,
                        });
                    }
                }
            }
        }
    }

    // Sum clipped durations
    const totalMins = stages.reduce((sum, s) => sum + s.clippedMins, 0);

    return {
        rowCount: data.rows?.length || 0,
        sleepStageCount: stages.length,
        duplicatesRemoved: dupeCount,
        totalSleepMins: Math.round(totalMins),
        stages
    };
}

async function main() {
    console.log(`\n=== Single Day API Debug: ${targetDate} ===\n`);

    const results = { date: targetDate, production: null, local: null };

    try {
        const prodData = await fetchSingleDay(PRODUCTION_URL, targetDate);
        results.production = analyzeData(prodData, targetDate);
        console.log(`Production: ${results.production.totalSleepMins} min`);
    } catch (err) {
        console.error(`❌ Production error: ${err.message}`);
        results.production = { error: err.message };
    }

    try {
        const localData = await fetchSingleDay(LOCAL_URL, targetDate);
        results.local = analyzeData(localData, targetDate);
        console.log(`Local: ${results.local.totalSleepMins} min`);
    } catch (err) {
        console.error(`❌ Local error: ${err.message}`);
        results.local = { error: err.message };
    }

    // Write to file
    const fs = await import('fs');
    const outputPath = './scripts/single_day_debug.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
