/**
 * GET /api/get-health-stats
 *
 * Aggregated health data for Multi-Day Stats view.
 * Fetches Health_Hourly (HR box plot data), Health_Daily (sleep/steps/HRV),
 * and Sheet1 (Feet on Ground col C, Brain Time col G) for a date range.
 *
 * Query params:
 *   startDate: YYYY-MM-DD (required)
 *   endDate:   YYYY-MM-DD (required)
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { startDate, endDate, days: Array<DayStat> }
 *   400: { error: "Missing parameters" }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to fetch health stats" }
 */

import { google } from 'googleapis';

// Parse "M/D/YYYY" or "YYYY-MM-DD" to { year, month, day } integers
function parseDateStr(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return { month: parseInt(parts[0], 10), day: parseInt(parts[1], 10), year: parseInt(parts[2], 10) };
    }
  }
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
    }
  }
  return null;
}

// Convert parsed date to "YYYY-MM-DD" string
function toISODate(parsed) {
  if (!parsed) return null;
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

// Check if a date string falls within [startDate, endDate] (inclusive)
function isInRange(dateStr, startDate, endDate) {
  const parsed = parseDateStr(dateStr);
  if (!parsed) return false;
  const iso = toISODate(parsed);
  return iso >= startDate && iso <= endDate;
}

// Compute 5-number summary from an array of numbers
function computeBoxPlot(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 1
    ? sorted[Math.floor(n / 2)]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

  const q1Idx = Math.floor(n / 4);
  const q3Idx = Math.floor(3 * n / 4);

  return {
    min: sorted[0],
    q1: sorted[q1Idx],
    median: Math.round(median * 10) / 10,
    q3: sorted[q3Idx],
    max: sorted[n - 1],
    count: n,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { startDate, endDate } = req.query;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!startDate || !endDate || !dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return res.status(400).json({ error: 'Missing or invalid startDate/endDate. Use YYYY-MM-DD format.' });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: 'startDate must be <= endDate' });
  }

  try {
    const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Fetch all three sheets in parallel
    const [hourlyResponse, dailyResponse, sheet1Response] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Health_Hourly!A2:I',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Health_Daily!A2:O',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A2:G',
      }),
    ]);

    // --- 1. HR Box Plot from Health_Hourly ---
    const hourlyRows = hourlyResponse.data.values || [];
    const hrByDate = {}; // date -> [bpm values]

    for (const row of hourlyRows) {
      const dateStr = row[1]; // Column B = Date
      const metric = row[3]; // Column D = Metric

      if (metric !== 'heart_rate') continue;
      if (!isInRange(dateStr, startDate, endDate)) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;

      const bpm = parseFloat(row[4]); // Column E = Value (Avg BPM)
      if (isNaN(bpm)) continue;

      if (!hrByDate[isoDate]) hrByDate[isoDate] = [];
      hrByDate[isoDate].push(bpm);
    }

    // --- 2. Sleep/Steps/HRV from Health_Daily ---
    const dailyRows = dailyResponse.data.values || [];
    const dailyByDate = {};

    for (const row of dailyRows) {
      const dateStr = row[0]; // Column A = Date
      if (!isInRange(dateStr, startDate, endDate)) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;

      dailyByDate[isoDate] = {
        steps: row[1] ? parseFloat(row[1]) : null,
        avgHR: row[2] ? parseFloat(row[2]) : null,
        restingHR: row[3] ? parseFloat(row[3]) : null,
        minHR: row[4] ? parseFloat(row[4]) : null,
        maxHR: row[5] ? parseFloat(row[5]) : null,
        avgHRV: row[6] ? parseFloat(row[6]) : null,
        sleepDuration: row[7] ? parseFloat(row[7]) : null, // minutes
        sleepEfficiency: row[8] || null,
        deepSleep: row[9] ? parseFloat(row[9]) : null, // minutes
        remSleep: row[10] ? parseFloat(row[10]) : null, // minutes
        hrCount: row[12] ? parseInt(row[12], 10) : null,
        hrvCount: row[13] ? parseInt(row[13], 10) : null,
        awakeMinutes: row[14] ? parseFloat(row[14]) : null,
      };
    }

    // --- 3. Feet on Ground (Col C) & Brain Time (Col G) from Sheet1 ---
    const sheet1Rows = sheet1Response.data.values || [];
    const manualByDate = {};

    for (const row of sheet1Rows) {
      // Column B (index 1) = date for the entry
      const dateStr = row[1];
      if (!dateStr) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;
      if (isoDate < startDate || isoDate > endDate) continue;

      // Column C (index 2) = Feet on Ground (hours)
      // Column G (index 6) = Brain Time
      manualByDate[isoDate] = {
        feetOnGround: row[2] ? parseFloat(row[2]) : null,
        brainTime: row[6] ? parseFloat(row[6]) : null,
      };
    }

    // --- 4. Merge all data by date ---
    const allDates = new Set([
      ...Object.keys(hrByDate),
      ...Object.keys(dailyByDate),
      ...Object.keys(manualByDate),
    ]);

    const days = [];
    for (const date of allDates) {
      const hr = hrByDate[date] ? computeBoxPlot(hrByDate[date]) : null;
      const daily = dailyByDate[date] || {};
      const manual = manualByDate[date] || {};

      // Compute core sleep = total - deep - rem - awake (if all available)
      let coreSleep = null;
      if (daily.sleepDuration != null && daily.deepSleep != null && daily.remSleep != null) {
        const awake = daily.awakeMinutes || 0;
        coreSleep = Math.max(0, daily.sleepDuration - daily.deepSleep - daily.remSleep - awake);
      }

      days.push({
        date,
        hr,
        steps: daily.steps != null ? Math.round(daily.steps) : null,
        sleep: daily.sleepDuration != null ? {
          total: Math.round(daily.sleepDuration),
          deep: daily.deepSleep != null ? Math.round(daily.deepSleep) : null,
          rem: daily.remSleep != null ? Math.round(daily.remSleep) : null,
          core: coreSleep != null ? Math.round(coreSleep) : null,
          awake: daily.awakeMinutes != null ? Math.round(daily.awakeMinutes) : null,
        } : null,
        hrv: daily.avgHRV != null ? { avg: daily.avgHRV, count: daily.hrvCount } : null,
        feetOnGround: manual.feetOnGround,
        brainTime: manual.brainTime,
      });
    }

    // Sort by date ascending
    days.sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({ startDate, endDate, days, count: days.length });
  } catch (error) {
    console.error('Error fetching health stats:', error);
    return res.status(500).json({ error: 'Failed to fetch health stats', details: error.message });
  }
}
