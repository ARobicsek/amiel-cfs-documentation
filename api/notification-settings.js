/**
 * GET/POST /api/notification-settings
 *
 * Manages user notification reminder settings.
 * Stores settings in Google Sheets (UserSettings tab).
 *
 * GET: Retrieve current settings
 * POST: Update settings
 *
 * Settings format:
 * {
 *   firstReminderTime: "13:14",  // 24-hour format (1:14 PM)
 *   repeatInterval: 60,           // minutes (0 = no repeat)
 *   stopAfterLog: true            // stop reminders after daily log
 * }
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
  // Verify authentication
  const authHeader = req.headers.authorization;
  // Handle "Bearer <token>" or just "<token>" case-insensitively, and trim whitespace
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  // For debugging: compare with known value
  if (!receivedToken || receivedToken !== expectedToken) {
    console.log('Auth failed.');
    console.log('Received token:', receivedToken);
    console.log('Expected token length:', expectedToken?.length);
    // Don't log the full expected token for security, but maybe the first/last chars if needed for debugging
    if (expectedToken) {
      console.log('Expected token starts with:', expectedToken.substring(0, 3) + '...');
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Auth successful');

  try {
    // Initialize Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    if (req.method === 'GET') {
      // Fetch current settings
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'UserSettings!A2:F2', // Row 2 = user settings (now including F)
        });

        const row = response.data.values?.[0];

        if (!row || row.length === 0) {
          // Return default settings
          return res.status(200).json({
            firstReminderTime: '20:00',  // 8 PM default
            repeatInterval: 60,           // 1 hour
            stopAfterLog: true,
            localTimeZone: 'America/New_York'
          });
        }

        return res.status(200).json({
          firstReminderTime: row[0] || '20:00',
          repeatInterval: parseInt(row[1]) || 60,
          stopAfterLog: row[2] === 'true',
          localTimeZone: row[5] || 'America/New_York'
        });

      } catch (error) {
        // UserSettings tab doesn't exist yet
        console.log('UserSettings tab not found, returning defaults');
        return res.status(200).json({
          firstReminderTime: '20:00',
          repeatInterval: 60,
          stopAfterLog: true,
          localTimeZone: 'America/New_York'
        });
      }

    } else if (req.method === 'POST') {
      // Save settings
      const { firstReminderTime, repeatInterval, stopAfterLog, localTimeZone } = req.body;

      // Validate inputs
      if (!firstReminderTime || typeof repeatInterval !== 'number') {
        return res.status(400).json({ error: 'Invalid settings format' });
      }

      // Ensure UserSettings tab exists
      try {
        // Try to get the sheet
        await sheets.spreadsheets.get({
          spreadsheetId,
          ranges: ['UserSettings!A1'],
        });
      } catch (error) {
        // Create UserSettings tab
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
          range: 'UserSettings!A1:F1',
          valueInputOption: 'RAW',
          resource: {
            values: [['First Reminder Time', 'Repeat Interval (min)', 'Stop After Log', 'Last Updated', 'Snooze Until', 'Timezone']],
          },
        });
      }

      // Save settings
      const timeZone = localTimeZone || 'America/New_York';
      const timestamp = new Date().toLocaleString('en-US', {
        timeZone: timeZone,
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'UserSettings!A2:D2',
        valueInputOption: 'RAW',
        resource: {
          values: [[
            firstReminderTime,
            repeatInterval.toString(),
            stopAfterLog.toString(),
            timestamp
          ]],
        },
      });

      // Write timezone separately to F2 so we don't clobber E2 (Snooze Until)
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'UserSettings!F2',
        valueInputOption: 'RAW',
        resource: {
          values: [[timeZone]],
        },
      });

      return res.status(200).json({
        success: true,
        settings: {
          firstReminderTime,
          repeatInterval,
          stopAfterLog,
          localTimeZone: timeZone
        }
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Failed to manage notification settings:', error);
    return res.status(500).json({
      error: 'Failed to manage notification settings',
      details: error.message
    });
  }
}
