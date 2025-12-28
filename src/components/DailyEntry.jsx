import { useState, useMemo } from 'react'

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

function DailyEntry({ onSave }) {
  // Date selector - defaults to yesterday
  const [dateFor, setDateFor] = useState(() => getYesterday())

  // Default to 6 hours for feet on ground
  const [hours, setHours] = useState(6)
  // Default to 1 hour for productive brain time
  const [brainTime, setBrainTime] = useState(1)
  const [showOptional, setShowOptional] = useState(false)
  const [comments, setComments] = useState('')
  const [oxaloacetate, setOxaloacetate] = useState('')
  const [exercise, setExercise] = useState('')
  const [modafinil, setModafinil] = useState('none')
  const [willDoECG, setWillDoECG] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState(null)

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

  // Modafinil options for the slider
  const modafinilOptions = ['none', 'quarter', 'half', 'whole']
  const modafinilLabels = { none: 'None', quarter: '¼', half: '½', whole: 'Whole' }

  // Haptic feedback helper - gives a satisfying 'clunk' feel
  // Note: navigator.vibrate works on Android but NOT on iOS Safari
  // For iOS, we use a light impact haptic via the experimental API if available
  const triggerHaptic = () => {
    // Try iOS haptic feedback first (requires user gesture, experimental)
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10)
    }
    // Try experimental haptic feedback API (Chrome on Android)
    if ('vibrate' in navigator) {
      navigator.vibrate(10)
    }
  }

  const handleSliderChange = (e) => {
    // Convert to whole hour increments (0, 1, 2, etc.)
    const value = parseFloat(e.target.value)
    const newValue = Math.round(value)
    if (newValue !== hours) {
      triggerHaptic()
    }
    setHours(newValue)
  }

  const handleBrainTimeChange = (e) => {
    // Convert to whole hour increments (0, 1, 2, etc.)
    const value = parseFloat(e.target.value)
    const newValue = Math.round(value)
    if (newValue !== brainTime) {
      triggerHaptic()
    }
    setBrainTime(newValue)
  }

  const handleModafinilChange = (e) => {
    const index = parseInt(e.target.value)
    const newValue = modafinilOptions[index]
    if (newValue !== modafinil) {
      triggerHaptic()
    }
    setModafinil(newValue)
  }

  const handleSave = async () => {
    setSaving(true)

    const entry = {
      date: new Date().toISOString(),
      dateFor: formatDateForApi(dateFor), // The date being documented FOR
      hours,
      comments: comments || null,
      oxaloacetate: oxaloacetate ? parseFloat(oxaloacetate) : null,
      exercise: exercise ? parseInt(exercise) : null,
      brainTime: brainTime,
      modafinil: modafinil !== 'none' ? modafinil : null,
      willDoECG: willDoECG
    }

    try {
      // Call parent save handler
      await onSave(entry)

      // Show success feedback
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 1500)

      // Trigger haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }

      // Reset optional fields
      setComments('')
      setOxaloacetate('')
      setExercise('')
      setModafinil('none')
      setWillDoECG(false)
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
          <div className="field-group modafinil-group">
            <label>Modafinil</label>
            <div className="modafinil-slider-container">
              <input
                type="range"
                className="modafinil-slider"
                min="0"
                max="3"
                step="1"
                value={modafinilOptions.indexOf(modafinil)}
                onChange={handleModafinilChange}
              />
              <div className="modafinil-labels">
                {modafinilOptions.map((opt, i) => (
                  <span
                    key={opt}
                    className={`modafinil-label ${modafinil === opt ? 'active' : ''}`}
                  >
                    {modafinilLabels[opt]}
                  </span>
                ))}
              </div>
            </div>
          </div>

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

          <div className="field-group">
            <label htmlFor="oxaloacetate">Oxaloacetate (grams)</label>
            <input
              id="oxaloacetate"
              type="number"
              step="0.1"
              min="0"
              value={oxaloacetate}
              onChange={(e) => setOxaloacetate(e.target.value)}
              placeholder="e.g., 2"
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
