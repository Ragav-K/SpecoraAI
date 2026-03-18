const axios = require('axios');
const fs = require('fs');

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

/**
 * Get authorization headers for AssemblyAI API
 */
function getHeaders() {
  return {
    authorization: process.env.ASSEMBLYAI_API_KEY,
    'content-type': 'application/json',
  };
}

/**
 * Upload an audio file to AssemblyAI and get a hosted URL
 * @param {string} filePath - Local path to the audio file
 * @returns {string} Hosted audio URL from AssemblyAI
 */
async function uploadAudio(filePath) {
  const data = fs.readFileSync(filePath);

  const response = await axios.post(`${ASSEMBLYAI_BASE}/upload`, data, {
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked',
    },
  });

  return response.data.upload_url;
}

/**
 * Start a transcription job on AssemblyAI
 * @param {string} audioUrl - URL of the audio file (AssemblyAI hosted or external)
 * @returns {string} Transcription ID for polling
 */
async function startTranscription(audioUrl) {
  const response = await axios.post(
    `${ASSEMBLYAI_BASE}/transcript`,
    { audio_url: audioUrl },
    { headers: getHeaders() }
  );

  return response.data.id;
}

/**
 * Poll AssemblyAI until transcription completes
 * @param {string} transcriptId - ID from startTranscription
 * @returns {string} Completed transcript text
 */
async function getTranscript(transcriptId) {
  const pollingUrl = `${ASSEMBLYAI_BASE}/transcript/${transcriptId}`;

  while (true) {
    const response = await axios.get(pollingUrl, { headers: getHeaders() });
    const { status, text, error } = response.data;

    if (status === 'completed') {
      return text;
    }

    if (status === 'error') {
      throw new Error(`Transcription failed: ${error}`);
    }

    // Poll every 3 seconds
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

module.exports = {
  uploadAudio,
  startTranscription,
  getTranscript,
};
