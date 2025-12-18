import { useState, useEffect } from 'react'
import DailyEntry from './components/DailyEntry'
import EntryHistory from './components/EntryHistory'
import Settings from './components/Settings'
import { submitEntry } from './utils/api'
import {
  saveOfflineEntry,
  setupOfflineSync,
  hasPendingEntries,
  getPendingEntries
} from './utils/offlineStorage'
import './App.css'

function App() {
  const [view, setView] = useState('entry') // 'entry' | 'history' | 'settings'
  const [lastSaved, setLastSaved] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState(null) // 'syncing' | 'success' | 'error' | null

  // Check if we already have an entry for today
  useEffect(() => {
    const today = new Date().toDateString()
    const savedDate = localStorage.getItem('lastEntryDate')
    if (savedDate === today) {
      setLastSaved(today)
    }
  }, [])

  // Track online/offline status and pending entries count
  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    const updatePendingCount = async () => {
      const entries = await getPendingEntries()
      setPendingCount(entries.length)
    }

    // Set initial status
    updatePendingCount()

    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  // Set up offline sync
  useEffect(() => {
    const cleanup = setupOfflineSync(
      async (entry) => {
        // Submit function for sync
        await submitEntry(entry)
      },
      async (result) => {
        // Sync complete callback
        console.log('Sync complete:', result)
        setSyncStatus('success')
        setTimeout(() => setSyncStatus(null), 3000)

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      }
    )

    return cleanup
  }, [])

  const handleSave = async (data) => {
    const today = new Date().toDateString()

    try {
      if (navigator.onLine) {
        // Try to submit online
        await submitEntry(data)
        console.log('Entry saved online')
      } else {
        // Save offline
        await saveOfflineEntry(data)
        console.log('Entry saved offline')

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      }

      localStorage.setItem('lastEntryDate', today)
      setLastSaved(today)
    } catch (error) {
      // If online submission fails, fall back to offline
      if (navigator.onLine) {
        console.log('Online submission failed, saving offline:', error)
        await saveOfflineEntry(data)

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      } else {
        throw error
      }
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>CFS Tracker</h1>
        <div className="status-indicators">
          {lastSaved && (
            <span className="saved-indicator">Saved today</span>
          )}
          {!isOnline && (
            <span className="offline-indicator">Offline</span>
          )}
          {pendingCount > 0 && (
            <span className="pending-indicator">
              {pendingCount} pending
            </span>
          )}
          {syncStatus === 'success' && (
            <span className="sync-success">Synced!</span>
          )}
        </div>
      </header>

      <main className="app-main">
        {view === 'entry' && (
          <DailyEntry onSave={handleSave} />
        )}
        {view === 'history' && (
          <EntryHistory />
        )}
        {view === 'settings' && (
          <Settings />
        )}
      </main>

      <nav className="app-nav">
        <button
          className={view === 'entry' ? 'active' : ''}
          onClick={() => setView('entry')}
        >
          Today
        </button>
        <button
          className={view === 'history' ? 'active' : ''}
          onClick={() => setView('history')}
        >
          History
        </button>
        <button
          className={view === 'settings' ? 'active' : ''}
          onClick={() => setView('settings')}
        >
          Settings
        </button>
      </nav>
    </div>
  )
}

export default App
