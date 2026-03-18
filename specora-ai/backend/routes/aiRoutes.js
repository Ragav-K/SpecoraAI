const express = require('express');
const aiController = require('../controllers/aiController');

const router = express.Router();

// POST /api/analyze/:meetingId — Analyze transcript with GPT-4
router.post('/:meetingId', aiController.analyzeMeeting);

module.exports = router;
