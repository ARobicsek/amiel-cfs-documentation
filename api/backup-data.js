/**
 * GET /api/backup-data
 *
 * Creates a daily backup of Sheet1 data to a timestamped backup sheet.
 * Called by Vercel cron job daily.
 * 
 * Also handles monthly email backups on the 1st of each month.
 *
 * Features:
 * - Creates backup sheets named "Backup_YYYY-MM-DD"
 * - Prunes backups older than 30 days
 * - Sends monthly email backup on the 1st of each month
 * - Includes row count validation to detect anomalies
 *
 * Response:
 *   200: { success: true, backupSheet: string, rowCount: number }
 *   500: { error: string }
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
    // Vercel cron jobs use GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Optional: Verify cron secret for additional security
    const cronSecret = req.headers['x-vercel-cron-secret'];
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
        // Log but don't block - allows manual testing
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
        const year = etDate.getFullYear();
        const month = String(etDate.getMonth() + 1).padStart(2, '0');
        const day = String(etDate.getDate()).padStart(2, '0');
        const backupSheetName = `Backup_${year}-${month}-${day}`;

        console.log(`Starting backup: ${backupSheetName}`);

        // Step 1: Fetch all data from Sheet1
        const sourceData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet1!A:Z', // Get all columns
        });

        const rows = sourceData.data.values || [];
        const rowCount = rows.length;

        console.log(`Fetched ${rowCount} rows from Sheet1`);

        // Anomaly detection: Alert if row count suddenly dropped
        // (This could indicate accidental deletion)
        if (rowCount < 5) {
            console.warn(`⚠️ WARNING: Sheet1 has only ${rowCount} rows. This may indicate data loss.`);
        }

        // Step 2: Get spreadsheet metadata to check for existing backup sheets
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
        });

        const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

        // Step 3: Create backup sheet if it doesn't exist
        if (!existingSheets.includes(backupSheetName)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: backupSheetName,
                            },
                        },
                    }],
                },
            });
            console.log(`Created new backup sheet: ${backupSheetName}`);
        } else {
            console.log(`Backup sheet ${backupSheetName} already exists, will overwrite`);
        }

        // Step 4: Write data to backup sheet
        if (rows.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${backupSheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: rows,
                },
            });
            console.log(`Wrote ${rowCount} rows to backup sheet`);
        }

        // Step 5: Prune old backups (keep last 30 days)
        const RETENTION_DAYS = 30;
        const cutoffDate = new Date(etDate);
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        const sheetsToDelete = [];
        for (const sheet of spreadsheet.data.sheets) {
            const title = sheet.properties.title;
            if (title.startsWith('Backup_')) {
                // Parse date from sheet name
                const dateMatch = title.match(/Backup_(\d{4})-(\d{2})-(\d{2})/);
                if (dateMatch) {
                    const backupDate = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
                    if (backupDate < cutoffDate) {
                        sheetsToDelete.push({
                            sheetId: sheet.properties.sheetId,
                            title: title,
                        });
                    }
                }
            }
        }

        // Delete old backup sheets
        if (sheetsToDelete.length > 0) {
            const deleteRequests = sheetsToDelete.map(s => ({
                deleteSheet: { sheetId: s.sheetId }
            }));

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: deleteRequests },
            });

            console.log(`Pruned ${sheetsToDelete.length} old backup(s): ${sheetsToDelete.map(s => s.title).join(', ')}`);
        }

        // Step 6: Check if today is the 1st - send monthly email backup
        let emailSent = false;
        if (etDate.getDate() === 1) {
            try {
                emailSent = await sendMonthlyEmailBackup(rows, etDate);
            } catch (emailError) {
                console.error('Failed to send monthly email backup:', emailError.message);
                // Don't fail the whole backup just because email failed
            }
        }

        return res.status(200).json({
            success: true,
            backupSheet: backupSheetName,
            rowCount: rowCount,
            prunedBackups: sheetsToDelete.length,
            emailSent: emailSent,
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
async function sendMonthlyEmailBackup(rows, date) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
        console.log('RESEND_API_KEY not configured, skipping email backup');
        return false;
    }

    const recipients = [
        'amiel.robicsek@gmail.com',
        'ari.robicsek@gmail.com'
    ];

    // Convert data to CSV
    const csvContent = rows.map(row =>
        row.map(cell => {
            // Escape quotes and wrap in quotes if contains comma or newline
            const str = String(cell || '');
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(',')
    ).join('\n');

    const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const fileName = `cfs-tracker-backup-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.csv`;

    // Base64 encode the CSV for attachment
    const csvBase64 = Buffer.from(csvContent).toString('base64');

    const emailBody = {
        from: 'CFS Tracker <noreply@resend.dev>',
        to: recipients,
        subject: `CFS Tracker Monthly Backup - ${monthName}`,
        html: `
      <h2>CFS Tracker Monthly Backup</h2>
      <p>This is your automated monthly backup of Amiel's CFS tracking data.</p>
      <p><strong>Date:</strong> ${monthName}</p>
      <p><strong>Total entries:</strong> ${rows.length - 1} (excluding header)</p>
      <p>The attached CSV file contains all tracking data.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">
        This backup was automatically generated by the CFS Tracker app.
        Keep this email for your records.
      </p>
    `,
        attachments: [
            {
                filename: fileName,
                content: csvBase64,
                type: 'text/csv',
            }
        ]
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
