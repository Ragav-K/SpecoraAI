/**
 * Specora AI — API Client Module
 * All backend communication in one place
 */
const API = (() => {
  const BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : 'https://specoraai.onrender.com/api';

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

    return new Error(`Request failed (${res.status})`);
  }

  async function request(url, options = {}) {
    try {
      const res = await fetch(`${BASE}${url}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      let data = null;

      if (rawText) {
        if (contentType.includes('application/json')) {
          try {
            data = JSON.parse(rawText);
          } catch (parseError) {
            throw new Error('The API returned invalid JSON. Please try again.');
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
        throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
      }

      return data || {};
    } catch (error) {
      console.error(`API Error [${url}]:`, error.message);
      throw error;
    }
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

    const res = await fetch(`${BASE}/meetings/${meetingId}/upload`, {
      method: 'POST',
      body: formData,
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let data = null;

    if (rawText) {
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          throw new Error('The upload API returned invalid JSON. Please try again.');
        }
      } else {
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          throw buildNonJsonError(rawText, res, `/meetings/${meetingId}/upload`);
        }
      }
    }

    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data || {};
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
  };
})();
