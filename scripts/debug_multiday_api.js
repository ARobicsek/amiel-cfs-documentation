#!/usr/bin/env node
/**
 * Debug script to test Multi-Day API responses
 * 
 * Compares production (Vercel) vs local API responses for sleep data.
 * 
 * Usage:
 *   node scripts/debug_multiday_api.js
 * 
 * Requires .env with SECRET_TOKEN
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

// Test date range (last 7 days)
const endDate = new Date();
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - 7);

const formatDate = (d) => d.toISOString().split('T')[0];

async function fetchMultiDay(baseUrl, startDate, endDate) {
    const url = `${baseUrl}/api/get-hourly-data?startDate=${startDate}&endDate=${endDate}`;
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

async function main() {
    const start = formatDate(startDate);
    const end = formatDate(endDate);

    console.log(`\n=== Multi-Day API Debug ===`);
    console.log(`Date range: ${start} to ${end}\n`);

    try {
        const prodData = await fetchMultiDay(PRODUCTION_URL, start, end);
        console.log(`\n✅ Production (${PRODUCTION_URL}):`);
        console.log(`   Days returned: ${prodData.days?.length || 0}`);

        // Show sleep data for each day
        console.log('\n   Sleep totals:');
        for (const day of (prodData.days || [])) {
            const sleep = day.sleep;
            if (sleep) {
                const total = sleep.total || 0;
                const hours = Math.floor(total / 60);
                const mins = total % 60;
                console.log(`   ${day.date}: ${hours}h ${mins}m (total=${total}min, deep=${sleep.deep || 0}m, rem=${sleep.rem || 0}m, core=${sleep.core || 0}m)`);
            } else {
                console.log(`   ${day.date}: No sleep data`);
            }
        }
    } catch (err) {
        console.error(`❌ Production error: ${err.message}`);
    }

    try {
        const localData = await fetchMultiDay(LOCAL_URL, start, end);
        console.log(`\n✅ Local (${LOCAL_URL}):`);
        console.log(`   Days returned: ${localData.days?.length || 0}`);

        // Show sleep data for each day
        console.log('\n   Sleep totals:');
        for (const day of (localData.days || [])) {
            const sleep = day.sleep;
            if (sleep) {
                const total = sleep.total || 0;
                const hours = Math.floor(total / 60);
                const mins = total % 60;
                console.log(`   ${day.date}: ${hours}h ${mins}m (total=${total}min, deep=${sleep.deep || 0}m, rem=${sleep.rem || 0}m, core=${sleep.core || 0}m)`);
            } else {
                console.log(`   ${day.date}: No sleep data`);
            }
        }
    } catch (err) {
        console.error(`❌ Local error: ${err.message}`);
    }
}

async function runAndSave() {
    const start = formatDate(startDate);
    const end = formatDate(endDate);

    const results = {
        dateRange: { start, end },
        timestamp: new Date().toISOString(),
        production: null,
        local: null,
        comparison: []
    };

    try {
        const prodData = await fetchMultiDay(PRODUCTION_URL, start, end);
        results.production = prodData.days?.map(d => ({
            date: d.date,
            sleep: d.sleep
        })) || [];
    } catch (err) {
        results.production = { error: err.message };
    }

    try {
        const localData = await fetchMultiDay(LOCAL_URL, start, end);
        results.local = localData.days?.map(d => ({
            date: d.date,
            sleep: d.sleep
        })) || [];
    } catch (err) {
        results.local = { error: err.message };
    }

    // Compare if both succeeded
    if (Array.isArray(results.production) && Array.isArray(results.local)) {
        const prodMap = new Map(results.production.map(d => [d.date, d.sleep]));
        const localMap = new Map(results.local.map(d => [d.date, d.sleep]));
        const allDates = new Set([...prodMap.keys(), ...localMap.keys()]);

        for (const date of [...allDates].sort()) {
            const prod = prodMap.get(date);
            const local = localMap.get(date);
            const diff = {
                date,
                prodTotal: prod?.total || 0,
                localTotal: local?.total || 0,
                difference: (prod?.total || 0) - (local?.total || 0),
                match: (prod?.total || 0) === (local?.total || 0)
            };
            results.comparison.push(diff);
        }
    }

    // Write to file
    const fs = await import('fs');
    const outputPath = './scripts/debug_output.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);

    // Also run main for console output
    await main();
}

runAndSave().catch(console.error);
