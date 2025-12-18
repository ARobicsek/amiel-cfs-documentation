/**
 * GET /api/get-entries
 *
 * Fetches recent entries from Google Sheets.
 *
 * Query params:
 *   limit: number (default: 7, max: 30)
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

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate authorization
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse query params
  const limit = Math.min(parseInt(req.query.limit) || 7, 30);

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:F',
    });

    const rows = response.data.values || [];
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Get last N entries
    const recentRows = dataRows.slice(-limit).reverse();

    const entries = recentRows.map(row => ({
      timestamp: row[0],
      date: row[1],
      hours: parseFloat(row[2]),
      comments: row[3] || null,
      oxaloacetate: row[4] ? parseFloat(row[4]) : null,
      exercise: row[5] ? parseInt(row[5]) : null,
    }));

    return res.status(200).json({ entries });

  } catch (error) {
    console.error('Failed to fetch entries:', error);
    return res.status(500).json({ error: 'Failed to fetch entries' });
  }
}
