# CFS Daily Tracker

A Progressive Web App (PWA) for tracking daily health metrics for Chronic Fatigue Syndrome management.

## Features

- **Minimal friction**: 2-tap daily logging (open app, slide hours, save)
- **Works offline**: Syncs when back online
- **Push notifications**: Daily reminders with jokes for motivation
- **Data export**: All data stored in Google Sheets for easy access
- **No login required**: Uses secret URL for authentication

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## For Developers

### Session Management

**IMPORTANT**: Use these commands at the start and end of every coding session:

| Command | When to Use |
|---------|-------------|
| `/start-session` | Beginning of every coding session |
| `/end-session` | End of every coding session |

This ensures proper documentation and progress tracking.

### Other Slash Commands

| Command | Purpose |
|---------|---------|
| `/status` | See current progress and what's completed |
| `/next` | Get guidance on the next task to implement |

### Key Documents

- [docs/PROGRESS.md](docs/PROGRESS.md) - Track completed features
- [docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md) - Google Cloud & Vercel setup
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture

### Development Rules

1. Always use `/start-session` at the beginning
2. Always use `/end-session` at the end
3. Update `docs/PROGRESS.md` (end-session does this)
4. Test on iPhone after each feature
5. Commit after each working feature
6. Don't skip ahead in the feature list

## Project Structure

```
cfs-tracker/
├── api/                      # Vercel serverless functions
│   ├── submit-entry.js       # Save daily entry
│   ├── get-entries.js        # Fetch history
│   ├── subscribe.js          # Push subscription
│   ├── send-notification.js  # Send push + joke
│   └── cron-trigger.js       # Scheduled trigger
├── public/
│   ├── manifest.json         # PWA manifest (auto-generated)
│   └── pwa-*.png             # App icons
├── src/
│   ├── components/
│   │   └── DailyEntry.jsx    # Main entry form
│   ├── utils/
│   │   ├── auth.js           # Secret token handling
│   │   ├── api.js            # API calls
│   │   └── offlineStorage.js # IndexedDB sync
│   ├── App.jsx
│   └── main.jsx
├── docs/                     # Documentation
└── .claude/commands/         # Claude Code slash commands
```

## Tech Stack

- **Frontend**: React + Vite + PWA
- **Backend**: Vercel Serverless Functions
- **Database**: Google Sheets API
- **Notifications**: Web Push API

## Cost

**$0/month** - All services used have generous free tiers.
