const Meeting = require('../models/Meeting');
const assemblyService = require('../services/assemblyService');

/**
 * POST /api/transcribe/:meetingId — Transcribe audio for a meeting
 */
async function transcribeMeeting(req, res) {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!meeting.audioUrl) {
      return res.status(400).json({ error: 'No audio file attached to this meeting' });
    }

    // Update status
    meeting.status = 'transcribing';
    await meeting.save();

    // Step 1: Upload audio to AssemblyAI
    const uploadedUrl = await assemblyService.uploadAudio(meeting.audioUrl);

    // Step 2: Start transcription
    const transcriptId = await assemblyService.startTranscription(uploadedUrl);

    // Step 3: Poll until complete
    const transcript = await assemblyService.getTranscript(transcriptId);

    // Save transcript
    meeting.transcript = transcript;
    meeting.status = 'transcribing';
    await meeting.save();

    res.json({
      message: 'Transcription completed',
      transcript,
      meeting,
    });
  } catch (error) {
    console.error('Transcription error:', error.message);

    // Update meeting status to error
    try {
      await Meeting.findByIdAndUpdate(req.params.meetingId, { status: 'error' });
    } catch (e) {
      /* ignore */
    }

    res.status(500).json({ error: `Transcription failed: ${error.message}` });
  }
}

module.exports = {
  transcribeMeeting,
};
