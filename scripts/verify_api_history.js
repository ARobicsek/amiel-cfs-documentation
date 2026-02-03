
import fetch from 'node-fetch';

const API_URL = 'http://localhost:3000/api/get-entries?limit=10';
const SECRET_TOKEN = 'dev-secret-token-12345';

async function verifyHistory() {
    console.log(`Fetching entries from ${API_URL}...`);
    try {
        const response = await fetch(API_URL, {
            headers: {
                'Authorization': `Bearer ${SECRET_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const entries = data.entries || [];

        console.log(`Received ${entries.length} entries.`);

        // Find Feb 2, 2026
        const targetDate = '2026-02-02';
        const entry = entries.find(e => e.normalizedDate === targetDate);

        if (entry) {
            console.log(`\nEntry for ${targetDate}:`);

            if (entry.health) {
                console.log(`  Sleep Minutes: ${entry.health.sleepMinutes}`);
                console.log(`  Deep: ${entry.health.deepSleep}`);
                console.log(`  REM: ${entry.health.remSleep}`);
                console.log(`  Awake: ${entry.health.awakeMinutes}`);

                // Expected value: 313 (from validation script)
                // Health_Daily has 0
                if (Math.abs(entry.health.sleepMinutes - 313) < 5) {
                    console.log('\n✅ VERIFIED: API returns corrected sleep total (matches validation)!');
                } else if (entry.health.sleepMinutes === 0) {
                    console.log('\n❌ FAILED: API returns 0 (Health_Daily value) instead of validated total.');
                } else {
                    console.log(`\n⚠️  MISMATCH: API returns ${entry.health.sleepMinutes}, expected ~313.`);
                }
            } else {
                console.log('  No health data found on entry.');
            }
        } else {
            console.log(`\n❌ Entry for ${targetDate} not found.`);
            console.log('Available dates:', entries.map(e => e.normalizedDate).join(', '));
        }

    } catch (error) {
        console.error('Test failed:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('Is the API server running? Try `npm run dev:api`');
        }
    }
}

verifyHistory();
