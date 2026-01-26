import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../docs');
const hourlyFile = path.join(docsDir, 'Jan_24_25_hourly.txt');

async function verify() {
    console.log('Reading mock data from:', hourlyFile);
    let content = fs.readFileSync(hourlyFile, 'utf-8');

    // FIX: The provided text file has a missing newline between row 80 and 81 (Heart Rate and Sleep Analysis).
    // We manually insert the newline to simulate correct Sheet data.
    // Pattern seems to be: json closing brace, tabs, then date '1/25/2026'
    // Regex: /}\t+1\/25\/2026/ -> "}\n1/25/2026"
    content = content.replace(/}\t+(1\/25\/2026)/g, '}\n$1');

    const lines = content.split('\n');

    const existingRows = [];
    lines.slice(1).forEach(l => {
        if (!l.trim()) return;
        const parts = l.split('\t');
        existingRows.push(parts);
    });

    console.log(`Loaded ${existingRows.length} hourly rows (after split fix).`);

    // ---------------------------------------------------------
    // COPY OF LOGIC FROM api/health-webhook.js (Re-aggregation part)
    // ---------------------------------------------------------

    const rowsByDate = {};
    const affectedDates = new Set();

    existingRows.forEach(row => {
        const dateStr = row[1];
        if (dateStr) {
            if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
            rowsByDate[dateStr].push(row);
            affectedDates.add(dateStr);
        }
    });

    for (const dateStr of affectedDates) {
        // Only verify relevant dates
        if (!['1/24/2026', '1/25/2026'].includes(dateStr)) continue;

        const daysRows = rowsByDate[dateStr] || [];

        // Stats Containers
        let totalSteps = 0;
        let hrSum = 0;
        let hrCount = 0;
        let sleepMinutes = 0;

        for (const row of daysRows) {
            const metric = row[3];
            const val = Number(row[4]);

            // Handle Raw Json (Col index 8)
            let rawJson = {};
            try {
                if (row[8]) rawJson = JSON.parse(row[8]);
            } catch (e) { }

            if (metric === 'step_count' && !isNaN(val)) {
                totalSteps += val;
            } else if (metric === 'heart_rate' && !isNaN(val)) {
                hrSum += val;
                hrCount++;
            } else if (metric === 'sleep_analysis') {
                // Logic for sleep analysis
                if (rawJson.totalSleep) {
                    sleepMinutes += (rawJson.totalSleep * 60); // Hours -> Mins
                } else {
                    // If no totalSleep, sum components? 
                    // In the Jan 24/25 file, totalSleep is 3.129...
                }

                // Fallback if totalSleep not used above (my code used explicit check)
                if (sleepMinutes === 0 && rawJson.totalSleep) sleepMinutes += (rawJson.totalSleep * 60);

            } else if (metric.startsWith('sleep_')) {
                // ...
            }
        }

        const finalSteps = Math.round(totalSteps * 100) / 100;
        const finalAvgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;

        console.log(`[${dateStr}]`);
        console.log(`  Steps: ${finalSteps}`);
        console.log(`  Avg HR: ${finalAvgHr} (Samples: ${hrCount})`);
        console.log(`  Sleep Mins: ${Math.round(sleepMinutes)}`);
        console.log('------------------------------------------------');
    }
}

verify();
