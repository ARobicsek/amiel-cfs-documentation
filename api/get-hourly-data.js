/**
 * GET /api/get-hourly-data
 *
 * Two modes:
 *
 * 1. Single Day (Stats Single Day view):
 *    Query: ?date=YYYY-MM-DD
 *    Returns: { date, rows, count }
 *
 * 2. Multi-Day Stats (Stats Multi Day view):
 *    Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *    Returns: { startDate, endDate, days, count }
 *    Aggregates HR box plots from Health_Hourly, sleep/steps/HRV from Health_Daily,
 *    and Feet on Ground / Brain Time from Sheet1.
 *
 * Headers:
 *   Authorization: Bearer <SECRET_TOKEN>
 */

import { google } from 'googleapis';
import { computeValidatedSleepByDate, computeHRAwakeAsleepByDate } from '../lib/sleepValidation.js';

// ── Shared helpers ──

function parseDateStr(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return { month: parseInt(parts[0], 10), day: parseInt(parts[1], 10), year: parseInt(parts[2], 10) };
    }
  }
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
    }
  }
  return null;
}

function toISODate(parsed) {
  if (!parsed) return null;
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

function isInRange(dateStr, startDate, endDate) {
  const parsed = parseDateStr(dateStr);
  if (!parsed) return false;
  const iso = toISODate(parsed);
  return iso >= startDate && iso <= endDate;
}

function computeBoxPlot(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 1
    ? sorted[Math.floor(n / 2)]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const q1Idx = Math.floor(n / 4);
  const q3Idx = Math.floor(3 * n / 4);
  return {
    min: sorted[0],
    q1: sorted[q1Idx],
    median: Math.round(median * 10) / 10,
    q3: sorted[q3Idx],
    max: sorted[n - 1],
    count: n,
  };
}

// ── Handler ──

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const authHeader = req.headers.authorization;
  const receivedToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  const expectedToken = process.env.SECRET_TOKEN ? process.env.SECRET_TOKEN.trim() : null;

  if (!receivedToken || receivedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { date, startDate, endDate } = req.query;

  // Route to the appropriate mode
  if (startDate && endDate) {
    return handleMultiDay(req, res, startDate, endDate);
  } else if (date) {
    return handleSingleDay(req, res, date);
  } else {
    return res.status(400).json({ error: 'Provide ?date=YYYY-MM-DD or ?startDate=...&endDate=...' });
  }
}

// ── Mode 1: Single Day ──

async function handleSingleDay(req, res, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  try {
    const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Health_Hourly!A2:I',
    });

    const allRows = response.data.values || [];
    const [year, month, day] = date.split('-');
    const targetMonth = parseInt(month, 10);
    const targetDay = parseInt(day, 10);
    const targetYear = parseInt(year, 10);

    // Compute next-day date for spillover sleep detection
    const nextDate = new Date(targetYear, targetMonth - 1, targetDay + 1);
    const nextMonth = nextDate.getMonth() + 1;
    const nextDay = nextDate.getDate();
    const nextYear = nextDate.getFullYear();

    function rowMatchesDate(dateStr, m, d, y) {
      if (!dateStr) return false;
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          return parseInt(parts[0], 10) === m &&
            parseInt(parts[1], 10) === d &&
            parseInt(parts[2], 10) === y;
        }
      }
      if (dateStr.includes('-')) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return dateStr.startsWith(iso);
      }
      return false;
    }

    const matchingRows = [];
    const spilloverRows = [];
    // Collect all next-day sleep_analysis rows with parsed time ranges for sibling detection
    const nextDaySleepRows = [];

    // NEW: Also collect sleep_stage rows from the PREVIOUS day to handle overnight sleep sessions
    // that start on the previous day and end on the target day.
    // NEW: Also collect sleep_stage rows from the PREVIOUS day to handle overnight sleep sessions
    // that start on the previous day and end on the target day.
    // Calculate previous date (using targetYear, targetMonth, targetDay directly)
    // Note: Month is 0-indexed in Date constructor (targetMonth is 1-indexed)
    const prevDate = new Date(targetYear, targetMonth - 1, targetDay - 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth() + 1;
    const prevDay = prevDate.getDate();

    const prevDaySleepStageRows = [];
    const nextDaySleepStageRows = [];

    for (const row of allRows) {
      const dateStr = row[1];
      // Standard match for Target Date (all metrics)
      if (rowMatchesDate(dateStr, targetMonth, targetDay, targetYear)) {
        matchingRows.push(row);
      }
      // Next Day Spillover (sleep_analysis only - OLD logic, kept for consistency)
      else if (row[3] === 'sleep_analysis' && rowMatchesDate(dateStr, nextMonth, nextDay, nextYear)) {
        // Parse time range for this next-day sleep session
        try {
          const rawJson = row[8] ? JSON.parse(row[8]) : {};
          if (rawJson.sleepStart && rawJson.sleepEnd) {
            const startDate = new Date(rawJson.sleepStart);
            const isSpillover = startDate.getFullYear() === targetYear &&
              (startDate.getMonth() + 1) === targetMonth &&
              startDate.getDate() === targetDay;
            if (isSpillover) {
              const startMs = new Date(rawJson.sleepStart).getTime();
              const endMs = new Date(rawJson.sleepEnd).getTime();
              nextDaySleepRows.push({ row, startMs, endMs, isSpillover });
            }
          }
        } catch { /* skip unparseable rows */ }
      }
      // Previous Day Sleep Stages (granular data): stages that start on prev day and end on target day.
      else if (row[3] === 'sleep_stage' && rowMatchesDate(dateStr, prevMonth, prevDay, prevYear)) {
        prevDaySleepStageRows.push(row);
      }
      // Next Day Sleep Stages (granular data): stages stored under next day that may start before midnight.
      // The client clips these to [dayStart, dayEnd], capturing any minutes on the target day.
      else if (row[3] === 'sleep_stage' && rowMatchesDate(dateStr, nextMonth, nextDay, nextYear)) {
        nextDaySleepStageRows.push(row);
      }
    }

    // Find spillover sessions and their cluster siblings (overlapping sessions from date+1).
    // Without siblings, the parent session can't be validated against its children.
    const spilloverSessions = nextDaySleepRows.filter(s => s.isSpillover);
    for (const s of spilloverSessions) {
      spilloverRows.push(s.row);
    }
    // Include cluster siblings: other date+1 sleep sessions whose time range overlaps a spillover session
    for (const candidate of nextDaySleepRows) {
      if (candidate.isSpillover) continue; // already included
      const overlaps = spilloverSessions.some(sp =>
        candidate.startMs < sp.endMs && candidate.endMs > sp.startMs
      );
      if (overlaps) spilloverRows.push(candidate.row);
    }

    const mapRow = (row, spillover = false) => ({
      timestamp: row[0] || '',
      date: row[1] || '',
      hour: row[2] ? parseInt(row[2], 10) : null,
      metric: row[3] || '',
      value: row[4] ? parseFloat(row[4]) : null,
      min: row[5] ? parseFloat(row[5]) : null,
      max: row[6] ? parseFloat(row[6]) : null,
      source: row[7] || '',
      rawData: row[8] || '',
      ...(spillover ? { spillover: true } : {}),
    });

    const rows = [
      ...matchingRows.map(row => mapRow(row)),
      ...spilloverRows.map(row => mapRow(row, true)),
      ...prevDaySleepStageRows.map(row => mapRow(row)),
      ...nextDaySleepStageRows.map(row => mapRow(row)),
    ];

    return res.status(200).json({ date, rows, count: rows.length });
  } catch (error) {
    console.error('Error fetching hourly data:', error);
    return res.status(500).json({ error: 'Failed to fetch hourly data', details: error.message });
  }
}

// ── Mode 2: Multi-Day Stats ──

async function handleMultiDay(req, res, startDate, endDate) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return res.status(400).json({ error: 'Invalid startDate/endDate. Use YYYY-MM-DD format.' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'startDate must be <= endDate' });
  }

  try {
    const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    // Fetch all four sheets in parallel
    const [hourlyResponse, dailyResponse, sheet1Response, ecgResponse] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Health_Hourly!A2:I',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Health_Daily!A2:Q',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Sheet1!A2:G',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'ECG_Readings!A2:E',  // Timestamp, Date, Classification, Avg HR, R/S Ratio
      }),
    ]);

    // --- 1. HR Box Plot from Health_Hourly ---
    const hourlyRows = hourlyResponse.data.values || [];
    const hrByDate = {};

    for (const row of hourlyRows) {
      const dateStr = row[1];
      const metric = row[3];
      if (metric !== 'heart_rate') continue;
      if (!isInRange(dateStr, startDate, endDate)) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;

      const bpm = parseFloat(row[4]);
      if (isNaN(bpm)) continue;

      if (!hrByDate[isoDate]) hrByDate[isoDate] = [];
      hrByDate[isoDate].push(bpm);
    }

    // --- 1b. Validated Sleep from Health_Hourly ---
    // Compute sleep from raw hourly data using the same validated algorithm
    // as the single-day view, instead of relying on pre-computed Health_Daily values.
    const rangeParseDateFn = (dateStr) => {
      const p = parseDateStr(dateStr);
      return p ? toISODate(p) : null;
    };
    const rangeFilterFn = (dateStr) => isInRange(dateStr, startDate, endDate);
    const validatedSleep = computeValidatedSleepByDate(hourlyRows, rangeFilterFn, rangeParseDateFn);
    // Compute HR-Awake/Asleep in real time from hourly data, using the same
    // cross-midnight sleep stage attribution as computeValidatedSleepByDate.
    // This replaces reading pre-stored Health_Daily columns P & Q, which were
    // computed by the backfill script without cross-midnight stage awareness.
    const computedHRSleep = computeHRAwakeAsleepByDate(hourlyRows, rangeFilterFn, rangeParseDateFn);

    // --- 2. Sleep/Steps/HRV from Health_Daily ---
    const dailyRows = dailyResponse.data.values || [];
    const dailyByDate = {};

    for (const row of dailyRows) {
      const dateStr = row[0];
      if (!isInRange(dateStr, startDate, endDate)) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;

      dailyByDate[isoDate] = {
        steps: row[1] ? parseFloat(row[1]) : null,
        avgHR: row[2] ? parseFloat(row[2]) : null,
        restingHR: row[3] ? parseFloat(row[3]) : null,
        minHR: row[4] ? parseFloat(row[4]) : null,
        maxHR: row[5] ? parseFloat(row[5]) : null,
        avgHRV: row[6] ? parseFloat(row[6]) : null,
        sleepDuration: row[7] ? parseFloat(row[7]) : null,
        sleepEfficiency: row[8] || null,
        deepSleep: row[9] ? parseFloat(row[9]) : null,
        remSleep: row[10] ? parseFloat(row[10]) : null,
        hrCount: row[12] ? parseInt(row[12], 10) : null,
        hrvCount: row[13] ? parseInt(row[13], 10) : null,
        awakeMinutes: row[14] ? parseFloat(row[14]) : null,
        avgHR_awake: row[15] ? parseFloat(row[15]) : null,
        avgHR_asleep: row[16] ? parseFloat(row[16]) : null,
      };
    }

    // --- 3. Feet on Ground (Col C) & Brain Time (Col G) from Sheet1 ---
    const sheet1Rows = sheet1Response.data.values || [];
    const manualByDate = {};

    for (const row of sheet1Rows) {
      const dateStr = row[1];
      if (!dateStr) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;
      if (isoDate < startDate || isoDate > endDate) continue;

      manualByDate[isoDate] = {
        feetOnGround: row[2] ? parseFloat(row[2]) : null,
        brainTime: row[6] ? parseFloat(row[6]) : null,
      };
    }

    // --- 4. ECG R/S Ratio and HR from ECG_Readings ---
    // Column B = Date, D = Avg HR (Apple), E = R/S Ratio
    const ecgRows = ecgResponse.data.values || [];
    const ecgByDate = {};

    for (const row of ecgRows) {
      const dateStr = row[1];  // Date column (B)
      if (!dateStr) continue;

      const parsed = parseDateStr(dateStr);
      const isoDate = toISODate(parsed);
      if (!isoDate) continue;
      if (isoDate < startDate || isoDate > endDate) continue;

      const avgHr = row[3] ? parseFloat(row[3]) : null;  // Column D
      const rsRatio = row[4] ? parseFloat(row[4]) : null;  // Column E

      if (rsRatio == null || isNaN(rsRatio)) continue;

      if (!ecgByDate[isoDate]) {
        ecgByDate[isoDate] = { hrSum: 0, hrCount: 0, rsSum: 0, rsCount: 0 };
      }
      ecgByDate[isoDate].rsSum += rsRatio;
      ecgByDate[isoDate].rsCount += 1;
      if (avgHr != null && !isNaN(avgHr)) {
        ecgByDate[isoDate].hrSum += avgHr;
        ecgByDate[isoDate].hrCount += 1;
      }
    }

    // --- 6. Merge all data by date ---
    const allDates = new Set([
      ...Object.keys(hrByDate),
      ...Object.keys(dailyByDate),
      ...Object.keys(manualByDate),
      ...Object.keys(validatedSleep),
      ...Object.keys(ecgByDate),
    ]);

    const days = [];
    for (const date of allDates) {
      const hr = hrByDate[date] ? computeBoxPlot(hrByDate[date]) : null;
      const daily = dailyByDate[date] || {};
      const manual = manualByDate[date] || {};
      const vSleep = validatedSleep[date];
      const vHR = computedHRSleep[date];
      const ecgData = ecgByDate[date];

      // Use validated sleep from hourly data (accurate), falling back to Health_Daily
      let sleep = null;
      if (vSleep && vSleep.totalMin > 0) {
        sleep = {
          total: vSleep.totalMin,
          deep: vSleep.deepMin || null,
          rem: vSleep.remMin || null,
          core: vSleep.coreMin || null,
          awake: vSleep.awakeMin || null,
        };
      } else if (daily.sleepDuration != null) {
        let coreSleep = null;
        if (daily.deepSleep != null && daily.remSleep != null) {
          const awake = daily.awakeMinutes || 0;
          coreSleep = Math.max(0, daily.sleepDuration - daily.deepSleep - daily.remSleep - awake);
        }
        sleep = {
          total: Math.round(daily.sleepDuration),
          deep: daily.deepSleep != null ? Math.round(daily.deepSleep) : null,
          rem: daily.remSleep != null ? Math.round(daily.remSleep) : null,
          core: coreSleep != null ? Math.round(coreSleep) : null,
          awake: daily.awakeMinutes != null ? Math.round(daily.awakeMinutes) : null,
        };
      }

      // ECG data: average R/S ratio and HR if multiple readings that day
      let ecg = null;
      if (ecgData && ecgData.rsCount > 0) {
        ecg = {
          avgRsRatio: Math.round((ecgData.rsSum / ecgData.rsCount) * 100) / 100,
          avgHr: ecgData.hrCount > 0 ? Math.round(ecgData.hrSum / ecgData.hrCount) : null,
          count: ecgData.rsCount,
        };
      }

      days.push({
        date,
        hr,
        steps: daily.steps != null ? Math.round(daily.steps) : null,
        sleep,
        hrv: daily.avgHRV != null ? { avg: daily.avgHRV, count: daily.hrvCount } : null,
        feetOnGround: manual.feetOnGround,
        brainTime: manual.brainTime,
        ecg,
        avgHR_awake: vHR?.avgHR_awake ?? daily.avgHR_awake,
        avgHR_asleep: vHR?.avgHR_asleep ?? daily.avgHR_asleep,
      });
    }

    days.sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({ startDate, endDate, days, count: days.length });
  } catch (error) {
    console.error('Error fetching health stats:', error);
    return res.status(500).json({ error: 'Failed to fetch health stats', details: error.message });
  }
}
