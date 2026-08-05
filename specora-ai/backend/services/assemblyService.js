const axios = require('axios');
const fs = require('fs');

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const isMock = process.env.MOCK_AI === 'true';

const MOCK_TRANSCRIPT = 'This is a mock transcript for Specora AI testing.';

/**
 * Get authorization headers for AssemblyAI API
 */
function ensureApiKey() {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured');
  }
}

function getHeaders() {
  ensureApiKey();
  return {
    authorization: process.env.ASSEMBLYAI_API_KEY,
    'content-type': 'application/json',
  };
}

/**
 * Upload an audio file to AssemblyAI and get a hosted URL.
 * Streams the file to avoid loading it fully into memory.
 */
async function uploadAudio(filePath) {
  if (isMock) {
    return 'mock_upload_url';
  }

  ensureApiKey();
  const stream = fs.createReadStream(filePath);

  const response = await axios({
    method: 'post',
    url: `${ASSEMBLYAI_BASE}/upload`,
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY,
      'transfer-encoding': 'chunked',
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    data: stream,
  });

  return response.data.upload_url;
}

/**
 * Start a transcription job on AssemblyAI
 */
async function startTranscription(audioUrl) {
  if (isMock) {
    return 'mock_transcript_id';
  }

  const response = await axios.post(
    `${ASSEMBLYAI_BASE}/transcript`,
    { audio_url: audioUrl },
    { headers: getHeaders() }
  );

  return response.data.id;
}

// Transcription now runs as a background job rather than inside an HTTP
// request, so the ceiling is set by how long a job can legitimately take (a
// multi-hour recording), not by a proxy's request timeout.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

function pollTranscript(transcriptId, timeoutMs = POLL_TIMEOUT_MS, intervalMs = 3000) {
  return new Promise((resolve, reject) => {
    if (isMock) {
      return resolve(MOCK_TRANSCRIPT);
    }

    const deadline = Date.now() + timeoutMs;

    const poll = async () => {
      try {
        if (Date.now() > deadline) {
          return reject(new Error('Transcription polling timed out'));
        }

        const response = await axios.get(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
          headers: getHeaders(),
        });
        const { status, text, error } = response.data;

        if (status === 'completed') {
          return resolve(text);
        }

        if (status === 'error') {
          return reject(new Error(`Transcription failed: ${error}`));
        }

        setTimeout(poll, intervalMs);
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}

async function getTranscript(transcriptId) {
  return pollTranscript(transcriptId);
}

module.exports = {
  uploadAudio,
  startTranscription,
  getTranscript,
};
