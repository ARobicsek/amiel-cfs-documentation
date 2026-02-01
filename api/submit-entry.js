/**
 * POST /api/submit-entry
 *
 * Two modes:
 *
 * 1. Default (no action): Saves a daily entry to Google Sheets.
 *    Request body: { hours, dateFor, comments, exercise, brainTime, willDoECG, ...medications }
 *    Response: { success: true, row: number }
 *
 * 2. action: "add-medication": Adds a new medication column to Sheet1.
 *    Request body: { action: "add-medication", name: "Medication Name" }
 *    Response: { success: true, medication: { key, label, columnLetter } }
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 */

import { google } from 'googleapis';

// Convert medication label to normalized key
// "Vitamin D" -> "vitamind", "Vitamin B-12" -> "vitaminb12"
function labelToKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric
}

// Convert column index to letter (0 = A, 25 = Z, 26 = AA, etc.)
function columnIndexToLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// Core fields occupy columns A-J (indices 0-9)
// Medications start at column K (index 10)
const MEDICATION_START_INDEX = 10;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate authorization
  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Check for action parameter
  const { action } = req.body;

  // Route to add-medication handler if requested
  if (action === 'add-medication') {
    return handleAddMedication(req, res);
  }

  // Default: submit entry
  // Parse and validate body
  const {
    dateFor, hours, comments, oxaloacetate, exercise, brainTime, modafinil, willDoECG
  } = req.body;

  if (hours === undefined || hours === null) {
    return res.status(400).json({ error: 'Missing required field: hours' });
  }

  if (typeof hours !== 'number' || hours < 0 || hours > 24) {
    return res.status(400).json({ error: 'Hours must be a number between 0 and 24' });
  }

  // dateFor is the date the user is documenting FOR (e.g., "01/01/2025")
  // If not provided, fall back to server's current date (for backwards compatibility)
  let entryDateFor = dateFor;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Get current time in US Eastern Time (this is when the entry was SUBMITTED)
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    // If no dateFor provided by client, fall back to server's current date
    if (!entryDateFor) {
      entryDateFor = now.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    }

    // ========== AUDIT LOGGING (Write-Ahead Log) ==========
    // Log incoming request BEFORE modifying data - enables replay if data is lost
    try {
      // Check if AuditLog sheet exists
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      });

      const sheetExists = spreadsheet.data.sheets.some(
        s => s.properties.title === 'AuditLog'
      );

      if (!sheetExists) {
        // Create AuditLog sheet with headers
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: 'AuditLog' },
              },
            }],
          },
        });

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'AuditLog!A1:D1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [['Timestamp', 'Action', 'DateFor', 'RequestBody (JSON)']],
          },
        });
      }

      // Log the incoming request
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'AuditLog!A:D',
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            timestamp,
            'SUBMIT_ENTRY',
            entryDateFor,
            JSON.stringify(req.body)
          ]],
        },
      });
    } catch (auditError) {
      // Log but don't fail the submission if audit logging fails
      console.error('Audit logging failed:', auditError.message);
    }
    // ========== END AUDIT LOGGING ==========

    // Fetch header row and existing data to check for duplicates and discover medication columns
    const existingData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:ZZ', // Open-ended to capture all medication columns
    });

    const allRows = existingData.data.values || [];
    const headerRow = allRows[0] || [];
    const dataRows = allRows.slice(1);

    // Discover medication columns from header (columns K onwards, index 10+)
    const medications = [];
    for (let i = MEDICATION_START_INDEX; i < headerRow.length; i++) {
      const label = headerRow[i];
      if (label && label.trim()) {
        medications.push({
          key: labelToKey(label),
          label: label.trim(),
          columnIndex: i
        });
      }
    }

    // Find existing row for this date
    let existingRowIndex = -1;
    for (let i = 0; i < dataRows.length; i++) {
      if (dataRows[i] && dataRows[i][1] === entryDateFor) {
        existingRowIndex = i + 2; // +2 because: +1 for header, +1 for 1-indexed sheets
        break;
      }
    }

    // Get today's date (documentation date) for willDoECG attribution
    const todayDate = now.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    // Build row data with core fields (A-J)
    const rowData = [
      timestamp,                          // Column A: Timestamp (when submitted, Eastern Time)
      entryDateFor,                       // Column B: Date FOR (the date being documented)
      hours,                              // Column C: Hours (required)
      comments || '',                     // Column D: Comments
      oxaloacetate || '',                 // Column E: Oxaloacetate (g)
      exercise || '',                     // Column F: Exercise (min)
      brainTime ?? '',                    // Column G: Productive brain time (hours) - use ?? to preserve 0
      modafinil || '',                    // Column H: Modafinil (none/quarter/half/whole)
      willDoECG ? 'Yes' : '',             // Column I: Will do ECG
      willDoECG ? todayDate : '',         // Column J: ECG Plan Date
    ];

    // Dynamically add medication values based on discovered columns
    for (const med of medications) {
      // Get medication value from request body using the key
      const value = req.body[med.key];
      rowData[med.columnIndex] = value || '';
    }

    // Calculate the last column letter for range
    const lastColumnIndex = Math.max(9, ...medications.map(m => m.columnIndex));
    const lastColumnLetter = columnIndexToLetter(lastColumnIndex);

    let rowNumber;

    if (existingRowIndex > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!A${existingRowIndex}:${lastColumnLetter}${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData]
        }
      });
      rowNumber = existingRowIndex;
    } else {
      // Append new row
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `Sheet1!A:${lastColumnLetter}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData]
        }
      });
      const updatedRange = response.data.updates.updatedRange;
      rowNumber = parseInt(updatedRange.match(/\d+/)[0]);
    }

    // Sort Sheet1 by date descending (most recent first)
    // Use dynamic end column based on discovered medications
    await sortSheetByDateDesc(sheets, spreadsheetId, 'Sheet1', lastColumnIndex + 1);

    return res.status(200).json({
      success: true,
      row: rowNumber
    });

  } catch (error) {
    console.error('Failed to save entry:', error);
    return res.status(500).json({ error: 'Failed to save entry' });
  }
}

/**
 * Handle adding a new medication column to Sheet1.
 */
async function handleAddMedication(req, res) {
  const { name } = req.body;

  // Validate name
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Medication name is required' });
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return res.status(400).json({ error: 'Medication name cannot be empty' });
  }

  if (trimmedName.length > 50) {
    return res.status(400).json({ error: 'Medication name is too long (max 50 characters)' });
  }

  // Capitalize first letter of each word for consistent display
  const formattedName = trimmedName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  const key = labelToKey(formattedName);

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Fetch header row to check for duplicates and find next column
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!1:1', // Just the header row
    });

    const headerRow = headerResponse.data.values?.[0] || [];

    // Check for duplicate (case-insensitive)
    const existingMeds = headerRow.slice(MEDICATION_START_INDEX);
    const normalizedExisting = existingMeds.map(h => h?.toLowerCase().trim());
    const normalizedNew = formattedName.toLowerCase();

    if (normalizedExisting.includes(normalizedNew)) {
      return res.status(400).json({
        error: `Medication '${formattedName}' already exists`
      });
    }

    // Also check by key to catch things like "Vitamin D" vs "VitaminD"
    const existingKeys = existingMeds.map(h => h ? labelToKey(h) : '');
    if (existingKeys.includes(key)) {
      const existingLabel = existingMeds[existingKeys.indexOf(key)];
      return res.status(400).json({
        error: `A similar medication '${existingLabel}' already exists`
      });
    }

    // Find next available column (after the last header)
    const nextColumnIndex = headerRow.length;
    const columnLetter = columnIndexToLetter(nextColumnIndex);

    // Add the new header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!${columnLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[formattedName]]
      }
    });

    return res.status(200).json({
      success: true,
      medication: {
        key,
        label: formattedName,
        columnLetter,
        columnIndex: nextColumnIndex
      }
    });

  } catch (error) {
    console.error('Failed to add medication:', error);
    return res.status(500).json({ error: 'Failed to add medication' });
  }
}

/**
 * Sort a sheet by column A (date/timestamp) in descending order (most recent first).
 */
async function sortSheetByDateDesc(sheets, spreadsheetId, sheetName, endColumnIndex = 22) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))'
    });
    const sheetsList = spreadsheet.data.sheets || [];
    const targetSheet = sheetsList.find(s => s.properties.title === sheetName);

    if (targetSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            sortRange: {
              range: {
                sheetId: targetSheet.properties.sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex
              },
              sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }]
            }
          }]
        }
      });
    }
  } catch (error) {
    console.error(`Error sorting ${sheetName} sheet:`, error);
  }
}
