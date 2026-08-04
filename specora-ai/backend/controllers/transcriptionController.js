const Meeting = require('../models/Meeting');
const assemblyService = require('../services/assemblyService');

/**
 * POST /api/transcribe/:meetingId — Transcribe audio for the caller's meeting
 */
async function transcribeMeeting(req, res) {
  try {
    // SECURITY: scoped by owner — another user's meeting is simply "not found".
    const meeting = await Meeting.findOne({
      _id: req.params.meetingId,
      user: req.user.id,
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!meeting.audioPath) {
      return res.status(400).json({ error: 'No audio file attached to this meeting' });
    }

    // Update status
    meeting.status = 'transcribing';
    await meeting.save();

    // Step 1: Upload audio to AssemblyAI
    const uploadedUrl = await assemblyService.uploadAudio(meeting.audioPath);

    // Step 2: Start transcription
    const transcriptId = await assemblyService.startTranscription(uploadedUrl);

    // Step 3: Poll until complete
    const transcript = await assemblyService.getTranscript(transcriptId);

    // Save transcript
    meeting.transcript = transcript;
    meeting.status = 'transcribed';
    await meeting.save();

    const responseMeeting = meeting.toObject();
    responseMeeting.audioUrl = meeting.audioPath ? `/api/meetings/${meeting._id}/audio` : '';

    res.json({
      message: 'Transcription completed',
      transcript,
      meeting: responseMeeting,
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    console.error('Transcription error:', error);

    // Update meeting status to error (still owner-scoped)
    try {
      await Meeting.findOneAndUpdate(
        { _id: req.params.meetingId, user: req.user.id },
        { status: 'error' }
      );
    } catch (e) {
      /* ignore */
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  transcribeMeeting,
};
