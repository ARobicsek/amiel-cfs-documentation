import { useState, useEffect, useCallback, useMemo } from 'react';
import { getHealthStats } from '../../utils/api';
import FullscreenChart from './FullscreenChart';
import HRBoxPlotChart from './charts/HRBoxPlotChart';
import SleepStackedBar from './charts/SleepStackedBar';
import MetricLineChart from './charts/MetricLineChart';

// Format date as "Jan 21" or full "Jan 21, 2026"
function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

function formatDateRange(startDate, endDate) {
  const [sy] = startDate.split('-').map(Number);
  const [ey] = endDate.split('-').map(Number);
  const start = formatDateShort(startDate);
  const end = formatDateShort(endDate);
  if (sy === ey) {
    return `${start} - ${end}, ${ey}`;
  }
  return `${start}, ${sy} - ${end}, ${ey}`;
}

// Get YYYY-MM-DD for today
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Add days to a YYYY-MM-DD string
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const RANGE_PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
];

const METRIC_CONFIGS = [
  { key: 'feetOnGround', label: 'Feet on Ground', defaultOn: true },
  { key: 'steps', label: 'Steps', defaultOn: true },
  { key: 'sleep', label: 'Sleep', defaultOn: true },
  { key: 'hr', label: 'HR', defaultOn: true },
  { key: 'hrAwake', label: 'HR Awake', defaultOn: false },
  { key: 'hrAsleep', label: 'HR Asleep', defaultOn: false },
  { key: 'hrv', label: 'HRV', defaultOn: true },
  { key: 'rsRatio', label: 'R/S Ratio', defaultOn: true },
  { key: 'brainTime', label: 'Brain Time', defaultOn: true },
];

/**
 * Multi-Day Stats View.
 * Shows date range navigation, quick selectors, and stacked metric charts.
 *
 * Props:
 *   isDark: boolean
 */
export default function MultiDayView({ isDark }) {
  const today = todayStr();

  // Date range state
  const [rangeDays, setRangeDays] = useState(7);
  const [endDate, setEndDate] = useState(today);
  const startDate = useMemo(() => addDays(endDate, -(rangeDays - 1)), [endDate, rangeDays]);

  // Metric visibility toggles
  const [visibleMetrics, setVisibleMetrics] = useState(() => {
    const m = {};
    METRIC_CONFIGS.forEach(mc => { m[mc.key] = mc.defaultOn; });
    return m;
  });

  // Data state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch data when date range changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getHealthStats(startDate, endDate)
      .then(result => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [startDate, endDate]);

  // Navigation handlers
  const canNext = endDate < today;

  const navigatePrev = useCallback(() => {
    setEndDate(prev => addDays(prev, -rangeDays));
  }, [rangeDays]);

  const navigateNext = useCallback(() => {
    setEndDate(prev => {
      const next = addDays(prev, rangeDays);
      return next > today ? today : next;
    });
  }, [rangeDays, today]);

  const selectPreset = useCallback((days) => {
    setRangeDays(days);
    setEndDate(today);
  }, [today]);

  const toggleMetric = useCallback((key) => {
    setVisibleMetrics(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Extract HRV values from nested structure
  const hrvExtractor = useCallback((day) => day.hrv?.avg ?? null, []);

  // Extract R/S ratio values from nested structure
  const rsRatioExtractor = useCallback((day) => day.ecg?.avgRsRatio ?? null, []);

  const days = data?.days || [];

  // Date range string for fullscreen display
  const dateRangeStr = formatDateRange(startDate, endDate);

  // Check if any days have ECG data
  const hasEcgData = days.some(d => d.ecg?.avgRsRatio != null);

  return (
    <div className="multi-day-view">
      {/* Date Range Navigator */}
      <div className="stats-date-nav">
        <button className="stats-nav-btn" onClick={navigatePrev}>&#9664;</button>
        <div className="stats-date-display">
          <span className="stats-date-text">{formatDateRange(startDate, endDate)}</span>
          {endDate === today && <span className="stats-date-today">Current</span>}
        </div>
        <button className="stats-nav-btn" onClick={navigateNext} disabled={!canNext}>&#9654;</button>
      </div>

      {/* Quick Range Selectors */}
      <div className="multi-day-presets">
        {RANGE_PRESETS.map(p => (
          <button
            key={p.label}
            className={`preset-btn ${rangeDays === p.days ? 'active' : ''}`}
            onClick={() => selectPreset(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Metric Toggles */}
      <div className="multi-day-toggles">
        {METRIC_CONFIGS.map(mc => (
          <label key={mc.key} className="metric-toggle">
            <input
              type="checkbox"
              checked={visibleMetrics[mc.key]}
              onChange={() => toggleMetric(mc.key)}
            />
            <span>{mc.label}</span>
          </label>
        ))}
      </div>

      {/* Error */}
      {error && <div className="stats-error">Error: {error}</div>}

      {/* Charts - keep visible while loading to prevent FullscreenChart unmount */}
      {!error && days.length > 0 && (
        <div className="multi-day-charts">
          {/* 1. Feet on Ground */}
          {visibleMetrics.feetOnGround && (
            <FullscreenChart
              title="Feet on Ground"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueKey="feetOnGround"
                  label="Feet on Ground"
                  unit="hours"
                  color="#f59e0b"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                />
              )}
            </FullscreenChart>
          )}

          {/* 2. Steps */}
          {visibleMetrics.steps && (
            <FullscreenChart
              title="Steps"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueKey="steps"
                  label="Steps"
                  unit="steps"
                  color="#10b981"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                  formatValue={(v) => Math.round(v).toLocaleString()}
                  isDeviceData
                />
              )}
            </FullscreenChart>
          )}

          {/* 3. Sleep Stacked Bars */}
          {visibleMetrics.sleep && (
            <FullscreenChart
              title="Sleep"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <SleepStackedBar
                  days={days}
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                />
              )}
            </FullscreenChart>
          )}

          {/* 4. Heart Rate Box Plots */}
          {visibleMetrics.hr && (
            <FullscreenChart
              title="Heart Rate"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <HRBoxPlotChart
                  days={days}
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                />
              )}
            </FullscreenChart>
          )}

          {/* 4b. HR Awake */}
          {visibleMetrics.hrAwake && (
            <FullscreenChart
              title="HR Awake"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueKey="avgHR_awake"
                  label="HR Awake"
                  unit="bpm"
                  color="#f97316"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                  formatValue={(v) => `${Math.round(v)} bpm`}
                  isDeviceData
                />
              )}
            </FullscreenChart>
          )}

          {/* 4c. HR Asleep */}
          {visibleMetrics.hrAsleep && (
            <FullscreenChart
              title="HR Asleep"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueKey="avgHR_asleep"
                  label="HR Asleep"
                  unit="bpm"
                  color="#6366f1"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                  formatValue={(v) => `${Math.round(v)} bpm`}
                  isDeviceData
                />
              )}
            </FullscreenChart>
          )}

          {/* 5. HRV */}
          {visibleMetrics.hrv && (
            <FullscreenChart
              title="HRV"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueExtractor={hrvExtractor}
                  label="HRV"
                  unit="ms"
                  color="#06b6d4"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                  formatValue={(v) => `${v.toFixed(1)} ms`}
                  isDeviceData
                />
              )}
            </FullscreenChart>
          )}

          {/* 6. R/S Ratio (only show if ECG data exists) */}
          {visibleMetrics.rsRatio && hasEcgData && (
            <FullscreenChart
              title="Avg R/S Ratio"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueExtractor={rsRatioExtractor}
                  label="R/S Ratio"
                  unit=""
                  color="#ef4444"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                  formatValue={(v) => v.toFixed(2)}
                  tooltipExtra={(day) => day.ecg?.avgHr ? `ECG HR: ${Math.round(day.ecg.avgHr)} BPM` : null}
                  pointsOnly={true}
                />
              )}
            </FullscreenChart>
          )}

          {/* 7. Brain Time */}
          {visibleMetrics.brainTime && (
            <FullscreenChart
              title="Brain Time"
              date={dateRangeStr}
              onPrev={navigatePrev}
              onNext={navigateNext}
              canNext={canNext}
            >
              {({ isFullscreen }) => (
                <MetricLineChart
                  days={days}
                  valueKey="brainTime"
                  label="Brain Time"
                  unit="hours"
                  color="#8b5cf6"
                  isDark={isDark}
                  isFullscreen={isFullscreen}
                />
              )}
            </FullscreenChart>
          )}
        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="stats-no-data">No data for this date range</div>
      )}
    </div>
  );
}
