# Health Data Archival System

## Overview

The Health Data Archival system safely manages the growth of the `Health_Hourly` sheet by moving older data to archive sheets. This prevents the sheet from hitting Google Sheets' 40,000 row limit while preserving all historical data.

## Why Archive?

- **Health_Hourly** receives ~140 rows per day
- At this rate, the sheet would hit Google's 40,000 row limit in approximately 10 months
- Archiving moves old data to separate sheets, keeping the active sheet performant
- **Nothing is ever deleted** - all data is preserved in archive sheets

## How It Works

### Safety Features

The archival system is designed with multiple safety layers:

1. **Dry-run mode** - Preview what would happen before making changes
2. **Explicit confirmation** - Won't run without `?confirm=true` parameter
3. **Archive-before-delete** - Creates verified backup BEFORE touching active data
4. **Verification checks** - Confirms archive was created successfully before deletion
5. **Safety thresholds** - Refuses to run if >95% of data would be archived (likely a configuration error)
6. **Nothing is lost** - All data preserved in `Health_Hourly_Archive_YYYY` sheets
7. **Detailed logging** - Every step logged for audit trail
8. **Error rollback** - If anything fails, NO data is deleted

### What Gets Archived

- Data older than the retention threshold (default: 90 days)
- Moved to archive sheets named `Health_Hourly_Archive_2026`, `Health_Hourly_Archive_2027`, etc.
- Recent data (last 90 days) stays in the active `Health_Hourly` sheet

## When to Run

### Recommended Timeline

1. **0-6 months**: No action needed (~25K rows)
2. **6-10 months**: Consider first archive (~30K-40K rows approaching limit)
3. **After archival**: Back to ~12.6K rows (90 days of data)
4. **Long-term**: Run archival every 6-12 months as needed

### Check Current Row Count

1. Open the Google Sheet
2. Look at the `Health_Hourly` sheet
3. Scroll to the bottom to see the last row number
4. If approaching 35,000+ rows, consider archiving

## How to Run

### Step 1: Preview (Dry Run)

**Always run this first** to see what would happen without making any changes.

**URL:**
```
GET https://amiel-cfs-documentation.vercel.app/api/archive-health-data?dryRun=true&retentionDays=90
```

**Response Example:**
```json
{
  "dryRun": true,
  "message": "Dry run - no changes made",
  "cutoffDate": "10/26/2025",
  "retentionDays": 90,
  "totalRows": 38500,
  "rowsToArchive": 25900,
  "rowsToKeep": 12600,
  "percentageToArchive": 67,
  "nextStep": "Run with ?confirm=true to perform archival",
  "oldestRowToArchive": "12/26/2024",
  "newestRowToArchive": "10/25/2025"
}
```

**What to Check:**
- `percentageToArchive`: Should be reasonable (typically 60-80%)
- `rowsToKeep`: Should leave ~12,000-15,000 rows (90 days worth)
- `oldestRowToArchive` and `newestRowToArchive`: Verify the date range makes sense

### Step 2: Execute (Actual Archival)

**Only run this after reviewing the dry-run results.**

**URL:**
```
GET https://amiel-cfs-documentation.vercel.app/api/archive-health-data?confirm=true&retentionDays=90
```

**Response Example:**
```json
{
  "success": true,
  "message": "Archive completed successfully",
  "cutoffDate": "10/26/2025",
  "retentionDays": 90,
  "archiveSheet": "Health_Hourly_Archive_2026",
  "rowsArchived": 25900,
  "rowsKept": 12600,
  "archivedDateRange": {
    "oldest": "12/26/2024",
    "newest": "10/25/2025"
  },
  "timestamp": "2026-01-24T12:00:00.000Z"
}
```

## Parameters

### retentionDays (optional)

Controls how many days of recent data to keep in the active sheet.

- **Default**: `90` (recommended)
- **Range**: 30-180 days
- **Example**: `?retentionDays=120` (keep last 4 months)

**Choosing the right value:**
- `60 days`: More frequent archiving, smaller active sheet, more archives
- `90 days` (default): Good balance between performance and convenience
- `120 days`: Less frequent archiving, larger active sheet

## Testing the Endpoint

### Using curl (from command line):

**Dry run:**
```bash
curl "https://amiel-cfs-documentation.vercel.app/api/archive-health-data?dryRun=true&retentionDays=90"
```

**Execute:**
```bash
curl "https://amiel-cfs-documentation.vercel.app/api/archive-health-data?confirm=true&retentionDays=90"
```

### Using a browser:

Simply paste the URL into your browser's address bar:
```
https://amiel-cfs-documentation.vercel.app/api/archive-health-data?dryRun=true&retentionDays=90
```

## Archive Sheets

### Naming Convention

Archive sheets are named by year: `Health_Hourly_Archive_2026`

- Data from 2026 goes into `Health_Hourly_Archive_2026`
- Data from 2027 goes into `Health_Hourly_Archive_2027`
- If an archive already exists, new data is appended to it

### Accessing Archived Data

1. Open the Google Sheet
2. Look for tabs named `Health_Hourly_Archive_YYYY`
3. Data is sorted chronologically (oldest to newest)
4. Same column structure as `Health_Hourly`

### Archive Backups

Archive sheets are **also backed up** by the daily backup system:
- Created as `HealthHourly_Backup_YYYY-MM-DD`
- Kept for 30 days
- Included in monthly email backups

## Troubleshooting

### "Safety check failed: Archive would remove >95% of data"

**Cause:** The retention days setting would archive almost all data.

**Solution:** Check your `retentionDays` parameter. You likely set it too low (e.g., 1 day instead of 90 days).

### "No data old enough to archive"

**Cause:** All data is within the retention window.

**Solution:** This is normal if you haven't been collecting data for more than 90 days yet. No action needed.

### Archive verification failed

**Cause:** Archive sheet wasn't created properly.

**Solution:** The archival was automatically aborted. No data was deleted. Try again or contact support.

## What NOT to Do

❌ **Don't manually delete rows** from `Health_Hourly` - use the archival endpoint instead

❌ **Don't delete archive sheets** - they contain historical data

❌ **Don't run archival without dry-run first** - always preview what will happen

❌ **Don't set retentionDays too low** (< 30 days) - you'll need to archive very frequently

## Recovery

If you accidentally delete data:

1. **Check daily backups**: `HealthHourly_Backup_YYYY-MM-DD` (kept for 30 days)
2. **Check monthly email backups**: CSV files sent on the 1st of each month
3. **Check archive sheets**: `Health_Hourly_Archive_YYYY`

## Summary

**First Time Setup:**
1. Wait until `Health_Hourly` has ~35,000+ rows (6-10 months)
2. Run dry-run: `?dryRun=true&retentionDays=90`
3. Review the results
4. Run actual archival: `?confirm=true&retentionDays=90`

**Ongoing Maintenance:**
- Run archival every 6-12 months as the sheet grows
- Always dry-run first
- Default 90-day retention works well for most use cases

**Safety:**
- Nothing is ever deleted - just moved to archive sheets
- Multiple verification steps before any changes
- Automatic backups of all data (daily + monthly email)
