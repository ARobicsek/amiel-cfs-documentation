/**
 * Utility for identifying days when the Apple Watch / phone is not worn.
 * Currently: Friday evening through Saturday (no device from Fri sunset to Sat sunset).
 * This makes device-derived data (HR, HRV, Steps, Sleep) less reliable on Fri & Sat.
 */

/**
 * Check if a date string falls on Friday or Saturday.
 * @param {string} dateStr - Date in YYYY-MM-DD, MM/DD/YYYY, or ISO format
 * @returns {boolean}
 */
export function isNoWatchDay(dateStr) {
  if (!dateStr) return false;

  let date;
  if (dateStr.includes('T')) {
    date = new Date(dateStr);
  } else if (dateStr.includes('/')) {
    date = new Date(dateStr);
  } else {
    // YYYY-MM-DD — add noon to avoid timezone edge cases
    date = new Date(dateStr + 'T12:00:00');
  }

  if (isNaN(date.getTime())) return false;

  const day = date.getDay(); // 0=Sun, 5=Fri, 6=Sat
  return day === 5 || day === 6;
}

/**
 * Grey color constants for no-watch days, used across all chart components.
 */
export const NO_WATCH_GREY = {
  // For chart elements (points, bars, lines)
  light: 'rgba(156, 163, 175, 0.5)',   // gray-400 @ 50%
  dark:  'rgba(107, 114, 128, 0.5)',    // gray-500 @ 50%
  // For chart borders / lines
  borderLight: 'rgba(156, 163, 175, 0.7)',
  borderDark:  'rgba(107, 114, 128, 0.7)',
  // Solid text color
  textLight: '#9ca3af',  // gray-400
  textDark:  '#6b7280',  // gray-500
};
