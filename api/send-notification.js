/**
 * POST /api/send-notification
 *
 * Sends a push notification with a joke.
 * Called by cron job or manually for testing.
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { success: true, joke: string, sent: number }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to send notification" }
 */

import webpush from 'web-push';
import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch a joke from the free API
    const jokeResponse = await fetch('https://official-joke-api.appspot.com/random_joke');
    const joke = await jokeResponse.json();
    const jokeText = `${joke.setup} ${joke.punchline}`;

    // Configure web-push with VAPID keys
    let vapidSubject = process.env.VAPID_EMAIL;
    console.log('VAPID_EMAIL from env:', vapidSubject);
    if (vapidSubject && !vapidSubject.startsWith('mailto:') && !vapidSubject.startsWith('http')) {
      vapidSubject = `mailto:${vapidSubject}`;
    }
    console.log('Final vapidSubject:', vapidSubject);

    if (!vapidSubject) {
      throw new Error('VAPID_EMAIL is not defined in environment variables');
    }

    webpush.setVapidDetails(
      vapidSubject,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    // Get subscriptions from Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    let subscriptions = [];
    try {
      const getResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Subscriptions!A:D',
      });

      const rows = getResponse.data.values || [];

      // Skip header row and parse subscriptions
      if (rows.length > 1) {
        subscriptions = rows.slice(1).map(row => {
          try {
            return JSON.parse(row[3]); // Full subscription is in column D
          } catch (error) {
            console.error('Failed to parse subscription:', error);
            return null;
          }
        }).filter(sub => sub !== null);
      }
    } catch (error) {
      console.error('Failed to get subscriptions:', error);
      // If no subscriptions exist, that's okay
    }

    if (subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No subscriptions found',
        joke: jokeText,
        sent: 0
      });
    }

    // Send notifications to all subscriptions
    const payload = JSON.stringify({
      title: 'Time to track your day!',
      body: jokeText,
      icon: '/pwa-192x192.png',
      badge: '/favicon.svg',
      data: {
        url: '/'
      },
      actions: [
        {
          action: 'track',
          title: 'Track Now',
          icon: '/pwa-192x192.png'
        },
        {
          action: 'snooze',
          title: 'Snooze 1 Hour',
          icon: '/pwa-192x192.png'
        }
      ]
    });

    let sentCount = 0;
    const sendPromises = subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload);
        sentCount++;
      } catch (error) {
        console.error('Failed to send to subscription:', error);
        // Could mark subscription as invalid and remove from sheet here
      }
    });

    await Promise.all(sendPromises);

    return res.status(200).json({
      success: true,
      joke: jokeText,
      sent: sentCount,
      total: subscriptions.length
    });

  } catch (error) {
    console.error('Failed to send notification:', error);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
