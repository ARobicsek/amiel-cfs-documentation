import { useState, useMemo, useEffect } from 'react'
import { getEntries } from '../utils/api'

// Helper to get a date at midnight in local time
function getLocalMidnight(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

// Get yesterday's date at midnight
function getYesterday() {
  const today = getLocalMidnight(new Date())
  today.setDate(today.getDate() - 1)
  return today
}

// Format date for display: "Thursday, January 1, 2025"
function formatDateFull(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

// Format date for API: "MM/DD/YYYY" in Eastern Time style
function formatDateForApi(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

// Get relative label: "today", "yesterday", "2 days ago", etc.
function getRelativeLabel(date) {
  const today = getLocalMidnight(new Date())
  const target = getLocalMidnight(date)
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  return `${diffDays} days ago`
}

// Default configuration for original medications (fallback for defaults)
// New medications added dynamically will default to OFF with no default dose
const MED_DEFAULTS = {
  'amitriptyline': { defaultDose: '', defaultOn: true },
  'dayquil': { defaultDose: '', defaultOn: false },
  'dextromethorphan': { defaultDose: '', defaultOn: false },
  'melatonin': { defaultDose: '', defaultOn: true },
  'metoprolol': { defaultDose: '', defaultOn: true },
  'modafinilnew': { defaultDose: '1 pill', defaultOn: true },
  'nyquil': { defaultDose: '', defaultOn: false },
  'oxaloacetatenew': { defaultDose: '1g', defaultOn: false },
  'senna': { defaultDose: '', defaultOn: true },
  'tirzepatide': { defaultDose: '', defaultOn: false },
  'venlafaxine': { defaultDose: '', defaultOn: true },
  'vitamind': { defaultDose: '', defaultOn: true }
}

// Get default values for a medication
function getMedDefaults(key) {
  const defaults = MED_DEFAULTS[key]
  if (defaults) {
    return defaults
  }
  // New medications default to OFF with no dose
  return { defaultDose: '', defaultOn: false }
}

function DailyEntry({ onSave }) {
  // Date selector - defaults to yesterday
  const [dateFor, setDateFor] = useState(() => getYesterday())

  // Default to 6 hours for feet on ground
  const [hours, setHours] = useState(6)
  // Default to 1 hour for productive brain time
  const [brainTime, setBrainTime] = useState(1)
  const [showOptional, setShowOptional] = useState(false)
  const [comments, setComments] = useState('')
  const [exercise, setExercise] = useState('')
  const [willDoECG, setWillDoECG] = useState(false)

  // Dynamic medication configuration from API
  const [medConfig, setMedConfig] = useState([])

  // Medications State - will be populated after medConfig loads
  const [meds, setMeds] = useState({})

  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showSyncECG, setShowSyncECG] = useState(false)
  const [error, setError] = useState(null)

  // Fetch history and medication config to populate defaults
  useEffect(() => {
    async function fetchDefaults() {
      try {
        const result = await getEntries(30)
        if (!result || !result.entries) return

        const entries = result.entries
        const dateForStr = formatDateForApi(dateFor)

        // Get medications from API response (or use empty array if not present)
        const apiMedications = result.medications || []
        setMedConfig(apiMedications)

        // Check if we have an entry for the selected date
        const currentEntry = entries.find(e => e.date === dateForStr)

        // Helper to find last valid dose in history
        const findLastDose = (key, entriesToSearch) => {
          const entry = entriesToSearch.find(e => e[key] && e[key] !== 'Off')
          return entry ? entry[key] : getMedDefaults(key).defaultDose
        }

        const newMeds = {}

        // Process each medication from the API
        apiMedications.forEach(med => {
          const key = med.key
          const defaults = getMedDefaults(key)

          if (currentEntry && currentEntry[key]) {
            // We have a saved entry for this date
            if (currentEntry[key] === 'Off') {
              newMeds[key] = {
                status: 'off',
                dose: findLastDose(key, entries.filter(e => e.date !== dateForStr))
              }
            } else {
              newMeds[key] = {
                status: 'on',
                dose: currentEntry[key]
              }
            }
          } else {
            // No entry for this date, look at history
            // Convert dateFor to YYYY-MM-DD
            const d = new Date(dateFor)
            const yyyy = d.getFullYear()
            const mm = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            const targetDateISO = `${yyyy}-${mm}-${dd}`

            const priorEntries = entries.filter(e => e.normalizedDate < targetDateISO)

            // Find most recent prior entry for this med
            const lastEntry = priorEntries.find(e => e[key])

            if (lastEntry) {
              if (lastEntry[key] === 'Off') {
                newMeds[key] = {
                  status: 'off',
                  dose: findLastDose(key, priorEntries)
                }
              } else {
                newMeds[key] = {
                  status: 'on',
                  dose: lastEntry[key]
                }
              }
            } else {
              // No history, use default
              newMeds[key] = {
                dose: defaults.defaultDose,
                status: defaults.defaultOn ? 'on' : 'off'
              }
            }
          }
        })

        setMeds(newMeds)

        // Also populate other fields if editing existing entry
        if (currentEntry) {
          setHours(currentEntry.hours ?? 6)
          setBrainTime(currentEntry.brainTime ?? 1)
          setComments(currentEntry.comments || '')
          setExercise(currentEntry.exercise || '')
          setWillDoECG(currentEntry.willDoECG || false)
        } else {
          // Reset to defaults if no entry
          setHours(6)
          setBrainTime(1)
          setComments('')
          setExercise('')
          setWillDoECG(false)
        }

      } catch (err) {
        console.error('Failed to fetch history for defaults:', err)
      }
    }

    fetchDefaults()
  }, [dateFor]) // Re-run when date changes

  // Calculate date bounds (5 days ago through today)
  const dateBounds = useMemo(() => {
    const today = getLocalMidnight(new Date())
    const minDate = getLocalMidnight(new Date())
    minDate.setDate(minDate.getDate() - 5)
    return { min: minDate, max: today }
  }, [])

  // Can navigate left/right?
  const canGoBack = dateFor > dateBounds.min
  const canGoForward = dateFor < dateBounds.max

  // Navigate dates
  const goToPreviousDay = () => {
    if (canGoBack) {
      const newDate = new Date(dateFor)
      newDate.setDate(newDate.getDate() - 1)
      setDateFor(newDate)
      triggerHaptic()
    }
  }

  const goToNextDay = () => {
    if (canGoForward) {
      const newDate = new Date(dateFor)
      newDate.setDate(newDate.getDate() + 1)
      setDateFor(newDate)
      triggerHaptic()
    }
  }

  // Haptic feedback helper
  const triggerHaptic = () => {
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10)
    }
    if ('vibrate' in navigator) {
      navigator.vibrate(10)
    }
  }

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value)
    const newValue = Math.round(value)
    if (newValue !== hours) {
      triggerHaptic()
    }
    setHours(newValue)
  }

  const handleBrainTimeChange = (e) => {
    const value = parseFloat(e.target.value)
    const newValue = Math.round(value)
    if (newValue !== brainTime) {
      triggerHaptic()
    }
    setBrainTime(newValue)
  }

  const handleMedChange = (key, field, value) => {
    setMeds(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }))
  }

  const handleMedToggle = (key) => {
    triggerHaptic()
    setMeds(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        status: prev[key].status === 'on' ? 'off' : 'on'
      }
    }))
  }

  const handleSave = async () => {
    setSaving(true)

    // Prepare meds for API
    const medsPayload = {}
    Object.keys(meds).forEach(key => {
      const med = meds[key]
      // If On, send dose. If Off, send "Off".
      medsPayload[key] = med.status === 'on' ? med.dose : 'Off'
    })

    const entry = {
      date: new Date().toISOString(),
      dateFor: formatDateForApi(dateFor),
      hours,
      comments: comments || null,
      exercise: exercise ? parseInt(exercise) : null,
      brainTime: brainTime,
      willDoECG: willDoECG,
      ...medsPayload
    }

    try {
      await onSave(entry)

      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 1500)

      setShowSyncECG(true)
      setTimeout(() => setShowSyncECG(false), 10000)

      if (navigator.vibrate) {
        navigator.vibrate(50)
      }

      // Reset UI state triggers?
      // Actually, we usually stay on the same page or reset defaults.
      // But preserving the entered data on screen is better UX for verification.
      setShowOptional(false)
    } catch (error) {
      console.error('Failed to save:', error)
      setError(error.message || 'Failed to save. Please try again.')
      setTimeout(() => setError(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="daily-entry">
      {showSuccess && (
        <div className="success-feedback">Saved!</div>
      )}
      {showSyncECG && (
        <a
          href="com.HealthExport://"
          className="sync-ecg-button"
          onClick={() => setShowSyncECG(false)}
        >
          Sync ECG Data
        </a>
      )}
      {error && (
        <div className="error-feedback">{error}</div>
      )}

      {/* Date Selector */}
      <div className="date-selector">
        <button
          className="date-nav-btn"
          onClick={goToPreviousDay}
          disabled={!canGoBack}
          aria-label="Previous day"
        >
          ‹
        </button>
        <div className="date-display">
          <span className="date-full">{formatDateFull(dateFor)}</span>
          <span className="date-relative">Logging for {getRelativeLabel(dateFor)}</span>
        </div>
        <button
          className="date-nav-btn"
          onClick={goToNextDay}
          disabled={!canGoForward}
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      <div className="hours-section">
        <span className="hours-label">Feet on the ground</span>
        <div className="hours-display">
          {hours}
          <span className="hours-unit">hrs</span>
        </div>
        <input
          type="range"
          className="hours-slider"
          min="0"
          max="24"
          step="1"
          value={hours}
          onChange={handleSliderChange}
        />
      </div>

      <div className="hours-section brain-time-section">
        <span className="hours-label">Productive brain time</span>
        <div className="hours-display">
          {brainTime}
          <span className="hours-unit">hrs</span>
        </div>
        <input
          type="range"
          className="hours-slider"
          min="0"
          max="24"
          step="1"
          value={brainTime}
          onChange={handleBrainTimeChange}
        />
      </div>

      <button
        className="optional-toggle"
        onClick={() => setShowOptional(!showOptional)}
      >
        {showOptional ? '− Hide details' : '+ Add details'}
      </button>

      {showOptional && (
        <div className="optional-fields">
          
          <div className="field-group ecg-group">
            <label>ECG Today</label>
            <button
              type="button"
              className={`ecg-toggle-btn ${willDoECG ? 'active' : ''}`}
              onClick={() => {
                setWillDoECG(!willDoECG)
                triggerHaptic()
              }}
            >
              {willDoECG ? 'Yes, will do ECG' : 'Tap if doing ECG'}
            </button>
          </div>

          <div className="medications-section">
            <h3 className="section-title">Medications</h3>
            {medConfig.length === 0 ? (
              <p className="loading-text">Loading medications...</p>
            ) : (
              medConfig.map(med => {
                const state = meds[med.key] || { status: 'off', dose: '' }
                const isOn = state.status === 'on'

                return (
                  <div key={med.key} className={`med-card ${isOn ? 'on' : 'off'}`}>
                    <div className="med-header">
                      <span className="med-name">{med.label}</span>
                      <button
                        className={`med-toggle ${isOn ? 'on' : 'off'}`}
                        onClick={() => handleMedToggle(med.key)}
                        aria-label={`Toggle ${med.label} ${isOn ? 'off' : 'on'}`}
                      >
                        {isOn ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="med-body">
                      <input
                        type="text"
                        className="med-dose-input"
                        value={state.dose}
                        onChange={(e) => handleMedChange(med.key, 'dose', e.target.value)}
                        placeholder="Enter dose..."
                        disabled={!isOn}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="field-group">
            <label htmlFor="comments">Comments</label>
            <textarea
              id="comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Amsy - say stuff."
            />
          </div>

          <div className="field-group">
            <label htmlFor="exercise">Exercise (minutes)</label>
            <input
              id="exercise"
              type="number"
              min="0"
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
              placeholder="e.g., 15"
            />
          </div>

        </div>
      )}

      <button
        className="save-button"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}

export default DailyEntry