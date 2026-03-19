const express = require('express');
const multer = require('multer');
const meetingController = require('../controllers/meetingController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/x-m4a', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

// Routes (JWT protected)
router.post('/', auth, meetingController.createMeeting);
router.get('/', auth, meetingController.getMeetings);
router.get('/:id/audio', auth, meetingController.streamAudio);
router.get('/:id', auth, meetingController.getMeetingById);
router.post('/:id/upload', auth, upload.single('audio'), meetingController.uploadAudio);
router.delete('/:id', auth, meetingController.deleteMeeting);

module.exports = router;
