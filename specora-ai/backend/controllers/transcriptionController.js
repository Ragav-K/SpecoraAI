const fs = require('fs');
const path = require('path');
const Meeting = require('../models/Meeting');
const assemblyService = require('../services/assemblyService');

/**
 * Transcription runs as a background job rather than inside the HTTP request.
 *
 * A long recording takes minutes to upload and transcribe — far longer than the
 * ~30-100s a hosted platform (Render, Heroku, most reverse proxies) will hold a
 * request open. Doing it inline meant the client saw a gateway timeout even
 * when the job had actually succeeded, and the meeting was left stuck in
 * 'transcribing' with no way to find out.
 *
 * POST /api/transcribe/:meetingId  starts (or resumes) the job and returns 202.
 * GET  /api/transcribe/:meetingId  reports progress.
 *
 * The job set below is per-process, so it is a de-duplication guard, not a
 * source of truth. Durable state lives on the meeting document: `status` plus
 * `transcriptId`. If the process restarts mid-job, the next poll sees
 * status==='transcribing' with a stored transcriptId and resumes polling
 * AssemblyAI for that same job rather than paying to transcribe it twice.
 */
const activeJobs = new Set();

/** Ownership-scoped lookup — another user's meeting is simply "not found". */
function findOwnedMeeting(req) {
  return Meeting.findOne({ _id: req.params.meetingId, user: req.user.id });
}

function audioFileMissing(meeting) {
  return !meeting.audioPath || !fs.existsSync(path.resolve(meeting.audioPath));
}

function progressPayload(meeting) {
  return {
    status: meeting.status,
    transcript: meeting.transcript || '',
    error: meeting.transcriptionError || '',
    done: meeting.status !== 'transcribing',
  };
}

/**
 * Restart the in-process poller for a meeting the database says is still
 * transcribing but that no live job is attached to (i.e. after a restart).
 */
function ensureJobRunning(meeting) {
  if (meeting.status !== 'transcribing') return;
  if (activeJobs.has(String(meeting._id))) return;
  runTranscriptionJob(meeting._id, meeting.user);
}

/**
 * Run the AssemblyAI pipeline and persist the outcome.
 *
 * Never rejects: this is invoked without `await`, so a rejection would surface
 * as an unhandled promise rejection (fatal on Node 15+). Every failure path
 * writes the reason to the meeting instead.
 *
 * @param {string} meetingId
 * @param {string} userId - carried through so the background writes stay
 *   owner-scoped exactly like the request-time queries.
 */
async function runTranscriptionJob(meetingId, userId) {
  const jobKey = String(meetingId);
  if (activeJobs.has(jobKey)) return;
  activeJobs.add(jobKey);

  const scope = { _id: meetingId, user: userId };

  try {
    const meeting = await Meeting.findOne(scope);
    if (!meeting) return;

    // Resume the existing AssemblyAI job when one is already on record,
    // otherwise upload and start a new one.
    let transcriptId = meeting.transcriptId;

    if (!transcriptId) {
      if (audioFileMissing(meeting)) {
        throw new Error('The audio file for this meeting is no longer available on the server.');
      }
      const uploadedUrl = await assemblyService.uploadAudio(meeting.audioPath);
      transcriptId = await assemblyService.startTranscription(uploadedUrl);
      await Meeting.updateOne(scope, { transcriptId });
    }

    const transcript = await assemblyService.getTranscript(transcriptId);

    await Meeting.updateOne(scope, {
      transcript,
      status: 'transcribed',
      transcriptId: '',
      transcriptionError: '',
    });
  } catch (error) {
    console.error(`Transcription job failed for meeting ${meetingId}:`, error.message);
    try {
      await Meeting.updateOne(scope, {
        status: 'error',
        transcriptId: '',
        // Safe to surface: these are our own messages or AssemblyAI's job
        // error text, not internal stack detail.
        transcriptionError: error.message || 'Transcription failed.',
      });
    } catch (writeError) {
      console.error('Could not record transcription failure:', writeError.message);
    }
  } finally {
    activeJobs.delete(jobKey);
  }
}

/**
 * POST /api/transcribe/:meetingId — start transcription, return immediately.
 */
async function startTranscription(req, res) {
  try {
    const meeting = await findOwnedMeeting(req);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.status === 'transcribing') {
      // Already running (or resumable after a restart) — report progress
      // instead of launching a duplicate, separately billed AssemblyAI job.
      ensureJobRunning(meeting);
      return res.status(202).json(progressPayload(meeting));
    }

    if (audioFileMissing(meeting)) {
      if (meeting.audioPath) {
        // Self-heal: the database claims audio the disk no longer has. Clear
        // the pointer so nothing else advertises a file that cannot be read.
        await Meeting.updateOne(
          { _id: meeting._id, user: req.user.id },
          { audioPath: '', audioUrl: '' }
        );
        return res.status(410).json({
          error:
            'The audio for this meeting is no longer available on the server. Please upload it again.',
        });
      }
      return res.status(400).json({ error: 'No audio file attached to this meeting' });
    }

    meeting.status = 'transcribing';
    meeting.transcriptionError = '';
    await meeting.save();

    // Deliberately not awaited — the job outlives this request.
    runTranscriptionJob(meeting._id, req.user.id);

    res.status(202).json(progressPayload(meeting));
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    console.error('Start transcription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/transcribe/:meetingId — poll transcription progress.
 */
async function getTranscriptionStatus(req, res) {
  try {
    const meeting = await findOwnedMeeting(req);

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    ensureJobRunning(meeting);

    res.json(progressPayload(meeting));
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    console.error('Transcription status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  startTranscription,
  getTranscriptionStatus,
};
