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

import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  // For debugging
  if (!receivedToken || receivedToken !== expectedToken) {
    console.log('Subscribe auth failed.');
    console.log('Received:', receivedToken);
    console.log('Expected length:', expectedToken?.length);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Subscribe auth successful');

  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get the spreadsheet to check if "Subscriptions" sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });

    const sheetExists = spreadsheet.data.sheets.some(
      (s) => s.properties.title === 'Subscriptions'
    );

    if (!sheetExists) {
      // Create the "Subscriptions" sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Subscriptions',
                },
              },
            },
          ],
        },
      });

      // Add headers to the new sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Subscriptions!A1:D1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Timestamp', 'Endpoint', 'Keys', 'Full Subscription']],
        },
      });
    }

    // Get current timestamp
    const timestamp = new Date().toISOString();

    // Store the subscription in a "Subscriptions" sheet
    // Format: [Timestamp, Endpoint, Keys (JSON), Full Subscription (JSON)]
    const subscriptionData = [
      timestamp,
      subscription.endpoint,
      JSON.stringify(subscription.keys),
      JSON.stringify(subscription)
    ];

    // For MVP, we'll just append the new subscription
    // In the future, we could check for duplicates and update instead
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Subscriptions!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [subscriptionData]
      }
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Failed to save subscription:', error);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
}
