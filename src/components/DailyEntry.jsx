import { useState } from 'react'

function DailyEntry({ onSave }) {
  // Default to 6 hours as specified
  const [hours, setHours] = useState(6)
  const [showOptional, setShowOptional] = useState(false)
  const [comments, setComments] = useState('')
  const [oxaloacetate, setOxaloacetate] = useState('')
  const [exercise, setExercise] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const handleSliderChange = (e) => {
    // Convert to half-hour increments (0, 0.5, 1, 1.5, etc.)
    const value = parseFloat(e.target.value)
    setHours(Math.round(value * 2) / 2)
  }

  const handleSave = async () => {
    setSaving(true)

    const entry = {
      date: new Date().toISOString(),
      hours,
      comments: comments || null,
      oxaloacetate: oxaloacetate ? parseFloat(oxaloacetate) : null,
      exercise: exercise ? parseInt(exercise) : null
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
      setShowOptional(false)
    } catch (error) {
      console.error('Failed to save:', error)
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="daily-entry">
      {showSuccess && (
        <div className="success-feedback">Saved!</div>
      )}

      <div className="hours-section">
        <span className="hours-label">Hours feet on ground</span>
        <div className="hours-display">
          {hours}
          <span className="hours-unit">hrs</span>
        </div>
        <input
          type="range"
          className="hours-slider"
          min="0"
          max="24"
          step="0.5"
          value={hours}
          onChange={handleSliderChange}
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
            <label htmlFor="oxaloacetate">Oxaloacetate (grams)</label>
            <input
              id="oxaloacetate"
              type="number"
              step="0.1"
              min="0"
              value={oxaloacetate}
              onChange={(e) => setOxaloacetate(e.target.value)}
              placeholder="e.g., 100"
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
