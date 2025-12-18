/**
 * GET /api/cron-trigger
 *
 * Called by Vercel cron job every hour.
 * Checks if current time matches any scheduled reminder.
 *
 * Vercel cron config in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron-trigger",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 *
 * Response:
 *   200: { triggered: boolean, message: string }
 */

import sendNotificationHandler from './send-notification.js';

export default async function handler(req, res) {
  // Vercel cron jobs use GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get current hour in Eastern Time (same timezone as the app uses)
    const now = new Date();
    const etTimeString = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false
    });
    const currentHour = parseInt(etTimeString.split(',')[1]?.trim() || etTimeString);

    // Send notifications hourly between 8 AM and 8 PM ET (8-20)
    const scheduledHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

    if (scheduledHours.includes(currentHour)) {
      console.log(`Cron triggered at hour ${currentHour} ET - sending notification`);

      // Call the send-notification handler directly
      const mockReq = {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.SECRET_TOKEN}`
        }
      };

      // Create a mock response object to capture the result
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

      // Call the notification handler
      await sendNotificationHandler(mockReq, mockRes);

      // Return the result from send-notification
      return res.status(200).json({
        triggered: true,
        hour: currentHour,
        timezone: 'America/New_York',
        notificationResult: {
          statusCode,
          data: responseData
        }
      });
    }

    return res.status(200).json({
      triggered: false,
      hour: currentHour,
      timezone: 'America/New_York',
      message: `No reminder scheduled for hour ${currentHour} ET (scheduled hours: 8 AM - 8 PM)`
    });

  } catch (error) {
    console.error('Cron trigger failed:', error);
    return res.status(500).json({
      error: 'Cron trigger failed',
      details: error.message
    });
  }
}
