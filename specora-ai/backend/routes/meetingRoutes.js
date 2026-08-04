const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const meetingController = require('../controllers/meetingController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

// Absolute upload directory — must not depend on the process working
// directory, or uploads land somewhere that doesn't exist when the server is
// started from outside the project root. Matches the dir created in server.js.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_MIME = {
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'audio/x-m4a': '.m4a',
  'audio/ogg': '.ogg',
};

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // SECURITY: never build a path from the client-supplied name. Derive the
    // extension from the (already whitelisted) mime type and use a random stem,
    // so traversal sequences and odd characters cannot reach the filesystem.
    const ext = ALLOWED_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
  fileFilter: (req, file, cb) => {
    if (Object.prototype.hasOwnProperty.call(ALLOWED_MIME, file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('Invalid file type. Only audio files are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  },
});

/**
 * Translate multer failures into 4xx JSON instead of letting them fall through
 * to the generic handler as 500s.
 */
function handleUpload(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Audio file is too large (200MB maximum).' });
    }
    if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
    return next(err);
  });
}

// Routes (JWT protected)
router.post('/', auth, meetingController.createMeeting);
router.get('/', auth, meetingController.getMeetings);
router.get('/:id/audio', auth, meetingController.streamAudio);
router.get('/:id', auth, meetingController.getMeetingById);
router.post('/:id/upload', auth, handleUpload, meetingController.uploadAudio);
router.delete('/:id', auth, meetingController.deleteMeeting);

module.exports = router;
