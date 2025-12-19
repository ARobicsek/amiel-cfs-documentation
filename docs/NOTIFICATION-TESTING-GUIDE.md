# Notification Testing & Configuration Guide

## Current Alert System Capabilities

Your notification system ALREADY has all the flexibility you requested:

### 1. **Set Time for Daily Alerts**
- Configure `firstReminderTime` in Google Sheets → UserSettings tab
- Format: `HH:MM` in 24-hour time (e.g., `20:00` for 8 PM)
- This is when your first reminder of the day will fire

### 2. **Repeated Alerts at Selected Intervals**
- Configure `repeatInterval` in UserSettings (in minutes)
- Options: `15`, `30`, `60`, `120`, `240`, or `0` (no repeats)
- Alerts repeat at this interval after the first reminder until you log

### 3. **Stop After Logging**
- Configure `stopAfterLog` in UserSettings
- Set to `true`: Stops sending reminders once you've logged for the day
- Set to `false`: Continues sending reminders even after logging

### 4. **Snooze Support**
- Click "Snooze 1 Hour" in the notification to delay the next reminder
- Snooze state is stored in `snoozeUntil` column in UserSettings

---

## Google Sheets UserSettings Configuration

Your UserSettings tab should have these columns:

| A: firstReminderTime | B: repeatInterval | C: stopAfterLog | D: (unused) | E: snoozeUntil |
|----------------------|-------------------|-----------------|-------------|----------------|
| 20:00                | 15                | true            |             |                |

**Example Configurations:**

### Daily reminder at 8 PM, no repeats:
```
firstReminderTime: 20:00
repeatInterval: 0
stopAfterLog: true
```

### Reminders every 15 minutes starting at 8 PM until logged:
```
firstReminderTime: 20:00
repeatInterval: 15
stopAfterLog: true
```

### Persistent reminders every hour (even after logging):
```
firstReminderTime: 09:00
repeatInterval: 60
stopAfterLog: false
```

---

## How to Test Notifications

### Diagnostic Steps:

#### 1. **Check if you have an active subscription**
   - Open your app in the browser
   - Go to Settings
   - Check if "Notifications Enabled" is showing
   - If not, click "Enable Notifications" and grant permission

#### 2. **Verify Environment Variables (Vercel)**

   **How to check Vercel environment variables:**
   1. Go to https://vercel.com/
   2. Click on your project
   3. Click "Settings" tab at the top
   4. Click "Environment Variables" in the left sidebar
   5. Verify these variables are set:
      - `VAPID_PUBLIC_KEY` (can have `=` padding - code now handles it)
      - `VAPID_PRIVATE_KEY` (can have `=` padding - code now handles it)
      - `VAPID_EMAIL` (should be an email address)
      - `SECRET_TOKEN`
      - `GOOGLE_SERVICE_ACCOUNT_KEY` (full JSON)
      - `GOOGLE_SHEET_ID`

   **Note**: The code now automatically strips padding (`=`) from VAPID keys, so you don't need to manually remove it.

#### 3. **Check Google Sheets Subscriptions Tab**
   - Open your Google Sheet
   - Look for a tab named "Subscriptions"
   - Should have at least one row with subscription data (endpoint, keys, auth, subscription JSON)
   - If missing, re-enable notifications in the app Settings

#### 4. **Test with Apps Script**
   Your Google Apps Script should look like this:
   ```javascript
   function triggerCron() {
     const url = 'https://your-app.vercel.app/api/cron-trigger';

     const options = {
       method: 'get',
       muteHttpExceptions: true
     };

     const response = UrlFetchApp.fetch(url, options);
     const statusCode = response.getResponseCode();
     const responseText = response.getContentText();

     Logger.log('Cron trigger response: ' + statusCode);
     Logger.log(responseText);

     return responseText;
   }
   ```

#### 5. **Force a Notification (Bypass "already_logged" check)**

   **Option A: Temporarily disable stopAfterLog**
   1. Open Google Sheets → UserSettings tab
   2. Change column C from `true` to `false`
   3. Run your Apps Script cron trigger
   4. Change it back to `true` when done testing

   **Option B: Delete today's entry temporarily**
   1. Open Google Sheets → Sheet1
   2. Find today's entry row
   3. Delete it (or cut and paste elsewhere temporarily)
   4. Run your Apps Script cron trigger
   5. Restore the entry

   **Option C: Change firstReminderTime to a few minutes from now**
   1. Check current time in Eastern Time
   2. Set `firstReminderTime` to 2-3 minutes from now
   3. Wait for the Apps Script to run (if on a 5-minute trigger)
   4. OR manually run the Apps Script

---

## Debugging the 500 Error

With the enhanced logging I just added, when you run the Apps Script again, you'll see detailed console logs showing:

1. ✅ "Fetching joke from API..."
2. ✅ "Joke fetched successfully"
3. ✅ "Configuring VAPID..."
4. ✅ "VAPID configured successfully"
5. ✅ "Fetching subscriptions from Google Sheets..."
6. ✅ "Found X rows in Subscriptions tab"
7. ✅ "Parsed X valid subscriptions"

**The logs will pinpoint exactly where the failure occurs.**

Most common causes of 500 errors:
- Missing VAPID environment variables in Vercel
- No subscriptions in Subscriptions tab
- Expired or invalid subscription (user cleared browser data)
- Joke API temporarily down

---

## Next Steps

1. **Deploy the updated code** (with enhanced logging)
2. **Run the Apps Script trigger manually**
3. **Check Vercel logs** (Vercel dashboard → your project → Logs)
4. **Share the detailed error message** with the error.message and logs

The enhanced logging will tell us exactly what's failing!

---

## Setting Up for Testing

### Quick Test Configuration:
```
1. Set firstReminderTime to current time + 5 minutes
2. Set repeatInterval to 5 (for quick testing)
3. Set stopAfterLog to false (so you can test multiple times)
4. Delete today's entry or wait for the time to hit
5. Run Apps Script manually
6. Check Vercel logs for detailed output
```

After testing:
```
1. Set firstReminderTime to your preferred time (e.g., 20:00)
2. Set repeatInterval to your preference (15, 30, 60, etc.)
3. Set stopAfterLog back to true
```
