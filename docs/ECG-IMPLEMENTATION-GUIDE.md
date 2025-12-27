# ECG Feature Implementation Guide

**For developers of all skill levels**

This guide provides step-by-step instructions to implement **fully automatic** ECG capture functionality in the CFS Daily Tracker app. The user only needs to take an ECG on their Apple Watch - everything else happens automatically.

**Key Design Principle:** The user has chronic fatigue syndrome. They cannot be expected to manually enter data, calculate ratios, or perform multiple steps. The solution must be **zero daily effort** after initial setup.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1: Google Drive & Sheets Setup](#3-phase-1-google-drive--sheets-setup-30-minutes)
4. [Phase 2: ECG Webhook Endpoint](#4-phase-2-ecg-webhook-endpoint-2-3-hours)
5. [Phase 3: Health Auto Export Configuration](#5-phase-3-health-auto-export-configuration-30-minutes)
6. [Phase 4: ECG Display in App](#6-phase-4-ecg-display-in-app-2-3-hours)
7. [R/S Ratio Calculation Algorithm](#7-rs-ratio-calculation-algorithm)
8. [Testing Guide](#8-testing-guide)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Overview

### What We're Building

A **fully automatic** system to capture daily ECG data:

| Data Captured | Source | Storage | User Effort |
|---------------|--------|---------|-------------|
| Full ECG waveform (~15,000 samples) | Apple Watch → Health Auto Export | Google Drive (CSV) | **None** |
| R/S ratio | **Calculated automatically** from waveform | Google Sheets | **None** |
| Heart rate | From ECG metadata | Google Sheets | **None** |
| Classification | From Apple (Sinus Rhythm, etc.) | Google Sheets | **None** |

### Target User Experience

**Daily routine (after one-time setup):**
1. ⌚ Take 30-second ECG on Apple Watch
2. ✅ **Done!** - Everything syncs and calculates automatically

**There is NO manual data entry. The R/S ratio is calculated server-side from the raw voltage data.**

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ APPLE WATCH                                                      │
│ └─ User takes 30-second ECG (only user action required)         │
└────────────────────────┬────────────────────────────────────────┘
                         │ (automatic)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ iPHONE                                                           │
│ └─ Health app stores ECG automatically                          │
│ └─ Health Auto Export detects new ECG                           │
│ └─ Sends to webhook automatically (background)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS POST (automatic, no user action)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ VERCEL SERVERLESS FUNCTION (/api/ecg-webhook)                   │
│ └─ Receives ~15,000 voltage samples                             │
│ └─ Calculates R/S ratio automatically                           │
│ └─ Stores full waveform to Google Drive                         │
│ └─ Stores metadata + R/S ratio to Google Sheets                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌─────────────────────┐     ┌─────────────────────────────────────┐
│ GOOGLE DRIVE        │     │ GOOGLE SHEETS                        │
│ └─ Waveform CSVs    │     │ └─ ECG_Readings sheet               │
│ └─ ~15KB per ECG    │     │    - Date, HR, R/S ratio (auto)     │
│ └─ Full raw data    │     │    - R amplitude, S amplitude       │
└─────────────────────┘     └─────────────────────────────────────┘
```

---

## 2. Prerequisites

**Complete these before starting development.**

### Required Accounts & Tools

- [ ] Google Cloud project (already set up for this app)
- [ ] Vercel account with project deployed
- [ ] iPhone with Apple Watch (user has this)
- [ ] **Health Auto Export app ($2.99)** - Purchase now on user's iPhone

### One-Time iPhone Setup (User Does This Once)

1. Purchase [Health Auto Export](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069) ($2.99)
2. Open the app and grant access to Health data
3. Specifically enable access to **Electrocardiograms**
4. Configuration details provided in Phase 3

---

## 3. Phase 1: Google Drive & Sheets Setup (30 Minutes)

**Goal:** Prepare storage infrastructure for ECG data.

### Step 1.1: Enable Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project (the one already used for Sheets)
3. Go to **APIs & Services** → **Library**
4. Search for "Google Drive API"
5. Click **Enable**

### Step 1.2: Get Service Account Email

1. Go to **IAM & Admin** → **Service Accounts**
2. Click on your existing service account
3. Copy the service account email (looks like `cfs-tracker@project-name.iam.gserviceaccount.com`)

### Step 1.3: Create ECG Storage Folder

1. Go to [Google Drive](https://drive.google.com)
2. Create a new folder called `CFS-ECG-Data`
3. Right-click the folder → **Share**
4. Paste the service account email
5. Set permission to **Editor**
6. Click **Share**
7. Copy the folder ID from the URL:
   - URL: `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j`
   - Folder ID: `1a2b3c4d5e6f7g8h9i0j` (the long string after `/folders/`)

### Step 1.4: Create ECG_Readings Sheet

1. Open your existing Google Sheet for this project
2. Click **+** at bottom to add new sheet tab
3. Name it exactly: `ECG_Readings`
4. Add these column headers in Row 1:

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Date | Classification | Avg Heart Rate | R/S Ratio | R Amplitude | S Amplitude | Notes | Waveform URL | Sample Count |

5. Format columns:
   - Column A: Format → Date time
   - Column D: Format → Number, 0 decimals
   - Column E: Format → Number, 2 decimals
   - Columns F, G: Format → Number, 0 decimals

### Step 1.5: Generate Webhook Secret

Run this in your terminal:
```bash
openssl rand -hex 32
```

Save the output (64 character string) - you'll need it in the next steps.

### Step 1.6: Add Environment Variables to Vercel

Go to your Vercel project → Settings → Environment Variables. Add:

| Variable | Value |
|----------|-------|
| `GOOGLE_DRIVE_FOLDER_ID` | The folder ID from Step 1.3 |
| `ECG_WEBHOOK_SECRET` | The secret from Step 1.5 |

**Commit checkpoint:**
```bash
git add .
git commit -m "Phase 1: Configure Google Drive and Sheets for ECG storage"
git push
```

---

## 4. Phase 2: ECG Webhook Endpoint (2-3 Hours)

**Goal:** Create the server endpoint that receives ECG data, calculates R/S ratio, and stores everything.

### Step 2.1: Create the Webhook Endpoint

**Create new file:** `api/ecg-webhook.js`

Copy this entire file:

```javascript
import { google } from 'googleapis';
import { Readable } from 'stream';

// Initialize Google APIs
function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate webhook
  const webhookSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.ECG_WEBHOOK_SECRET?.trim();

  if (!webhookSecret || webhookSecret !== expectedSecret) {
    console.log('ECG Webhook: Invalid secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const ecgData = req.body;

    console.log('ECG Webhook received:', JSON.stringify(ecgData, null, 2).slice(0, 500));

    // Extract ECG information
    // Health Auto Export sends data in various formats - handle common ones
    const ecg = extractECGData(ecgData);

    if (!ecg) {
      return res.status(400).json({ error: 'Could not parse ECG data' });
    }

    const auth = getGoogleAuth();

    // Store raw waveform data in Google Drive
    let waveformUrl = '';
    if (ecg.voltageMeasurements && ecg.voltageMeasurements.length > 0) {
      waveformUrl = await storeWaveformData(auth, ecg);
    }

    // Calculate R/S ratio from voltage data
    let rsRatio = null;
    let rAmplitude = null;
    let sAmplitude = null;

    if (ecg.voltageMeasurements && ecg.voltageMeasurements.length > 0) {
      const rsResult = calculateRSRatio(ecg.voltageMeasurements, ecg.samplingFrequency || 512);
      rsRatio = rsResult.rsRatio;
      rAmplitude = rsResult.rAmplitude;
      sAmplitude = rsResult.sAmplitude;
    }

    // Store metadata in Google Sheets
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Get current Eastern Time
    const now = new Date();
    const etOptions = { timeZone: 'America/New_York' };
    const timestamp = now.toLocaleString('en-US', etOptions);
    const dateStr = ecg.date || now.toLocaleDateString('en-US', etOptions);

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'ECG_Readings!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,                              // A: Timestamp
          dateStr,                                // B: Date
          ecg.classification || '',               // C: Classification
          ecg.averageHeartRate || '',             // D: Avg Heart Rate
          rsRatio !== null ? rsRatio.toFixed(2) : '',  // E: R/S Ratio
          rAmplitude !== null ? Math.round(rAmplitude) : '',  // F: R Amplitude (µV)
          sAmplitude !== null ? Math.round(sAmplitude) : '',  // G: S Amplitude (µV)
          'Auto-sync',                            // H: Notes
          waveformUrl,                            // I: Waveform URL
          ecg.voltageMeasurements?.length || '',  // J: Sample count
        ]],
      },
    });

    console.log('ECG saved successfully:', {
      date: dateStr,
      classification: ecg.classification,
      hr: ecg.averageHeartRate,
      rsRatio,
      samples: ecg.voltageMeasurements?.length,
    });

    return res.status(200).json({
      success: true,
      message: 'ECG data saved',
      rsRatio,
      rAmplitude,
      sAmplitude,
    });

  } catch (error) {
    console.error('ECG Webhook error:', error);
    return res.status(500).json({
      error: 'Failed to process ECG data',
      details: error.message,
    });
  }
}

/**
 * Extract ECG data from various Health Auto Export formats
 */
function extractECGData(data) {
  // Direct format
  if (data.classification && data.voltageMeasurements) {
    return {
      classification: data.classification,
      averageHeartRate: data.averageHeartRate || data.heartRate,
      samplingFrequency: data.samplingFrequency || 512,
      voltageMeasurements: data.voltageMeasurements,
      date: data.startDate || data.date,
    };
  }

  // Nested in 'data' field
  if (data.data && data.data.electrocardiogram) {
    const ecg = data.data.electrocardiogram;
    return {
      classification: ecg.classification,
      averageHeartRate: ecg.averageHeartRate,
      samplingFrequency: ecg.samplingFrequency || 512,
      voltageMeasurements: ecg.voltageMeasurements,
      date: ecg.startDate,
    };
  }

  // Array format (multiple ECGs)
  if (Array.isArray(data) && data.length > 0) {
    const ecg = data[0]; // Take most recent
    return extractECGData(ecg);
  }

  // Nested in 'metrics' field
  if (data.metrics && data.metrics.electrocardiogram) {
    return extractECGData(data.metrics.electrocardiogram);
  }

  console.log('Unknown ECG format:', Object.keys(data));
  return null;
}

/**
 * Store waveform data as CSV in Google Drive
 */
async function storeWaveformData(auth, ecg) {
  const drive = google.drive({ version: 'v3', auth });

  // Create CSV content
  const csvLines = ['Time (s),Voltage (µV)'];
  const samplingRate = ecg.samplingFrequency || 512;

  ecg.voltageMeasurements.forEach((v, i) => {
    const time = (v.timeSinceSampleStart !== undefined)
      ? v.timeSinceSampleStart
      : (i / samplingRate);
    const voltage = v.microVolts !== undefined ? v.microVolts : v;
    csvLines.push(`${time.toFixed(6)},${voltage}`);
  });

  const csvContent = csvLines.join('\n');
  const buffer = Buffer.from(csvContent, 'utf-8');
  const stream = Readable.from(buffer);

  // Generate filename with timestamp
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
  const fileName = `ECG_${dateStr}_${timeStr}.csv`;

  // Upload to Google Drive
  const driveResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID.trim()],
    },
    media: {
      mimeType: 'text/csv',
      body: stream,
    },
    fields: 'id, webViewLink',
  });

  // Make file viewable
  await drive.permissions.create({
    fileId: driveResponse.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return driveResponse.data.webViewLink;
}

/**
 * Calculate R/S ratio from voltage measurements
 *
 * Algorithm:
 * 1. Apply simple bandpass filter to remove baseline wander
 * 2. Detect R peaks (local maxima above threshold)
 * 3. For each R peak, find the S wave (local minimum after R)
 * 4. Calculate R amplitude (peak voltage) and S amplitude (trough depth)
 * 5. Return average R/S ratio across all detected beats
 */
function calculateRSRatio(voltageMeasurements, samplingRate = 512) {
  // Convert to simple array of voltages
  const voltages = voltageMeasurements.map(v =>
    v.microVolts !== undefined ? v.microVolts : v
  );

  if (voltages.length < samplingRate) {
    return { rsRatio: null, rAmplitude: null, sAmplitude: null };
  }

  // Simple moving average baseline removal
  const windowSize = Math.floor(samplingRate * 0.2); // 200ms window
  const baseline = movingAverage(voltages, windowSize);
  const filtered = voltages.map((v, i) => v - (baseline[i] || 0));

  // Find R peaks
  const rPeaks = findRPeaks(filtered, samplingRate);

  if (rPeaks.length < 2) {
    // Not enough beats detected, use global max/min
    const maxV = Math.max(...filtered);
    const minV = Math.min(...filtered);

    if (maxV > 0 && minV < 0) {
      return {
        rsRatio: Math.abs(maxV / minV),
        rAmplitude: maxV,
        sAmplitude: Math.abs(minV),
      };
    }
    return { rsRatio: null, rAmplitude: null, sAmplitude: null };
  }

  // Calculate R and S amplitudes for each beat
  const rsRatios = [];
  const rAmplitudes = [];
  const sAmplitudes = [];

  for (const rPeakIdx of rPeaks) {
    const rAmplitude = filtered[rPeakIdx];

    // Look for S wave within 100ms after R peak
    const searchEnd = Math.min(rPeakIdx + Math.floor(samplingRate * 0.1), filtered.length);
    let sIdx = rPeakIdx;
    let sAmplitude = filtered[rPeakIdx];

    for (let i = rPeakIdx + 1; i < searchEnd; i++) {
      if (filtered[i] < sAmplitude) {
        sAmplitude = filtered[i];
        sIdx = i;
      }
    }

    // S wave should be negative
    if (sAmplitude < 0 && rAmplitude > 0) {
      const ratio = rAmplitude / Math.abs(sAmplitude);
      rsRatios.push(ratio);
      rAmplitudes.push(rAmplitude);
      sAmplitudes.push(Math.abs(sAmplitude));
    }
  }

  if (rsRatios.length === 0) {
    return { rsRatio: null, rAmplitude: null, sAmplitude: null };
  }

  // Return median values (more robust than mean)
  rsRatios.sort((a, b) => a - b);
  rAmplitudes.sort((a, b) => a - b);
  sAmplitudes.sort((a, b) => a - b);

  const medianIdx = Math.floor(rsRatios.length / 2);

  return {
    rsRatio: rsRatios[medianIdx],
    rAmplitude: rAmplitudes[medianIdx],
    sAmplitude: sAmplitudes[medianIdx],
  };
}

/**
 * Simple moving average filter
 */
function movingAverage(arr, windowSize) {
  const result = [];
  let sum = 0;

  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= windowSize) {
      sum -= arr[i - windowSize];
      result.push(sum / windowSize);
    } else {
      result.push(sum / (i + 1));
    }
  }

  return result;
}

/**
 * Find R peaks using simple threshold-based detection
 */
function findRPeaks(voltages, samplingRate) {
  const peaks = [];

  // Calculate threshold (60% of max amplitude)
  const maxV = Math.max(...voltages);
  const threshold = maxV * 0.6;

  // Minimum distance between R peaks (~300ms for 200 BPM max)
  const minDistance = Math.floor(samplingRate * 0.3);

  let lastPeakIdx = -minDistance;

  for (let i = 2; i < voltages.length - 2; i++) {
    // Check if local maximum
    if (voltages[i] > voltages[i - 1] &&
        voltages[i] > voltages[i - 2] &&
        voltages[i] > voltages[i + 1] &&
        voltages[i] > voltages[i + 2] &&
        voltages[i] > threshold &&
        i - lastPeakIdx >= minDistance) {
      peaks.push(i);
      lastPeakIdx = i;
    }
  }

  return peaks;
}
```

### Step 2.2: Deploy and Test Webhook

1. Commit and deploy:
```bash
git add api/ecg-webhook.js
git commit -m "Add ECG webhook endpoint with R/S ratio calculation"
git push
```

2. Wait for Vercel deployment to complete

3. Test the webhook with curl:
```bash
curl -X POST https://YOUR-APP.vercel.app/api/ecg-webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET_HERE" \
  -d '{"classification":"SinusRhythm","averageHeartRate":72,"samplingFrequency":512,"voltageMeasurements":[{"microVolts":100},{"microVolts":300},{"microVolts":800},{"microVolts":200},{"microVolts":-300},{"microVolts":-100},{"microVolts":50}]}'
```

4. Check:
   - Vercel logs show "ECG saved successfully"
   - Google Sheets ECG_Readings has new row
   - Google Drive folder has new CSV file

---

## 5. Phase 3: Health Auto Export Configuration (30 Minutes)

**Goal:** Configure the iPhone app to automatically send ECG data to your webhook.

### Step 3.1: Open Health Auto Export on iPhone

The user should already have purchased and installed the app (see Prerequisites).

### Step 3.2: Create Automation

1. Open **Health Auto Export** app
2. Tap **Automations** tab at bottom
3. Tap **+ New Automation**

### Step 3.3: Configure Automation Settings

Fill in these settings exactly:

| Setting | Value |
|---------|-------|
| **Name** | CFS ECG Sync |
| **Export Type** | REST API |
| **URL** | `https://YOUR-APP.vercel.app/api/ecg-webhook` |
| **Method** | POST |
| **Format** | JSON |

### Step 3.4: Add Authentication Header

1. Scroll to **Headers** section
2. Tap **Add Header**
3. Enter:
   - **Key:** `X-Webhook-Secret`
   - **Value:** (paste the ECG_WEBHOOK_SECRET from Phase 1)

### Step 3.5: Select Data to Export

1. Scroll to **Data** section
2. Tap to configure
3. **Deselect everything** except:
   - ✅ **Electrocardiogram** (ECG)
4. Make sure "Include raw samples" or similar option is **enabled**

### Step 3.6: Set Trigger

1. Scroll to **Trigger** section
2. Select: **When new data is available**
   - This sends ECG data automatically after each recording
   - Alternative: Set a schedule (e.g., hourly) if you prefer batching

### Step 3.7: Save and Enable

1. Tap **Save**
2. Make sure the automation toggle is **ON** (green)
3. You may need to add the Automations widget to your home screen for best background sync

### Step 3.8: Test the Full Flow

1. On Apple Watch, take a 30-second ECG
2. Wait 1-5 minutes for Health Auto Export to sync
3. Check Google Sheets → ECG_Readings for new row
4. Verify R/S Ratio column has a calculated value

**Note:** iOS may delay background syncs. For immediate testing:
- Open Health Auto Export app
- Tap the manual sync button if available
- Or wait a few minutes with the app in foreground

---

## 6. Phase 4: ECG Display in App (Optional, 2-3 Hours)

**Goal:** Show ECG history in the CFS Tracker app.

This phase is optional. The automatic capture already works - this just adds a way to view ECG data in the app.

### Step 4.1: Create ECG History API

**Create new file:** `api/get-ecg-readings.js`

```javascript
import { google } from 'googleapis';

function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.SECRET_TOKEN?.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID.trim(),
      range: 'ECG_Readings!A:J',
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return res.status(200).json({ readings: [] });
    }

    // Parse rows (skip header)
    const readings = rows.slice(1).map(row => ({
      timestamp: row[0] || '',
      date: row[1] || '',
      classification: row[2] || '',
      heartRate: row[3] || '',
      rsRatio: row[4] || '',
      rAmplitude: row[5] || '',
      sAmplitude: row[6] || '',
      notes: row[7] || '',
      waveformUrl: row[8] || '',
      sampleCount: row[9] || '',
    })).reverse(); // Most recent first

    return res.status(200).json({ readings: readings.slice(0, 30) }); // Last 30

  } catch (error) {
    console.error('Get ECG readings error:', error);
    return res.status(500).json({ error: error.message });
  }
}
```

### Step 4.2: Create ECG History Component

**Create new file:** `src/components/ECGHistory.jsx`

```jsx
import { useState, useEffect } from 'react';
import { authenticatedFetch } from '../utils/api';
import './ECGHistory.css';

export default function ECGHistory() {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchReadings();
  }, []);

  async function fetchReadings() {
    try {
      const response = await authenticatedFetch('/api/get-ecg-readings');
      if (!response.ok) throw new Error('Failed to fetch ECG readings');
      const data = await response.json();
      setReadings(data.readings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="ecg-history loading">Loading ECG data...</div>;
  if (error) return <div className="ecg-history error">Error: {error}</div>;
  if (readings.length === 0) return <div className="ecg-history empty">No ECG readings yet</div>;

  return (
    <div className="ecg-history">
      <h2>ECG History</h2>
      <div className="readings-list">
        {readings.map((reading, i) => (
          <div key={i} className="reading-card">
            <div className="reading-date">{reading.date}</div>
            <div className="reading-stats">
              <span className="stat">
                <strong>R/S:</strong> {reading.rsRatio || 'N/A'}
              </span>
              <span className="stat">
                <strong>HR:</strong> {reading.heartRate || 'N/A'} bpm
              </span>
              <span className="stat classification">
                {reading.classification || 'Unknown'}
              </span>
            </div>
            {reading.waveformUrl && (
              <a href={reading.waveformUrl} target="_blank" rel="noopener noreferrer"
                 className="view-waveform">View Waveform</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 4.3: Add ECG History Styles

**Create new file:** `src/components/ECGHistory.css`

```css
.ecg-history { padding: 1rem; }
.ecg-history h2 { margin: 0 0 1rem; font-size: 1.25rem; }
.readings-list { display: flex; flex-direction: column; gap: 0.75rem; }

.reading-card {
  padding: 1rem;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color, #e5e7eb);
}

.reading-date { font-weight: 600; margin-bottom: 0.5rem; }
.reading-stats { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.9rem; }
.stat strong { color: var(--text-muted, #6b7280); }
.classification { background: #dbeafe; color: #1e40af; padding: 0.125rem 0.5rem; border-radius: 0.25rem; }

.view-waveform {
  display: inline-block; margin-top: 0.5rem;
  color: var(--accent, #3b82f6); font-size: 0.85rem;
}

@media (prefers-color-scheme: dark) {
  .reading-card { background: #1f2937; border-color: #374151; }
  .classification { background: #1e3a5f; color: #93c5fd; }
}
```

### Step 4.4: Add ECG Tab to Navigation

Update `src/App.jsx` to add an ECG tab in the navigation (similar to how History tab works).

---

## 7. R/S Ratio Calculation Algorithm

The R/S ratio is calculated automatically in the webhook. Here's how it works:

### Algorithm Steps

1. **Baseline Removal**
   - Apply 200ms moving average filter
   - Subtract baseline from signal to center waveform

2. **R Peak Detection**
   - Find local maxima (points higher than neighbors)
   - Filter by threshold (60% of max amplitude)
   - Enforce minimum 300ms between peaks (max 200 BPM)

3. **S Wave Detection**
   - For each R peak, search the next 100ms
   - Find the minimum value (most negative point)
   - This is the S wave

4. **Ratio Calculation**
   - R amplitude = voltage at R peak
   - S amplitude = |voltage at S wave|
   - R/S ratio = R amplitude ÷ S amplitude

5. **Median Selection**
   - Calculate ratio for each beat
   - Return median value (robust to outliers)

### Accuracy Notes

- Apple Watch = single-lead ECG (Lead I equivalent)
- R/S ratio varies by lead; Lead I may differ from V1-V6
- Best used for **tracking changes over time**
- Not equivalent to clinical 12-lead ECG

---

## 8. Testing Guide

### Test Checklist

- [ ] Google Drive API enabled
- [ ] ECG folder created and shared with service account
- [ ] ECG_Readings sheet created with headers
- [ ] Environment variables set in Vercel
- [ ] Webhook responds to curl test
- [ ] R/S ratio appears in test response
- [ ] CSV file appears in Google Drive
- [ ] Row appears in Google Sheets
- [ ] Health Auto Export configured
- [ ] Real ECG syncs automatically

### Sample Test Payload

```json
{
  "classification": "SinusRhythm",
  "averageHeartRate": 72,
  "samplingFrequency": 512,
  "startDate": "2025-01-15T10:30:00Z",
  "voltageMeasurements": [
    {"microVolts": 50, "timeSinceSampleStart": 0},
    {"microVolts": 200, "timeSinceSampleStart": 0.002},
    {"microVolts": 800, "timeSinceSampleStart": 0.004},
    {"microVolts": 300, "timeSinceSampleStart": 0.006},
    {"microVolts": -400, "timeSinceSampleStart": 0.008},
    {"microVolts": -100, "timeSinceSampleStart": 0.010},
    {"microVolts": 50, "timeSinceSampleStart": 0.012}
  ]
}
```

---

## 9. Troubleshooting

### "401 Unauthorized" on webhook
- Check `X-Webhook-Secret` header matches `ECG_WEBHOOK_SECRET`
- Verify no whitespace in the secret value
- Redeploy Vercel after adding env variable

### "Could not parse ECG data"
- Check Vercel logs for the raw body received
- Health Auto Export may send different JSON structure
- Update `extractECGData()` to handle new format

### Files not appearing in Google Drive
- Verify service account email has Editor access to folder
- Check `GOOGLE_DRIVE_FOLDER_ID` is just the ID (not full URL)
- Check Vercel logs for Drive API errors

### R/S ratio is null
- ECG must have at least 1 second of data
- Check voltage data format matches expected structure
- Verify `microVolts` field exists

### Health Auto Export not syncing
- Open the app to trigger foreground sync
- Check automation is enabled (green toggle)
- Verify ECG data type is selected
- iOS background limits may delay sync

### Debug Logging

Add to webhook for debugging:
```javascript
console.log('=== ECG DEBUG ===');
console.log('Body:', JSON.stringify(req.body, null, 2).slice(0, 500));
```

---

## Summary

| Phase | Time | What It Does |
|-------|------|--------------|
| 1 | 30 min | Set up Google Drive folder and Sheets |
| 2 | 2-3 hrs | Create webhook with R/S calculation |
| 3 | 30 min | Configure Health Auto Export |
| 4 | 2-3 hrs | (Optional) Add ECG history view in app |

### Final Result

**Daily user experience:**
1. ⌚ Take 30-second ECG on Apple Watch
2. ✅ **Done!**

Everything else happens automatically:
- Health Auto Export sends data to webhook
- Webhook calculates R/S ratio
- Full waveform saved to Google Drive
- Metadata saved to Google Sheets

**No manual data entry required.**
