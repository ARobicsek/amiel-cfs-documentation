import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOURLY_FILE = path.join(__dirname, '../docs/new_hourly.txt');

function parseTSV(content) {
    if (!content) return [];
    const lines = content.trim().split('\n');
    const headers = lines[0].split('\t');
    return lines.slice(1).map(line => {
        const values = line.split('\t');
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i];
        });
        return obj;
    });
}

function calculate() {
    try {
        const content = fs.readFileSync(HOURLY_FILE, 'utf8');
        const data = parseTSV(content);

        // Filter for Jan 27, 2026
        // Note: Apple Health timestamps are often End Time.
        // We filter by date column string which comes from the sheet.
        const targetRows = data.filter(r => r['Date'] === '1/27/2026' && r['Metric'].startsWith('sleep_'));

        if (targetRows.length === 0) {
            console.log('No sleep rows found for 1/27/2026.');
            return;
        }

        // Sort by timestamp
        targetRows.sort((a, b) => new Date(a['Timestamp']) - new Date(b['Timestamp']));

        const sessions = {};
        const uniqueSignatures = new Set();

        console.log('--- RAW ROWS FOUND ---');
        targetRows.forEach(row => {
            const metric = row['Metric'];
            const val = parseFloat(row['Value']);
            const ts = row['Timestamp'];
            const signature = `${metric}|${ts}|${val}`;

            // Deduplicate
            const isDup = uniqueSignatures.has(signature);
            console.log(`${ts} | ${metric.padEnd(15)} | ${val} min ${isDup ? '(DUP)' : ''}`);

            if (isDup) return;
            uniqueSignatures.add(signature);

            // Ignore summary row for addition, but keeping it for context if needed
            if (metric === 'sleep_analysis') return;

            if (!sessions[ts]) {
                sessions[ts] = { deep: 0, core: 0, rem: 0, awake: 0 };
            }

            if (metric === 'sleep_deep') sessions[ts].deep += val;
            if (metric === 'sleep_core') sessions[ts].core += val;
            if (metric === 'sleep_rem') sessions[ts].rem += val;
            if (metric === 'sleep_awake') sessions[ts].awake += val;
        });

        console.log('\n--- CALCULATED SESSIONS ---');
        let grandTotal = 0;
        let grandAwake = 0;

        Object.keys(sessions).forEach(ts => {
            const s = sessions[ts];
            const sessionTotal = s.deep + s.core + s.rem;
            grandTotal += sessionTotal;
            grandAwake += s.awake;

            console.log(`\nSession Ending: ${ts}`);
            console.log(`Total Sleep: ${sessionTotal} min`);
            console.log(` - Deep:  ${s.deep}`);
            console.log(` - Core:  ${s.core}`);
            console.log(` - REM:   ${s.rem}`);
            console.log(` - Awake: ${s.awake}`);
        });

        console.log('\n================================');
        console.log(`GRAND TOTAL SLEEP: ${grandTotal} min`);
        console.log(`GRAND TOTAL AWAKE: ${grandAwake} min`);
        console.log('================================');

    } catch (e) {
        console.error('Error:', e);
    }
}

calculate();
