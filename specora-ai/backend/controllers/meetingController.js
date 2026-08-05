const fs = require('fs');
const path = require('path');
const Meeting = require('../models/Meeting');

/**
 * Is the meeting's audio actually readable right now?
 *
 * `audioPath` living in the database is not proof the file exists. Uploads are
 * written to the container's local disk, which is ephemeral on Render and
 * similar platforms — every redeploy wipes it while the database keeps
 * pointing at the vanished file. Checking the filesystem is what stops the API
 * from advertising a player that can only ever fail to load.
 */
const audioFileExists = (audioPath) => {
  if (!audioPath) return false;
  try {
    return fs.existsSync(path.resolve(audioPath));
  } catch (error) {
    return false;
  }
};

const formatMeeting = (meeting) => {
  if (!meeting) return null;
  const raw = meeting.toObject ? meeting.toObject() : meeting;
  const available = audioFileExists(raw.audioPath);
  return {
    ...raw,
    audioUrl: available ? `/api/meetings/${meeting._id}/audio` : '',
    audioAvailable: available,
  };
};

/**
 * Drop a dangling audio pointer so the record stops claiming a file that is
 * gone. Best-effort: a failure here must never break the read that noticed it.
 */
const forgetMissingAudio = async (meetingId, userId) => {
  try {
    await Meeting.updateOne({ _id: meetingId, user: userId }, { audioPath: '', audioUrl: '' });
  } catch (error) {
    console.warn(`Could not clear missing audio pointer for ${meetingId}:`, error.message);
  }
};

/**
 * Shared error responder.
 * SECURITY: a malformed :id produces a CastError. Report it as 404 rather than
 * 500 so probing for valid/invalid IDs looks identical to an outsider.
 */
const handleError = (error, res, label) => {
  if (error.name === 'CastError') {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  console.error(label, error);
  return res.status(500).json({ error: 'Internal server error' });
};

/**
 * POST /api/meetings — Create a new meeting owned by the caller
 */
async function createMeeting(req, res) {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Meeting title is required' });
    }

    const meeting = await Meeting.create({ title, user: req.user.id });
    res.status(201).json(formatMeeting(meeting));
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/meetings — Get the caller's meetings only
 */
async function getMeetings(req, res) {
  try {
    const meetings = await Meeting.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(meetings.map(formatMeeting));
  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/meetings/:id — Get a single meeting owned by the caller
 */
async function getMeetingById(req, res) {
  try {
    const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user.id });

    // SECURITY: 404 (not 403) for someone else's meeting, so the API cannot be
    // used to probe which meeting IDs exist.
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.audioPath && !audioFileExists(meeting.audioPath)) {
      await forgetMissingAudio(meeting._id, req.user.id);
      meeting.audioPath = '';
    }

    res.json(formatMeeting(meeting));
  } catch (error) {
    handleError(error, res, 'Get meeting error:');
  }
}

/**
 * POST /api/meetings/:id/upload — Upload audio file for the caller's meeting
 */
async function uploadAudio(req, res) {
  try {
    const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user.id });

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
    handleError(error, res, 'Upload audio error:');
  }
}

/**
 * DELETE /api/meetings/:id — Delete the caller's meeting
 */
async function deleteMeeting(req, res) {
  try {
    const meeting = await Meeting.findOneAndDelete({ _id: req.params.id, user: req.user.id });

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
    handleError(error, res, 'Delete meeting error:');
  }
}

/**
 * GET /api/meetings/:id/audio — Stream the caller's meeting audio
 */
async function streamAudio(req, res) {
  try {
    const meeting = await Meeting.findOne({ _id: req.params.id, user: req.user.id });
    if (!meeting || !meeting.audioPath) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    const filePath = path.resolve(meeting.audioPath);
    if (!fs.existsSync(filePath)) {
      // The file went away underneath us (ephemeral disk). Clear the pointer so
      // subsequent reads report the meeting honestly as having no audio.
      await forgetMissingAudio(meeting._id, req.user.id);
      return res.status(404).json({ error: 'Audio not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.mp3': 'audio/mpeg',
      '.mpeg': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
      '.m4a': 'audio/mp4',
      '.mp4': 'audio/mp4',
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
    handleError(error, res, 'Stream audio error:');
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
