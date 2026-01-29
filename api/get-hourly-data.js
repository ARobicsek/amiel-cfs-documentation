/**
 * GET /api/get-hourly-data
 *
 * Fetches raw Health_Hourly data for a single day.
 * Used by the Stats Single Day view.
 *
 * Query params:
 *   date: YYYY-MM-DD (required)
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { rows: Array<{ timestamp, date, hour, metric, value, min, max, source, rawData }> }
 *   400: { error: "Missing date parameter" }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to fetch hourly data" }
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
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

  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date parameter. Use YYYY-MM-DD format.' });
  }

  try {
    // Parse the service account key
    const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Fetch all Health_Hourly data
    // Columns: A=Timestamp, B=Date, C=Hour, D=Metric, E=Value, F=Min, G=Max, H=Source, I=Raw Data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Health_Hourly!A2:I',
    });

    const allRows = response.data.values || [];

    // Convert the requested date to comparable format
    // Health_Hourly Date column uses format like "1/28/2026"
    const [year, month, day] = date.split('-');
    const targetMonth = parseInt(month, 10);
    const targetDay = parseInt(day, 10);
    const targetYear = parseInt(year, 10);

    // Filter rows matching the requested date
    const matchingRows = allRows.filter(row => {
      const dateStr = row[1]; // Column B = Date
      if (!dateStr) return false;

      // Handle "M/D/YYYY" format
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const m = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          const y = parseInt(parts[2], 10);
          return m === targetMonth && d === targetDay && y === targetYear;
        }
      }

      // Handle "YYYY-MM-DD" format
      if (dateStr.includes('-')) {
        return dateStr.startsWith(date);
      }

      return false;
    });

    // Map to structured objects
    const rows = matchingRows.map(row => ({
      timestamp: row[0] || '',
      date: row[1] || '',
      hour: row[2] ? parseInt(row[2], 10) : null,
      metric: row[3] || '',
      value: row[4] ? parseFloat(row[4]) : null,
      min: row[5] ? parseFloat(row[5]) : null,
      max: row[6] ? parseFloat(row[6]) : null,
      source: row[7] || '',
      rawData: row[8] || '',
    }));

    return res.status(200).json({ date, rows, count: rows.length });
  } catch (error) {
    console.error('Error fetching hourly data:', error);
    return res.status(500).json({ error: 'Failed to fetch hourly data', details: error.message });
  }
}
