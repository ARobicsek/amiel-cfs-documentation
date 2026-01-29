import { useState, useSyncExternalStore } from 'react';
import SingleDayView from './SingleDayView';
import './StatsTab.css';

// Dark mode detection using useSyncExternalStore (avoids setState-in-effect lint error)
const darkModeQuery = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function subscribeToDarkMode(callback) {
  darkModeQuery?.addEventListener('change', callback);
  return () => darkModeQuery?.removeEventListener('change', callback);
}

function getDarkModeSnapshot() {
  return darkModeQuery?.matches ?? false;
}

/**
 * Top-level Stats tab with Single Day / Multi Day toggle.
 * Multi Day view will be added in Phase C/D.
 */
export default function StatsTab() {
  const [activeView, setActiveView] = useState('single'); // 'single' | 'multi'
  const isDark = useSyncExternalStore(subscribeToDarkMode, getDarkModeSnapshot);

  return (
    <div className="stats-tab">
      {/* View Toggle */}
      <div className="stats-toggle">
        <button
          className={`stats-toggle-btn ${activeView === 'single' ? 'active' : ''}`}
          onClick={() => setActiveView('single')}
        >
          Single Day
        </button>
        <button
          className={`stats-toggle-btn ${activeView === 'multi' ? 'active' : ''}`}
          onClick={() => setActiveView('multi')}
        >
          Multi Day
        </button>
      </div>

      {/* View Content */}
      {activeView === 'single' && (
        <SingleDayView isDark={isDark} />
      )}
      {activeView === 'multi' && (
        <div className="stats-coming-soon">
          Multi Day view coming soon
        </div>
      )}
    </div>
  );
}
