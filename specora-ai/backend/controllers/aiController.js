const Meeting = require('../models/Meeting');
const aiService = require('../services/aiService');

/**
 * POST /api/analyze/:meetingId — Analyze transcript with GPT-4
 */
async function analyzeMeeting(req, res) {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!meeting.transcript) {
      return res.status(400).json({ error: 'No transcript available. Transcribe the audio first.' });
    }

    // Update status
    meeting.status = 'analyzing';
    await meeting.save();

    // Call GPT-4 for analysis
    const analysis = await aiService.analyzeTranscript(meeting.transcript, meeting.title);

    // Save all analysis results
    meeting.srs = analysis.srs;
    meeting.requirements = analysis.requirements;
    meeting.userStories = analysis.userStories;
    meeting.apiEndpoints = analysis.apiEndpoints;
    meeting.dbTables = analysis.dbTables;
    meeting.architecture = analysis.architecture;
    meeting.status = 'completed';
    await meeting.save();

    res.json({
      message: 'Analysis completed',
      analysis,
      meeting,
    });
  } catch (error) {
    console.error('Analysis error:', error.message);

    try {
      await Meeting.findByIdAndUpdate(req.params.meetingId, { status: 'error' });
    } catch (e) {
      /* ignore */
    }

    res.status(500).json({ error: `Analysis failed: ${error.message}` });
  }
}

module.exports = {
  analyzeMeeting,
};
