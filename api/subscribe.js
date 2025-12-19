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

  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch (parseError) {
    console.error('Configuration Error: GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON', parseError);
    return res.status(500).json({ 
      error: 'Server Configuration Error', 
      details: 'GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Check Vercel environment variables.' 
    });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Step 1: Check if Spreadsheet exists (validates ID)
    let spreadsheet;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();
    try {
      console.log('Fetching spreadsheet metadata for ID:', spreadsheetId);
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      spreadsheet = response.data;
      console.log('Spreadsheet found. Title:', spreadsheet.properties.title);
    } catch (sheetError) {
      console.error('Failed to find spreadsheet:', sheetError.message);
      return res.status(404).json({ 
        error: 'Google Sheet Not Found', 
        details: `Could not find spreadsheet with ID: ${process.env.GOOGLE_SHEET_ID}. Check permissions or ID.` 
      });
    }

    // Step 2: Check for "Subscriptions" tab
    const sheetExists = spreadsheet.sheets.some(
      (s) => s.properties.title === 'Subscriptions'
    );

    if (!sheetExists) {
      // Create the "Subscriptions" sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
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
        spreadsheetId,
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
      spreadsheetId,
      range: 'Subscriptions!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [subscriptionData]
      }
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Failed to save subscription:', error);
    return res.status(500).json({ 
      error: 'Failed to save subscription',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
