const Meeting = require('../models/Meeting');
const aiService = require('../services/aiService');

/**
 * POST /api/analyze/:meetingId — Analyze the caller's meeting transcript
 */
async function analyzeMeeting(req, res) {
  try {
    // SECURITY: scoped by owner — another user's meeting is simply "not found".
    const meeting = await Meeting.findOne({
      _id: req.params.meetingId,
      user: req.user.id,
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!meeting.transcript) {
      return res.status(400).json({ error: 'No transcript available. Transcribe the audio first.' });
    }

    // Update status
    meeting.status = 'analyzing';
    await meeting.save();

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
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    console.error('Analysis error:', error);

    try {
      await Meeting.findOneAndUpdate(
        { _id: req.params.meetingId, user: req.user.id },
        { status: 'error' }
      );
    } catch (e) {
      /* ignore */
    }

    // Surface upstream provider failures as themselves. Reporting a provider
    // quota/auth/rate-limit problem as a bare 500 sends people hunting for a
    // bug in this codebase that isn't there.
    const { provider } = aiService.describeProvider();
    const upstream = error.status;

    if (upstream === 429) {
      return res.status(503).json({
        error:
          error.code === 'insufficient_quota'
            ? `The ${provider} account has no remaining quota. Check plan and billing details.`
            : `The AI provider (${provider}) is rate limiting requests. Please retry shortly.`,
      });
    }
    if (upstream === 401 || upstream === 403) {
      return res.status(503).json({
        error: `The ${provider} API key was rejected. Check the key in backend/.env.`,
      });
    }
    if (upstream === 404) {
      return res.status(503).json({
        error: `The configured model was not found on ${provider}. Check the model name in backend/.env.`,
      });
    }
    // Missing key / malformed model reply — message is already user-facing.
    if (error.statusCode === 502 || error.statusCode === 503) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  analyzeMeeting,
};
