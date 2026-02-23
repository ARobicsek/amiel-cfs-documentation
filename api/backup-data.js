/**
 * GET /api/backup-data
 *
 * Creates daily backups using 5 rotating weekly slots per source sheet.
 * Called by Vercel cron job daily.
 *
 * Strategy: 5 fixed backup sheets per source, rotating on a 35-day cycle.
 * Each slot is overwritten daily for 7 days, then advances to the next.
 * This guarantees at least 28 days of backup coverage with only 25 total
 * backup sheets (vs. the old approach of up to 150 date-stamped sheets).
 *
 * Large sheets (Health_Hourly) use incremental backups — each slot only
 * stores the last 7 days of data, keeping cell usage bounded as data grows.
 *
 * Also handles monthly email backups on the 1st of each month.
 *
 * Response:
 *   200: { success: true, weekSlot: number, ... }
 *   500: { error: string }
 */

import { google } from 'googleapis';

// Source sheets and their backup prefixes.
// incrementalDays + dateCol: only back up rows from the last N days (by column index).
// Sheets without these fields get full-snapshot backups.
const BACKUP_SOURCES = [
    { source: 'Sheet1', range: 'Sheet1!A:Z', prefix: 'Backup_Sheet1' },
    { source: 'ECG_Readings', range: 'ECG_Readings!A:Z', prefix: 'Backup_ECG' },
    { source: 'ECG_Waveforms', range: 'ECG_Waveforms!A:Z', prefix: 'Backup_Waveforms' },
    { source: 'Health_Hourly', range: 'Health_Hourly!A:I', prefix: 'Backup_HealthHourly', incrementalDays: 7, dateCol: 1 },
    { source: 'Health_Daily', range: 'Health_Daily!A:Q', prefix: 'Backup_HealthDaily' },
];

/**
 * Compute which weekly slot (1-5) to use for a given date.
 * Same slot for 7 consecutive days, then advances. 35-day cycle.
 */
function getWeekSlot(etDate) {
    const daysSinceEpoch = Math.floor(etDate.getTime() / 86400000);
    return Math.floor((daysSinceEpoch % 35) / 7) + 1;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const cronSecret = req.headers['x-vercel-cron-secret'];
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
        console.log('Note: Cron secret mismatch or missing');
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

        // Get current date in Eastern Time
        const now = new Date();
        const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const weekSlot = getWeekSlot(etDate);

        console.log(`Starting rotating backup, week slot W${weekSlot}`);

        // Step 1: Fetch all source data
        const fetchResults = await Promise.all(
            BACKUP_SOURCES.map(s =>
                sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: s.range,
                }).catch(() => ({ data: { values: [] } }))
            )
        );

        const sourceData = {};
        const rowCounts = {};
        BACKUP_SOURCES.forEach((s, i) => {
            sourceData[s.source] = fetchResults[i].data.values || [];
            rowCounts[s.source] = sourceData[s.source].length;
        });

        console.log(`Fetched: ${BACKUP_SOURCES.map(s => `${s.source}=${rowCounts[s.source]}`).join(', ')}`);

        if (rowCounts['Sheet1'] < 5) {
            console.warn(`WARNING: Sheet1 has only ${rowCounts['Sheet1']} rows. This may indicate data loss.`);
        }

        // Step 2: Get spreadsheet metadata
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const existingSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
        const existingSheetMap = {};
        spreadsheet.data.sheets.forEach(s => {
            existingSheetMap[s.properties.title] = s.properties.sheetId;
        });

        // Step 3: Delete old date-stamped backup sheets FIRST (frees cells before creating new ones)
        const oldBackupPattern = /^(?:ECG_|Waveform_|HealthHourly_|HealthDaily_)?Backup_\d{4}-\d{2}-\d{2}$/;
        const oldBackups = spreadsheet.data.sheets.filter(s =>
            oldBackupPattern.test(s.properties.title)
        );

        if (oldBackups.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: oldBackups.map(s => ({
                        deleteSheet: { sheetId: s.properties.sheetId }
                    })),
                },
            });
            console.log(`Migrated: deleted ${oldBackups.length} old date-stamped backup sheet(s)`);
        }

        // Step 4: Create any missing backup sheets for the current week slot
        const sheetsToCreate = [];
        for (const s of BACKUP_SOURCES) {
            const sheetName = `${s.prefix}_W${weekSlot}`;
            if (!existingSheetNames.includes(sheetName) && rowCounts[s.source] > 0) {
                sheetsToCreate.push({ addSheet: { properties: { title: sheetName } } });
            }
        }

        if (sheetsToCreate.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: sheetsToCreate },
            });
            console.log(`Created: ${sheetsToCreate.map(s => s.addSheet.properties.title).join(', ')}`);
        }

        // Step 5: Clear and write data to the current week slot's backup sheets
        const backupSheetNames = [];
        for (const s of BACKUP_SOURCES) {
            const sheetName = `${s.prefix}_W${weekSlot}`;
            let rows = sourceData[s.source];

            // For incremental sources, filter to header + last N days only
            if (s.incrementalDays && s.dateCol != null && rows.length > 1) {
                const cutoff = new Date(etDate);
                cutoff.setDate(cutoff.getDate() - s.incrementalDays);
                const header = rows[0];
                const filtered = rows.slice(1).filter(row => {
                    const d = new Date(row[s.dateCol]);
                    return !isNaN(d.getTime()) && d >= cutoff;
                });
                rows = [header, ...filtered];
                console.log(`${s.source}: incremental backup ${filtered.length} rows (last ${s.incrementalDays} days)`);
            }

            if (rows.length > 0) {
                // Clear existing content first (handles case where new data is shorter)
                await sheets.spreadsheets.values.clear({
                    spreadsheetId,
                    range: `${sheetName}!A:Z`,
                }).catch(() => {}); // Ignore if sheet was just created

                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${sheetName}!A1`,
                    valueInputOption: 'RAW',
                    requestBody: { values: rows },
                });
                backupSheetNames.push(sheetName);
            }
        }

        console.log(`Wrote to: ${backupSheetNames.join(', ')}`);


        // Step 6: Check if today is the 1st — send monthly email backup
        let emailSent = false;
        if (etDate.getDate() === 1) {
            try {
                emailSent = await sendMonthlyEmailBackup(
                    sourceData['Sheet1'],
                    sourceData['ECG_Readings'],
                    sourceData['ECG_Waveforms'],
                    sourceData['Health_Hourly'],
                    sourceData['Health_Daily'],
                    etDate
                );
            } catch (emailError) {
                console.error('Failed to send monthly email backup:', emailError.message);
            }
        }

        return res.status(200).json({
            success: true,
            weekSlot,
            backupSheets: backupSheetNames,
            rowCounts,
            oldBackupsCleaned: oldBackups.length,
            emailSent,
            timestamp: now.toISOString(),
        });

    } catch (error) {
        console.error('Backup failed:', error);
        return res.status(500).json({
            error: 'Backup failed',
            details: error.message,
        });
    }
}

/**
 * Send monthly email backup to configured recipients
 */
async function sendMonthlyEmailBackup(rows, ecgRows, waveformRows, healthHourlyRows, healthDailyRows, date) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
        console.log('RESEND_API_KEY not configured, skipping email backup');
        return false;
    }

    const recipients = [
        'amiel.robicsek@gmail.com',
        'ari.robicsek@gmail.com'
    ];

    // Helper to convert rows to CSV
    const toCsv = (dataRows) => dataRows.map(row =>
        row.map(cell => {
            const str = String(cell || '');
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(',')
    ).join('\n');

    const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const datePrefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    // Create attachments
    const attachments = [
        {
            filename: `cfs-tracker-entries-${datePrefix}.csv`,
            content: Buffer.from(toCsv(rows)).toString('base64'),
            type: 'text/csv',
        }
    ];

    // Only attach ECG data if it exists
    if (ecgRows && ecgRows.length > 0) {
        attachments.push({
            filename: `cfs-tracker-ecg-readings-${datePrefix}.csv`,
            content: Buffer.from(toCsv(ecgRows)).toString('base64'),
            type: 'text/csv',
        });
    }

    // Only attach waveform data if it exists
    if (waveformRows && waveformRows.length > 0) {
        attachments.push({
            filename: `cfs-tracker-ecg-waveforms-${datePrefix}.csv`,
            content: Buffer.from(toCsv(waveformRows)).toString('base64'),
            type: 'text/csv',
        });
    }

    // Only attach health hourly data if it exists
    if (healthHourlyRows && healthHourlyRows.length > 0) {
        attachments.push({
            filename: `cfs-tracker-health-hourly-${datePrefix}.csv`,
            content: Buffer.from(toCsv(healthHourlyRows)).toString('base64'),
            type: 'text/csv',
        });
    }

    // Only attach health daily data if it exists
    if (healthDailyRows && healthDailyRows.length > 0) {
        attachments.push({
            filename: `cfs-tracker-health-daily-${datePrefix}.csv`,
            content: Buffer.from(toCsv(healthDailyRows)).toString('base64'),
            type: 'text/csv',
        });
    }

    const emailBody = {
        from: 'CFS Tracker <noreply@resend.dev>',
        to: recipients,
        subject: `CFS Tracker Monthly Backup - ${monthName}`,
        html: `
      <h2>CFS Tracker Monthly Backup</h2>
      <p>This is your automated monthly backup of Amiel's CFS tracking data.</p>
      <p><strong>Date:</strong> ${monthName}</p>
      <p><strong>Daily entries:</strong> ${rows.length - 1} (excluding header)</p>
      <p><strong>ECG readings:</strong> ${ecgRows ? ecgRows.length - 1 : 0} (excluding header)</p>
      <p><strong>ECG waveforms:</strong> ${waveformRows ? waveformRows.length - 1 : 0} (excluding header)</p>
      <p><strong>Health hourly data:</strong> ${healthHourlyRows ? healthHourlyRows.length - 1 : 0} (excluding header)</p>
      <p><strong>Health daily data:</strong> ${healthDailyRows ? healthDailyRows.length - 1 : 0} (excluding header)</p>
      <p>The attached CSV files contain all tracking data.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">
        This backup was automatically generated by the CFS Tracker app.
        Keep this email for your records.
      </p>
    `,
        attachments: attachments
    };

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API error: ${response.status} - ${errorText}`);
    }

    console.log(`Monthly backup email sent to: ${recipients.join(', ')}`);
    return true;
}
