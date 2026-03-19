const express = require('express');
const transcriptionController = require('../controllers/transcriptionController');
const Meeting = require('../models/Meeting');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/transcribe/:meetingId — Start a new transcription job
router.post('/:meetingId', auth, transcriptionController.transcribeMeeting);

// GET /api/transcribe/:meetingId — Return current transcription status/text
router.get('/:meetingId', auth, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId).select('status transcript');

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    res.json({
      status: meeting.status,
      transcript: meeting.transcript,
    });
  } catch (error) {
    console.error('Fetch transcription status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
