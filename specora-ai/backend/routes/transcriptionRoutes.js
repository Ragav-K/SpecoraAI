const express = require('express');
const transcriptionController = require('../controllers/transcriptionController');

const router = express.Router();

// POST /api/transcribe/:meetingId — Transcribe meeting audio
router.post('/:meetingId', transcriptionController.transcribeMeeting);

module.exports = router;
