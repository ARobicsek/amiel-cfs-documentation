# VAPID & Push Notification Debugging Guide

This document summarizes the critical issues and solutions encountered while setting up Web Push Notifications for the CFS Tracker, specifically for iOS Safari PWA support.

## The Core Issue: "Split Key Pair" & Stale Builds

The persistent `403 BadJwtToken` error from Apple and `403 VAPID credentials do not correspond` from FCM were caused by a mismatch between the **Public Key** used by the Frontend (iPhone/Browser) and the **Private Key** used by the Backend (Vercel).

### Symptoms
1.  **Apple Error:** `{"reason":"BadJwtToken"}` with status 403.
2.  **FCM Error:** `the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions`.
3.  **UI:** Might misleadingly say "Keys match" if it compares the *configured* server key to the *configured* client key, missing the fact that the *subscription itself* was created with an old key.

### Root Causes
1.  **Vercel/Vite Build Process:** `VITE_VAPID_PUBLIC_KEY` is embedded into the JavaScript bundle at **build time**. Changing it in Vercel settings does *not* update the running client code until a full rebuild occurs.
2.  **Service Worker Caching:** iOS Safari is extremely aggressive about caching the PWA's `index.html` and JS bundles. Even deleting the PWA often leaves the old Service Worker alive, serving stale code with old keys.
3.  **Key Rotation:** When keys are rotated, *all* existing subscriptions become invalid (410 Gone / 403 Forbidden) and must be recreated.

---

## The Solution Checklist

If this happens again, follow this exact sequence:

### 1. Server-Side Configuration
*   Generate new keys: `npx web-push generate-vapid-keys`
*   Update **Vercel Environment Variables** (Production):
    *   `VAPID_PUBLIC_KEY`: New Public Key
    *   `VAPID_PRIVATE_KEY`: New Private Key
    *   `VITE_VAPID_PUBLIC_KEY`: **Identical** New Public Key
*   **Redeploy** (Uncheck "Use existing Build Cache" if possible).

### 2. Database Cleanup
*   **Google Sheets:** Delete **ALL rows** in the 'Subscriptions' tab. Old subscriptions are cryptographically dead.

### 3. Client-Side "Nuke" (Crucial for iOS)
Merely refreshing is not enough.

**For iPhone:**
1.  **Delete** the PWA from Home Screen.
2.  **Clear Safari Data:** Settings > Safari > Advanced > Website Data > **Delete [your-domain]**.
3.  **Restart Safari** and visit the site.
4.  **Login** (Enter Secret Token).
5.  **Enable Notifications** *before* adding to Home Screen to verify.
6.  **Add to Home Screen.**

**For Desktop:**
1.  Open DevTools -> Application -> Service Workers -> **Unregister**.
2.  Clear Site Data (Storage).
3.  Hard Refresh.

---

## Code Safety Features Added

1.  **Settings UI Lock Fix:** The "Authentication Token" input is now always visible, even if the browser reports `Push Not Supported`. This prevents the "Catch-22" where you couldn't enter the token to enable features.
2.  **Explicit Logging:** The app now logs detailed connection/token status on startup.
3.  **Key Validation:** The system checks if keys match (prefix check) in the test notification response.

## Reference Commands

*   **Generate Keys:** `npx web-push generate-vapid-keys`
*   **Run Local API:** `vercel dev`
*   **Build:** `npm run build`
