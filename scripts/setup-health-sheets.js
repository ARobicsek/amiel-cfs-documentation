import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.GOOGLE_SHEET_ID) {
  console.error('Error: Missing GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SHEET_ID in .env.local');
  process.exit(1);
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function setupSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Checking existing sheets...');
  
  const doc = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingTitles = doc.data.sheets.map(s => s.properties.title);

  const requests = [];

  // 1. Health_Daily
  if (!existingTitles.includes('Health_Daily')) {
    console.log('Queueing creation of Health_Daily...');
    requests.push({
      addSheet: {
        properties: { title: 'Health_Daily', gridProperties: { frozenRowCount: 1 } }
      }
    });
  }

  // 2. Health_Hourly
  if (!existingTitles.includes('Health_Hourly')) {
    console.log('Queueing creation of Health_Hourly...');
    requests.push({
      addSheet: {
        properties: { title: 'Health_Hourly', gridProperties: { frozenRowCount: 1 } }
      }
    });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests }
    });
    console.log('Sheets created.');
  } else {
    console.log('Sheets already exist.');
  }

  // Header Definitions
  const dailyHeaders = [
    'Date', 'Steps', 'Avg HR', 'Resting HR', 'Min HR', 'Max HR',
    'HRV (SDNN)', 'Sleep Duration (min)', 'Sleep Efficiency', 'Deep Sleep (min)', 'REM Sleep (min)',
    'Last Updated', 'HR Sample Count', 'HRV Sample Count', 'Awake Minutes'
  ];

  const hourlyHeaders = [
    'Timestamp', 'Date', 'Hour', 'Metric', 'Value', 'Min', 'Max', 'Source', 'Raw Data'
  ];

  // Update Headers
  console.log('Updating headers...');
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Health_Daily!A1:O1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [dailyHeaders] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Health_Hourly!A1:I1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [hourlyHeaders] }
  });

  console.log('Success! Health sheets are ready.');
}

setupSheets().catch(console.error);
