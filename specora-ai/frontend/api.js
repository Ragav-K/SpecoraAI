/**
 * Specora AI — API Client Module
 * All backend communication in one place
 */
const API = (() => {
  // Environment-aware base URLs (local first, then production)
  const LOCAL_BASES = ['http://localhost:5000/api', 'http://localhost:5001/api'];
  const PROD_BASE = 'https://specoraai.onrender.com/api';

  function getApiBases() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return LOCAL_BASES;
    }
    if (host === 'specoraai.web.app') {
      return [PROD_BASE];
    }
    // Fallback: try same-origin /api for other deployments
    return [`${window.location.origin.replace(/\/$/, '')}/api`];
  }

  function buildNonJsonError(text, res, url) {
    const looksLikeHtml = /^\s*</.test(text);

    if (looksLikeHtml) {
      if (res.status >= 500) {
        return new Error(`The API server returned an HTML error page for ${url}. Please try again in a moment.`);
      }

      return new Error(`The API endpoint ${url} returned HTML instead of JSON. Please verify the backend URL and deployment.`);
    }

    if (text) {
      return new Error(text);
    }

    const err = new Error(`Request failed (${res.status})`);
    err.status = res.status;
    err.retryable = false;
    return err;
  }

  function getSessionToken() {
    const raw = localStorage.getItem('specora_session');
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      return session?.token || null;
    } catch (error) {
      console.warn('Invalid session payload');
      return null;
    }
  }

  function buildFetchOptions(options) {
    const isFormData = options.body instanceof FormData;
    const headers = {
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    };
    const token = getSessionToken();
    if (token) {
      headers.headers.Authorization = `Bearer ${token}`;
    }
    return {
      ...headers,
      ...options,
    };
  }

  async function parseResponse(res, url) {
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let data = null;

    if (rawText) {
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          const err = new Error('The API returned invalid JSON. Please try again.');
          err.retryable = false;
          throw err;
        }
      } else {
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          throw buildNonJsonError(rawText, res, url);
        }
      }
    }

    if (!res.ok) {
      const err = new Error(data?.error || data?.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.retryable = false;
      throw err;
    }

    return data || {};
  }

  // Centralized fetch helper that retries the next host on network errors
  async function fetchAPI(path, options = {}) {
    const bases = getApiBases();
    let lastError = null;

    for (const base of bases) {
      try {
        const res = await fetch(`${base}${path}`, buildFetchOptions(options));
        return await parseResponse(res, path);
      } catch (error) {
        console.error(`[API] ${base}${path} failed:`, error.message);
        lastError = error;
        if (error.retryable === false) {
          break; // HTTP errors shouldn't trigger fallback hosts
        }
      }
    }

    throw lastError || new Error('All API endpoints are unreachable. Please check your network connection.');
  }

  async function request(url, options = {}) {
    return fetchAPI(url, options);
  }

  async function getMeetingAudio(meetingId) {
    const bases = getApiBases();
    const token = getSessionToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    for (const base of bases) {
      try {
        const res = await fetch(`${base}/meetings/${meetingId}/audio`, { headers });
        if (!res.ok) {
          throw new Error(`Audio fetch failed (${res.status})`);
        }
        return await res.blob();
      } catch (error) {
        console.error(`[API] Audio download failed via ${base}:`, error.message);
      }
    }

    throw new Error('Unable to download audio file.');
  }

  /**
   * Create a new meeting
   */
  async function createMeeting(title) {
    return request('/meetings', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  /**
   * Get all meetings
   */
  async function getMeetings() {
    return request('/meetings');
  }

  /**
   * Get a single meeting by ID
   */
  async function getMeeting(id) {
    return request(`/meetings/${id}`);
  }

  /**
   * Delete a meeting
   */
  async function deleteMeeting(id) {
    return request(`/meetings/${id}`, { method: 'DELETE' });
  }

  /**
   * Upload audio file for a meeting (FormData — no JSON header)
   */
  async function uploadAudio(meetingId, file) {
    const formData = new FormData();
    formData.append('audio', file);
    return fetchAPI(`/meetings/${meetingId}/upload`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Start transcription for a meeting
   */
  async function transcribe(meetingId) {
    return request(`/transcribe/${meetingId}`, { method: 'POST' });
  }

  /**
   * Start AI analysis for a meeting
   */
  async function analyze(meetingId) {
    return request(`/analyze/${meetingId}`, { method: 'POST' });
  }

  /**
   * Health check
   */
  async function healthCheck() {
    return request('/health');
  }

  // ── Auth ──

  async function signup(email, name, password) {
    return request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, name, password }) });
  }

  async function verifyOtp(email, otp) {
    return request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp }) });
  }

  async function login(email, password) {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async function requestPasswordReset(email) {
    return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async function resetPassword(email, otp, newPassword) {
    return request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, otp, newPassword }) });
  }

  return {
    createMeeting,
    getMeetings,
    getMeeting,
    deleteMeeting,
    uploadAudio,
    transcribe,
    analyze,
    healthCheck,
    signup,
    verifyOtp,
    login,
    requestPasswordReset,
    resetPassword,
    getMeetingAudio,
  };
})();
