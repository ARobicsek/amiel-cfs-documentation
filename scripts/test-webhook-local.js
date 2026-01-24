// scripts/test-webhook-local.js

import handler from '../api/health-webhook.js';

// Mock Response Object
class MockRes {
    constructor() {
        this.statusCode = 200;
        this.headers = {};
        this.body = null;
    }

    setHeader(key, value) {
        this.headers[key] = value;
        return this;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    json(data) {
        this.body = data;
        console.log('Response JSON:', JSON.stringify(data, null, 2));
        return this;
    }

    end() {
        console.log('Response ended');
        return this;
    }
}

// Sample Payload from Health Auto Export (simplified)
const samplePayload = {
    data: {
        metrics: [
            {
                name: "heart_rate",
                units: "bpm",
                data: [
                    { date: new Date().toISOString(), qty: 75, source: "Test Script" },
                    { date: new Date().toISOString(), qty: 82, source: "Test Script" }
                ]
            },
            {
                name: "step_count",
                units: "count",
                data: [
                    { date: new Date().toISOString(), qty: 150, source: "Test Script" }
                ]
            },
            {
                name: "sleep_analysis",
                data: [
                    // 4 hours of core sleep
                    {
                        startDate: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
                        endDate: new Date().toISOString(),
                        value: 'asleep_core',
                        source: "Test Script"
                    }
                ]
            }
        ]
    }
};

// Run Test
async function runTest() {
    console.log('Testing Health Webhook...');

    // Mock Request
    const req = {
        method: 'POST',
        headers: {
            'x-webhook-secret': process.env.ECG_WEBHOOK_SECRET // Load from env
        },
        body: samplePayload
    };

    const res = new MockRes();

    try {
        // Note: This attempts to write to the REAL Google Sheet if creds are loaded!
        // We should be careful. 
        // Ideally we'd mock the Google Sheets API too, but that's complex for this script.
        // Let's just run it to see if it parses correctly. 
        // Since it writes to 'Health_Hourly' and 'Health_Daily' for TODAY, it will add a few rows.
        // This confirms End-to-End connectivity.
        await handler(req, res);

        if (res.statusCode === 200) {
            console.log('✅ Test Passed: Webhook processed successfully.');
        } else {
            console.error('❌ Test Failed: Status', res.statusCode);
        }

    } catch (error) {
        console.error('❌ Test Crashed:', error);
    }
}

// Ensure env vars are loaded (if running via node directly, might need dotenv)
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

runTest();
