const express = require('express');
const transcriptionController = require('../controllers/transcriptionController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/transcribe/:meetingId — Start (or resume) a transcription job.
// Returns 202 immediately; the work continues in the background.
router.post('/:meetingId', auth, transcriptionController.startTranscription);

// GET /api/transcribe/:meetingId — Poll transcription status/text.
// SECURITY: owner-scoped in the controller, so status and transcript text
// cannot be read cross-account.
router.get('/:meetingId', auth, transcriptionController.getTranscriptionStatus);

module.exports = router;
