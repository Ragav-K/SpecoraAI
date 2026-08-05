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

  /**
   * True when the current document is the login/signup page.
   * The 401 handler must never fire here: auth.html also loads api.js, and a
   * wrong password now legitimately returns 401. Redirecting would reload the
   * page and swallow the inline error message.
   */
  function isAuthPage() {
    return /(^|\/)auth\.html$/.test(window.location.pathname);
  }

  let sessionExpiryHandled = false;

  /**
   * A 401 on an app page means the stored token is expired, forged, or signed
   * with a different secret. Clear it and send the user to login — otherwise
   * every request fails and the dashboard renders empty, which looks exactly
   * like the user's data having been deleted.
   */
  function handleSessionExpired() {
    if (isAuthPage() || sessionExpiryHandled) return;
    sessionExpiryHandled = true;
    localStorage.removeItem('specora_session');
    window.location.href = 'auth.html?expired=1';
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
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    };

    const token = getSessionToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // `headers` must be applied AFTER spreading `options`: a caller that passes
    // its own `headers` key would otherwise clobber the merged object and strip
    // the Authorization header along with it.
    return { ...options, headers };
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
      if (res.status === 401) {
        handleSessionExpired();
      }

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
          if (res.status === 401) handleSessionExpired();
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
   * Start transcription for a meeting.
   * Returns as soon as the job is accepted (202) — it does NOT wait for the
   * transcript. Use transcribeAndWait for the full flow.
   */
  async function transcribe(meetingId) {
    return request(`/transcribe/${meetingId}`, { method: 'POST' });
  }

  /**
   * Poll transcription progress: { status, transcript, error, done }
   */
  async function getTranscriptionStatus(meetingId) {
    return request(`/transcribe/${meetingId}`);
  }

  /**
   * Start transcription and poll until it finishes.
   *
   * The server runs transcription as a background job, because a long
   * recording takes far longer than any hosting platform will hold a request
   * open. The client therefore has to poll rather than await a single call.
   *
   * @param {string} meetingId
   * @param {object} [opts]
   * @param {(status: string) => void} [opts.onProgress] - called on each poll
   * @param {number} [opts.intervalMs] - delay between polls
   * @param {number} [opts.timeoutMs] - give up after this long
   * @returns {Promise<string>} the transcript text
   */
  async function transcribeAndWait(meetingId, opts = {}) {
    const intervalMs = opts.intervalMs || 3000;
    const timeoutMs = opts.timeoutMs || 30 * 60 * 1000;
    const onProgress = opts.onProgress || (() => {});

    // Frontend (Firebase Hosting) and backend (Render) deploy separately, so a
    // new client can briefly meet an older server. The old contract ran
    // transcription inside the POST and its status route returned no `done`
    // flag — hence both compatibility shims below. They can be dropped once
    // the backend is known to be updated everywhere.
    const isTerminal = (progress) =>
      progress.done === true ||
      progress.status === 'transcribed' ||
      progress.status === 'completed' ||
      progress.status === 'error';

    const started = await transcribe(meetingId);

    // Old backend: the POST itself carried the finished transcript.
    if (started.transcript && started.status !== 'transcribing') {
      onProgress('transcribed');
      return started.transcript;
    }

    onProgress(started.status || 'transcribing');

    const deadline = Date.now() + timeoutMs;

    // A transient network blip mid-job should not fail the whole transcription;
    // only give up once several consecutive polls have failed.
    let consecutiveErrors = 0;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      let progress;
      try {
        progress = await getTranscriptionStatus(meetingId);
        consecutiveErrors = 0;
      } catch (error) {
        // A 401 has already redirected to login; anything else may be transient.
        if (error.status === 401 || error.status === 404) throw error;
        if (++consecutiveErrors >= 5) throw error;
        continue;
      }

      onProgress(progress.status);

      if (progress.status === 'error') {
        throw new Error(progress.error || 'Transcription failed.');
      }

      if (isTerminal(progress)) {
        return progress.transcript || '';
      }
    }

    throw new Error('Transcription is taking unusually long. Check back on the meeting shortly.');
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
    getTranscriptionStatus,
    transcribeAndWait,
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
