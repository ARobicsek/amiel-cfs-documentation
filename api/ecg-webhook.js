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
 * Parse CSV data from Health Auto Export
 * Returns array of ECG records
 *
 * CSV format: one row per ECG, with voltage data split across multiple columns
 * Columns: start, classification, averageHeartRate, samplingFrequency, voltage1, voltage2, voltage3, voltage4
 * Each voltage column contains a portion of the ~15,000 samples as comma-separated values
 */
function parseCSVData(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header row - handle quoted headers
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  console.log('CSV Headers:', headers);

  // Find relevant column indices
  const dateIdx = headers.findIndex(h => h.includes('start') || h === 'date' || h === 'time');
  const classIdx = headers.findIndex(h => h.includes('classification'));
  const hrIdx = headers.findIndex(h =>
    (h.includes('average') && h.includes('heart')) ||
    h === 'averageheartrate' ||
    h.includes('heartrate')
  );
  const samplingIdx = headers.findIndex(h => h.includes('sampling'));

  // Find ALL voltage columns (voltage1, voltage2, voltage3, voltage4 or similar)
  const voltageIndices = [];
  headers.forEach((h, idx) => {
    if (h.includes('voltage')) {
      voltageIndices.push(idx);
    }
  });

  console.log('Column indices:', { dateIdx, classIdx, hrIdx, samplingIdx, voltageIndices });

  const records = [];

  // Each row is one ECG record
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const dateStr = dateIdx >= 0 ? values[dateIdx]?.trim() : null;
    const classification = classIdx >= 0 ? values[classIdx]?.trim() : null;
    const hrValue = hrIdx >= 0 ? values[hrIdx]?.trim() : null;
    const hr = hrValue ? parseFloat(hrValue) : null;
    const samplingValue = samplingIdx >= 0 ? values[samplingIdx]?.trim() : null;
    const sampling = samplingValue ? parseFloat(samplingValue) : 512;

    console.log(`Row ${i}: date=${dateStr}, class=${classification}, hr=${hr}, sampling=${sampling}`);

    // Combine all voltage columns into one array
    const voltageMeasurements = [];
    for (const vIdx of voltageIndices) {
      const voltageStr = values[vIdx];
      if (voltageStr) {
        // Each voltage cell may contain comma-separated values or a single value
        // But since we're in CSV, the cell should be quoted if it contains commas
        // Parse the voltage values from the cell
        const voltageValues = voltageStr.split(',')
          .map(v => v.trim())
          .filter(v => v !== '')
          .map(v => parseFloat(v))
          .filter(v => !isNaN(v));

        for (const voltage of voltageValues) {
          voltageMeasurements.push({ voltage });
        }
      }
    }

    console.log(`Row ${i}: Found ${voltageMeasurements.length} voltage measurements`);

    if (dateStr || voltageMeasurements.length > 0) {
      records.push({
        date: dateStr,
        classification: classification,
        averageHeartRate: hr,
        samplingFrequency: sampling,
        voltageMeasurements: voltageMeasurements,
      });
    }
  }

  console.log(`Parsed ${records.length} ECG record(s) from CSV with total voltage samples`);
  if (records.length > 0) {
    console.log(`First record: ${records[0].voltageMeasurements.length} samples, HR=${records[0].averageHeartRate}, class=${records[0].classification}`);
  }

  return records;
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
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

    // Check if this is CSV data
    const isCSV = contentType.includes('text/csv') ||
                  contentType.includes('text/plain') ||
                  (!contentType.includes('json') && rawBody.trim().split('\n')[0].includes(','));

    if (isCSV) {
      console.log('Detected CSV format');
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

    // Get existing ECG dates to avoid duplicates
    const existingDates = await getExistingECGDates(sheets, sheetId);
    console.log(`Found ${existingDates.size} existing ECG dates in sheet`);

    // Sort ECG records by date (newest first) and process each one
    ecgRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

    const results = [];
    let savedCount = 0;
    let skippedCount = 0;

    for (const ecg of ecgRecords) {
      // Check for duplicate by ECG date (within 1 minute)
      const ecgDateKey = ecg.date ? new Date(ecg.date).toISOString().slice(0, 16) : null;
      if (ecgDateKey && existingDates.has(ecgDateKey)) {
        console.log(`Skipping duplicate ECG from ${ecg.date}`);
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

      // Format the ECG date for display
      const ecgDate = ecg.date ? new Date(ecg.date) : now;
      const ecgDateStr = ecgDate.toLocaleString('en-US', etOptions);

      // Generate unique ECG ID using the ECG's timestamp
      const ecgId = `ECG_${ecgDate.getTime()}`;

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

      // Add to existing dates to prevent duplicates within same request
      if (ecgDateKey) {
        existingDates.add(ecgDateKey);
      }

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
 * Get existing ECG dates from sheet to avoid duplicates
 */
async function getExistingECGDates(sheets, sheetId) {
  const existingDates = new Set();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'ECG_Readings!B:B', // Date column
    });

    const rows = response.data.values || [];
    for (const row of rows) {
      if (row[0] && row[0] !== 'Date') {
        // Parse the date and create a key (truncated to minute for matching)
        try {
          const date = new Date(row[0]);
          if (!isNaN(date.getTime())) {
            existingDates.add(date.toISOString().slice(0, 16));
          }
        } catch (e) {
          // Skip unparseable dates
        }
      }
    }
  } catch (error) {
    console.log('Could not fetch existing dates:', error.message);
  }

  return existingDates;
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
 * Find R peaks using simple threshold-based detection
 */
function findRPeaks(voltages, samplingRate) {
  const peaks = [];

  // Calculate threshold (60% of max amplitude)
  const maxV = Math.max(...voltages);
  const threshold = maxV * 0.6;

  // Minimum distance between R peaks (~300ms for 200 BPM max)
  const minDistance = Math.floor(samplingRate * 0.3);

  let lastPeakIdx = -minDistance;

  for (let i = 2; i < voltages.length - 2; i++) {
    // Check if local maximum
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

  return peaks;
}
