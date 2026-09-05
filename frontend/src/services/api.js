import { supabase } from '../lib/supabase.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3000';
let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

function createSessionError(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

export function createAuthenticatedFetch({
  supabaseClient,
  apiBase = '',
  onUnauthorized = () => {},
  fetchImpl = fetch,
}) {
  async function performRequest(path, options, accessToken) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetchImpl(`${apiBase}${path}`, {
      ...options,
      headers,
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  }

  return async function authenticatedFetch(path, options = {}) {
    if (!supabaseClient) {
      throw createSessionError('Supabase Auth is not configured');
    }

    const { data, error } = await supabaseClient.auth.getSession();
    let session = data?.session ?? null;

    if (error || !session?.access_token) {
      onUnauthorized('Your session has expired. Please sign in again.');
      throw createSessionError('Authentication session is missing or expired');
    }

    let result = await performRequest(path, options, session.access_token);
    if (result.response.status === 401) {
      const refreshed = await supabaseClient.auth.refreshSession();
      session = refreshed.data?.session ?? null;

      if (!refreshed.error && session?.access_token) {
        result = await performRequest(path, options, session.access_token);
      }
    }

    if (result.response.status === 401) {
      await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => {});
      onUnauthorized('Your session has expired. Please sign in again.');
      throw createSessionError(
        result.json.error || 'Authentication session is invalid or expired'
      );
    }

    if (!result.response.ok) {
      const message =
        result.json.error ||
        result.json.message ||
        `Request failed (${result.response.status})`;
      const requestError = new Error(message);
      requestError.status = result.response.status;
      requestError.payload = result.json;
      throw requestError;
    }

    return result.json;
  };
}

export const fetchWithAuth = createAuthenticatedFetch({
  supabaseClient: supabase,
  apiBase: API_BASE,
  onUnauthorized(message) {
    unauthorizedHandler?.(message);
  },
});
