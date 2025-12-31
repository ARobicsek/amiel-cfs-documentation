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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchEntries() {
      try {
        setLoading(true);
        setError(null);
        const data = await getEntries(10);
        setEntries(data.entries || []);
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
          <EntryCard key={entry.normalizedDate || index} entry={entry} />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual entry card component
 */
function EntryCard({ entry }) {
  const hasAnyData = entry.hasEntryData || entry.hasECGData;

  // Collect all medications that were taken (not "Off")
  const medsTaken = [];
  const medFields = [
    { key: 'amitriptyline', label: 'Amitriptyline' },
    { key: 'dayquil', label: 'DayQuil' },
    { key: 'dextromethorphan', label: 'Dextromethorphan' },
    { key: 'melatonin', label: 'Melatonin' },
    { key: 'metoprolol', label: 'Metoprolol' },
    { key: 'modafinilNew', label: 'Modafinil' },
    { key: 'nyquil', label: 'NyQuil' },
    { key: 'oxaloacetateNew', label: 'Oxaloacetate' },
    { key: 'senna', label: 'Senna' },
    { key: 'tirzepatide', label: 'Tirzepatide' },
    { key: 'venlafaxine', label: 'Venlafaxine' },
    { key: 'vitaminD', label: 'Vitamin D' }
  ];

  medFields.forEach(med => {
    const value = entry[med.key];
    if (value && value !== 'Off') {
      medsTaken.push(`${med.label}: ${value}`);
    }
  });

  // Debug: Show medication data in UI for recent entries
  const isRecentEntry = entry.normalizedDate === '2025-12-31' || entry.normalizedDate === '2025-12-30' || entry.normalizedDate === '2025-12-29';

  return (
    <div className={`entry-card ${!entry.hasEntryData && entry.hasECGData ? 'ecg-only' : ''}`}>
      {/* Header with date */}
      <div className="entry-header">
        <span className="entry-date">{formatDate(entry.normalizedDate || entry.date)}</span>
      </div>

      {/* DEBUG: Show raw med data for recent entries */}
      {isRecentEntry && (
        <div style={{fontSize: '10px', background: '#ffeb3b', padding: '5px', margin: '5px 0'}}>
          <strong>DEBUG {entry.normalizedDate}:</strong><br/>
          vitD: {entry.vitaminD || 'null'}, venla: {entry.venlafaxine || 'null'},
          modaf: {entry.modafinilNew || 'null'}, senna: {entry.senna || 'null'},
          melat: {entry.melatonin || 'null'}, metop: {entry.metoprolol || 'null'}<br/>
          medsTaken.length: {medsTaken.length}
        </div>
      )}

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
                  <span key={idx} className="metric">
                    {med}
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

      {/* ECG-only indicator */}
      {!entry.hasEntryData && entry.hasECGData && (
        <div className="ecg-only-notice">ECG data only</div>
      )}
    </div>
  );
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
