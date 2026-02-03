#!/usr/bin/env node
/**
 * Check for overnight stages
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

    const results = [];
    for (const row of sleepStages) {
        try {
            const raw = JSON.parse(row.rawData);
            const startDateMatch = raw.startDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
            const endDateMatch = raw.endDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);

            if (startDateMatch && endDateMatch) {
                const startLocal = startDateMatch[0];
                const endLocal = endDateMatch[0];

                if (startLocal !== endLocal) {
                    results.push({
                        stage: raw.stage,
                        startDate: raw.startDate,
                        endDate: raw.endDate,
                        durationMins: raw.durationMins,
                        startLocal,
                        endLocal
                    });
                }
            }
        } catch { }
    }

    console.log(`Found ${results.length} overnight stages (start date != end date)`);

    // Also check for stages that cross midnight
    const crossMidnight = [];
    for (const row of sleepStages) {
        try {
            const raw = JSON.parse(row.rawData);
            const startDateStr = raw.startDate;
            const endDateStr = raw.endDate;

            // Extract local date from string (YYYY-MM-DD portion)
            const startLocal = startDateStr?.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
            const endLocal = endDateStr?.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];

            // If stage ends on Jan 28 but starts on a different date, it's overnight
            if (endLocal === '2026-01-28' && startLocal !== '2026-01-28') {
                crossMidnight.push({
                    stage: raw.stage,
                    startDate: raw.startDate,
                    endDate: raw.endDate,
                    durationMins: raw.durationMins,
                    // Calculate clipped duration (midnight to end)
                    note: `Starts on ${startLocal}, ends on ${endLocal}`
                });
            }
        } catch { }
    }

    console.log(`\nStages ending on 2026-01-28 but starting on a different date: ${crossMidnight.length}`);
    for (const s of crossMidnight) {
        console.log(`  ${s.stage}: ${s.durationMins}min - ${s.startDate} -> ${s.endDate}`);
    }

    fs.writeFileSync('./scripts/overnight_debug.json', JSON.stringify({
        overnightCount: results.length,
        overnightStages: results,
        crossMidnightCount: crossMidnight.length,
        crossMidnightStages: crossMidnight
    }, null, 2));
    console.log('\nSaved to ./scripts/overnight_debug.json');
}

main().catch(console.error);
