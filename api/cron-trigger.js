/**
 * GET /api/cron-trigger
 *
 * Called by Vercel cron job every 15 minutes.
 * Checks if current time matches any scheduled reminder based on user settings.
 *
 * Vercel cron config in vercel.json:
 *   "crons": [{ "path": "/api/cron-trigger", "schedule": "every 15 minutes" }]
 *
 * Smart reminder logic:
 * - Fetches user's reminder settings (first time, repeat interval, stop after log)
 * - Checks if user has logged today
 * - Calculates next reminder times based on settings
 * - Supports cross-date reminders (e.g., 1 AM next day)
 *
 * Response:
 *   200: { triggered: boolean, message: string, details: object }
 */

import sendNotificationHandler from './send-notification.js';
import { google } from 'googleapis';

export default async function handler(req, res) {
  // Vercel cron jobs use GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Get current time in Eastern Time
    const now = new Date();
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentHour = etDate.getHours();
    const currentMinute = etDate.getMinutes();
    const todayDateString = etDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' });

    // Fetch user settings
    let settings = {
      firstReminderTime: '20:00',
      repeatInterval: 60,
      stopAfterLog: true,
      snoozeUntil: null
    };

    try {
      const settingsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'UserSettings!A2:E2',
      });

      const row = settingsResponse.data.values?.[0];
      if (row && row.length > 0) {
        settings.firstReminderTime = row[0] || '20:00';
        settings.repeatInterval = parseInt(row[1]) || 60;
        settings.stopAfterLog = row[2] === 'true';
        settings.snoozeUntil = row[4] || null;  // Column E
      }
    } catch (error) {
      console.log('Using default settings (UserSettings tab not found)');
    }

    // Check if currently snoozed
    if (settings.snoozeUntil) {
      const snoozeDate = new Date(settings.snoozeUntil);
      const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

      if (nowET < snoozeDate) {
        // Still snoozed
        return res.status(200).json({
          triggered: false,
          reason: 'snoozed',
          message: `Reminder snoozed until ${settings.snoozeUntil}`,
          snoozeUntil: settings.snoozeUntil,
          settings
        });
      } else {
        // Snooze expired - clear it and send reminder
        console.log('Snooze expired, sending reminder and clearing snooze');

        // Clear snooze
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'UserSettings!E2',
          valueInputOption: 'RAW',
          resource: {
            values: [['']],
          },
        });

        // Continue to send reminder below
      }
    }

    // Check if user has logged today (if stopAfterLog is enabled)
    let hasLoggedToday = false;
    if (settings.stopAfterLog) {
      try {
        const entriesResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Sheet1!A:B', // Timestamp and Date columns
        });

        const rows = entriesResponse.data.values || [];
        hasLoggedToday = rows.some(row => {
          const dateValue = row[1]; // Date column
          return dateValue === todayDateString;
        });
      } catch (error) {
        console.error('Failed to check today\'s entries:', error);
      }
    }

    // If user has logged and we should stop, don't send reminder
    if (hasLoggedToday && settings.stopAfterLog) {
      return res.status(200).json({
        triggered: false,
        reason: 'already_logged',
        message: `User has already logged today (${todayDateString}). No reminder sent.`,
        settings,
        todayDateString
      });
    }

    // Parse first reminder time
    const [firstHour, firstMinute] = settings.firstReminderTime.split(':').map(Number);

    // Calculate if we should send a reminder now
    const shouldSendReminder = checkIfReminderTime(
      currentHour,
      currentMinute,
      firstHour,
      firstMinute,
      settings.repeatInterval
    );

    if (!shouldSendReminder) {
      return res.status(200).json({
        triggered: false,
        reason: 'not_reminder_time',
        message: `Current time ${currentHour}:${String(currentMinute).padStart(2, '0')} does not match reminder schedule.`,
        settings,
        currentTime: `${currentHour}:${String(currentMinute).padStart(2, '0')}`,
        nextReminderTime: calculateNextReminderTime(currentHour, currentMinute, firstHour, firstMinute, settings.repeatInterval)
      });
    }

    // Send the notification!
    console.log(`Cron triggered at ${currentHour}:${String(currentMinute).padStart(2, '0')} ET - sending notification`);

    const mockReq = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.SECRET_TOKEN}`
      }
    };

    let statusCode = 200;
    let responseData = null;

    const mockRes = {
      status: (code) => {
        statusCode = code;
        return mockRes;
      },
      json: (data) => {
        responseData = data;
        return mockRes;
      }
    };

    await sendNotificationHandler(mockReq, mockRes);

    return res.status(200).json({
      triggered: true,
      reason: 'reminder_sent',
      currentTime: `${currentHour}:${String(currentMinute).padStart(2, '0')}`,
      settings,
      notificationResult: {
        statusCode,
        data: responseData
      }
    });

  } catch (error) {
    console.error('Cron trigger failed:', error);
    return res.status(500).json({
      error: 'Cron trigger failed',
      details: error.message
    });
  }
}

/**
 * Check if current time matches a reminder time
 * Returns true if we should send a reminder now
 *
 * Option B behavior: If first reminder time has passed today, skip to tomorrow
 */
function checkIfReminderTime(currentHour, currentMinute, firstHour, firstMinute, repeatInterval) {
  const currentMinutesSinceMidnight = currentHour * 60 + currentMinute;
  const firstReminderMinutes = firstHour * 60 + firstMinute;

  // If current time is before first reminder today, no reminder yet (wait for first reminder)
  if (currentMinutesSinceMidnight < firstReminderMinutes) {
    return false;
  }

  // OPTION B: If first reminder time has passed and we're past it, skip to tomorrow
  // Only send reminders that are at or after the first reminder time today
  const minutesSinceFirst = currentMinutesSinceMidnight - firstReminderMinutes;

  // If no repeat interval, only send at the first reminder time (within 15 min window)
  if (repeatInterval === 0) {
    return minutesSinceFirst < 15;
  }

  // With repeat interval: check if current time aligns with the schedule
  // (first reminder, or subsequent intervals after it)
  const remainder = minutesSinceFirst % repeatInterval;
  return remainder < 15;
}

/**
 * Calculate the next reminder time for display purposes
 */
function calculateNextReminderTime(currentHour, currentMinute, firstHour, firstMinute, repeatInterval) {
  const currentMinutesSinceMidnight = currentHour * 60 + currentMinute;
  const firstReminderMinutes = firstHour * 60 + firstMinute;

  // If before first reminder today, next is the first reminder
  if (currentMinutesSinceMidnight < firstReminderMinutes) {
    return `${String(firstHour).padStart(2, '0')}:${String(firstMinute).padStart(2, '0')} today`;
  }

  // If no repeat, next is tomorrow at first reminder time
  if (repeatInterval === 0) {
    return `${String(firstHour).padStart(2, '0')}:${String(firstMinute).padStart(2, '0')} tomorrow`;
  }

  // Calculate next reminder based on interval
  const minutesSinceFirst = currentMinutesSinceMidnight - firstReminderMinutes;
  const intervalsElapsed = Math.floor(minutesSinceFirst / repeatInterval);
  const nextReminderMinutes = firstReminderMinutes + ((intervalsElapsed + 1) * repeatInterval);

  // Check if next reminder is today or tomorrow
  if (nextReminderMinutes < 24 * 60) {
    const nextHour = Math.floor(nextReminderMinutes / 60);
    const nextMinute = nextReminderMinutes % 60;
    return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')} today`;
  } else {
    // Next reminder is tomorrow
    return `${String(firstHour).padStart(2, '0')}:${String(firstMinute).padStart(2, '0')} tomorrow`;
  }
}
