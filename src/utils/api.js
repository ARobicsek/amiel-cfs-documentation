/**
 * API utility functions
 *
 * All API calls include the secret token for authentication.
 * Token is retrieved from URL on first visit, then stored in localStorage.
 */

import { getSecretToken } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const token = getSecretToken();

  if (!token) {
    throw new Error('No authentication token found');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

/**
 * Submit a daily entry
 */
export async function submitEntry(entry) {
  return apiRequest('/api/submit-entry', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

/**
 * Get recent entries
 */
export async function getEntries(limit = 7) {
  return apiRequest(`/api/get-entries?limit=${limit}`);
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(subscription) {
  return apiRequest('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}
