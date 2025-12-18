import { useState, useEffect } from 'react'
import DailyEntry from './components/DailyEntry'
import './App.css'

function App() {
  const [view, setView] = useState('entry') // 'entry' | 'history' | 'settings'
  const [lastSaved, setLastSaved] = useState(null)

  // Check if we already have an entry for today
  useEffect(() => {
    const today = new Date().toDateString()
    const savedDate = localStorage.getItem('lastEntryDate')
    if (savedDate === today) {
      setLastSaved(today)
    }
  }, [])

  const handleSave = (data) => {
    // TODO: Replace with actual API call
    console.log('Saving entry:', data)
    const today = new Date().toDateString()
    localStorage.setItem('lastEntryDate', today)
    setLastSaved(today)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>CFS Tracker</h1>
        {lastSaved && (
          <span className="saved-indicator">Saved today</span>
        )}
      </header>

      <main className="app-main">
        {view === 'entry' && (
          <DailyEntry onSave={handleSave} />
        )}
        {view === 'history' && (
          <div className="placeholder">
            <p>History view coming soon</p>
            <button onClick={() => setView('entry')}>Back to Entry</button>
          </div>
        )}
        {view === 'settings' && (
          <div className="placeholder">
            <p>Settings coming soon</p>
            <button onClick={() => setView('entry')}>Back to Entry</button>
          </div>
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
