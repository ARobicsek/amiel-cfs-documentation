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
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

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
    const ecgData = req.body;

    console.log('=== ECG WEBHOOK PAYLOAD ===');
    console.log('Full payload:', JSON.stringify(ecgData, null, 2));
    console.log('Top-level keys:', Object.keys(ecgData || {}));
    console.log('Type:', typeof ecgData);
    console.log('Is Array:', Array.isArray(ecgData));

    // Extract ECG information
    // Health Auto Export sends data in various formats - handle common ones
    const ecg = extractECGData(ecgData);

    if (!ecg) {
      // Return detailed debug info in error response
      return res.status(400).json({
        error: 'Could not parse ECG data',
        debug: {
          receivedKeys: Object.keys(ecgData || {}),
          isArray: Array.isArray(ecgData),
          type: typeof ecgData,
          sample: JSON.stringify(ecgData).slice(0, 1000),
        }
      });
    }

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

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

    // Get current Eastern Time
    const now = new Date();
    const etOptions = { timeZone: 'America/New_York' };
    const timestamp = now.toLocaleString('en-US', etOptions);
    const dateStr = ecg.date || now.toLocaleDateString('en-US', etOptions);

    // Generate unique ECG ID for linking readings to waveforms
    const ecgId = `ECG_${now.getTime()}`;

    // Store metadata in ECG_Readings sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'ECG_Readings!A:O',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,                              // A: Timestamp
          dateStr,                                // B: Date
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
        // Continue - metadata is already saved
      }
    }

    console.log('ECG saved successfully:', {
      ecgId,
      date: dateStr,
      classification: ecg.classification,
      appleHR: ecg.averageHeartRate,
      calculatedHR,
      hrValid,
      hrDiff,
      beatsDetected,
      rsRatio,
      samples: ecg.voltageMeasurements?.length,
      waveformStored,
    });

    return res.status(200).json({
      success: true,
      message: 'ECG data saved',
      ecgId,
      rsRatio,
      rAmplitude,
      sAmplitude,
      calculatedHR,
      appleHR,
      hrValid,
      hrDiff,
      beatsDetected,
      waveformStored,
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
 * Extract ECG data from various Health Auto Export formats
 */
function extractECGData(data) {
  // Health Auto Export format: { data: { ecg: [...] } }
  if (data.data && data.data.ecg && Array.isArray(data.data.ecg)) {
    const ecgArray = data.data.ecg;
    if (ecgArray.length > 0) {
      // Take the most recent ECG (last in array, or first - they seem to send newest)
      const ecg = ecgArray[ecgArray.length - 1];
      return {
        classification: ecg.classification,
        averageHeartRate: ecg.averageHeartRate,
        samplingFrequency: ecg.samplingFrequency || 512,
        voltageMeasurements: ecg.voltageMeasurements,
        date: ecg.start || ecg.end,
      };
    }
  }

  // Direct format (single ECG object)
  if (data.classification && data.voltageMeasurements) {
    return {
      classification: data.classification,
      averageHeartRate: data.averageHeartRate || data.heartRate,
      samplingFrequency: data.samplingFrequency || 512,
      voltageMeasurements: data.voltageMeasurements,
      date: data.start || data.startDate || data.date,
    };
  }

  // Nested in 'data' field with 'electrocardiogram' key (alternate format)
  if (data.data && data.data.electrocardiogram) {
    const ecg = data.data.electrocardiogram;
    return {
      classification: ecg.classification,
      averageHeartRate: ecg.averageHeartRate,
      samplingFrequency: ecg.samplingFrequency || 512,
      voltageMeasurements: ecg.voltageMeasurements,
      date: ecg.start || ecg.startDate,
    };
  }

  // Array format (multiple ECGs at top level)
  if (Array.isArray(data) && data.length > 0) {
    const ecg = data[data.length - 1]; // Take most recent
    return extractECGData(ecg);
  }

  // Nested in 'metrics' field
  if (data.metrics && data.metrics.electrocardiogram) {
    return extractECGData(data.metrics.electrocardiogram);
  }

  console.log('Unknown ECG format:', Object.keys(data));
  return null;
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
