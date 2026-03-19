const express = require('express');
const aiController = require('../controllers/aiController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/analyze/:meetingId — Analyze transcript with GPT-4
router.post('/:meetingId', auth, aiController.analyzeMeeting);

module.exports = router;
