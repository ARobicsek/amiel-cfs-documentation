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

export default async function handler(req, res) {
  // Vercel cron jobs use GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify this is from Vercel cron (optional security)
  const cronSecret = req.headers['x-vercel-cron'];
  // In production, you might want to verify this

  try {
    // Get current hour in user's timezone
    // TODO: Make timezone configurable
    const now = new Date();
    const currentHour = now.getHours();

    // TODO: Get scheduled times from storage
    // For now, hardcode 8 PM (20:00) as default reminder time
    const scheduledHours = [20]; // 8 PM

    if (scheduledHours.includes(currentHour)) {
      // Trigger notification
      // In production, call the send-notification endpoint internally
      // or directly send the notification here

      console.log(`Cron triggered at hour ${currentHour} - would send notification`);

      // TODO: Actually send notification
      // await fetch(`${process.env.VERCEL_URL}/api/send-notification`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${process.env.SECRET_TOKEN}`,
      //     'Content-Type': 'application/json'
      //   }
      // });

      return res.status(200).json({
        triggered: true,
        message: `Reminder triggered at hour ${currentHour}`
      });
    }

    return res.status(200).json({
      triggered: false,
      message: `No reminder scheduled for hour ${currentHour}`
    });

  } catch (error) {
    console.error('Cron trigger failed:', error);
    return res.status(500).json({ error: 'Cron trigger failed' });
  }
}
