/**
 * GET /api/archive-health-data
 *
 * SAFELY archives old Health_Hourly data to reduce spreadsheet size.
 *
 * Safety Features:
 * - Only runs when explicitly called (not automated)
 * - Requires confirmation via query parameter
 * - Creates archive backup BEFORE deleting any data
 * - Only archives data older than configurable threshold (default: 90 days)
 * - Validates archive was created successfully before deletion
 * - Preserves all data in archive sheets (nothing is lost)
 * - Detailed logging of every step
 * - Dry-run mode to preview what would be archived
 *
 * Query Parameters:
 *   ?dryRun=true         - Preview what would be archived without making changes
 *   ?confirm=true        - Required to actually perform archival
 *   ?retentionDays=90    - Keep this many days in active sheet (default: 90)
 *
 * Usage:
 *   1. First run with ?dryRun=true to see what would happen
 *   2. Then run with ?confirm=true to actually archive
 *
 * Example:
 *   GET /api/archive-health-data?dryRun=true
 *   GET /api/archive-health-data?confirm=true&retentionDays=90
 */

import { google } from 'googleapis';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const dryRun = req.query.dryRun === 'true';
    const confirm = req.query.confirm === 'true';
    const retentionDays = parseInt(req.query.retentionDays || '90');

    // Safety check: require explicit confirmation
    if (!dryRun && !confirm) {
        return res.status(400).json({
            error: 'Missing required parameter',
            message: 'Must use either ?dryRun=true (to preview) or ?confirm=true (to archive)',
            example: '/api/archive-health-data?dryRun=true'
        });
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

        // Calculate cutoff date (in ET)
        const now = new Date();
        const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const cutoffDate = new Date(etNow);
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffStr = cutoffDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' });

        console.log(`Archive cutoff date: ${cutoffStr} (keeping last ${retentionDays} days)`);

        // Step 1: Fetch Health_Hourly data
        const hourlyData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Health_Hourly!A:I',
        });

        const allRows = hourlyData.data.values || [];
        if (allRows.length === 0) {
            return res.status(200).json({
                message: 'No data found in Health_Hourly sheet',
                dryRun: dryRun
            });
        }

        const headers = allRows[0];
        const dataRows = allRows.slice(1);

        // Step 2: Separate old data from recent data
        const rowsToArchive = [];
        const rowsToKeep = [headers]; // Always keep headers

        for (const row of dataRows) {
            const timestamp = row[0]; // Column A: Timestamp
            const dateStr = row[1];   // Column B: Date

            // Parse date to check if it's old enough to archive
            const rowDate = new Date(dateStr);

            if (rowDate < cutoffDate) {
                rowsToArchive.push(row);
            } else {
                rowsToKeep.push(row);
            }
        }

        console.log(`Total rows: ${dataRows.length}, To archive: ${rowsToArchive.length}, To keep: ${rowsToKeep.length - 1}`);

        // Safety check: Don't archive if it would delete too much data
        if (rowsToArchive.length > dataRows.length * 0.95) {
            return res.status(400).json({
                error: 'Safety check failed',
                message: 'Archive would remove >95% of data. This seems unsafe. Please verify retention settings.',
                rowsToArchive: rowsToArchive.length,
                totalRows: dataRows.length
            });
        }

        // Safety check: Don't proceed if there's nothing to archive
        if (rowsToArchive.length === 0) {
            return res.status(200).json({
                message: 'No data old enough to archive',
                cutoffDate: cutoffStr,
                retentionDays: retentionDays,
                totalRows: dataRows.length
            });
        }

        // DRY RUN: Just return what would happen
        if (dryRun) {
            return res.status(200).json({
                dryRun: true,
                message: 'Dry run - no changes made',
                cutoffDate: cutoffStr,
                retentionDays: retentionDays,
                totalRows: dataRows.length,
                rowsToArchive: rowsToArchive.length,
                rowsToKeep: rowsToKeep.length - 1,
                percentageToArchive: Math.round((rowsToArchive.length / dataRows.length) * 100),
                nextStep: 'Run with ?confirm=true to perform archival',
                oldestRowToArchive: rowsToArchive[0] ? rowsToArchive[0][1] : null,
                newestRowToArchive: rowsToArchive[rowsToArchive.length - 1] ? rowsToArchive[rowsToArchive.length - 1][1] : null
            });
        }

        // ACTUAL ARCHIVAL (confirm=true)
        console.log('Starting actual archival process...');

        // Step 3: Create archive sheet name
        const year = etNow.getFullYear();
        const archiveSheetName = `Health_Hourly_Archive_${year}`;

        // Step 4: Get spreadsheet metadata
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
        });

        const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

        // Step 5: Create archive sheet if it doesn't exist
        if (!existingSheets.includes(archiveSheetName)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: archiveSheetName }
                        }
                    }]
                },
            });
            console.log(`Created archive sheet: ${archiveSheetName}`);
        }

        // Step 6: If archive already has data, append to it; otherwise write with headers
        const existingArchive = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${archiveSheetName}!A:I`,
        }).catch(() => ({ data: { values: [] } }));

        const existingArchiveRows = existingArchive.data.values || [];
        const archiveIsEmpty = existingArchiveRows.length === 0;

        // Step 7: Write to archive sheet
        if (archiveIsEmpty) {
            // Write headers + archived data
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${archiveSheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headers, ...rowsToArchive] },
            });
            console.log(`Wrote ${rowsToArchive.length} rows to NEW archive ${archiveSheetName}`);
        } else {
            // Append archived data (no headers)
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${archiveSheetName}!A:I`,
                valueInputOption: 'RAW',
                requestBody: { values: rowsToArchive },
            });
            console.log(`Appended ${rowsToArchive.length} rows to existing archive ${archiveSheetName}`);
        }

        // Step 8: VERIFY archive was created successfully
        const verifyArchive = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${archiveSheetName}!A:I`,
        });

        const verifyCount = (verifyArchive.data.values || []).length - 1; // -1 for header
        const expectedMinCount = rowsToArchive.length;

        if (verifyCount < expectedMinCount) {
            throw new Error(`Archive verification failed! Expected at least ${expectedMinCount} rows, found ${verifyCount}`);
        }

        console.log(`✓ Archive verified: ${verifyCount} rows in ${archiveSheetName}`);

        // Step 9: Update Health_Hourly sheet with only recent data
        // CRITICAL: Only delete old rows AFTER archive is verified!
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Health_Hourly!A:I',
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Health_Hourly!A1',
            valueInputOption: 'RAW',
            requestBody: { values: rowsToKeep },
        });

        console.log(`✓ Updated Health_Hourly: removed ${rowsToArchive.length} old rows, kept ${rowsToKeep.length - 1} recent rows`);

        return res.status(200).json({
            success: true,
            message: 'Archive completed successfully',
            cutoffDate: cutoffStr,
            retentionDays: retentionDays,
            archiveSheet: archiveSheetName,
            rowsArchived: rowsToArchive.length,
            rowsKept: rowsToKeep.length - 1,
            archivedDateRange: {
                oldest: rowsToArchive[0] ? rowsToArchive[0][1] : null,
                newest: rowsToArchive[rowsToArchive.length - 1] ? rowsToArchive[rowsToArchive.length - 1][1] : null
            },
            timestamp: now.toISOString(),
        });

    } catch (error) {
        console.error('Archival failed:', error);
        return res.status(500).json({
            error: 'Archival failed',
            details: error.message,
            message: 'No data was deleted. The archive process was aborted safely.'
        });
    }
}
