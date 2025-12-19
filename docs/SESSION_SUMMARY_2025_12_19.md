# Session Summary: Debugging iPhone Push Notifications (Dec 19, 2025)

## 🎯 Goal
Fix the `403 BadJwtToken` error preventing push notifications on iOS PWA. 
**Current Status:** Desktop (Chrome/FCM) works perfectly. iOS (APNs) consistently fails with `403 BadJwtToken`.

## 🧩 The Core Issue
Despite the backend successfully signing requests for Google (FCM), Apple's Push Notification Service (APNs) rejects the exact same signed VAPID headers with:
```json
{
  "statusCode": 403,
  "body": "{\"reason\": \"BadJwtToken\"}",
  "endpoint": "https://web.push.apple.com/..."
}
```

## 🏆 Accomplishments & Validations
1.  **Verified VAPID Key Integrity: 
    *   Confirmed `VITE_VAPID_PUBLIC_KEY` (Frontend) matches `VAPID_PUBLIC_KEY` (Backend).
    *   Both are using the new key starting with: `BFmL1...`
    *   **Proof:** Desktop Chrome subscribes and receives notifications using these exact keys.
2.  **RFC 8292 Compliance Updates:**
    *   **Subject Claim (`sub`):** Explicitly updated to use the `mailto:` scheme (e.g., `mailto:ari.robicsek@gmail.com`). This is a strict requirement for Apple.
    *   **Audience Claim (`aud`):** Verified requirements for `https://web.push.apple.com`.
3.  **Deployment Hygiene:**
    *   Regenerated VAPID keys.
    *   Redeployed to Vercel with "Redeploy with existing build cache" **UNCHECKED** to prevent "zombie key" issues.
    *   Cleared Google Sheets subscription database.

## 📝 Chronology of Troubleshooting Steps

### Phase 1: The Key Mismatch (Solved)
*   **Issue:** Logs showed Client using old key (`BExMs...`) and Server using new key (`BFmL1...`).
*   **Fix:** Rotated keys, updated Vercel environment variables, and forced client cache clear.
*   **Result:** Client and Server now aligned. Desktop notifications started working.

### Phase 2: Apple Strictness (In Progress)
*   **Issue:** iOS still returns `403 BadJwtToken`.
*   **Hypothesis:** Apple is stricter than Chrome regarding the JWT format (VAPID claims).
*   **Actions:**
    *   Updated code to ensure `vapidDetails.subject` is strictly `mailto:...`.
    *   Investigated `aud` claim. Apple requires the audience to be the *origin* (`https://web.push.apple.com`), not the full endpoint. The `web-push` library usually handles this, but it's a prime suspect.
    *   Resubscribed on iOS after clearing Safari history and deleting the Home Screen app.
*   **Result:** Error persists.

### Phase 3: The "Senior Dev" Checklist (Review)
We reviewed a list of common pitfalls:
1.  **`sub` Claim:** Must be `mailto:`. (✅ We did this).
2.  **`aud` Claim:** Must be `https://web.push.apple.com`. (✅ `web-push` library standard behavior, but worth double-checking).
3.  **Key Mismatch:** (✅ Verified resolved).
4.  **Crypto Encoding:** Apple requires Raw P-256 (64 bytes), not ASN.1 DER. `web-push` library *should* handle this, but if we are on an old version or using a specific Node crypto setup, it might drift.

## 🐛 Latest Logs (Comparison)

### Desktop (Success)
```text
Test notification sent! (0 devices) (Keys match: BFmL1FbjVGfE3fw...) 
Subject: mailto:ari.robicsek@gmail.com
Sending to FCM: https://fcm.googleapis.com/fcm/send/ehSNumZgVx4:AP... 
Success: FCM
```

### iOS (Failure)
```text
Test notification sent! (1 device) (Keys match: BFmL1FbjVGfE3fw...) 
Subject: mailto:ari.robicsek@gmail.com 
⚠️ 1 device(s) failed: 
1. Received unexpected response code (Status: 403) 
Endpoint: https://web.push.apple.com/QJD9NbgKSQ18KCfwQ8yZd0Z... 
Response: {"reason":"BadJwtToken"}
```

## 🔭 Next Steps
1.  **Debug the JWT Generation:**
    *   We cannot see the *actual* JWT token being sent to Apple in the logs. We need to log the generated authorization header to inspect the `aud` and `exp` claims directly.
2.  **Library verification:**
    *   Check the version of `web-push` in `package.json`. Ensure it's the latest.
    *   Consider generating the VAPID headers manually (or using a different library) for a single test to rule out library-specific formatting issues that Chrome ignores but Apple rejects.
3.  **Time Drift:**
    *   Ensure the `exp` (expiration) claim is not > 24 hours. Apple rejects tokens valid for longer than 24 hours.
4.  **Endpoint URL:**
    *   Verify we aren't sending the request to the *production* APNs URL while using a *development* token, or vice versa (though Web Push standardizes this via the endpoint URL provided by the browser).

### Possible other things to consider

1.  **Verify iPhone Subscription Key:**
    *   We need to log the *actual* key from the subscription object on the iPhone: `btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))) `.
    *   Compare this *byte-for-byte* with the `VITE_VAPID_PUBLIC_KEY`.
    *   If they differ, the Service Worker is *still* serving the old key despite our cache clearing.
2.  **Nuclear Option:**
    *   Change the PWA `manifest.json` or `sw.js` filename slightly to force a browser update.
3.  **Apple-Specific Constraints:**
    *   Investigate if `web-push` creates a JWT `aud` (Audience) claim that Apple dislikes (e.g., trailing slash issues), though this is unlikely given the library's maturity.
4.  **Time Sync:**
    *   Verify the server time on Vercel isn't drifting (JWT `exp` claim issue), though unlikely to affect only Apple.

## 📂 Key Files
*   `api/send-notification.js`: The backend logic where VAPID details are set.
*   `src/utils/pushNotification.js`: Frontend subscription logic.
*   `docs/APPLE-PUSH-ISSUE-RESEARCH.md`: Background reading.