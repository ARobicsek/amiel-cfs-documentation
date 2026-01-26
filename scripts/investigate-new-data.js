
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../docs');
// Use the new files provided by the user
const hourlyFile = path.join(docsDir, 'new_hourly.txt');
const dailyFile = path.join(docsDir, 'new_daily.txt');

function run() {
    console.log('Reading:', hourlyFile);
    const content = fs.readFileSync(hourlyFile, 'utf-8');
    const lines = content.split('\n');

    // Skip header
    const dataLines = lines.slice(1).filter(l => l.trim().length > 0);

    const stats = {};

    dataLines.forEach((line) => {
        // Tab separated
        // Timestamp	Date	Hour	Metric	Value	Min	Max	Source	Raw Data
        const parts = line.split('\t');
        if (parts.length < 5) return;

        const dateStr = parts[1];
        const metric = parts[3];
        const value = parseFloat(parts[4]);

        if (!stats[dateStr]) {
            stats[dateStr] = { steps: 0, hrSum: 0, hrCount: 0, sleep: 0 };
        }

        if (metric === 'step_count' && !isNaN(value)) {
            stats[dateStr].steps += value;
        }

        if (metric === 'heart_rate' && !isNaN(value)) {
            stats[dateStr].hrSum += value;
            stats[dateStr].hrCount++;
        }

        // Sleep Analysis from Raw JSON
        if (metric === 'sleep_analysis') {
            try {
                const raw = JSON.parse(parts[8] || '{}');
                if (raw.totalSleep) {
                    stats[dateStr].sleep += (raw.totalSleep * 60);
                }
            } catch (e) { }
        }
    });

    console.log('--- Aggregation Results from HOURY file ---');
    Object.keys(stats).sort().forEach(date => {
        if (date.includes('1/24/2026') || date.includes('1/25/2026') || date.includes('1/26/2026')) {
            const avgHr = stats[date].hrCount > 0 ? Math.round(stats[date].hrSum / stats[date].hrCount) : 0;
            console.log(`[${date}] Steps: ${Math.round(stats[date].steps * 100) / 100}, AvgHR: ${avgHr}, SleepMin: ${stats[date].sleep}`);
        }
    });

    console.log('\n--- Daily File Content for Comparison ---');
    const dailyContent = fs.readFileSync(dailyFile, 'utf-8');
    dailyContent.split('\n').forEach(l => {
        if (l.includes('1/24/2026') || l.includes('1/25/2026')) {
            console.log(l);
        }
    });
}

run();
