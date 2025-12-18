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
 *   200: { success: true, joke: string }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to send notification" }
 */

// TODO: npm install web-push
// import webpush from 'web-push';

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

    // TODO: Configure web-push with VAPID keys
    // webpush.setVapidDetails(
    //   `mailto:${process.env.VAPID_EMAIL}`,
    //   process.env.VAPID_PUBLIC_KEY,
    //   process.env.VAPID_PRIVATE_KEY
    // );

    // TODO: Get subscription from storage and send notification
    // const subscription = await getStoredSubscription();
    //
    // await webpush.sendNotification(subscription, JSON.stringify({
    //   title: 'Time to track your day!',
    //   body: jokeText,
    //   icon: '/pwa-192x192.png',
    //   data: {
    //     url: '/'
    //   }
    // }));

    console.log('Would send notification with joke:', jokeText);

    return res.status(200).json({
      success: true,
      message: 'Notification not sent (push not yet configured)',
      joke: jokeText
    });

  } catch (error) {
    console.error('Failed to send notification:', error);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
