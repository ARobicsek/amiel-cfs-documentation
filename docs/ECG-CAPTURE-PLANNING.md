# ECG Capture Feature Planning

## Overview

This document outlines the research, options, and recommendations for adding ECG (electrocardiogram) capture functionality to the CFS Daily Tracker app. The goal is to allow daily capture of:
1. **Full ECG tracing** from 30-second iPhone/Apple Watch ECG recordings
2. **R/S wave ratio** measurements
3. **Selection capability** when multiple ECGs are taken in a day

**Critical Constraint:** The solution must minimize effort for a user with chronic fatigue syndrome.

---

## Understanding the R/S Ratio

Based on research, the "S/R ratio" (or more commonly "R/S ratio") refers to the ratio of the R-wave amplitude to the S-wave amplitude in an ECG's QRS complex. This metric is clinically significant for:

- **Ventricular hypertrophy detection** - R/S ratio ≥1 in lead V1 can indicate right ventricular hypertrophy
- **Transition zone identification** - The point where R/S ratio becomes >1 (normally at V3 or V4)
- **Cardiac axis assessment**

In the context of CFS/autonomic dysfunction, tracking this ratio over time could reveal:
- Changes in cardiac electrical activity
- Potential structural adaptations
- Correlation with symptom severity

**Note:** If your son's doctor specified a different ratio or measurement, please clarify. Other autonomic-relevant ECG metrics include:
- **30:15 ratio** (Ewing ratio) - for autonomic function testing
- **HRV metrics** (RMSSD, LF/HF ratio) - for sympathetic/parasympathetic balance

---

## Current App Architecture Constraints

The CFS Tracker is a **Progressive Web App (PWA)**:

| Constraint | Implication |
|------------|-------------|
| **No native iOS access** | Cannot use HealthKit APIs directly |
| **No Apple Health integration** | Cannot pull ECG waveform data programmatically |
| **Browser sandbox** | Limited file system access |
| **Google Sheets backend** | Storage format must be compatible |

This significantly limits options compared to a native iOS app.

---

## ECG Capture Options Analysis

### Option 1: Manual PDF Export + Image Upload (Most Feasible)

**How it works:**
1. User takes ECG on Apple Watch
2. Opens Health app → Heart → Electrocardiograms
3. Taps the ECG → "Export a PDF for Your Doctor"
4. Shares PDF to the CFS Tracker PWA (or saves image/screenshot)
5. App stores the image in cloud storage

**User Effort:** Medium (5-6 taps + share action)

**Implementation:**
- Add file upload component to DailyEntry
- Store images in Google Drive (linked to Sheets) or Cloudinary
- Store image URL reference in Google Sheets
- Manual entry of R/S ratio (calculated by user or doctor)

**Pros:**
- Works with current PWA architecture
- No additional app purchases needed
- Full tracing preserved as PDF

**Cons:**
- Multiple steps required
- R/S ratio must be entered manually
- No automated analysis

---

### Option 2: Third-Party App Integration (Recommended for Minimal Effort)

**Recommended App: [Health Auto Export](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069)**

**How it works:**
1. Configure app to auto-export ECG data to REST API endpoint
2. Add new Vercel API endpoint to receive ECG data
3. Store raw voltage data in Google Sheets or separate storage
4. Calculate R/S ratio server-side

**User Effort:** Very Low (take ECG, everything else is automatic)

**Implementation:**
```
User takes ECG → Health Auto Export → REST API → Vercel Function → Storage
```

**Pros:**
- Nearly zero daily effort after setup
- Raw voltage data available (512 Hz sampling)
- Automated background sync
- Can calculate R/S ratio programmatically

**Cons:**
- Requires $2.99 app purchase
- Background sync not 100% reliable (iOS limitation)
- Initial setup complexity
- Voltage data is large (~15,000 samples per ECG)

**ECG Data Format from Health Auto Export:**
```json
{
  "classification": "SinusRhythm",
  "averageHeartRate": 72,
  "samplingFrequency": 512,
  "voltageMeasurements": [
    {"microVolts": 123, "timeSinceSampleStart": 0.0},
    {"microVolts": 145, "timeSinceSampleStart": 0.00195},
    ...
  ]
}
```

---

### Option 3: ECG+ App for Automated Analysis

**App: [ECG+](https://apps.apple.com/us/app/ecg-analyzer-for-qtc-hrv/id1567047859)**

**How it works:**
1. ECG+ automatically analyzes Apple Watch ECGs when saved
2. Provides QRS amplitude measurements (including R/S calculation)
3. User screenshots or exports the analysis
4. Manual entry of key metrics into CFS Tracker

**User Effort:** Low-Medium (1 screenshot + manual entry)

**Implementation:**
- Add numeric fields for ECG metrics to DailyEntry
- Optional: Add image upload for analysis screenshot

**Pros:**
- Professional-grade ECG analysis
- QRS amplitude calculated automatically
- Detects arrhythmias, PVCs, PACs
- GPT-powered explanations

**Cons:**
- Subscription cost (~$30/year)
- Still requires manual data transfer
- No direct API integration

---

### Option 4: Native iOS App (Most Capable, Most Complex)

**How it works:**
Build a companion iOS app using Swift/SwiftUI that:
1. Accesses HealthKit ECG data directly
2. Calculates R/S ratio automatically
3. Syncs to existing Google Sheets backend
4. Provides seamless PWA ↔ native integration

**User Effort:** Minimal (take ECG, sync happens automatically)

**Implementation:**
- New Swift iOS app project
- HealthKit ECG access (`HKElectrocardiogramQuery`)
- Signal processing for wave detection
- REST API sync to Vercel backend

**Pros:**
- Full access to raw ECG voltage data
- Automated R/S ratio calculation
- Seamless user experience
- Can trigger from PWA notification

**Cons:**
- Significant development effort (40+ hours)
- Requires Apple Developer Program ($99/year)
- App Store review process
- Ongoing maintenance burden

---

### Option 5: iOS Shortcuts + Simple Entry (Compromise)

**How it works:**
1. Create iOS Shortcut that prompts for R/S ratio after ECG
2. Shortcut sends data directly to Vercel API
3. Optionally exports PDF to iCloud for archival

**User Effort:** Low (tap shortcut, enter one number, done)

**Implementation:**
- Create iOS Shortcut with web request action
- Add ECG API endpoint to Vercel
- Store R/S ratio and metadata in Sheets

**Pros:**
- No app purchase required
- Very fast daily entry
- Works today with minimal development

**Cons:**
- R/S ratio must be calculated externally
- No waveform storage (unless manual PDF save)
- Requires knowing how to read R/S ratio

---

## Recommended Implementation Strategy

Given the constraints (PWA architecture, minimal user effort, CFS consideration), the solution must be **fully automatic from the start**. The user cannot be expected to manually enter R/S ratios or other ECG data.

### Implementation Phases (All Automatic)

#### Phase 1: Infrastructure Setup (30 minutes)
- Enable Google Drive API
- Create ECG storage folder
- Create ECG_Readings sheet with proper columns
- Generate webhook secret
- Add environment variables to Vercel

#### Phase 2: Webhook Endpoint (2-3 hours)
- Create `/api/ecg-webhook` endpoint
- Implement R/S ratio calculation algorithm
- Store full waveform to Google Drive as CSV
- Store metadata to Google Sheets

**R/S Ratio Calculation Algorithm:**
```javascript
function calculateRSRatio(voltageMeasurements) {
  // 1. Remove baseline wander with moving average filter
  // 2. Detect R peaks (local maxima above threshold)
  // 3. Find S waves (minimum within 100ms after each R peak)
  // 4. Calculate R/S ratio for each beat
  // 5. Return median ratio (robust to outliers)
}
```

#### Phase 3: Health Auto Export Configuration (30 minutes)
- Configure automation in the app
- Set webhook URL and secret
- Select ECG data type
- Enable automatic sync trigger

#### Phase 4: ECG Display (Optional, 2-3 hours)
- Add API to fetch ECG readings
- Create ECG history component
- Add ECG tab to navigation

### Key Design Principle

**NO MANUAL DATA ENTRY.** The user takes an ECG on their Apple Watch - that's it. Everything else happens automatically:
- Health Auto Export detects new ECG
- Sends data to webhook
- Webhook calculates R/S ratio
- Stores waveform and metadata

See `docs/ECG-IMPLEMENTATION-GUIDE.md` for complete step-by-step instructions.

---

## Data Storage Design

### Google Sheets Schema Addition

**New Sheet: "ECG_Readings"**
| Column | Type | Description |
|--------|------|-------------|
| A: Timestamp | DateTime | When ECG was taken |
| B: Date | Date | Date for linking to daily entry |
| C: Classification | String | Sinus Rhythm, AFib, etc. |
| D: Avg Heart Rate | Number | BPM during ECG |
| E: R/S Ratio | Number | Calculated or entered |
| F: R Wave Amplitude | Number | In microvolts |
| G: S Wave Amplitude | Number | In microvolts |
| H: HRV (SDNN) | Number | If available |
| I: Notes | String | User observations |
| J: PDF/Image URL | String | Link to stored tracing |
| K: Raw Data URL | String | Link to voltage CSV (if stored) |

### Waveform Storage Options

For storing the actual ECG tracing (~15,000 voltage samples):

1. **Google Drive** - Store as CSV, link in Sheets
2. **Cloudinary** - Store waveform images
3. **Firebase Storage** - For raw JSON voltage data
4. **Compress + Sheets** - Store downsampled data directly

Recommendation: Use Google Drive for consistency with existing architecture.

---

## Minimal Effort User Workflow (Target State)

**Daily routine with Phase 3 implementation:**

1. ⌚ Take ECG on Apple Watch (30 seconds)
2. ✅ Done - Health Auto Export syncs automatically
3. 📱 Open CFS Tracker, see ECG data already populated
4. 💾 Save daily entry as usual

**Effort:** One 30-second ECG recording. Everything else is automatic.

---

## Technical Considerations

### R/S Ratio Calculation

To calculate R/S ratio from raw voltage data:

1. **Bandpass filter** (0.5-40 Hz) to remove noise
2. **R-peak detection** using Pan-Tompkins algorithm
3. **QRS segmentation** around each R-peak
4. **Find S-wave** as minimum after R-peak
5. **Calculate ratio** = |R amplitude| / |S amplitude|

Libraries that could help:
- JavaScript: `ecg-dsp` (signal processing)
- Python: `neurokit2`, `biosppy` (ECG analysis)

### Sample Rate Considerations

Apple Watch ECG: 512 Hz sampling rate
- 30-second recording = 15,360 samples
- ~150KB per ECG as JSON
- Consider downsampling for storage efficiency

---

## Cost Analysis

| Option | One-time Cost | Recurring Cost |
|--------|--------------|----------------|
| Manual PDF | $0 | $0 |
| Health Auto Export | $2.99 | $0 |
| ECG+ App | $0 | ~$30/year |
| Native iOS App | ~$99 (dev account) | $99/year |

**Recommendation:** Start with Phase 1 (free), then Phase 2 (free), then evaluate if Health Auto Export ($2.99) is worth it for Phase 3.

---

## Next Steps

1. **Clarify R/S ratio requirements** - Confirm this is the correct metric, or if another measurement is needed
2. **Implement Phase 1** - Add basic ECG fields to DailyEntry (quick win)
3. **Test PDF workflow** - Determine if manual PDF export is acceptable effort
4. **Evaluate Health Auto Export** - Test reliability of background sync
5. **Decision point** - Proceed to Phase 3 or explore native app

---

## Research Sources

- [Apple HKElectrocardiogram Documentation](https://developer.apple.com/documentation/healthkit/hkelectrocardiogram)
- [WWDC20 - What's New in HealthKit](https://developer.apple.com/videos/play/wwdc2020/10182/)
- [Health Auto Export App](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069)
- [ECG+ App](https://apps.apple.com/us/app/ecg-analyzer-for-qtc-hrv/id1567047859)
- [Apple ECG PDF Export Guide](https://support.apple.com/en-us/120278)
- [MyDataHelps ECG Export Format](https://support.mydatahelps.org/hc/en-us/articles/4412383294099-Apple-HealthKitV2-Electrocardiogram-Export-Format)
- [ECG Wave Components - LITFL](https://litfl.com/r-wave-ecg-library/)
- [QRS Complex Analysis](https://ecgwaves.com/ecg-qrs-complex-q-r-s-wave-duration-interval/)
- [Parsing Apple Health Data with Python](https://www.markwk.com/data-analysis-for-apple-health.html)

---

## Appendix: Apple Watch ECG Capabilities

- **Recording Duration:** 30 seconds
- **Lead Configuration:** Single-lead (Lead I equivalent)
- **Sampling Rate:** 512 Hz
- **Voltage Resolution:** Microvolts
- **Classifications:** Sinus Rhythm, Atrial Fibrillation, Inconclusive, Low Heart Rate, High Heart Rate
- **Storage:** Health app on iPhone
- **Export Options:** PDF (via Health app), Raw data (via full health export or HealthKit API)

The single-lead limitation means:
- R/S ratio is measured from Lead I only
- Not equivalent to clinical 12-lead ECG
- Suitable for rhythm monitoring, limited for structural analysis
