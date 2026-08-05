/**
 * Exercises the transcription background job against stubbed model/service
 * modules. No database, no network, no AssemblyAI calls.
 */
const path = require('path');
const Module = require('module');

const BACKEND = path.resolve(__dirname, '..', '..', 'backend');

const MODEL_PATH = path.join(BACKEND, 'models', 'Meeting.js');
const SERVICE_PATH = path.join(BACKEND, 'services', 'assemblyService.js');
const CONTROLLER_PATH = path.join(BACKEND, 'controllers', 'transcriptionController.js');

// ── Stub state ────────────────────────────────────────────────────
let doc;
let calls;

function resetDoc(overrides = {}) {
  calls = { upload: 0, start: 0, poll: 0 };
  doc = Object.assign(
    {
      _id: 'M1',
      user: 'U1',
      audioPath: __filename, // a file that genuinely exists
      transcript: '',
      transcriptId: '',
      transcriptionError: '',
      status: 'uploading',
      save: async () => {},
    },
    overrides
  );
}

const MeetingStub = {
  findOne: async (q) => (q._id === doc._id && q.user === doc.user ? doc : null),
  updateOne: async (q, update) => {
    if (q._id === doc._id && q.user === doc.user) Object.assign(doc, update);
    return { acknowledged: true };
  },
};

let serviceBehaviour = {};
const assemblyStub = {
  uploadAudio: async () => {
    calls.upload++;
    if (serviceBehaviour.uploadFails) throw new Error('upload exploded');
    return 'https://upload/url';
  },
  startTranscription: async () => {
    calls.start++;
    return 'ASSEMBLY-JOB-1';
  },
  getTranscript: async () => {
    calls.poll++;
    if (serviceBehaviour.pollFails) throw new Error('Transcription failed: bad audio');
    if (serviceBehaviour.pollDelayMs) {
      await new Promise((r) => setTimeout(r, serviceBehaviour.pollDelayMs));
    }
    return 'the transcript text';
  },
};

// Inject stubs into the module cache before the controller resolves them.
function stub(p, exports) {
  const m = new Module(p, null);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}
stub(MODEL_PATH, MeetingStub);
stub(SERVICE_PATH, assemblyStub);

const controller = require(CONTROLLER_PATH);

// ── Test helpers ──────────────────────────────────────────────────
let pass = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else failures.push(name);
};

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}
const req = (overrides = {}) => ({
  params: { meetingId: 'M1' },
  user: { id: 'U1' },
  ...overrides,
});

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ── Tests ─────────────────────────────────────────────────────────
(async () => {
  // 1. Happy path: POST returns 202 immediately, job completes afterwards.
  resetDoc();
  serviceBehaviour = {};
  let res = mockRes();
  await controller.startTranscription(req(), res);
  ok('POST returns 202', res.statusCode === 202);
  ok('202 body reports transcribing', res.body.status === 'transcribing');
  ok('202 body not done', res.body.done === false);
  ok('transcript not yet written when request returned', doc.transcript === '');
  await settle();
  ok('job wrote transcript', doc.transcript === 'the transcript text');
  ok('job set status transcribed', doc.status === 'transcribed');
  ok('job cleared transcriptId', doc.transcriptId === '');
  ok('uploaded exactly once', calls.upload === 1);

  // 2. Status polling reflects completion.
  res = mockRes();
  await controller.getTranscriptionStatus(req(), res);
  ok('GET reports done', res.body.done === true);
  ok('GET returns transcript', res.body.transcript === 'the transcript text');

  // 3. Failure path: error is captured on the document, never thrown.
  resetDoc();
  serviceBehaviour = { pollFails: true };
  res = mockRes();
  await controller.startTranscription(req(), res);
  await settle();
  ok('failed job sets status error', doc.status === 'error');
  ok('failed job records reason', /bad audio/.test(doc.transcriptionError));
  ok('failed job clears transcriptId', doc.transcriptId === '');
  res = mockRes();
  await controller.getTranscriptionStatus(req(), res);
  ok('GET surfaces the error text', /bad audio/.test(res.body.error));
  ok('GET marks errored job done', res.body.done === true);

  // 4. De-duplication: a second POST mid-job must not start a second
  //    (separately billed) AssemblyAI job.
  resetDoc();
  serviceBehaviour = { pollDelayMs: 150 };
  await controller.startTranscription(req(), mockRes());
  res = mockRes();
  await controller.startTranscription(req(), res);
  ok('duplicate POST returns 202', res.statusCode === 202);
  await controller.getTranscriptionStatus(req(), mockRes()); // polls shouldn't spawn either
  await settle(250);
  ok('only one upload despite 2 POSTs + a poll', calls.upload === 1);
  ok('only one AssemblyAI job started', calls.start === 1);

  // 5. Restart resume: status 'transcribing' with a stored transcriptId and no
  //    live job must resume polling the SAME job, not re-upload.
  resetDoc({ status: 'transcribing', transcriptId: 'ASSEMBLY-JOB-1' });
  serviceBehaviour = {};
  res = mockRes();
  await controller.getTranscriptionStatus(req(), res);
  await settle();
  ok('resumed without re-uploading', calls.upload === 0);
  ok('resumed without starting a new job', calls.start === 0);
  ok('resumed job polled existing id', calls.poll === 1);
  ok('resumed job completed', doc.status === 'transcribed');

  // 6. Missing audio file: stale DB pointer is cleared and reported as 410.
  resetDoc({ audioPath: path.join(BACKEND, 'no-such-file.webm') });
  res = mockRes();
  await controller.startTranscription(req(), res);
  ok('missing audio file -> 410', res.statusCode === 410);
  ok('missing audio pointer cleared', doc.audioPath === '');
  ok('no AssemblyAI call made', calls.upload === 0);

  // 7. No audio ever attached -> 400, distinct from the stale-pointer case.
  resetDoc({ audioPath: '' });
  res = mockRes();
  await controller.startTranscription(req(), res);
  ok('no audio attached -> 400', res.statusCode === 400);

  // 8. Cross-account access is "not found", not "forbidden".
  resetDoc();
  res = mockRes();
  await controller.getTranscriptionStatus(req({ user: { id: 'INTRUDER' } }), res);
  ok('other user gets 404', res.statusCode === 404);
  res = mockRes();
  await controller.startTranscription(req({ user: { id: 'INTRUDER' } }), res);
  ok('other user cannot start a job', res.statusCode === 404);
  ok('other user triggered no work', calls.upload === 0);

  console.log(
    failures.length
      ? `\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}\n(${pass} passed)`
      : `\nall ${pass} job checks passed`
  );
  process.exit(failures.length ? 1 : 0);
})();
