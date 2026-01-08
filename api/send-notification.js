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
    // Check for custom message in request body
    const { message } = req.body || {};
    const customMessage = (message && typeof message === 'string') ? message.trim() : '';

    // Always fetch a joke
    console.log('Fetching joke from API...');
    let jokeString = '';

    try {
      const jokeResponse = await fetch('https://official-joke-api.appspot.com/random_joke');
      if (jokeResponse.ok) {
        const joke = await jokeResponse.json();
        jokeString = `${joke.setup} ${joke.punchline}`;
        console.log('Joke fetched successfully');
      } else {
        console.error(`Joke API returned ${jokeResponse.status}`);
        jokeString = 'Why did the developer go broke? Because he used up all his cache.';
      }
    } catch (e) {
      console.error('Failed to fetch joke:', e);
      jokeString = 'Why did the developer go broke? Because he used up all his cache.';
    }

    // Combine custom message and joke
    let jokeText;
    if (customMessage) {
      jokeText = `${customMessage}\n\n${jokeString}`;
      console.log('Using custom message + joke');
    } else {
      jokeText = jokeString;
      console.log('Using joke only');
    }

    // Initialize debugInfo early so we can add VAPID info
    let debugInfo = {
      sheetId: process.env.GOOGLE_SHEET_ID ? process.env.GOOGLE_SHEET_ID.substring(0, 5) + '...' : 'missing',
      rowsFound: 0,
      rowsContent: [],
      parseErrors: [],
      appleJwtDebug: null  // Will be populated for Apple endpoints
    };
    let subscriptions = [];

    // Configure web-push with VAPID keys
    console.log('Configuring VAPID...');
    // IMPORTANT: .trim() removes trailing newlines that break Apple's JWT validation
    let vapidSubject = process.env.VAPID_EMAIL ? process.env.VAPID_EMAIL.trim() : null;
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

    // Debug: Log full key info to verify they match expected values
    console.log('VAPID Public Key:', vapidPublicKey);
    console.log('VAPID Public Key length:', vapidPublicKey.length);
    console.log('VAPID Private Key length:', vapidPrivateKey.length);
    console.log('VAPID Private Key (first 10 chars):', vapidPrivateKey.substring(0, 10));

    // Add VAPID debug info
    debugInfo.vapid = {
      subject: vapidSubject,
      serverKeyPrefix: vapidPublicKey.substring(0, 15) + '...',
      publicKeyLength: vapidPublicKey.length,
      privateKeyLength: vapidPrivateKey.length
    };

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

    try {
      const getResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID.trim(),
        range: 'Subscriptions!A:D',
      });

      const rows = getResponse.data.values || [];
      debugInfo.rowsFound = rows.length;
      console.log(`Found ${rows.length} rows in Subscriptions tab`);

      // Robust parsing: Iterate ALL rows to find valid subscriptions
      // This handles cases where header is missing or rows are messy
      if (rows.length > 0) {
        // Capture a sample for debugging
        debugInfo.rowsContent = rows.slice(0, 5).map(r => ({
          colCount: r.length,
          hasFullSub: !!r[3],
          fullSubPreview: r[3] ? r[3].substring(0, 50) + '...' : 'undefined'
        }));

        subscriptions = rows.map((row, index) => {

          try {

            // We expect the full subscription JSON in column D (index 3)

            if (!row[3]) {

              debugInfo.parseErrors.push({ index, error: 'Empty column D' });

              return null;

            }



            let sub;

            try {

              sub = JSON.parse(row[3]);

            } catch (e) {

              // Ignore header row which is likely "Full Subscription"

              if (row[3] === "Full Subscription" || (index === 0 && !row[3].startsWith('{'))) {

                return null;

              }

              debugInfo.parseErrors.push({

                index,

                error: 'JSON parse error',

                contentPreview: row[3].substring(0, 20) + '...'

              });

              return null;

            }



            // Validate it has the essential fields of a PushSubscription

            const missing = [];

            if (!sub.endpoint) missing.push('endpoint');

            if (!sub.keys) missing.push('keys');

            else {

              if (!sub.keys.p256dh) missing.push('keys.p256dh');

              if (!sub.keys.auth) missing.push('keys.auth');

            }



            if (missing.length > 0) {

              debugInfo.parseErrors.push({ index, error: 'Missing fields', missing });

              return null;

            }



            // Attach the original row index for cleanup (index 0 is the first row returned)

            // The Google Sheets API uses 0-based index for the whole sheet.

            // Since we grabbed 'A:D', rows[0] is truly row 0 of the sheet.

            sub._rowIndex = index;

            return sub;

          } catch (error) {

            // JSON parse error - expected for the header row

            // or invalid data. We silently skip.

            debugInfo.parseErrors.push({ index, error: 'Unexpected error', message: error.message });

            return null;

          }

        }).filter(sub => sub !== null);

      }

      console.log(`Parsed ${subscriptions.length} valid subscriptions`);

    } catch (error) {

      console.error('Failed to get subscriptions from Google Sheets:', error);

      console.error('Error details:', error.message);

      debugInfo.error = error.message;

      // If no subscriptions exist, that's okay

    }



    if (subscriptions.length === 0) {

      console.log('No subscriptions found - returning success with sent=0');

      return res.status(200).json({

        success: true,

        message: 'No subscriptions found',

        joke: jokeText,

        sent: 0,

        debug_info: debugInfo

      });

    }



    // Send notifications to all subscriptions

    const payload = JSON.stringify({

      title: 'Time to track your day!',

      body: jokeText,

      icon: '/pwa-192x192.png',

      badge: '/favicon.svg',

      data: {
        url: '/',
        token: expectedToken  // Pass token for snooze action
      },

      actions: [
        {
          action: 'snooze',
          title: 'Snooze 1 Hour'
        }
      ]

    });



    let sentCount = 0;

    const sendErrors = [];

    const rowsToDelete = [];



    const sendPromises = subscriptions.map(async (subscription) => {
      try {
        // Create a clean subscription object for web-push (remove internal _rowIndex)
        const cleanSub = {
          endpoint: subscription.endpoint,
          keys: subscription.keys
        };

        // Add options that Apple may require
        const options = {
          TTL: 86400, // 24 hours in seconds
          urgency: 'normal'
        };

        // Log which endpoint we're sending to
        const isApple = subscription.endpoint.includes('apple.com');
        console.log(`Sending to ${isApple ? 'Apple' : 'FCM'}: ${subscription.endpoint.substring(0, 50)}...`);

        // DEBUG: For Apple endpoints, log the actual JWT being generated
        if (isApple) {
          try {
            const requestDetails = webpush.generateRequestDetails(cleanSub, payload, options);
            const authHeader = requestDetails.headers.Authorization;
            console.log('=== APPLE JWT DEBUG ===');
            console.log('Full Authorization header:', authHeader);

            // Decode the JWT to inspect claims (it's the part after "vapid t=")
            if (authHeader && authHeader.includes('t=')) {
              const jwtToken = authHeader.split('t=')[1].split(',')[0];
              const jwtParts = jwtToken.split('.');
              if (jwtParts.length >= 2) {
                // Decode the payload (second part of JWT)
                const payloadBase64 = jwtParts[1];
                // Add padding if needed for base64 decoding
                const padded = payloadBase64 + '='.repeat((4 - payloadBase64.length % 4) % 4);
                const decoded = Buffer.from(padded, 'base64').toString('utf8');
                console.log('JWT Payload (decoded):', decoded);

                const claims = JSON.parse(decoded);
                console.log('JWT aud claim:', claims.aud);
                console.log('JWT sub claim:', claims.sub);
                console.log('JWT exp claim:', claims.exp, '(expires:', new Date(claims.exp * 1000).toISOString(), ')');

                // Check if exp is more than 24 hours from now
                const now = Math.floor(Date.now() / 1000);
                const expDiff = claims.exp - now;
                const expHours = (expDiff / 3600).toFixed(2);
                console.log('JWT exp is', expDiff, 'seconds from now (', expHours, 'hours)');

                // Store in debugInfo for API response
                debugInfo.appleJwtDebug = {
                  aud: claims.aud,
                  sub: claims.sub,
                  exp: claims.exp,
                  expISO: new Date(claims.exp * 1000).toISOString(),
                  expHoursFromNow: parseFloat(expHours),
                  expOver24Hours: expDiff > 86400,
                  cryptoKeyHeader: requestDetails.headers['Crypto-Key'] ? requestDetails.headers['Crypto-Key'].substring(0, 50) + '...' : null
                };

                if (expDiff > 86400) {
                  console.log('WARNING: exp claim is MORE than 24 hours! Apple will reject this.');
                }
              }
            }
            console.log('Crypto-Key header:', requestDetails.headers['Crypto-Key']);
            console.log('=== END APPLE JWT DEBUG ===');
          } catch (debugErr) {
            console.log('JWT debug error:', debugErr.message);
            debugInfo.appleJwtDebug = { error: debugErr.message };
          }
        }

        await webpush.sendNotification(cleanSub, payload, options);
        sentCount++;
        console.log(`Success: ${isApple ? 'Apple' : 'FCM'}`);
      } catch (error) {
        console.error('Failed to send to subscription:', error);
        console.error('Error body:', error.body);
        console.error('Error headers:', error.headers);

        // Only auto-delete 410 Gone (truly expired) - keep 403 for debugging
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`Marking expired subscription at row ${subscription._rowIndex} for deletion.`);
          rowsToDelete.push(subscription._rowIndex);
        }

        sendErrors.push({
          endpoint: subscription.endpoint ? subscription.endpoint.substring(0, 50) + '...' : 'unknown',
          error: error.message,
          statusCode: error.statusCode,
          body: error.body, // Include full error body from push service
          headers: error.headers ? JSON.stringify(error.headers) : undefined
        });
      }
    });



    await Promise.all(sendPromises);



    // Clean up invalid subscriptions

    let cleanedUp = 0;

    if (rowsToDelete.length > 0) {

      try {

        // Sort descending to delete from bottom up

        rowsToDelete.sort((a, b) => b - a);



        const requests = rowsToDelete.map(rowIndex => ({

          deleteDimension: {

            range: {

              sheetId: 0, // Assuming Subscriptions is the first sheet? DANGEROUS.

              // We need the specific sheetId for "Subscriptions".

              // Let's assume we need to fetch it first or use a smarter way.

              // Actually, 'deleteDimension' requires sheetId (integer), NOT the name.

              // This is tricky without fetching metadata.



              // ALTERNATIVE: Just clear the content of the row. It's safer and easier.

              // We can filter out empty rows in future reads.

              dimension: "ROWS",

              startIndex: rowIndex,

              endIndex: rowIndex + 1

            }

          }

        }));



        // Getting Sheet ID for "Subscriptions"

        // We already have 'sheets' client.

        const spreadsheet = await sheets.spreadsheets.get({

          spreadsheetId: process.env.GOOGLE_SHEET_ID.trim()

        });

        const subSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'Subscriptions');



        if (subSheet) {

          const sheetId = subSheet.properties.sheetId;



          // Update requests with correct sheetId

          requests.forEach(req => req.deleteDimension.range.sheetId = sheetId);



          await sheets.spreadsheets.batchUpdate({

            spreadsheetId: process.env.GOOGLE_SHEET_ID.trim(),

            requestBody: { requests }

          });

          cleanedUp = rowsToDelete.length;

          console.log(`Successfully deleted ${cleanedUp} invalid subscription rows.`);

        } else {

          console.error('Could not find "Subscriptions" sheet ID for cleanup.');

        }

      } catch (cleanupError) {

        console.error('Failed to cleanup invalid subscriptions:', cleanupError);

        // Don't fail the whole request just because cleanup failed

        debugInfo.cleanupError = cleanupError.message;

      }

    }



    return res.status(200).json({

      success: true,

      joke: jokeText,

      sent: sentCount,

      total: subscriptions.length,

      debug_info: debugInfo,

      send_errors: sendErrors,

      cleaned_up: cleanedUp

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
