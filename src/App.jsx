import { useState, useEffect } from 'react'
import DailyEntry from './components/DailyEntry'
import EntryHistory from './components/EntryHistory'
import Settings from './components/Settings'
import { submitEntry } from './utils/api'
import {
  saveOfflineEntry,
  setupOfflineSync,
  hasPendingEntries,
  getPendingEntries,
  syncPendingEntries
} from './utils/offlineStorage'
import { getSecretToken } from './utils/auth'
import './App.css'

function App() {
  const [view, setView] = useState('entry') // 'entry' | 'history' | 'settings'
  const [lastSaved, setLastSaved] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState(null) // 'syncing' | 'success' | 'error' | null
  const [syncError, setSyncError] = useState(null) // Error message for failed syncs
  const [showDebug, setShowDebug] = useState(false) // Debug panel toggle
  const [debugLogs, setDebugLogs] = useState([]) // Debug log entries

  // Add debug log entry
  const addDebugLog = (type, message, details = null) => {
    const timestamp = new Date().toLocaleTimeString()
    const logEntry = {
      timestamp,
      type, // 'info' | 'error' | 'success'
      message,
      details
    }
    setDebugLogs(prev => [logEntry, ...prev].slice(0, 20)) // Keep last 20 logs
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`, details || '')
  }

  // Check if we already have an entry for today
  useEffect(() => {
    const today = new Date().toDateString()
    const savedDate = localStorage.getItem('lastEntryDate')
    if (savedDate === today) {
      setLastSaved(today)
    }

    // Log initial state
    const token = getSecretToken()
    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'App initialized',
      details: {
        hasToken: !!token,
        tokenLength: token?.length,
        isOnline: navigator.onLine,
        userAgent: navigator.userAgent.substring(0, 100)
      }
    }
    setDebugLogs([logEntry])
    console.log(`[${logEntry.timestamp}] INFO: App initialized`, logEntry.details)
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

        if (result.failed > 0) {
          setSyncStatus('error')
          setSyncError(`Failed to sync ${result.failed} of ${result.synced + result.failed} entries`)
        } else {
          setSyncStatus('success')
          setSyncError(null)
        }

        setTimeout(() => {
          setSyncStatus(null)
          setSyncError(null)
        }, 5000)

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      }
    )

    return cleanup
  }, [])

  const handleManualSync = async () => {
    if (pendingCount === 0) return

    setSyncStatus('syncing')
    try {
      const result = await syncPendingEntries(async (entry) => {
        await submitEntry(entry)
      })

      // Use same callback logic as auto-sync
      if (result.failed > 0) {
        setSyncStatus('error')
        setSyncError(`Failed to sync ${result.failed} entries`)
      } else {
        setSyncStatus('success')
        setSyncError(null)
      }

      setTimeout(() => {
        setSyncStatus(null)
        setSyncError(null)
      }, 5000)

      const entries = await getPendingEntries()
      setPendingCount(entries.length)
    } catch (error) {
      setSyncStatus('error')
      setSyncError(error.message)
      setTimeout(() => {
        setSyncStatus(null)
        setSyncError(null)
      }, 5000)
    }
  }

  const handleSave = async (data) => {
    const today = new Date().toDateString()
    const token = getSecretToken()

    addDebugLog('info', 'Attempting to save entry', {
      isOnline: navigator.onLine,
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 10)}...` : 'none'
    })

    try {
      if (navigator.onLine) {
        // Try to submit online
        addDebugLog('info', 'Submitting entry online...')
        await submitEntry(data)
        addDebugLog('success', 'Entry saved online successfully')
      } else {
        // Save offline
        await saveOfflineEntry(data)
        addDebugLog('info', 'Entry saved offline (device offline)')

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      }

      localStorage.setItem('lastEntryDate', today)
      setLastSaved(today)
    } catch (error) {
      // If online submission fails, fall back to offline
      if (navigator.onLine) {
        addDebugLog('error', 'Online submission failed', {
          error: error.message,
          stack: error.stack
        })
        await saveOfflineEntry(data)
        addDebugLog('info', 'Saved to offline storage as fallback')

        // Update pending count
        const entries = await getPendingEntries()
        setPendingCount(entries.length)
      } else {
        addDebugLog('error', 'Failed to save entry', {
          error: error.message
        })
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
            <button
              className="pending-indicator clickable"
              onClick={handleManualSync}
              disabled={syncStatus === 'syncing'}
              title="Click to retry sync"
            >
              {syncStatus === 'syncing' ? 'Syncing...' : `${pendingCount} pending`}
            </button>
          )}
          {syncStatus === 'success' && (
            <span className="sync-success">Synced!</span>
          )}
          {syncStatus === 'error' && (
            <span className="sync-error" title={syncError}>Sync failed</span>
          )}
          <button
            className="debug-toggle"
            onClick={() => setShowDebug(!showDebug)}
            title="Toggle debug panel"
          >
            {showDebug ? '✕' : '🐛'}
          </button>
        </div>
      </header>

      {showDebug && (
        <div className="debug-panel">
          <div className="debug-header">
            <h3>Debug Panel</h3>
            <button onClick={() => setDebugLogs([])}>Clear</button>
          </div>
          <div className="debug-info">
            <div><strong>Token:</strong> {getSecretToken() ? `${getSecretToken().substring(0, 15)}...` : 'MISSING'}</div>
            <div><strong>Online:</strong> {isOnline ? 'Yes' : 'No'}</div>
            <div><strong>Pending:</strong> {pendingCount}</div>
          </div>
          <div className="debug-logs">
            {debugLogs.length === 0 ? (
              <div className="debug-log-empty">No logs yet. Try saving an entry.</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div key={idx} className={`debug-log debug-log-${log.type}`}>
                  <div className="debug-log-time">{log.timestamp}</div>
                  <div className="debug-log-message">{log.message}</div>
                  {log.details && (
                    <pre className="debug-log-details">{JSON.stringify(log.details, null, 2)}</pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

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
