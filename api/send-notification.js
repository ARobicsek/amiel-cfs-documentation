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
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch a joke from the free API
    console.log('Fetching joke from API...');
    const jokeResponse = await fetch('https://official-joke-api.appspot.com/random_joke');
    if (!jokeResponse.ok) {
      throw new Error(`Joke API returned ${jokeResponse.status}`);
    }
    const joke = await jokeResponse.json();
    const jokeText = `${joke.setup} ${joke.punchline}`;
    console.log('Joke fetched successfully');

    // Configure web-push with VAPID keys
    console.log('Configuring VAPID...');
    let vapidSubject = process.env.VAPID_EMAIL;
    console.log('VAPID_EMAIL from env:', vapidSubject);
    if (vapidSubject && !vapidSubject.startsWith('mailto:') && !vapidSubject.startsWith('http')) {
      vapidSubject = `mailto:${vapidSubject}`;
    }
    console.log('Final vapidSubject:', vapidSubject);

    if (!vapidSubject) {
      throw new Error('VAPID_EMAIL is not defined in environment variables');
    }
    if (!process.env.VAPID_PUBLIC_KEY) {
      throw new Error('VAPID_PUBLIC_KEY is not defined in environment variables');
    }
    if (!process.env.VAPID_PRIVATE_KEY) {
      throw new Error('VAPID_PRIVATE_KEY is not defined in environment variables');
    }

    // Strip padding and whitespace from VAPID keys (web-push requires URL-safe base64 without padding)
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY.trim().replace(/=+$/, '');
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY.trim().replace(/=+$/, '');

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    );
    console.log('VAPID configured successfully');

    // Get subscriptions from Google Sheets
    console.log('Fetching subscriptions from Google Sheets...');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    let subscriptions = [];
    try {
      const getResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID.trim(),
        range: 'Subscriptions!A:D',
      });

      const rows = getResponse.data.values || [];
      console.log(`Found ${rows.length} rows in Subscriptions tab (including header)`);

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
      console.log(`Parsed ${subscriptions.length} valid subscriptions`);
    } catch (error) {
      console.error('Failed to get subscriptions from Google Sheets:', error);
      console.error('Error details:', error.message);
      // If no subscriptions exist, that's okay
    }

    if (subscriptions.length === 0) {
      console.log('No subscriptions found - returning success with sent=0');
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
      // actions: [
      //   {
      //     action: 'track',
      //     title: 'Track Now',
      //     icon: '/pwa-192x192.png'
      //   },
      //   {
      //     action: 'snooze',
      //     title: 'Snooze 1 Hour',
      //     icon: '/pwa-192x192.png'
      //   }
      // ]
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
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      error: 'Failed to send notification',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
