import { useState, useEffect } from 'react';
import {
  isPushSupported,
  getPermissionStatus,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribed
} from '../utils/pushNotification.js';
import './Settings.css';

export default function Settings() {
  const [pushSupported, setPushSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    checkPushStatus();
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

      <div className="settings-section">
        <h3>Push Notifications</h3>
        <p className="settings-description">
          Get daily reminders with a joke to track your health metrics.
          Notifications will be sent once per hour.
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
            You're all set! You'll receive daily reminder notifications.
            Notifications are sent every hour between 8 AM and 8 PM.
          </p>
        )}
      </div>

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
