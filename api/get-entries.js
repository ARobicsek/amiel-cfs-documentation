/**
 * GET /api/get-entries
 *
 * Fetches recent entries from Google Sheets, including ECG and Health data.
 * Merges daily entries with ECG readings and Health Auto Export stats by date.
 *
 * Query params:
 *   limit: number (default: 10, max: 30)
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { entries: Array<Entry> }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to fetch entries" }
 */

import { google } from 'googleapis';
import { computeValidatedSleepByDate } from '../lib/sleepValidation.js';

// Normalize date string to YYYY-MM-DD format for comparison
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  let date;

  // Handle various formats
  if (dateStr.includes('T')) {
    // ISO format: 2025-12-28T00:28:24
    date = new Date(dateStr);
  } else if (dateStr.includes(',')) {
    // Format: 12/28/2025, 12:28:24 AM
    date = new Date(dateStr);
  } else if (dateStr.includes('/')) {
    // Format: 12/28/2025 or MM/DD/YYYY
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      date = new Date(year, parseInt(month) - 1, parseInt(day));
    }
  } else if (dateStr.includes('-')) {
    // Format: 2025-12-28
    date = new Date(dateStr + 'T12:00:00');
  }

  if (!date || isNaN(date.getTime())) return null;

  // Return YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse ECG timestamp to get both normalized date and timestamp for sorting
function parseECGTimestamp(timestampStr) {
  if (!timestampStr) return { date: null, timestamp: 0 };

  let date;

  if (timestampStr.includes(',')) {
    // Format: 12/28/2025, 12:28:24 AM
    date = new Date(timestampStr);
  } else if (timestampStr.includes('T')) {
    // ISO format
    date = new Date(timestampStr);
  } else {
    date = new Date(timestampStr);
  }

  if (!date || isNaN(date.getTime())) {
    return { date: null, timestamp: 0 };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    timestamp: date.getTime()
  };
}

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate authorization
  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse query params - default to 10 entries
  const limit = Math.min(parseInt(req.query.limit) || 10, 30);

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Fetch daily entries, ECG readings, Health Data, and Hourly data in parallel
    const [entriesResponse, ecgResponse, healthResponse, hourlyResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A:V', // Extended to include all meds (K-V)
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'ECG_Readings!A:E', // Timestamp, Date, Classification, Avg HR, R/S Ratio
      }).catch(() => ({ data: { values: [] } })), // Handle if ECG sheet doesn't exist
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Health_Daily!A:O', // Date, Steps, AvgHR, RestHR, MinHR, MaxHR, HRV, SleepDur, Eff, Deep, REM, LastUpd, HRCount, HRVCount, Awake
      }).catch(() => ({ data: { values: [] } })), // Handle if Health sheet doesn't exist
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Health_Hourly!A2:I', // For validated sleep computation
      }).catch(() => ({ data: { values: [] } }))
    ]);

    // Process daily entries - index by normalized date
    const entriesRows = entriesResponse.data.values || [];
    const entriesDataRows = entriesRows.slice(1); // Skip header

    const entriesByDate = {};
    const ecgPlanByDate = {}; // Separate map for willDoECG, keyed by ECG Plan Date (column J)

    for (const row of entriesDataRows) {
      const dateFor = row[1]; // Column B is the date the entry is FOR
      const normalizedDate = normalizeDate(dateFor);
      if (normalizedDate) {
        // Keep the most recent entry for each date (last one wins)
        entriesByDate[normalizedDate] = {
          timestamp: row[0],
          date: dateFor,
          hours: parseFloat(row[2]) || 0,
          comments: row[3] || null,
          oxaloacetate: row[4] ? parseFloat(row[4]) : null,
          exercise: row[5] ? parseInt(row[5]) : null,
          brainTime: row[6] ? parseFloat(row[6]) : null,
          modafinil: row[7] || null, // Keeping for backward compatibility or if used as fallback
          // New Meds (Columns K-V)
          vitaminD: row[10] || null,
          venlafaxine: row[11] || null,
          tirzepatide: row[12] || null,
          oxaloacetateNew: row[13] || null,
          nyquil: row[14] || null,
          modafinilNew: row[15] || null,
          dextromethorphan: row[16] || null,
          dayquil: row[17] || null,
          amitriptyline: row[18] || null,
          senna: row[19] || null,
          melatonin: row[20] || null,
          metoprolol: row[21] || null,
        };
      }

      // Process willDoECG separately - attributed to ECG Plan Date (column J), not dateFor
      if (row[8] === 'Yes' && row[9]) {
        const ecgPlanDate = normalizeDate(row[9]); // Column J is the ECG Plan Date
        if (ecgPlanDate) {
          ecgPlanByDate[ecgPlanDate] = true;
        }
      }
    }

    // Process ECG readings - index by collection date, keep most recent per day
    const ecgRows = ecgResponse.data.values || [];
    const ecgDataRows = ecgRows.slice(1); // Skip header

    const ecgByDate = {};
    for (const row of ecgDataRows) {
      // Use Column B (actual ECG date/time) NOT Column A (received timestamp)
      const { date: normalizedDate, timestamp } = parseECGTimestamp(row[1]); // Column B is ECG date
      if (normalizedDate) {
        // Keep track of most recent ECG per day (by actual ECG time)
        if (!ecgByDate[normalizedDate] || timestamp > ecgByDate[normalizedDate].timestamp) {
          ecgByDate[normalizedDate] = {
            timestamp,
            classification: row[2] || null,  // Column C
            avgHR: row[3] ? parseFloat(row[3]) : null,  // Column D
            rsRatio: row[4] ? parseFloat(row[4]) : null,  // Column E
          };
        }
      }
    }

    // Process Health Data (Health_Daily)
    const healthRows = healthResponse.data.values || [];
    const healthDataRows = healthRows.slice(1); // Skip header
    const healthByDate = {};

    for (const row of healthDataRows) {
      // Row: Date(0), Steps(1), AvgHR(2), RestHR(3), MinHR(4), MaxHR(5), HRV(6), SleepDur(7), Eff(8), Deep(9), REM(10)
      const dateStr = row[0];
      const normalizedDate = normalizeDate(dateStr);
      if (normalizedDate) {
        healthByDate[normalizedDate] = {
          steps: row[1] ? parseInt(row[1]) : null,
          avgHR: row[2] ? parseFloat(row[2]) : null,
          restingHR: row[3] ? parseFloat(row[3]) : null,
          minHR: row[4] ? parseFloat(row[4]) : null,
          maxHR: row[5] ? parseFloat(row[5]) : null,
          hrv: row[6] ? parseFloat(row[6]) : null,
          sleepMinutes: row[7] ? parseFloat(row[7]) : null,
          sleepEff: row[8] || null,
          deepSleep: row[9] ? parseFloat(row[9]) : null,
          remSleep: row[10] ? parseFloat(row[10]) : null,
          // New Columns
          // K (10) REM
          // L (11) Last Update 
          hrCount: row[12] ? parseInt(row[12]) : null,
          hrvCount: row[13] ? parseInt(row[13]) : null,
          awakeMinutes: row[14] ? parseFloat(row[14]) : null,
        };
      }
    }

    // Compute validated sleep from hourly data (same algorithm as single-day view)
    const hourlyRows = hourlyResponse.data.values || [];
    const validatedSleep = computeValidatedSleepByDate(
      hourlyRows,
      () => true, // Include all dates; we filter by limit later
      (dateStr) => normalizeDate(dateStr)
    );

    // Override Health_Daily sleep values with validated ones
    for (const [isoDate, vSleep] of Object.entries(validatedSleep)) {
      if (vSleep.totalMin > 0) {
        if (!healthByDate[isoDate]) {
          healthByDate[isoDate] = {};
        }
        healthByDate[isoDate].sleepMinutes = vSleep.totalMin;
        healthByDate[isoDate].deepSleep = vSleep.deepMin;
        healthByDate[isoDate].remSleep = vSleep.remMin;
        healthByDate[isoDate].awakeMinutes = vSleep.awakeMin;
      }
    }

    // Merge all unique dates from all three sources
    const allDates = new Set([
      ...Object.keys(entriesByDate),
      ...Object.keys(ecgByDate),
      ...Object.keys(ecgPlanByDate),
      ...Object.keys(healthByDate)
    ]);

    // Build combined entries
    const combinedEntries = [];
    for (const date of allDates) {
      const entry = entriesByDate[date] || {};
      const ecg = ecgByDate[date] || {};
      const health = healthByDate[date] || {};
      const willDoECG = ecgPlanByDate[date] || false;

      combinedEntries.push({
        normalizedDate: date,
        date: entry.date || date, // Use original format if available
        hours: entry.hours ?? null,
        comments: entry.comments || null,
        oxaloacetate: entry.oxaloacetate ?? null,
        exercise: entry.exercise ?? null,
        brainTime: entry.brainTime ?? null,
        modafinil: entry.modafinil || null,
        // Meds
        vitaminD: entry.vitaminD || null,
        venlafaxine: entry.venlafaxine || null,
        tirzepatide: entry.tirzepatide || null,
        oxaloacetateNew: entry.oxaloacetateNew || null,
        nyquil: entry.nyquil || null,
        modafinilNew: entry.modafinilNew || null,
        dextromethorphan: entry.dextromethorphan || null,
        dayquil: entry.dayquil || null,
        amitriptyline: entry.amitriptyline || null,
        senna: entry.senna || null,
        melatonin: entry.melatonin || null,
        metoprolol: entry.metoprolol || null,

        willDoECG: willDoECG,
        // ECG data
        ecgHR: ecg.avgHR ?? null,
        ecgRSRatio: ecg.rsRatio ?? null,
        ecgClassification: ecg.classification || null,
        // Health Data
        health: {
          steps: health.steps,
          avgHR: health.avgHR,
          restingHR: health.restingHR,
          minHR: health.minHR,
          maxHR: health.maxHR,
          hrv: health.hrv,
          sleepMinutes: health.sleepMinutes,
          deepSleep: health.deepSleep,
          remSleep: health.remSleep,
          sleepEff: health.sleepEff,
          awakeMinutes: health.awakeMinutes,
          hrCount: health.hrCount,
          hrvCount: health.hrvCount
        },

        // Flags
        hasEntryData: !!entriesByDate[date],
        hasECGData: !!ecgByDate[date],
        hasHealthData: !!healthByDate[date]
      });
    }

    // Sort by date descending (most recent first)
    combinedEntries.sort((a, b) => b.normalizedDate.localeCompare(a.normalizedDate));

    // Return limited entries
    const entries = combinedEntries.slice(0, limit);

    return res.status(200).json({ entries });

  } catch (error) {
    console.error('Failed to fetch entries:', error);
    return res.status(500).json({ error: 'Failed to fetch entries' });
  }
}
