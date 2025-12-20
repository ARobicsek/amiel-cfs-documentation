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
 *   brainTime: number (hours of productive brain time),
 *   modafinil: string | null (none, quarter, half, whole)
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
  const { date, hours, comments, oxaloacetate, exercise, brainTime, modafinil } = req.body;

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

    // Check if an entry for today already exists (one row per day)
    const existingData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:B',
    });

    let existingRowIndex = -1;
    const rows = existingData.data.values || [];

    // Find row with today's date (column B)
    for (let i = 1; i < rows.length; i++) { // Skip header row
      if (rows[i] && rows[i][1] === dateOnly) {
        existingRowIndex = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    const rowData = [
      timestamp,                          // Timestamp (Eastern Time)
      dateOnly,                           // Date (Eastern Time, not client-sent UTC)
      hours,                              // Hours (required)
      comments || '',                     // Comments
      oxaloacetate || '',                 // Oxaloacetate (g)
      exercise || '',                     // Exercise (min)
      brainTime || '',                    // Productive brain time (hours)
      modafinil || ''                     // Modafinil (none/quarter/half/whole)
    ];

    let rowNumber;

    if (existingRowIndex > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!A${existingRowIndex}:H${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData]
        }
      });
      rowNumber = existingRowIndex;
    } else {
      // Append new row
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A:H',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData]
        }
      });
      const updatedRange = response.data.updates.updatedRange;
      rowNumber = parseInt(updatedRange.match(/\d+/)[0]);
    }

    return res.status(200).json({
      success: true,
      row: rowNumber
    });

  } catch (error) {
    console.error('Failed to save entry:', error);
    return res.status(500).json({ error: 'Failed to save entry' });
  }
}
