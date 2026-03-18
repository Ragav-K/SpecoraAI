const Meeting = require('../models/Meeting');

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
    res.status(201).json(meeting);
  } catch (error) {
    console.error('Create meeting error:', error.message);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
}

/**
 * GET /api/meetings — Get all meetings
 */
async function getMeetings(req, res) {
  try {
    const meetings = await Meeting.find().sort({ createdAt: -1 });
    res.json(meetings);
  } catch (error) {
    console.error('Get meetings error:', error.message);
    res.status(500).json({ error: 'Failed to fetch meetings' });
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

    res.json(meeting);
  } catch (error) {
    console.error('Get meeting error:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting' });
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

    meeting.audioUrl = req.file.path;
    meeting.status = 'uploading';
    await meeting.save();

    res.json({
      message: 'Audio uploaded successfully',
      audioUrl: req.file.path,
      meeting,
    });
  } catch (error) {
    console.error('Upload audio error:', error.message);
    res.status(500).json({ error: 'Failed to upload audio' });
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

    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Delete meeting error:', error.message);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
}

module.exports = {
  createMeeting,
  getMeetings,
  getMeetingById,
  uploadAudio,
  deleteMeeting,
};
