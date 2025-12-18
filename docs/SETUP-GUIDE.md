# Setup Guide

Step-by-step instructions for external service setup.

## 1. Google Cloud Setup (Required for Phase 1)

### Create Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click "Select a project" → "New Project"
3. Name: `CFS Tracker`
4. Click "Create"

### Enable Google Sheets API

1. In the project, go to "APIs & Services" → "Library"
2. Search for "Google Sheets API"
3. Click on it → Click "Enable"

### Create Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Name: `cfs-tracker-service`
4. Click "Create and Continue"
5. Skip the optional steps, click "Done"
6. Click on the service account you just created
7. Go to "Keys" tab → "Add Key" → "Create new key"
8. Choose JSON → Download the file
9. **Keep this file secure!** It contains your credentials.

### Create Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it: `CFS Tracker Data`
4. In Row 1, add these headers:
   - A1: `Timestamp`
   - B1: `Date`
   - C1: `Hours`
   - D1: `Comments`
   - E1: `Oxaloacetate (g)`
   - F1: `Exercise (min)`
5. Click "Share" button
6. Add the service account email (looks like `cfs-tracker-service@project-id.iam.gserviceaccount.com`)
7. Give it "Editor" access
8. Copy the spreadsheet ID from the URL:
   - URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit`
   - Copy the part between `/d/` and `/edit`

---

## 2. Vercel Setup (Required for deployment)

### Create Account & Project

1. Go to [vercel.com](https://vercel.com) and sign up (free)
2. Click "Add New" → "Project"
3. Import your GitHub repository (you'll need to push this code first)
4. Framework Preset: Vite
5. Click "Deploy"

### Add Environment Variables

In Vercel project settings → Environment Variables, add:

| Variable | Value | Description |
|----------|-------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `{"type":"service_account",...}` | Entire JSON file contents |
| `GOOGLE_SHEET_ID` | `1abc...xyz` | Spreadsheet ID from URL |
| `SECRET_TOKEN` | `your-random-secret` | Generate a random string (e.g., use `openssl rand -hex 32`) |

### Generate VAPID Keys (Phase 2 - Notifications)

```bash
npx web-push generate-vapid-keys
```

Add these to Vercel environment variables:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL` - Your email address

---

## 3. Local Development

### Environment Variables

Create a `.env.local` file (never commit this!):

```env
VITE_API_URL=http://localhost:3000
VITE_SECRET_TOKEN=dev-secret-token
```

For API development, create `.env`:

```env
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_SHEET_ID=your-spreadsheet-id
SECRET_TOKEN=dev-secret-token
```

### Running Locally

```bash
# Start frontend dev server
npm run dev

# Test API locally (requires Vercel CLI)
npm install -g vercel
vercel dev
```

---

## 4. Deploying Updates

```bash
# Push to GitHub - Vercel auto-deploys
git add .
git commit -m "Description of changes"
git push origin main
```

---

## 5. Testing on iPhone

1. Open your Vercel deployment URL on iPhone Safari
2. Add `?secret=YOUR_SECRET_TOKEN` to the URL
3. Tap Share button → "Add to Home Screen"
4. The app will appear as an icon on home screen
5. Open from icon - it runs in standalone mode (no Safari UI)

---

## Troubleshooting

### "API not working"
- Check Vercel function logs in dashboard
- Verify environment variables are set
- Ensure Google Sheet is shared with service account

### "App not installing as PWA"
- Must be served over HTTPS
- Check manifest.json is valid
- Icons must be correct sizes (192x192, 512x512)

### "Push notifications not working"
- iOS requires the app to be added to home screen
- Notifications must be explicitly enabled in settings
- Check VAPID keys are correct
