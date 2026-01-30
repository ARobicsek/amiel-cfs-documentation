import { google } from 'googleapis';

// Initialize Google APIs
function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

export const config = {
  api: {
    bodyParser: false, // We'll handle parsing ourselves to support both JSON and CSV
  },
};

/**
 * Read raw body from request
 */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}

/**
 * Extract CSV content from multipart form-data
 * Health Auto Export sends data as multipart/form-data with the CSV embedded
 */
function extractFromMultipart(rawBody) {
  // Check if it's multipart (starts with boundary)
  if (!rawBody.includes('--Boundary-') && !rawBody.includes('boundary=')) {
    return rawBody; // Not multipart, return as-is
  }

  console.log('Detected multipart form-data, extracting CSV...');

  // Find the CSV content between the headers and the next boundary
  // Pattern: Content-Type: "text/csv" followed by blank line, then CSV data
  const csvMatch = rawBody.match(/Content-Type:\s*"?text\/csv"?\s*\r?\n\r?\n([\s\S]*?)(?:\r?\n--Boundary-|\r?\n------)/i);

  if (csvMatch && csvMatch[1]) {
    console.log('Extracted CSV content, length:', csvMatch[1].length);
    return csvMatch[1].trim();
  }

  // Try alternate pattern - just find content after double newline in multipart
  const parts = rawBody.split(/\r?\n\r?\n/);
  if (parts.length >= 2) {
    // Find the part that looks like CSV (starts with "Start," or similar)
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('Start,') || parts[i].includes('Classification,')) {
        // Combine this and subsequent parts until we hit a boundary
        let csvContent = parts.slice(i).join('\n\n');
        const boundaryIdx = csvContent.indexOf('\n--Boundary-');
        if (boundaryIdx > 0) {
          csvContent = csvContent.slice(0, boundaryIdx);
        }
        console.log('Extracted CSV via alternate method, length:', csvContent.length);
        return csvContent.trim();
      }
    }
  }

  console.log('Could not extract CSV from multipart, returning raw');
  return rawBody;
}

/**
 * Parse CSV data from Health Auto Export
 *
 * Health Auto Export CSV uses KEY-VALUE format (not columnar):
 * Start,2025-12-27 23:15:55 -0500
 * End,2025-12-27 23:16:25 -0500
 * Classification,Sinus Rhythm
 * Avg. Heart Rate (count/min),72.0
 * Number of Voltage Measurements,15360
 * Sampling Frequency (Hz),512.0
 * Voltage Measurements,0.001,0.002,0.003,...
 *
 * MULTI-ECG: When multiple ECGs are exported together, each ECG has its own
 * set of key-value pairs. We detect this by looking for repeated "Start" keys.
 */
function parseCSVData(csvText) {
  // First extract from multipart if needed
  csvText = extractFromMultipart(csvText);

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  console.log('Parsing key-value CSV format, line count:', lines.length);
  console.log('First 5 lines:', lines.slice(0, 5));

  // Split lines into separate ECG blocks by detecting repeated "Start" keys
  const ecgBlocks = [];
  let currentBlock = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const firstComma = line.indexOf(',');
    if (firstComma === -1) continue;

    const key = line.slice(0, firstComma).trim().toLowerCase();

    // If we see a "start" key and already have lines in current block,
    // that means a new ECG is starting - save the current block
    if ((key === 'start' || key.includes('start')) && currentBlock.length > 0) {
      ecgBlocks.push(currentBlock);
      currentBlock = [];
      console.log(`Detected new ECG block (block ${ecgBlocks.length + 1})`);
    }

    currentBlock.push(line);
  }

  // Don't forget the last block
  if (currentBlock.length > 0) {
    ecgBlocks.push(currentBlock);
  }

  console.log(`Found ${ecgBlocks.length} ECG block(s) in CSV`);

  // Parse each block into an ECG record
  const records = [];
  for (let blockIdx = 0; blockIdx < ecgBlocks.length; blockIdx++) {
    const block = ecgBlocks[blockIdx];
    const ecg = parseCSVBlock(block, blockIdx + 1);
    if (ecg) {
      records.push(ecg);
    }
  }

  console.log(`Successfully parsed ${records.length} ECG record(s) from CSV`);
  return records;
}

/**
 * Parse a single ECG block (set of key-value lines) into an ECG record
 */
function parseCSVBlock(lines, blockNum) {
  const data = {};
  let voltageValues = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const firstComma = line.indexOf(',');
    if (firstComma === -1) continue;

    const key = line.slice(0, firstComma).trim().toLowerCase();
    const value = line.slice(firstComma + 1).trim();

    // Check for voltage measurements line (contains many comma-separated numbers)
    if (key.includes('voltage') && key.includes('measurement')) {
      const allValues = value.split(',');
      for (const v of allValues) {
        const num = parseFloat(v.trim());
        if (!isNaN(num)) {
          voltageValues.push({ voltage: num });
        }
      }
    } else {
      data[key] = value;
    }
  }

  // Extract metadata with flexible key matching
  let startDate = null;
  let classification = null;
  let heartRate = null;
  let samplingFreq = 512;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'start' || key.includes('start')) {
      startDate = value;
    }
    if (key === 'classification') {
      classification = value;
    }
    if (key.includes('heart') && key.includes('rate')) {
      heartRate = parseFloat(value);
    }
    if (key.includes('sampling') && key.includes('freq')) {
      // Handle "512.0)" format (malformed from "Sampling Frequency (Hz,512.0)")
      samplingFreq = parseFloat(value.replace(/[^0-9.]/g, '')) || 512;
    }
  }

  console.log(`Block ${blockNum}: date=${startDate}, class=${classification}, hr=${heartRate}, sampling=${samplingFreq}, voltages=${voltageValues.length}`);

  if (!startDate && !classification && voltageValues.length === 0) {
    console.log(`Block ${blockNum}: No valid ECG data found`);
    return null;
  }

  return {
    date: startDate,
    classification: classification,
    averageHeartRate: heartRate,
    samplingFrequency: samplingFreq,
    voltageMeasurements: voltageValues,
  };
}
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log request size info for debugging 413 errors
  const contentLength = req.headers['content-length'];
  const contentType = req.headers['content-type'];
  console.log('=== ECG REQUEST SIZE DEBUG ===');
  console.log('Content-Length:', contentLength, 'bytes');
  console.log('Content-Length (KB):', contentLength ? (parseInt(contentLength) / 1024).toFixed(2) : 'unknown');
  console.log('Content-Type:', contentType);

  // Authenticate webhook
  const webhookSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.ECG_WEBHOOK_SECRET?.trim();

  console.log('=== ECG WEBHOOK DEBUG ===');
  console.log('Received secret:', webhookSecret ? `${webhookSecret.slice(0, 10)}...` : 'none');
  console.log('Expected secret:', expectedSecret ? `${expectedSecret.slice(0, 10)}...` : 'NOT SET');
  console.log('Match:', webhookSecret === expectedSecret);

  if (!webhookSecret || webhookSecret !== expectedSecret) {
    console.log('ECG Webhook: Invalid secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    // Read raw body since we disabled automatic body parsing
    const rawBody = await getRawBody(req);
    const contentType = req.headers['content-type'] || '';

    console.log('=== ECG WEBHOOK PAYLOAD ===');
    console.log('Content-Type:', contentType);
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.slice(0, 500));

    let ecgRecords = [];
    let ecgData = null; // Declare outside so it's available for error reporting

    // Check if this is CSV or multipart form-data (which contains CSV)
    const isCSV = contentType.includes('text/csv') ||
                  contentType.includes('text/plain') ||
                  contentType.includes('multipart/form-data') ||
                  rawBody.trim().startsWith('--Boundary-') ||
                  (!contentType.includes('json') && rawBody.trim().split('\n')[0].includes(','));

    if (isCSV) {
      console.log('Detected CSV/multipart format');
      ecgRecords = parseCSVData(rawBody);
    } else {
      // JSON format
      console.log('Detected JSON format');
      try {
        ecgData = JSON.parse(rawBody);
      } catch (parseError) {
        console.log('JSON parse failed, trying as CSV');
        ecgRecords = parseCSVData(rawBody);
      }
      if (ecgData) {
        console.log('Top-level keys:', Object.keys(ecgData || {}));
        console.log('Is Array:', Array.isArray(ecgData));
        ecgRecords = extractAllECGData(ecgData);
      }
    }

    if (!ecgRecords || ecgRecords.length === 0) {
      return res.status(400).json({
        error: 'Could not parse ECG data',
        debug: {
          format: isCSV ? 'CSV' : 'JSON',
          rawBodyPreview: rawBody.slice(0, 500),
          receivedKeys: ecgData ? Object.keys(ecgData) : [],
          isArray: ecgData ? Array.isArray(ecgData) : false,
          type: typeof ecgData,
        }
      });
    }

    console.log(`Found ${ecgRecords.length} ECG record(s) in payload`);

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Get existing ECG IDs to avoid duplicates
    const existingIds = await getExistingECGIds(sheets, sheetId);

    // Sort ECG records by date (newest first) and process each one
    ecgRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

    const results = [];
    let savedCount = 0;
    let skippedCount = 0;

    for (const ecg of ecgRecords) {
      // Generate ECG ID early so we can check for duplicates
      const ecgDate = ecg.date ? new Date(ecg.date) : new Date();
      const ecgId = `ECG_${ecgDate.getTime()}`;

      // Check for duplicate by ECG_ID (most reliable)
      if (existingIds.has(ecgId)) {
        console.log(`Skipping duplicate ECG: ${ecgId}`);
        skippedCount++;
        continue;
      }

      // Calculate R/S ratio and HR from voltage data
      let rsRatio = null;
      let rAmplitude = null;
      let sAmplitude = null;
      let calculatedHR = null;
      let beatsDetected = 0;

      if (ecg.voltageMeasurements && ecg.voltageMeasurements.length > 0) {
        const rsResult = calculateRSRatio(ecg.voltageMeasurements, ecg.samplingFrequency || 512);
        rsRatio = rsResult.rsRatio;
        rAmplitude = rsResult.rAmplitude;
        sAmplitude = rsResult.sAmplitude;
        calculatedHR = rsResult.calculatedHR;
        beatsDetected = rsResult.beatsDetected || 0;
      }

      // HR validation: compare our calculated HR with Apple's reported HR
      const appleHR = ecg.averageHeartRate;
      let hrValid = null;
      let hrDiff = null;
      if (calculatedHR && appleHR) {
        hrDiff = Math.abs(calculatedHR - appleHR);
        hrValid = hrDiff <= 10; // Within 10 BPM = valid
      }

      // Use ECG's actual date/time, not current time
      const now = new Date();
      const etOptions = { timeZone: 'America/New_York' };
      const receivedTimestamp = now.toLocaleString('en-US', etOptions);

      // Format the ECG date for display (ecgDate and ecgId already defined above)
      const ecgDateStr = ecgDate.toLocaleString('en-US', etOptions);

      // Store metadata in ECG_Readings sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'ECG_Readings!A:O',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            receivedTimestamp,                      // A: Timestamp (when we received it)
            ecgDateStr,                             // B: Date (when ECG was taken)
            ecg.classification || '',               // C: Classification
            ecg.averageHeartRate || '',             // D: Avg Heart Rate (Apple)
            rsRatio !== null ? rsRatio.toFixed(2) : '',  // E: R/S Ratio
            rAmplitude !== null ? Math.round(rAmplitude) : '',  // F: R Amplitude (µV)
            sAmplitude !== null ? Math.round(sAmplitude) : '',  // G: S Amplitude (µV)
            calculatedHR || '',                     // H: Calc HR (our detection)
            hrValid === true ? '✓' : (hrValid === false ? '✗' : ''),  // I: HR Valid
            beatsDetected || '',                    // J: Beats Detected
            'Auto-sync',                            // K: Notes
            ecgId,                                  // L: ECG ID (links to waveform)
            ecg.voltageMeasurements?.length || '',  // M: Sample count
            ecg.samplingFrequency || 512,           // N: Sampling Frequency
            hrDiff !== null ? hrDiff : '',          // O: HR Diff (absolute difference)
          ]],
        },
      });

      // Store raw waveform data in ECG_Waveforms sheet
      let waveformStored = false;
      if (ecg.voltageMeasurements && ecg.voltageMeasurements.length > 0) {
        try {
          await storeWaveformInSheets(sheets, sheetId, ecgId, ecg);
          waveformStored = true;
        } catch (waveformError) {
          console.error('Waveform storage failed:', waveformError.message);
        }
      }

      // Add to existing IDs to prevent duplicates within same request
      existingIds.add(ecgId);

      savedCount++;
      results.push({
        ecgId,
        date: ecgDateStr,
        classification: ecg.classification,
        appleHR: ecg.averageHeartRate,
        calculatedHR,
        hrValid,
        rsRatio,
        waveformStored,
      });

      console.log(`Saved ECG: ${ecgId} from ${ecgDateStr}`);
    }

    console.log(`ECG processing complete: ${savedCount} saved, ${skippedCount} skipped (duplicates)`);

    // Sort ECG sheets by date descending (most recent first)
    await sortSheetByDateDesc(sheets, sheetId, 'ECG_Readings', 15);
    await sortSheetByDateDesc(sheets, sheetId, 'ECG_Waveforms', 6);

    return res.status(200).json({
      success: true,
      message: `Processed ${ecgRecords.length} ECG(s): ${savedCount} saved, ${skippedCount} skipped`,
      savedCount,
      skippedCount,
      results,
    });

  } catch (error) {
    console.error('ECG Webhook error:', error);
    return res.status(500).json({
      error: 'Failed to process ECG data',
      details: error.message,
    });
  }
}

/**
 * Get existing ECG IDs from sheet to avoid duplicates
 * Uses ECG_ID column (L) which is more reliable than date matching
 */
async function getExistingECGIds(sheets, sheetId) {
  const existingIds = new Set();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'ECG_Readings!L:L', // ECG_ID column
    });

    const rows = response.data.values || [];
    for (const row of rows) {
      if (row[0] && row[0] !== 'ECG_ID' && row[0].startsWith('ECG_')) {
        existingIds.add(row[0]);
      }
    }
    console.log(`Found ${existingIds.size} existing ECG IDs in sheet`);
  } catch (error) {
    console.log('Could not fetch existing ECG IDs:', error.message);
  }

  return existingIds;
}

/**
 * Extract ALL ECG records from various Health Auto Export formats
 * Returns an array of ECG objects
 */
function extractAllECGData(data) {
  const records = [];

  // Health Auto Export format: { data: { ecg: [...] } }
  if (data.data && data.data.ecg && Array.isArray(data.data.ecg)) {
    for (const ecg of data.data.ecg) {
      records.push({
        classification: ecg.classification,
        averageHeartRate: ecg.averageHeartRate,
        samplingFrequency: ecg.samplingFrequency || 512,
        voltageMeasurements: ecg.voltageMeasurements,
        date: ecg.start || ecg.end,
      });
    }
    return records;
  }

  // Direct format (single ECG object)
  if (data.classification && data.voltageMeasurements) {
    records.push({
      classification: data.classification,
      averageHeartRate: data.averageHeartRate || data.heartRate,
      samplingFrequency: data.samplingFrequency || 512,
      voltageMeasurements: data.voltageMeasurements,
      date: data.start || data.startDate || data.date,
    });
    return records;
  }

  // Nested in 'data' field with 'electrocardiogram' key (alternate format)
  if (data.data && data.data.electrocardiogram) {
    const ecgData = data.data.electrocardiogram;
    // Could be array or single object
    const ecgArray = Array.isArray(ecgData) ? ecgData : [ecgData];
    for (const ecg of ecgArray) {
      records.push({
        classification: ecg.classification,
        averageHeartRate: ecg.averageHeartRate,
        samplingFrequency: ecg.samplingFrequency || 512,
        voltageMeasurements: ecg.voltageMeasurements,
        date: ecg.start || ecg.startDate,
      });
    }
    return records;
  }

  // Array format (multiple ECGs at top level)
  if (Array.isArray(data) && data.length > 0) {
    for (const item of data) {
      const extracted = extractAllECGData(item);
      records.push(...extracted);
    }
    return records;
  }

  // Nested in 'metrics' field
  if (data.metrics && data.metrics.electrocardiogram) {
    return extractAllECGData(data.metrics.electrocardiogram);
  }

  console.log('Unknown ECG format:', Object.keys(data));
  return records;
}

/**
 * Store waveform data in Google Sheets
 * Voltages are stored as comma-separated values, split across columns if needed
 * (Google Sheets has a 50K character limit per cell)
 */
async function storeWaveformInSheets(sheets, sheetId, ecgId, ecg) {
  const samplingRate = ecg.samplingFrequency || 512;

  // Extract voltage values, rounded to 2 decimal places
  const voltages = ecg.voltageMeasurements.map(v => {
    const voltage = v.voltage !== undefined ? v.voltage : (v.microVolts !== undefined ? v.microVolts : v);
    return voltage.toFixed(2);
  });

  // Join as comma-separated string
  const voltageString = voltages.join(',');

  // Split into chunks of ~45K characters (safe margin under 50K limit)
  const CHUNK_SIZE = 45000;
  const chunks = [];
  for (let i = 0; i < voltageString.length; i += CHUNK_SIZE) {
    chunks.push(voltageString.slice(i, i + CHUNK_SIZE));
  }

  // Ensure we have exactly 4 columns (pad with empty strings if fewer chunks)
  while (chunks.length < 4) {
    chunks.push('');
  }

  // Store in ECG_Waveforms sheet
  // Columns: A: ECG_ID, B: Sampling Frequency, C-F: Voltage Data (4 chunks)
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'ECG_Waveforms!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        ecgId,
        samplingRate,
        chunks[0],
        chunks[1],
        chunks[2],
        chunks[3],
      ]],
    },
  });

  console.log(`Waveform stored: ${voltages.length} samples in ${chunks.filter(c => c).length} chunks`);
}

/**
 * Calculate R/S ratio from voltage measurements
 *
 * Algorithm:
 * 1. Apply simple bandpass filter to remove baseline wander
 * 2. Detect R peaks (local maxima above threshold)
 * 3. For each R peak, find the S wave (local minimum after R)
 * 4. Calculate R amplitude (peak voltage) and S amplitude (trough depth)
 * 5. Return median R/S ratio across all detected beats
 */
function calculateRSRatio(voltageMeasurements, samplingRate = 512) {
  // Convert to simple array of voltages
  // Health Auto Export uses 'voltage' field, others might use 'microVolts'
  const voltages = voltageMeasurements.map(v =>
    v.voltage !== undefined ? v.voltage : (v.microVolts !== undefined ? v.microVolts : v)
  );

  if (voltages.length < samplingRate) {
    return { rsRatio: null, rAmplitude: null, sAmplitude: null };
  }

  // Simple moving average baseline removal
  const windowSize = Math.floor(samplingRate * 0.2); // 200ms window
  const baseline = movingAverage(voltages, windowSize);
  const filtered = voltages.map((v, i) => v - (baseline[i] || 0));

  // Find R peaks
  const rPeaks = findRPeaks(filtered, samplingRate);

  if (rPeaks.length < 2) {
    // Not enough beats detected, use global max/min
    const maxV = Math.max(...filtered);
    const minV = Math.min(...filtered);

    if (maxV > 0 && minV < 0) {
      return {
        rsRatio: Math.abs(maxV / minV),
        rAmplitude: maxV,
        sAmplitude: Math.abs(minV),
        calculatedHR: null,
        beatsDetected: rPeaks.length,
      };
    }
    return { rsRatio: null, rAmplitude: null, sAmplitude: null, calculatedHR: null, beatsDetected: 0 };
  }

  // Calculate heart rate from R-R intervals
  const rrIntervals = [];
  for (let i = 1; i < rPeaks.length; i++) {
    rrIntervals.push(rPeaks[i] - rPeaks[i - 1]);
  }
  const avgRRSamples = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  const avgRRSeconds = avgRRSamples / samplingRate;
  const calculatedHR = Math.round(60 / avgRRSeconds);

  // Calculate R and S amplitudes for each beat
  const rsRatios = [];
  const rAmplitudes = [];
  const sAmplitudes = [];

  for (const rPeakIdx of rPeaks) {
    const rAmplitude = filtered[rPeakIdx];

    // Look for S wave within 100ms after R peak
    const searchEnd = Math.min(rPeakIdx + Math.floor(samplingRate * 0.1), filtered.length);
    let sIdx = rPeakIdx;
    let sAmplitude = filtered[rPeakIdx];

    for (let i = rPeakIdx + 1; i < searchEnd; i++) {
      if (filtered[i] < sAmplitude) {
        sAmplitude = filtered[i];
        sIdx = i;
      }
    }

    // S wave should be negative
    if (sAmplitude < 0 && rAmplitude > 0) {
      const ratio = rAmplitude / Math.abs(sAmplitude);
      rsRatios.push(ratio);
      rAmplitudes.push(rAmplitude);
      sAmplitudes.push(Math.abs(sAmplitude));
    }
  }

  if (rsRatios.length === 0) {
    return { rsRatio: null, rAmplitude: null, sAmplitude: null, calculatedHR, beatsDetected: rPeaks.length };
  }

  // Return median values (more robust than mean)
  rsRatios.sort((a, b) => a - b);
  rAmplitudes.sort((a, b) => a - b);
  sAmplitudes.sort((a, b) => a - b);

  const medianIdx = Math.floor(rsRatios.length / 2);

  return {
    rsRatio: rsRatios[medianIdx],
    rAmplitude: rAmplitudes[medianIdx],
    sAmplitude: sAmplitudes[medianIdx],
    calculatedHR,
    beatsDetected: rPeaks.length,
  };
}

/**
 * Simple moving average filter
 */
function movingAverage(arr, windowSize) {
  const result = [];
  let sum = 0;

  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= windowSize) {
      sum -= arr[i - windowSize];
      result.push(sum / windowSize);
    } else {
      result.push(sum / (i + 1));
    }
  }

  return result;
}

/**
 * Find R peaks using simple threshold detection with T-wave protection
 *
 * Key insight: T-waves occur ~300ms after R-peaks.
 * Solution: Use 320ms minimum distance (allows up to 187 BPM) to skip T-waves.
 * Keep threshold simple - the min distance does the heavy lifting.
 */
function findRPeaks(voltages, samplingRate) {
  const peaks = [];

  // Minimum distance: 320ms - skips T-waves but allows up to 187 BPM
  const minDistance = Math.floor(samplingRate * 0.32);

  // Simple threshold: 30% of max amplitude (like original but slightly lower)
  const maxV = Math.max(...voltages);
  const threshold = maxV * 0.30;

  console.log(`Peak detection: maxV=${maxV.toFixed(4)}, threshold=${threshold.toFixed(4)}, minDist=${minDistance} samples (${(minDistance/samplingRate*1000).toFixed(0)}ms)`);

  let lastPeakIdx = -minDistance;

  for (let i = 2; i < voltages.length - 2; i++) {
    // Simple local maximum check
    if (voltages[i] > voltages[i - 1] &&
        voltages[i] > voltages[i - 2] &&
        voltages[i] > voltages[i + 1] &&
        voltages[i] > voltages[i + 2] &&
        voltages[i] > threshold &&
        i - lastPeakIdx >= minDistance) {
      peaks.push(i);
      lastPeakIdx = i;
    }
  }

  console.log(`Peak detection found ${peaks.length} R peaks`);
  return peaks;
}

/**
 * Sort a sheet by column A (date/timestamp) in descending order (most recent first).
 */
async function sortSheetByDateDesc(sheets, spreadsheetId, sheetName, endColumnIndex = 15) {
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

