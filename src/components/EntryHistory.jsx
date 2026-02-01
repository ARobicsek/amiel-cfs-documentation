import { useState, useEffect } from 'react';
import { getEntries } from '../utils/api';
import './EntryHistory.css';

/**
 * EntryHistory component
 *
 * Displays the last 10 days of data from Google Sheets.
 * Shows daily entries and ECG data merged by date.
 * ECG data is attributed to the date it was collected.
 */
export default function EntryHistory() {
  const [entries, setEntries] = useState([]);
  const [medications, setMedications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchEntries() {
      try {
        setLoading(true);
        setError(null);
        const data = await getEntries(10);
        setEntries(data.entries || []);
        setMedications(data.medications || []);
      } catch (err) {
        console.error('Failed to fetch entries:', err);
        setError(err.message || 'Failed to load entries');
      } finally {
        setLoading(false);
      }
    }

    fetchEntries();
  }, []);

  if (loading) {
    return (
      <div className="entry-history">
        <h2>Recent Entries</h2>
        <p className="loading">Loading your history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="entry-history">
        <h2>Recent Entries</h2>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="entry-history">
        <h2>Recent Entries</h2>
        <p className="empty">No entries yet. Submit your first entry above!</p>
      </div>
    );
  }

  return (
    <div className="entry-history">
      <h2>Recent Entries</h2>
      <div className="entries-list">
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.normalizedDate || index}
            entry={entry}
            previousEntry={entries[index + 1] || null}
            medications={medications}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual entry card component
 */
function EntryCard({ entry, previousEntry, medications }) {
  const hasAnyData = entry.hasEntryData || entry.hasECGData;

  // Collect all medications that were taken (not "Off")
  const medsTaken = [];

  medications.forEach(med => {
    const value = entry[med.key];
    if (value && value !== 'Off') {
      // Check if medication changed from previous day
      const prevValue = previousEntry ? previousEntry[med.key] : null;
      const isChanged = prevValue !== value;

      medsTaken.push({
        label: med.label,
        value: value,
        changed: isChanged
      });
    }
  });

  return (
    <div className={`entry-card ${!entry.hasEntryData && entry.hasECGData ? 'ecg-only' : ''}`}>
      {/* Header with date */}
      <div className="entry-header">
        <span className="entry-date">{formatDate(entry.normalizedDate || entry.date)}</span>
      </div>

      {/* Row 1: Daily entry metrics */}
      {entry.hasEntryData && (
        <div className="entry-main-metrics">
          <div className="main-metric">
            <span className="metric-value">{entry.hours || 0}</span>
            <span className="metric-label">hrs upright</span>
          </div>
          <div className="main-metric">
            <span className="metric-value">{entry.brainTime ?? 0}</span>
            <span className="metric-label">hrs brain</span>
          </div>
        </div>
      )}

      {/* Row 2: ECG metrics (side by side) */}
      {entry.hasECGData && (
        <div className="entry-ecg-metrics">
          {entry.ecgHR !== null && (
            <div className="main-metric ecg-metric">
              <span className="metric-value">{Math.round(entry.ecgHR)}</span>
              <span className="metric-label">HR bpm</span>
            </div>
          )}
          {entry.ecgRSRatio !== null && (
            <div className="main-metric ecg-metric">
              <span className="metric-value">{entry.ecgRSRatio.toFixed(2)}</span>
              <span className="metric-label">R/S ratio</span>
            </div>
          )}
        </div>
      )}

      {/* Secondary details */}
      {(entry.comments || medsTaken.length > 0 || entry.exercise || entry.willDoECG) && (
        <div className="entry-details">
          {entry.comments && (
            <p className="entry-comments">{entry.comments}</p>
          )}
          <div className="entry-metrics">
            {medsTaken.length > 0 && (
              <div className="medications-list">
                <span className="metric-label">Medications:</span>
                {medsTaken.map((med, idx) => (
                  <span
                    key={idx}
                    className={`metric ${med.changed ? 'med-changed' : ''}`}
                  >
                    {med.label}: {med.value}
                  </span>
                ))}
              </div>
            )}
            {entry.exercise && (
              <span className="metric">
                {entry.exercise} min exercise
              </span>
            )}
            {entry.willDoECG && (
              <span className="metric ecg-planned">
                ECG planned
              </span>
            )}
          </div>
        </div>
      )}

      {/* Row 3: Health Data (Auto-Imported) */}
      {entry.hasHealthData && entry.health && (
        <div className="entry-health-metrics">
          <div className="health-section-title">Health Data (Auto)</div>
          <div className="health-grid">

            {/* Heart Rate */}
            {(entry.health.avgHR > 0) && (
              <div className="health-item">
                <span className="health-icon">❤️</span>
                <div className="health-details">
                  <span className="health-value">{Math.round(entry.health.avgHR)} <small>bpm</small></span>
                  <span className="health-sub">Avg HR</span>
                </div>
              </div>
            )}

            {/* HRV */}
            {(entry.health.hrv > 0) && (
              <div className="health-item">
                <span className="health-icon">📊</span>
                <div className="health-details">
                  <span className="health-value">{Math.round(entry.health.hrv)} <small>ms</small></span>
                  <span className="health-sub">HRV</span>
                </div>
              </div>
            )}

            {/* Steps */}
            {(entry.health.steps > 0) && (
              <div className="health-item">
                <span className="health-icon">👣</span>
                <div className="health-details">
                  <span className="health-value">{entry.health.steps.toLocaleString()}</span>
                  <span className="health-sub">Steps</span>
                </div>
              </div>
            )}

            {/* Sleep */}
            {(entry.health.sleepMinutes > 0) && (
              <div className="health-item">
                <span className="health-icon">😴</span>
                <div className="health-details">
                  <span className="health-value">{formatSleepMinutes(entry.health.sleepMinutes)}</span>
                  <span className="health-sub">Sleep</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ECG-only indicator */}
      {!entry.hasEntryData && entry.hasECGData && (
        <div className="ecg-only-notice">ECG data only</div>
      )}
    </div>
  );
}

/**
 * Format sleep duration in minutes to "Xh Ym" display string.
 */
function formatSleepMinutes(minutes) {
  if (!minutes || minutes <= 0) return '--';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format date string for display
 * Handles various date formats: "2024-12-17", "12/17/2025", "12/17/2025, 23:02:15", ISO timestamps
 */
function formatDate(dateStr) {
  // Parse the date - handle different formats
  let date;

  if (dateStr.includes('T')) {
    // ISO timestamp like "2025-12-18T03:59:56.649Z"
    date = new Date(dateStr);
  } else if (dateStr.includes(',')) {
    // Formatted timestamp like "12/17/2025, 23:02:15"
    date = new Date(dateStr);
  } else if (dateStr.includes('/')) {
    // MM/DD/YYYY format like "12/17/2025"
    date = new Date(dateStr);
  } else {
    // Simple date string like "2024-12-17" (YYYY-MM-DD) - add time to avoid timezone issues
    date = new Date(dateStr + 'T12:00:00');
  }

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if it's today or yesterday
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  // Otherwise show "Dec 17"
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
