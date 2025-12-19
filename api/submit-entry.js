/**
 * POST /api/submit-entry
 *
 * Saves a daily entry to Google Sheets.
 *
 * Request body:
 * {
 *   date: string (ISO date),
 *   hours: number (required, 0-24),
 *   comments: string | null,
 *   oxaloacetate: number | null (grams),
 *   exercise: number | null (minutes),
 *   brainTime: number | null (hours of productive brain time),
 *   midodrine: number | null (mg)
 * }
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { success: true, row: number }
 *   401: { error: "Unauthorized" }
 *   400: { error: "Missing required field: hours" }
 *   500: { error: "Failed to save entry" }
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate authorization
  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse and validate body
  const { date, hours, comments, oxaloacetate, exercise, brainTime, midodrine } = req.body;

  if (hours === undefined || hours === null) {
    return res.status(400).json({ error: 'Missing required field: hours' });
  }

  if (typeof hours !== 'number' || hours < 0 || hours > 24) {
    return res.status(400).json({ error: 'Hours must be a number between 0 and 24' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Get current time in US Eastern Time
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const dateOnly = now.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,                          // Timestamp (Eastern Time)
          dateOnly,                           // Date (Eastern Time, not client-sent UTC)
          hours,                              // Hours (required)
          comments || '',                     // Comments
          oxaloacetate || '',                 // Oxaloacetate (g)
          exercise || '',                     // Exercise (min)
          brainTime || '',                    // Productive brain time (hours)
          midodrine || ''                     // Midodrine (mg)
        ]]
      }
    });

    const updatedRange = response.data.updates.updatedRange;
    const rowNumber = parseInt(updatedRange.match(/\d+/)[0]);

    return res.status(200).json({
      success: true,
      row: rowNumber
    });

  } catch (error) {
    console.error('Failed to save entry:', error);
    return res.status(500).json({ error: 'Failed to save entry' });
  }
}
