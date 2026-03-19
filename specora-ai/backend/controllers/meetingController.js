const fs = require('fs');
const path = require('path');
const Meeting = require('../models/Meeting');

const formatMeeting = (meeting) => {
  if (!meeting) return null;
  const raw = meeting.toObject ? meeting.toObject() : meeting;
  return {
    ...raw,
    audioUrl: raw.audioPath ? `/api/meetings/${meeting._id}/audio` : '',
    audioAvailable: Boolean(raw.audioPath),
  };
};

/**
 * POST /api/meetings — Create a new meeting
 */
async function createMeeting(req, res) {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Meeting title is required' });
    }

    const meeting = await Meeting.create({ title });
    res.status(201).json(formatMeeting(meeting));
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/meetings — Get all meetings
 */
async function getMeetings(req, res) {
  try {
    const meetings = await Meeting.find().sort({ createdAt: -1 });
    res.json(meetings.map(formatMeeting));
  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/meetings/:id — Get a single meeting by ID
 */
async function getMeetingById(req, res) {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    res.json(formatMeeting(meeting));
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/meetings/:id/upload — Upload audio file for a meeting
 */
async function uploadAudio(req, res) {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    meeting.audioPath = req.file.path;
    meeting.audioUrl = `/api/meetings/${meeting._id}/audio`;
    meeting.status = 'uploading';
    await meeting.save();

    res.json({
      message: 'Audio uploaded successfully',
      meeting: formatMeeting(meeting),
    });
  } catch (error) {
    console.error('Upload audio error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/meetings/:id — Delete a meeting
 */
async function deleteMeeting(req, res) {
  try {
    const meeting = await Meeting.findByIdAndDelete(req.params.id);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.audioPath) {
      const filePath = path.resolve(meeting.audioPath);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileErr) {
        console.warn(`Unable to delete audio file ${filePath}:`, fileErr.message);
      }
    }

    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/meetings/:id/audio — Stream meeting audio securely
 */
async function streamAudio(req, res) {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting || !meeting.audioPath) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const filePath = path.resolve(meeting.audioPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.mp3': 'audio/mpeg',
      '.mpeg': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Audio stream error:', err);
      res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Stream audio error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createMeeting,
  getMeetings,
  getMeetingById,
  uploadAudio,
  deleteMeeting,
  streamAudio,
};
