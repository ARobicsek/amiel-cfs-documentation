/**
 * GET /api/get-entries
 *
 * Fetches recent entries from Google Sheets, including ECG data.
 * Merges daily entries with ECG readings by date.
 * ECG data is attributed to collection date (not documentation date).
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

    // Fetch both daily entries (Sheet1) and ECG readings in parallel
    const [entriesResponse, ecgResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A:J', // Extended to include brainTime (G), modafinil (H), willDoECG (I), ECG Plan Date (J)
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'ECG_Readings!A:E', // Timestamp, Date, Classification, Avg HR, R/S Ratio
      }).catch(() => ({ data: { values: [] } })) // Handle if ECG sheet doesn't exist
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
          modafinil: row[7] || null,
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
      // Column B is when the ECG was actually taken on the Apple Watch
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

    // Merge all unique dates from all three sources
    const allDates = new Set([
      ...Object.keys(entriesByDate),
      ...Object.keys(ecgByDate),
      ...Object.keys(ecgPlanByDate)
    ]);

    // Build combined entries
    const combinedEntries = [];
    for (const date of allDates) {
      const entry = entriesByDate[date] || {};
      const ecg = ecgByDate[date] || {};
      const willDoECG = ecgPlanByDate[date] || false; // willDoECG attributed to ECG Plan Date

      combinedEntries.push({
        normalizedDate: date,
        date: entry.date || date, // Use original format if available
        hours: entry.hours || null,
        comments: entry.comments || null,
        oxaloacetate: entry.oxaloacetate || null,
        exercise: entry.exercise || null,
        brainTime: entry.brainTime || null,
        modafinil: entry.modafinil || null,
        willDoECG: willDoECG,
        // ECG data
        ecgHR: ecg.avgHR || null,
        ecgRSRatio: ecg.rsRatio || null,
        ecgClassification: ecg.classification || null,
        // Flag to indicate data source
        hasEntryData: !!entriesByDate[date],
        hasECGData: !!ecgByDate[date],
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
