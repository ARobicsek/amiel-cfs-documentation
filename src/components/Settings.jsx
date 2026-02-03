import { useState, useEffect } from 'react';
import {
  isPushSupported,
  getPermissionStatus,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribed
} from '../utils/pushNotification.js';
import { getAuthToken } from '../utils/auth.js';
import {
  getEntries,
  addMedication,
  getNotificationSettings,
  saveNotificationSettings,
  sendNotification
} from '../utils/api.js';
import './Settings.css';

export default function Settings() {
  const [pushSupported, setPushSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [manualAlertMessage, setManualAlertMessage] = useState('');
  const [includeJoke, setIncludeJoke] = useState(true);

  // Auth token settings
  const [authToken, setAuthToken] = useState('');
  const [tokenMessage, setTokenMessage] = useState({ type: '', text: '' });

  // Reminder schedule settings
  const [reminderSettings, setReminderSettings] = useState({
    firstReminderTime: '20:00',
    repeatInterval: 60,
    stopAfterLog: true
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState({ type: '', text: '' });

  // Medication management
  const [medications, setMedications] = useState([]);
  const [medsLoading, setMedsLoading] = useState(true);
  const [newMedName, setNewMedName] = useState('');
  const [medPreview, setMedPreview] = useState(null);
  const [medAdding, setMedAdding] = useState(false);
  const [medMessage, setMedMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    checkPushStatus();
    fetchReminderSettings();
    fetchMedications();

    // Load current auth token
    const currentToken = getAuthToken();
    setAuthToken(currentToken || '');
  }, []);

  async function fetchMedications() {
    try {
      setMedsLoading(true);
      const data = await getEntries(1); // Just need medications metadata
      setMedications(data.medications || []);
    } catch (err) {
      console.error('Failed to fetch medications:', err);
    } finally {
      setMedsLoading(false);
    }
  }

  // Format medication name for preview (capitalize each word)
  function formatMedName(name) {
    if (!name) return '';
    return name
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  function handleMedPreview() {
    const formatted = formatMedName(newMedName);
    if (formatted) {
      setMedPreview(formatted);
      setMedMessage({ type: '', text: '' });
    }
  }

  function handleMedCancel() {
    setMedPreview(null);
    setNewMedName('');
    setMedMessage({ type: '', text: '' });
  }

  async function handleMedAdd() {
    if (!medPreview) return;

    const token = getAuthToken();
    if (!token) {
      setMedMessage({
        type: 'error',
        text: 'Please enter and save your Authentication Token first.'
      });
      return;
    }

    setMedAdding(true);
    setMedMessage({ type: '', text: '' });

    try {
      const result = await addMedication(medPreview);
      if (result.success) {
        setMedMessage({
          type: 'success',
          text: `Added "${result.medication.label}" successfully!`
        });
        setNewMedName('');
        setMedPreview(null);
        // Refresh medications list
        await fetchMedications();
      }
    } catch (err) {
      console.error('Failed to add medication:', err);
      setMedMessage({
        type: 'error',
        text: err.message || 'Failed to add medication'
      });
    } finally {
      setMedAdding(false);
    }
  }

  function saveAuthToken() {
    const trimmedToken = authToken.trim();
    if (!trimmedToken) {
      setTokenMessage({
        type: 'error',
        text: 'Please enter a valid token'
      });
      return;
    }

    localStorage.setItem('cfs_auth_token', trimmedToken);
    setTokenMessage({
      type: 'success',
      text: 'Token saved! Please reload the app to apply changes.'
    });

    // Clear message after 5 seconds
    setTimeout(() => {
      setTokenMessage({ type: '', text: '' });
    }, 5000);
  }

  async function checkPushStatus() {
    const supported = isPushSupported();
    setPushSupported(supported);

    if (supported) {
      const perm = getPermissionStatus();
      setPermission(perm);

      const sub = await isSubscribed();
      setSubscribed(sub);
    }
  }

  async function fetchReminderSettings() {
    try {
      // getAuthToken() check not strictly needed as apiRequest handles it, but keeps UI logic consistent
      const settings = await getNotificationSettings();
      setReminderSettings(settings);
    } catch (error) {
      console.error('Failed to fetch reminder settings:', error);
    }
  }

  async function saveReminderSettings() {
    const token = getAuthToken();
    if (!token) {
      setSettingsMessage({
        type: 'error',
        text: 'Please enter and save your Authentication Token first.'
      });
      return;
    }

    setSettingsLoading(true);
    setSettingsMessage({ type: '', text: '' });

    try {
      await saveNotificationSettings(reminderSettings);

      setSettingsMessage({
        type: 'success',
        text: 'Reminder settings saved successfully!'
      });
    } catch (error) {
      console.error('Failed to save reminder settings:', error);
      setSettingsMessage({
        type: 'error',
        text: 'Failed to save settings. Please try again.'
      });
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleTestNotification() {
    const token = getAuthToken();
    if (!token) {
      setMessage({
        type: 'error',
        text: 'Please enter and save your Authentication Token first.'
      });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const data = await sendNotification();
      // apiRequest throws if not OK, so if we are here, it's success.
      // But we need the data. sendNotification returns json.

      if (data) {
        // We already have data
        let successMsg = `Test notification sent! (${data.sent} device${data.sent !== 1 ? 's' : ''})`;

        if (data.debug_info && data.debug_info.vapid) {
          const serverKeyPrefix = data.debug_info.vapid.serverKeyPrefix;
          const clientKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
          const clientKeyPrefix = clientKey.trim().substring(0, 15) + '...';

          console.log('VAPID Check:', { server: serverKeyPrefix, client: clientKeyPrefix });

          if (serverKeyPrefix && clientKeyPrefix && serverKeyPrefix !== clientKeyPrefix) {
            successMsg += `\n\n⚠️ CRITICAL CONFIG ERROR ⚠️\nVAPID Key Mismatch!`;
            successMsg += `\nClient uses: ${clientKeyPrefix}`;
            successMsg += `\nServer uses: ${serverKeyPrefix}`;
            successMsg += `\nCheck your Vercel Environment Variables. VITE_VAPID_PUBLIC_KEY and VAPID_PUBLIC_KEY must be identical.`;
          } else {
            successMsg += `\n(Keys match: ${serverKeyPrefix})`;
          }

          if (data.debug_info.vapid.subject) {
            successMsg += `\nSubject: ${data.debug_info.vapid.subject}`;
          }
        }

        if (data.cleaned_up && data.cleaned_up > 0) {
          successMsg += `\n\nNote: ${data.cleaned_up} expired subscription(s) were removed.`;
          // If we failed to send AND cleaned up, it likely means OUR subscription was the bad one.
          // Reset UI to allow re-subscribing.
          if (data.sent === 0) {
            setSubscribed(false);
            successMsg += `\nYour subscription was expired. Please click "Enable Notifications" to re-subscribe.`;
          }
        }

        // Always show send errors if any occurred (even if some succeeded)
        if (data.send_errors && data.send_errors.length > 0) {
          successMsg += `\n\n⚠️ ${data.send_errors.length} device(s) failed:`;
          data.send_errors.forEach((err, idx) => {
            successMsg += `\n${idx + 1}. ${err.error}`;
            if (err.statusCode) successMsg += ` (Status: ${err.statusCode})`;
            if (err.endpoint) successMsg += `\n   Endpoint: ${err.endpoint}`;
            if (err.body) successMsg += `\n   Response: ${err.body}`;
          });
        }

        if (data.sent === 0 && data.debug_info) {
          console.log('Debug Info:', data.debug_info);
          successMsg += `\n\nDebug: Found ${data.debug_info.rowsFound} rows.`;
          if (data.debug_info.parseErrors && data.debug_info.parseErrors.length > 0) {
            const firstError = data.debug_info.parseErrors[0];
            successMsg += `\nError 1: ${firstError.error}`;
            if (firstError.missing) successMsg += ` (${firstError.missing.join(', ')})`;
          }
        }

        setMessage({
          type: 'success',
          text: successMsg
        });
      }

      // Removed else block as apiRequest throws errors
    } catch (error) {
      console.error('Failed to send test notification:', error);
      // apiRequest error object structure might be different, let's just use message
      setMessage({
        type: 'error',
        text: `Error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleEnableNotifications() {
    const token = getAuthToken();
    if (!token) {
      setMessage({
        type: 'error',
        text: 'Please enter and save your Authentication Token first.'
      });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      // Request permission if not granted
      if (permission !== 'granted') {
        const perm = await requestNotificationPermission();
        setPermission(perm);

        if (perm !== 'granted') {
          setMessage({
            type: 'error',
            text: 'Notification permission denied. Please enable notifications in your browser settings.'
          });
          setLoading(false);
          return;
        }
      }

      // Force fresh subscription: Unsubscribe first to clear any potential stale subscription (wrong keys)
      // This is critical if the VAPID keys have changed on the server.
      await unsubscribeFromPush();

      // Subscribe to push notifications
      await subscribeToPush();
      setSubscribed(true);
      setMessage({
        type: 'success',
        text: 'Successfully subscribed to notifications! You will receive daily reminders.'
      });
    } catch (error) {
      console.error('Failed to enable notifications:', error);
      setMessage({
        type: 'error',
        text: 'Failed to enable notifications. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisableNotifications() {
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await unsubscribeFromPush();
      setSubscribed(false);
      setMessage({
        type: 'success',
        text: 'Successfully unsubscribed from notifications.'
      });
    } catch (error) {
      console.error('Failed to disable notifications:', error);
      setMessage({
        type: 'error',
        text: 'Failed to disable notifications. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleManualAlert() {
    const token = getAuthToken();
    if (!token) {
      setMessage({
        type: 'error',
        text: 'Please enter and save your Authentication Token first.'
      });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const data = await sendNotification({
        message: manualAlertMessage,
        includeJoke: includeJoke
      });

      // apiRequest returns the JSON directly
      if (data) {
        let successMsg = `Manual alert sent! (${data.sent} device${data.sent !== 1 ? 's' : ''})`;

        // Show errors if any
        if (data.send_errors && data.send_errors.length > 0) {
          successMsg += `\n\n⚠️ ${data.send_errors.length} device(s) failed:`;
          data.send_errors.forEach((err, idx) => {
            successMsg += `\n${idx + 1}. ${err.error}`;
          });
        }

        setMessage({
          type: 'success',
          text: successMsg
        });
        setManualAlertMessage(''); // Clear input on success
      }
    } catch (error) {
      console.error('Failed to send manual alert:', error);
      setMessage({
        type: 'error',
        text: `Error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings">
      <h2>Settings</h2>

      {/* Reminder Schedule Section */}
      <div className="settings-section">
        <h3>Reminder Schedule</h3>
        <p className="settings-description">
          Customize when and how often you receive reminders to track your daily health metrics.
        </p>

        <div className="settings-form">
          <div className="form-group">
            <label htmlFor="firstReminderTime">First Reminder Time</label>
            <input
              type="time"
              id="firstReminderTime"
              value={reminderSettings.firstReminderTime}
              onChange={(e) => setReminderSettings({
                ...reminderSettings,
                firstReminderTime: e.target.value
              })}
              className="time-input"
            />
            <p className="help-text">
              Set your first daily reminder. If this time has already passed today,
              the reminder will start tomorrow at this time.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="repeatInterval">Repeat Every</label>
            <select
              id="repeatInterval"
              value={reminderSettings.repeatInterval}
              onChange={(e) => setReminderSettings({
                ...reminderSettings,
                repeatInterval: parseInt(e.target.value)
              })}
              className="select-input"
            >
              <option value="0">Never (one-time only)</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="240">4 hours</option>
            </select>
            <p className="help-text">
              How often to repeat the reminder after the first one.
            </p>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={reminderSettings.stopAfterLog}
                onChange={(e) => setReminderSettings({
                  ...reminderSettings,
                  stopAfterLog: e.target.checked
                })}
              />
              <span>Stop reminders after I log today</span>
            </label>
            <p className="help-text">
              Automatically stop sending reminders once you've tracked your health metrics for the day.
              Reminders will resume tomorrow.
            </p>
          </div>
        </div>

        {settingsMessage.text && (
          <div className={`settings-message ${settingsMessage.type}`}>
            {settingsMessage.text}
          </div>
        )}

        <div className="settings-actions">
          <button
            onClick={saveReminderSettings}
            disabled={settingsLoading}
            className="btn-primary"
          >
            {settingsLoading ? 'Saving...' : 'Save Reminder Settings'}
          </button>
        </div>
      </div>

      {/* Manage Medications Section */}
      <div className="settings-section">
        <h3>Manage Medications</h3>
        <p className="settings-description">
          View current medications and add new ones to track.
        </p>

        {/* Current Medications List */}
        <div className="medications-list-container">
          <h4 className="subsection-title">Current Medications</h4>
          {medsLoading ? (
            <p className="loading-text">Loading medications...</p>
          ) : medications.length === 0 ? (
            <p className="empty-text">No medications configured.</p>
          ) : (
            <div className="medications-grid">
              {medications.map(med => (
                <span key={med.key} className="medication-chip">
                  {med.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Add New Medication */}
        <div className="add-medication-form">
          <h4 className="subsection-title">Add New Medication</h4>

          {!medPreview ? (
            <>
              <div className="form-group">
                <label htmlFor="newMedName">Medication Name</label>
                <input
                  type="text"
                  id="newMedName"
                  value={newMedName}
                  onChange={(e) => setNewMedName(e.target.value)}
                  placeholder="e.g., Vitamin B-12"
                  className="text-input"
                  maxLength={50}
                />
                <p className="help-text">
                  Enter the medication name exactly as you want it to appear.
                </p>
              </div>
              <div className="settings-actions">
                <button
                  onClick={handleMedPreview}
                  disabled={!newMedName.trim()}
                  className="btn-primary"
                >
                  Preview
                </button>
              </div>
            </>
          ) : (
            <div className="medication-preview">
              <p className="preview-label">Will add medication:</p>
              <p className="preview-name">{medPreview}</p>
              <p className="help-text">
                Please verify the spelling is correct before adding.
              </p>
              <div className="settings-actions preview-actions">
                <button
                  onClick={handleMedCancel}
                  disabled={medAdding}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMedAdd}
                  disabled={medAdding}
                  className="btn-primary"
                >
                  {medAdding ? 'Adding...' : 'Add Medication'}
                </button>
              </div>
            </div>
          )}

          {medMessage.text && (
            <div className={`settings-message ${medMessage.type}`}>
              {medMessage.text}
            </div>
          )}
        </div>
      </div>

      {/* Push Notifications Section */}
      <div className="settings-section">
        <h3>Push Notifications</h3>

        {!pushSupported ? (
          <p className="error-message">
            Push notifications are not supported in your browser.
            Please use a modern browser like Chrome, Firefox, or Safari.
          </p>
        ) : (
          <>
            <p className="settings-description">
              Get daily reminders with a joke to track your health metrics.
              {subscribed && ' Notifications are currently active.'}
              {!subscribed && ' Enable notifications below to start receiving reminders.'}
            </p>

            <div className="notification-status">
              <div className="status-item">
                <span className="status-label">Browser Support:</span>
                <span className={`status-value ${pushSupported ? 'success' : 'error'}`}>
                  {pushSupported ? 'Supported' : 'Not Supported'}
                </span>
              </div>

              <div className="status-item">
                <span className="status-label">Permission:</span>
                <span className={`status-value ${permission === 'granted' ? 'success' : permission === 'denied' ? 'error' : 'warning'}`}>
                  {permission === 'granted' ? 'Granted' : permission === 'denied' ? 'Denied' : 'Not Requested'}
                </span>
              </div>

              <div className="status-item">
                <span className="status-label">Subscription:</span>
                <span className={`status-value ${subscribed ? 'success' : 'inactive'}`}>
                  {subscribed ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {message.text && (
              <div className={`settings-message ${message.type}`}>
                {message.text}
              </div>
            )}

            <div className="settings-actions">
              {!subscribed ? (
                <button
                  onClick={handleEnableNotifications}
                  disabled={loading || permission === 'denied'}
                  className="btn-primary"
                >
                  {loading ? 'Enabling...' : 'Enable Notifications'}
                </button>
              ) : (
                <div className="subscribed-actions">
                  <button
                    onClick={handleDisableNotifications}
                    disabled={loading}
                    className="btn-secondary"
                  >
                    {loading ? 'Disabling...' : 'Disable Notifications'}
                  </button>
                  <button
                    onClick={handleTestNotification}
                    disabled={loading}
                    className="btn-primary"
                  >
                    {loading ? 'Sending...' : 'Send Test Notification'}
                  </button>
                </div>
              )}
            </div>

            {permission === 'denied' && (
              <p className="help-text error">
                Notifications are blocked. To enable them, please:
                <ol>
                  <li>Click the lock icon in your browser's address bar</li>
                  <li>Allow notifications for this site</li>
                  <li>Refresh the page</li>
                </ol>
              </p>
            )}

            {subscribed && (
              <p className="help-text success">
                You're all set! You'll receive customized reminder notifications based on your schedule above.
              </p>
            )}
          </>
        )}
      </div>

      {/* Manual Alert Section */}
      <div className="settings-section">
        <h3>Manual Alert</h3>
        <p className="settings-description">
          Manually send a push notification to all subscribed devices.
        </p>

        <div className="settings-form">
          <div className="form-group">
            <label htmlFor="manualMessage">Custom Message (Optional)</label>
            <input
              type="text"
              id="manualMessage"
              value={manualAlertMessage}
              onChange={(e) => setManualAlertMessage(e.target.value)}
              placeholder="Your message (joke will be added below)"
              className="text-input"
            />
            <p className="help-text">
              Enter a message to display above the random joke. If empty, only a joke will be sent.
            </p>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeJoke}
                onChange={(e) => setIncludeJoke(e.target.checked)}
              />
              <span>Include random joke</span>
            </label>
          </div>

          <div className="settings-actions">
            <button
              onClick={handleManualAlert}
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Sending...' : 'Send Manual Alert'}
            </button>
          </div>
        </div>
      </div>

      {/* Authentication Token Section */}
      <div className="settings-section">
        <h3>Authentication Token</h3>
        <p className="settings-description">
          Enter your authentication token to enable syncing with Google Sheets. Hint: dev-secret-token-12345.
        </p>

        <div className="settings-form">
          <div className="form-group">
            <label htmlFor="authToken">Token</label>
            <input
              type="text"
              id="authToken"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Enter your token"
              className="text-input"
            />
            <p className="help-text">
              Current token: {authToken ? `${authToken.substring(0, 20)}...` : 'NOT SET'}
            </p>
          </div>
        </div>

        {tokenMessage.text && (
          <div className={`settings-message ${tokenMessage.type}`}>
            {tokenMessage.text}
          </div>
        )}

        <div className="settings-actions">
          <button
            onClick={saveAuthToken}
            className="btn-primary"
          >
            Save Token
          </button>
        </div>
      </div>

      {/* About Section */}
      <div className="settings-section">
        <h3>About</h3>
        <p className="settings-description">
          CFS Daily Tracker helps you monitor your health metrics for
          Chronic Fatigue Syndrome management. Track hours, symptoms, and
          supplements daily.
        </p>
        <p className="settings-version">Version 1.0.0</p>
      </div>
    </div>
  );
}
