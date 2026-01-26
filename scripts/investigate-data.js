import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../docs');
const hourlyFile = path.join(docsDir, 'Jan_24_25_hourly.txt');

function run() {
    console.log('Reading:', hourlyFile);
    const content = fs.readFileSync(hourlyFile, 'utf-8');
    const lines = content.split('\n');

    // Skip header
    const dataLines = lines.slice(1).filter(l => l.trim().length > 0);

    let totalSteps = 0;
    let hrSum = 0;
    let hrCount = 0;
    let hrMin = null;
    let hrMax = null;

    let jan24Steps = 0;
    let jan25Steps = 0;

    console.log(`Processing ${dataLines.length} rows...`);

    dataLines.forEach((line, index) => {
        // Tab separated
        // Timestamp	Date	Hour	Metric	Value	Min	Max	Source	Raw Data
        const parts = line.split('\t');
        if (parts.length < 5) return;

        const dateStr = parts[1]; // 1/24/2026
        const metric = parts[3];
        const value = parseFloat(parts[4]);

        if (metric === 'step_count') {
            if (!isNaN(value)) {
                if (dateStr.includes('1/24/2026') || dateStr.includes('2026-01-24')) {
                    jan24Steps += value;
                }
                if (dateStr.includes('1/25/2026') || dateStr.includes('2026-01-25')) {
                    jan25Steps += value;
                }
                totalSteps += value;
            }
        }

        if (metric === 'heart_rate') {
            if (!isNaN(value) && (dateStr.includes('1/24/2026'))) {
                hrSum += value;
                hrCount++;
                if (hrMin === null || value < hrMin) hrMin = value;
                if (hrMax === null || value > hrMax) hrMax = value;
            }
        }
    });

    console.log('------------------------------------------------');
    console.log('Jan 24 Steps Total:', jan24Steps);
    console.log('Jan 25 Steps Total:', jan25Steps);
    console.log('Total Steps parsed:', totalSteps);
    console.log('------------------------------------------------');
    console.log('Jan 24 Heart Rate Stats (from Hourly Sheet):');
    console.log('Count:', hrCount);
    console.log('Avg:', hrCount > 0 ? hrSum / hrCount : 0);
    console.log('Min:', hrMin);
    console.log('Max:', hrMax);

}

run();
