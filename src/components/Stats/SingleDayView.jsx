import { useState, useEffect, useCallback } from 'react';
import CombinedChart from './charts/CombinedChart';
import FullscreenChart from './FullscreenChart';
import { processSingleDayData, formatMinutes } from '../../utils/statsDataService';
import { getSecretToken } from '../../utils/auth';

/**
 * Single Day Stats view.
 * Shows HR scatter plot + activity bar + summary stats for one day.
 *
 * Props:
 *   isDark: boolean - current theme
 */
export default function SingleDayView({ isDark }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return formatDateISO(now);
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (dateStr) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const token = getSecretToken();
      const res = await fetch(`/api/get-hourly-data?date=${dateStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const json = await res.json();

      if (json.rows.length === 0) {
        setData({ empty: true, summary: null });
      } else {
        const processed = processSingleDayData(json.rows, dateStr);
        setData(processed);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedDate);
  }, [selectedDate, fetchData]);

  const navigateDay = (delta) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(formatDateISO(d));
  };

  const isToday = selectedDate === formatDateISO(new Date());
  const displayDate = formatDisplayDate(selectedDate);

  return (
    <div className="single-day-view">
      {/* Date Navigator */}
      <div className="stats-date-nav">
        <button
          className="stats-nav-btn"
          onClick={() => navigateDay(-1)}
        >
          &#9664;
        </button>
        <div className="stats-date-display">
          <span className="stats-date-text">{displayDate}</span>
          {isToday && <span className="stats-date-today">Today</span>}
        </div>
        <button
          className="stats-nav-btn"
          onClick={() => navigateDay(1)}
          disabled={isToday}
        >
          &#9654;
        </button>
      </div>

      {/* Content */}
      {loading && (
        <div className="stats-loading">Loading data...</div>
      )}

      {error && (
        <div className="stats-error">Error: {error}</div>
      )}

      {!loading && !error && data?.empty && (
        <div className="stats-no-data">No data for this day</div>
      )}

      {!loading && !error && data && !data.empty && (
        <>
          {/* Combined Chart (Heart Rate + Activity) */}
          <FullscreenChart title="Heart Rate & Activity">
            <CombinedChart
              hrPoints={data.hrPoints}
              activityMinutes={data.activityMinutes}
              isDark={isDark}
            />
          </FullscreenChart>

          {/* Summary Stats */}
          <div className="stats-summary">
            <div className="stats-summary-item">
              <span className="stats-summary-label">Sleep</span>
              <span className="stats-summary-value">{formatMinutes(data.summary.totalSleepMin)}</span>
            </div>
            <div className="stats-summary-item">
              <span className="stats-summary-label">Steps</span>
              <span className="stats-summary-value">
                {data.summary.totalSteps != null ? data.summary.totalSteps.toLocaleString() : '--'}
              </span>
            </div>
            <div className="stats-summary-item">
              <span className="stats-summary-label">Avg HR</span>
              <span className="stats-summary-value">
                {data.summary.avgHR != null ? `${data.summary.avgHR} bpm` : '--'}
              </span>
            </div>
            <div className="stats-summary-item">
              <span className="stats-summary-label">HRV</span>
              <span className="stats-summary-value">
                {data.summary.avgHRV != null ? `${data.summary.avgHRV} ms` : '--'}
              </span>
            </div>
            <div className="stats-summary-item stats-summary-detail">
              <span className="stats-summary-label">HR Readings</span>
              <span className="stats-summary-value">{data.summary.hrCount}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Helper: format Date to YYYY-MM-DD
function formatDateISO(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: format YYYY-MM-DD to "Wed, January 28"
function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  });
}
