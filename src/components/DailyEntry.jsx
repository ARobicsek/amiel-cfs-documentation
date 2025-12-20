import { useState } from 'react'

function DailyEntry({ onSave }) {
  // Default to 6 hours for feet on ground
  const [hours, setHours] = useState(6)
  // Default to 1 hour for productive brain time
  const [brainTime, setBrainTime] = useState(1)
  const [showOptional, setShowOptional] = useState(false)
  const [comments, setComments] = useState('')
  const [oxaloacetate, setOxaloacetate] = useState('')
  const [exercise, setExercise] = useState('')
  const [modafinil, setModafinil] = useState('none')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState(null)

  // Modafinil options for the slider
  const modafinilOptions = ['none', 'quarter', 'half', 'whole']
  const modafinilLabels = { none: 'None', quarter: '¼', half: '½', whole: 'Whole' }

  // Haptic feedback helper - gives a satisfying 'clunk' feel
  const triggerHaptic = () => {
    if (navigator.vibrate) {
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
      hours,
      comments: comments || null,
      oxaloacetate: oxaloacetate ? parseFloat(oxaloacetate) : null,
      exercise: exercise ? parseInt(exercise) : null,
      brainTime: brainTime,
      modafinil: modafinil !== 'none' ? modafinil : null
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

          <div className="field-group">
            <label htmlFor="comments">Comments</label>
            <textarea
              id="comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="How are you feeling?"
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
