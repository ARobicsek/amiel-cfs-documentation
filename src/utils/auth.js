/**
 * Authentication utilities
 *
 * Uses a simple secret URL token approach:
 * 1. User visits app with ?secret=TOKEN in URL
 * 2. Token is stored in localStorage
 * 3. All subsequent API calls use the stored token
 *
 * This approach has zero friction (no login) while still
 * protecting the API from unauthorized access.
 */

const TOKEN_KEY = 'cfs_auth_token';

/**
 * Get the secret token from URL or localStorage
 */
export function getSecretToken() {
  // Development bypass for local testing
  if (import.meta.env.DEV || window.location.hostname === 'localhost') {
    return localStorage.getItem(TOKEN_KEY) || 'dev-token-for-local-testing';
  }

  // First, check URL for token (initial visit)
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('secret');

  if (urlToken) {
    // Store token and clean up URL
    localStorage.setItem(TOKEN_KEY, urlToken);

    // Remove token from URL without page reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    return urlToken;
  }

  // Otherwise, get from localStorage
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return !!getSecretToken();
}

/**
 * Clear authentication (for testing/debugging)
 */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Get the app URL with secret token (for sharing)
 */
export function getAuthenticatedUrl() {
  const token = getSecretToken();
  if (!token) return null;

  const baseUrl = window.location.origin;
  return `${baseUrl}/?secret=${token}`;
}
