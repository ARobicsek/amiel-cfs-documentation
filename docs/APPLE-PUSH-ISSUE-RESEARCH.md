# Apple Web Push Notification Issue - Deep Research Request

## Problem Summary

We have a Progressive Web App (PWA) that uses Web Push notifications. Notifications work perfectly on **Chrome/FCM** but consistently fail on **iOS Safari PWA** with a `403 Forbidden` error and `{"reason":"BadJwtToken"}` response from Apple's push service.

## Technical Stack

- **Frontend**: React 19 + Vite 7 + vite-plugin-pwa
- **Backend**: Vercel Serverless Functions (Node.js)
- **Push Library**: `web-push` npm package v3.6.7
- **Storage**: Google Sheets (for subscription storage)
- **iOS Version**: iOS 16.4+ (PWA installed to Home Screen)

## The Error

When sending push notifications to Apple endpoints (`web.push.apple.com`), we receive:

```
HTTP 403 Forbidden
Body: {"reason":"BadJwtToken"}
Headers: {
  'content-type': 'text/plain; charset=UTF-8',
  'apns-id': '...'
}
```

Chrome/FCM endpoints work correctly with the same code.

## Architecture Overview

### Subscription Flow (Client-Side)
```javascript
// src/utils/pushNotification.js
const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
});
// Subscription sent to /api/subscribe and stored in Google Sheets
```

### Notification Sending Flow (Server-Side)
```javascript
// api/send-notification.js
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY.trim().replace(/=+$/, '');
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY.trim().replace(/=+$/, '');

webpush.setVapidDetails(
  'mailto:ari.robicsek@gmail.com',
  vapidPublicKey,
  vapidPrivateKey
);

await webpush.sendNotification(subscription, payload, {
  TTL: 86400,
  urgency: 'normal'
});
```

### Environment Variables (Vercel)
- `VAPID_PUBLIC_KEY` - Server-side public key
- `VAPID_PRIVATE_KEY` - Server-side private key
- `VITE_VAPID_PUBLIC_KEY` - Client-side public key (baked into JS at build time)
- `VAPID_EMAIL` - Set to `mailto:ari.robicsek@gmail.com`

## What We've Verified

1. **Keys match between client and server**: The UI confirms "Keys match" when comparing the first 15 chars of client and server public keys

2. **Key format is correct**:
   - Public key: 87 characters (correct for base64url-encoded P-256 public key)
   - Private key: 43 characters (correct for base64url-encoded P-256 private key)
   - Keys generated using `npx web-push generate-vapid-keys`

3. **VAPID subject format is correct**: `mailto:ari.robicsek@gmail.com` (no spaces, no angle brackets)

4. **PWA is properly installed**: Added to Home Screen on iOS, not running in Safari browser

5. **iOS version is compatible**: iOS 16.4+ which supports Web Push for PWAs

6. **Subscription endpoint is Apple**: Endpoints start with `https://web.push.apple.com/...`

## What We've Tried

### Attempt 1: Verify VAPID Email Format
- Changed from `admin@cfs-tracker.local` to real email `ari.robicsek@gmail.com`
- Result: Still 403 BadJwtToken

### Attempt 2: Regenerate VAPID Keys
- Generated fresh keys using `npx web-push generate-vapid-keys`
- Updated in Vercel environment variables
- Result: Still 403 BadJwtToken

### Attempt 3: Add TTL and Urgency Options
```javascript
const options = {
  TTL: 86400,
  urgency: 'normal'
};
await webpush.sendNotification(subscription, payload, options);
```
- Result: Still 403 BadJwtToken

### Attempt 4: Force Vercel Rebuild
- Created empty commit to trigger fresh build
- Ensured `VITE_VAPID_PUBLIC_KEY` would be baked into new JS bundle
- Result: Still 403 BadJwtToken

### Attempt 5: Delete Old Subscriptions and Re-subscribe
- Deleted all Apple (`web.push.apple.com`) subscriptions from Google Sheets
- Disabled notifications in PWA
- Re-enabled notifications (creating fresh subscription)
- Result: Still 403 BadJwtToken

### Attempt 6: Generate Brand New Keys and Full Reset
- Generated completely new VAPID key pair
- Updated all three env vars in Vercel (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY)
- Waited for new deployment
- Cleared subscriptions
- Re-subscribed on iPhone
- Result: FCM now also fails with "VAPID credentials do not correspond to the credentials used to create the subscriptions", Apple still returns BadJwtToken

## Key Observations

1. **FCM (Chrome) worked initially** - Before key regeneration, Chrome notifications worked perfectly

2. **FCM error is clear**: "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions" - This suggests subscriptions are being created with different keys than what the server uses

3. **Apple error is opaque**: `BadJwtToken` doesn't specify what's wrong with the JWT

4. **Build-time vs Runtime issue**: `VITE_VAPID_PUBLIC_KEY` is embedded at Vite build time, while `VAPID_PUBLIC_KEY` is read at runtime. If these ever get out of sync, subscriptions will fail.

5. **Possible timing issue**: When changing keys in Vercel:
   - Env vars update immediately
   - But the JS bundle needs a rebuild to get new VITE_VAPID_PUBLIC_KEY
   - If user subscribes before rebuild completes, subscription uses old key

## Specific Questions for Research

1. **What exactly does Apple's "BadJwtToken" error mean?** What specific JWT claims or formats does Apple reject that other push services accept?

2. **Are there known issues with the `web-push` npm library (v3.6.7) and Apple's push service?**

3. **What is the exact JWT format Apple expects?** Specifically:
   - What should the `aud` (audience) claim be?
   - What are the `exp` (expiration) requirements?
   - What `sub` (subject) formats are accepted?

4. **Is there a way to decode/debug the JWT that web-push generates** to verify it meets Apple's requirements?

5. **Are there any Apple-specific VAPID requirements** that differ from the standard Web Push protocol?

6. **Could there be an issue with how the subscription is created on iOS Safari?** Perhaps the client-side subscription process differs from Chrome?

7. **Is there a known issue with Vercel's serverless environment** that affects JWT signing or timing?

## Relevant Code Files

- `src/utils/pushNotification.js` - Client-side subscription logic
- `api/send-notification.js` - Server-side notification sending
- `src/components/Settings.jsx` - UI for enable/disable notifications
- `public/sw-custom.js` - Service worker for push events

## Environment Details

- Node.js version on Vercel: Latest LTS
- web-push version: 3.6.7
- Deployment platform: Vercel (Hobby plan)
- iOS device: iPhone with iOS 16.4+
- Browser: Safari (via PWA on Home Screen)

## Sample Error Logs

### Apple Push Failure
```
Sending to Apple: https://web.push.apple.com/QPmR8FqT7MYG26kY1NsMNxh...
WebPushError: Received unexpected response code
  statusCode: 403,
  body: '{"reason":"BadJwtToken"}',
  endpoint: 'https://web.push.apple.com/QPmR8FqT7MYG26kY1NsMNxh...'
```

### FCM Failure (after key change)
```
Sending to FCM: https://fcm.googleapis.com/fcm/send/cwaEeXdJmvw:AP...
WebPushError: Received unexpected response code
  statusCode: 403,
  body: 'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.'
```

## What We Need

A solution that allows iOS Safari PWA push notifications to work using the standard `web-push` npm library, or an alternative approach if the library has fundamental incompatibilities with Apple's push service.
