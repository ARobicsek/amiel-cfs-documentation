# Apple Watch ECG Data Parsing & Visualization Guide

## Data Format Overview

Apple Watch ECG exports contain a single Lead I recording with the following structure:

### File Structure
| Field | Description | Example |
|-------|-------------|---------|
| ECG_ID | Unique identifier | `ECG_1766898077000` |
| Sampling_Freq | Samples per second | `512` (Hz) |
| Voltage_1, Voltage_2, Voltage_3... | Voltage data (see below) | Comma-separated values |

### Key Parameters
- **Sampling Rate:** 512 Hz (512 samples per second)
- **Duration:** 30 seconds
- **Total Samples:** 15,360 (512 × 30)
- **Voltage Units:** Microvolts (μV)

---

## Understanding the Voltage Fields

**Important:** The multiple "Voltage_X" columns are NOT separate channels. They are **one continuous data stream split across columns** due to export formatting limitations.

### How to Handle
1. **Concatenate** all Voltage columns in order: `Voltage_1 + Voltage_2 + Voltage_3 + ...`
2. The combined data forms one continuous Lead I waveform
3. Values are comma-separated within each column

### Watch for Sample Count Header
Some exports include the sample count as the first value:
```
15360.00, 98.01, 101.11, 103.91, ...
```
If the first value equals `15360.00`, **skip it** — it's metadata, not voltage data.

---

## Parsing Steps

### Step 1: Extract Raw Data
```
1. Read all Voltage columns
2. Combine into single string (remove column separators)
3. Split by comma
4. Convert each value to number
```

### Step 2: Clean Data
```
1. Check if first value = 15360 → skip it
2. Remove any empty or invalid values
3. Result: array of 15,360 voltage values (μV)
```

### Step 3: Create Time Axis
```
time_seconds = sample_index / 512

Example:
- Sample 0 → 0.000s
- Sample 512 → 1.000s
- Sample 15359 → 29.998s
```

### Step 4: Convert Units for Display
```
voltage_mV = voltage_μV / 1000

Typical range: -0.5 mV to +1.2 mV
```

---

## Visualization Specifications

### Standard ECG Display Settings
| Parameter | Value |
|-----------|-------|
| X-axis | Time in seconds |
| Y-axis | Voltage in millivolts (mV) |
| Y-range | -0.5 to 1.2 mV (typical) |
| Line color | Black |
| Line width | Thin (0.5-1px) |

### Grid (Optional - ECG Paper Style)
- **Major grid:** Every 0.2 seconds (X) and 0.5 mV (Y)
- **Minor grid:** Every 0.04 seconds (X) and 0.1 mV (Y)
- **Background:** Light pink/red (#fff8f8)

### Multi-Strip Layout (Recommended)
For 30-second recordings, display as **3 rows × 10 seconds each**:
- Strip 1: Samples 0–5119 (0–10s)
- Strip 2: Samples 5120–10239 (10–20s)  
- Strip 3: Samples 10240–15359 (20–30s)

---

## Google Sheets Implementation Notes

### Parsing in Apps Script
```javascript
function parseECGData(rawData) {
  // 1. Split by tabs to get columns
  // 2. Join voltage columns, remove tabs
  // 3. Split by comma
  // 4. Convert to numbers, skip first if = 15360
  // 5. Return array of voltage values
}
```

### Charting Options
1. **Native Google Sheets Chart:** Line chart with time on X-axis
   - May struggle with 15,360 points — consider downsampling
   
2. **Apps Script + Charts API:** More control over appearance

3. **Export to visualization tool:** Generate data, visualize externally

### Downsampling (if needed)
For performance, you can reduce from 512 Hz to 128 Hz:
- Take every 4th sample
- Results in 3,840 points (still smooth waveform)

---

## Quick Reference

```
File → Parse → Visualize

┌─────────────────────────────────────────────────────┐
│ ECG_ID | Sampling_Freq | Voltage_1 | Voltage_2 |...│
│   ID   |     512       | v1,v2,v3  | v4,v5,v6  |...│
└─────────────────────────────────────────────────────┘
                          ↓
              Concatenate all voltage columns
                          ↓
         Remove first value if it equals 15360
                          ↓
        Array of 15,360 values (microvolts)
                          ↓
           Divide by 1000 → millivolts
                          ↓
      Plot: X = index/512 (seconds), Y = mV
```

---

## Sample Data Characteristics

| Metric | Typical Value |
|--------|---------------|
| QRS amplitude | 0.8–1.0 mV |
| Baseline | ~0 mV |
| Heart rate | Count R-peaks, multiply by 2 (for 30s) |
| Noise floor | ±0.05 mV |

**Artifacts to expect:** Initial 1-2 seconds may show settling/motion artifact (large deflections outside normal range).