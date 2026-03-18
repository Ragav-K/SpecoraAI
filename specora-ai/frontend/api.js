/**
 * Specora AI — API Client Module
 * All backend communication in one place
 */
const API = (() => {
  const BASE = '/api';

  async function request(url, options = {}) {
    try {
      const res = await fetch(`${BASE}${url}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      return data;
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

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
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
