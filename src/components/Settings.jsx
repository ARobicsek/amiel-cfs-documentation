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
import './Settings.css';

export default function Settings() {
  const [pushSupported, setPushSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Reminder schedule settings
  const [reminderSettings, setReminderSettings] = useState({
    firstReminderTime: '20:00',
    repeatInterval: 60,
    stopAfterLog: true
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    checkPushStatus();
    fetchReminderSettings();
  }, []);

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
      const token = getAuthToken();
      const response = await fetch('/api/notification-settings', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const settings = await response.json();
        setReminderSettings(settings);
      }
    } catch (error) {
      console.error('Failed to fetch reminder settings:', error);
    }
  }

  async function saveReminderSettings() {
    setSettingsLoading(true);
    setSettingsMessage({ type: '', text: '' });

    try {
      const token = getAuthToken();
      const response = await fetch('/api/notification-settings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reminderSettings)
      });

      if (response.ok) {
        setSettingsMessage({
          type: 'success',
          text: 'Reminder settings saved successfully!'
        });
      } else {
        throw new Error('Failed to save settings');
      }
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

  async function handleEnableNotifications() {
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

  if (!pushSupported) {
    return (
      <div className="settings">
        <h2>Settings</h2>
        <div className="settings-section">
          <h3>Push Notifications</h3>
          <p className="error-message">
            Push notifications are not supported in your browser.
            Please use a modern browser like Chrome, Firefox, or Safari.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <h2>Settings</h2>

      {/* Reminder Schedule Section - Moved to Top */}
      <div className="settings-section">
        <h3>Reminder Schedule</h3>
        <p className="settings-description">
          Customize when and how often you receive reminders to track your daily health metrics.
          <br /><br />
          <strong>Note:</strong> With the current Vercel Hobby plan, notifications are limited to once per day at 9 PM ET.
          The settings below will take effect if you upgrade to Pro plan for more frequent notifications.
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

      {/* Push Notifications Section */}
      <div className="settings-section">
        <h3>Push Notifications</h3>
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
            <button
              onClick={handleDisableNotifications}
              disabled={loading}
              className="btn-secondary"
            >
              {loading ? 'Disabling...' : 'Disable Notifications'}
            </button>
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
