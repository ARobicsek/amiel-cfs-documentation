/**
 * POST /api/subscribe
 *
 * Saves a push notification subscription.
 *
 * Request body:
 *   PushSubscription object from browser
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 *
 * Response:
 *   200: { success: true }
 *   401: { error: "Unauthorized" }
 *   500: { error: "Failed to save subscription" }
 */

// TODO: Store subscription in Google Sheets (separate tab) or JSON file

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    // TODO: Save subscription to storage
    // For now, just log it
    console.log('Push subscription received:', subscription.endpoint);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Failed to save subscription:', error);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
}
