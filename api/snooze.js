/**
 * POST /api/snooze
 *
 * Records a snooze request from the user.
 * Stores snooze time in Google Sheets (UserSettings tab).
 * Cron job will check for active snooze and send reminder when snooze expires.
 *
 * Request body:
 * {
 *   duration: 60  // snooze duration in minutes (default: 60)
 * }
 *
 * Response:
 *   200: { success: true, snoozeUntil: string }
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authentication
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { duration = 60 } = req.body;

    // Calculate snooze until time
    const now = new Date();
    const snoozeUntil = new Date(now.getTime() + duration * 60 * 1000);

    // Format in Eastern Time for storage
    const snoozeUntilET = snoozeUntil.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Initialize Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Ensure UserSettings tab exists
    try {
      await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: ['UserSettings!A1'],
      });
    } catch (error) {
      // Create UserSettings tab if it doesn't exist
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'UserSettings',
                },
              },
            },
          ],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'UserSettings!A1:E1',
        valueInputOption: 'RAW',
        resource: {
          values: [['First Reminder Time', 'Repeat Interval (min)', 'Stop After Log', 'Last Updated', 'Snooze Until']],
        },
      });
    }

    // Save snooze time to column E (Snooze Until)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'UserSettings!E2',
      valueInputOption: 'RAW',
      resource: {
        values: [[snoozeUntilET]],
      },
    });

    console.log(`Snoozed until ${snoozeUntilET}`);

    return res.status(200).json({
      success: true,
      snoozeUntil: snoozeUntilET,
      message: `Snoozed for ${duration} minutes`
    });

  } catch (error) {
    console.error('Failed to process snooze:', error);
    return res.status(500).json({
      error: 'Failed to process snooze',
      details: error.message
    });
  }
}
