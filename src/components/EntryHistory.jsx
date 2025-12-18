import { useState, useEffect } from 'react';
import { getEntries } from '../utils/api';
import './EntryHistory.css';

/**
 * EntryHistory component
 *
 * Displays the last 7 days of daily entries from Google Sheets.
 * Shows hours logged and optional fields (comments, oxaloacetate, exercise).
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
        const data = await getEntries(7);
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
          <div key={index} className="entry-card">
            <div className="entry-header">
              <span className="entry-date">{formatDate(entry.date)}</span>
              <span className="entry-hours">{entry.hours}h</span>
            </div>
            {(entry.comments || entry.oxaloacetate || entry.exercise) && (
              <div className="entry-details">
                {entry.comments && (
                  <p className="entry-comments">{entry.comments}</p>
                )}
                <div className="entry-metrics">
                  {entry.oxaloacetate && (
                    <span className="metric">
                      💊 {entry.oxaloacetate}mg
                    </span>
                  )}
                  {entry.exercise && (
                    <span className="metric">
                      🏃 {entry.exercise}min
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
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
