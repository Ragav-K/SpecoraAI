/**
 * Specora AI — end-to-end test.
 *
 * Boots the real server against the real Atlas cluster and drives the full
 * pipeline over HTTP: signup -> OTP -> login -> meeting -> upload ->
 * transcribe -> analyze, plus the security and failure paths.
 *
 * Safety:
 *   - MOCK_AI=true          -> no AssemblyAI or AI-provider calls, no billing
 *   - EMAIL_PROVIDER=console -> no email is sent; the OTP is read from the log
 *   - every record it creates is tagged and deleted in the finally block
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// Must match multer's destination in backend/routes/meetingRoutes.js.
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = 5099;
const BASE = `http://localhost:${PORT}/api`;

// Everything created by this run carries this tag, so cleanup can find it even
// if the run dies half way through.
const TAG = `e2e-${Date.now()}`;
const userA = { email: `${TAG}-a@specora-e2e.invalid`, name: 'E2E User A', password: 'test-pw-1234' };
const userB = { email: `${TAG}-b@specora-e2e.invalid`, name: 'E2E User B', password: 'test-pw-1234' };

let pass = 0;
const failures = [];
let currentSection = '';

const section = (name) => {
  currentSection = name;
  console.log(`\n  ${name}`);
};
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`    ok   ${name}`);
  } else {
    failures.push(`[${currentSection}] ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`    FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// ── Server process ────────────────────────────────────────────────
let serverLog = '';
let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['backend/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'development',
        MOCK_AI: 'true',
        EMAIL_PROVIDER: 'console',
      },
    });

    const onData = (buf) => {
      serverLog += buf.toString();
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('error', reject);

    const deadline = Date.now() + 30000;
    const probe = async () => {
      if (Date.now() > deadline) return reject(new Error('server did not start:\n' + serverLog));
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) return resolve();
      } catch (e) {
        /* not up yet */
      }
      setTimeout(probe, 300);
    };
    probe();
  });
}

// ── HTTP helper ───────────────────────────────────────────────────
async function call(method, endpoint, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) {
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${endpoint}`, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { _nonJson: text.slice(0, 200) };
  }
  return { status: res.status, data, contentType: res.headers.get('content-type') };
}

/** Pull the most recent OTP the console email provider printed. */
function latestOtp() {
  const matches = [...serverLog.matchAll(/code:\s+(\d{6})/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** A minimal but genuinely valid 8kHz mono WAV. */
function makeWav() {
  const samples = 8000; // 1 second
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin(i / 12) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function uploadAudio(meetingId, token, { mime = 'audio/wav', filename = 'clip.wav' } = {}) {
  const form = new FormData();
  form.append('audio', new Blob([makeWav()], { type: mime }), filename);
  const res = await fetch(`${BASE}/meetings/${meetingId}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function registerUser(u) {
  const signup = await call('POST', '/auth/signup', { body: u });
  if (signup.status !== 200) throw new Error(`signup failed: ${JSON.stringify(signup.data)}`);
  const otp = latestOtp();
  if (!otp) throw new Error('no OTP found in server log');
  const verify = await call('POST', '/auth/verify-otp', { body: { email: u.email, otp } });
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.data)}`);
  return { token: verify.data.token, user: verify.data.user, otp };
}

// ── The run ───────────────────────────────────────────────────────
const createdFiles = [];

(async () => {
  console.log(`\nSpecora AI end-to-end  (tag: ${TAG})`);
  await startServer();
  console.log(`  server up on :${PORT}\n`);

  let A, B, meetingId;

  // ── Health ──────────────────────────────────────────────────────
  section('Health');
  {
    const { status, data } = await call('GET', '/health');
    ok('health returns 200', status === 200);
    ok('reports mock AI provider', data.services.ai.provider === 'mock', JSON.stringify(data.services.ai));
    ok('reports mongodb configured', data.services.mongodb === true);
  }

  // ── Signup / OTP / login ────────────────────────────────────────
  section('Auth');
  {
    A = await registerUser(userA);
    ok('signup + OTP verification returns a token', Boolean(A.token));
    ok('verified user payload has no password field', A.user.password === undefined);

    const reuse = await call('POST', '/auth/verify-otp', {
      body: { email: userA.email, otp: A.otp },
    });
    ok('OTP cannot be replayed after verification', reuse.status === 400, `got ${reuse.status}`);

    const login = await call('POST', '/auth/login', {
      body: { email: userA.email, password: userA.password },
    });
    ok('login succeeds', login.status === 200);
    ok('login returns a token', Boolean(login.data.token));

    const badPw = await call('POST', '/auth/login', {
      body: { email: userA.email, password: 'wrong-password' },
    });
    ok('wrong password rejected', badPw.status === 401);

    const unknown = await call('POST', '/auth/login', {
      body: { email: `${TAG}-nobody@specora-e2e.invalid`, password: 'wrong-password' },
    });
    ok('unknown email is indistinguishable from wrong password',
      unknown.status === badPw.status && unknown.data.error === badPw.data.error,
      `${unknown.status}/${badPw.status}`);

    const reset = await call('POST', '/auth/forgot-password', { body: { email: userA.email } });
    const resetUnknown = await call('POST', '/auth/forgot-password', {
      body: { email: `${TAG}-nobody@specora-e2e.invalid` },
    });
    ok('password reset does not leak account existence',
      reset.status === resetUnknown.status && reset.data.message === resetUnknown.data.message);

    A.token = login.data.token;
    B = await registerUser(userB);
    ok('second account created for isolation tests', Boolean(B.token));
  }

  // ── Auth enforcement ────────────────────────────────────────────
  section('Auth enforcement');
  {
    const noToken = await call('GET', '/meetings');
    ok('no token -> 401', noToken.status === 401);
    const badToken = await call('GET', '/meetings', { token: 'not.a.jwt' });
    ok('garbage token -> 401', badToken.status === 401);
    const forged = await call('GET', '/meetings', {
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSJ9.' +
        'ZmFrZXNpZ25hdHVyZQ',
    });
    ok('forged signature -> 401', forged.status === 401);
  }

  // ── Meetings ────────────────────────────────────────────────────
  section('Meetings');
  {
    const created = await call('POST', '/meetings', { token: A.token, body: { title: `${TAG} meeting` } });
    ok('create meeting -> 201', created.status === 201, JSON.stringify(created.data));
    meetingId = created.data._id;
    ok('meeting is returned with an id', Boolean(meetingId));
    ok('new meeting reports no audio', created.data.audioAvailable === false);

    const noTitle = await call('POST', '/meetings', { token: A.token, body: {} });
    ok('missing title -> 400', noTitle.status === 400);

    const list = await call('GET', '/meetings', { token: A.token });
    ok('list includes the new meeting', list.data.some((m) => m._id === meetingId));

    const badId = await call('GET', '/meetings/not-a-valid-id', { token: A.token });
    ok('malformed id -> 404 (not 500)', badId.status === 404);
  }

  // ── Upload ──────────────────────────────────────────────────────
  section('Upload');
  {
    const rejected = await uploadAudio(meetingId, A.token, {
      mime: 'application/x-msdownload',
      filename: 'evil.exe',
    });
    ok('non-audio upload rejected -> 400', rejected.status === 400, JSON.stringify(rejected.data));

    const up = await uploadAudio(meetingId, A.token);
    ok('audio upload -> 200', up.status === 200, JSON.stringify(up.data));
    ok('audio now reported available', up.data.meeting.audioAvailable === true);

    const detail = await call('GET', `/meetings/${meetingId}`, { token: A.token });
    const files = fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : [];
    const mine = files.filter((f) => f.endsWith('.wav'));
    mine.forEach((f) => createdFiles.push(path.join(UPLOADS, f)));
    // Assert separately, so a wrong path fails as "found nothing" rather than
    // silently satisfying the naming check with an empty list.
    ok('uploaded file is on disk', mine.length > 0, `looked in ${UPLOADS}`);
    ok('stored filename is randomised, not client-supplied',
      mine.length > 0 && !mine.some((f) => f.includes('clip')), mine.join(','));
    ok('stored name matches <timestamp>-<random>.wav',
      mine.some((f) => /^\d+-[0-9a-f]{16}\.wav$/.test(f)), mine.join(','));
    ok('audioUrl advertised on detail', detail.data.audioUrl === `/api/meetings/${meetingId}/audio`);

    const audioRes = await fetch(`${BASE}/meetings/${meetingId}/audio`, {
      headers: { Authorization: `Bearer ${A.token}` },
    });
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    ok('audio streams back', audioRes.status === 200);
    ok('audio content-type is audio/wav', audioRes.headers.get('content-type') === 'audio/wav');
    ok('audio bytes round-trip intact', audioBuf.length === makeWav().length,
      `${audioBuf.length} vs ${makeWav().length}`);

    const noAuthAudio = await fetch(`${BASE}/meetings/${meetingId}/audio`);
    ok('audio requires auth', noAuthAudio.status === 401);
  }

  // ── Cross-account isolation ─────────────────────────────────────
  section('Cross-account isolation');
  {
    const peek = await call('GET', `/meetings/${meetingId}`, { token: B.token });
    ok("other user's meeting -> 404 (not 403)", peek.status === 404);

    const listB = await call('GET', '/meetings', { token: B.token });
    ok("other user's list excludes it", !listB.data.some((m) => m._id === meetingId));

    const audioB = await fetch(`${BASE}/meetings/${meetingId}/audio`, {
      headers: { Authorization: `Bearer ${B.token}` },
    });
    ok("other user cannot stream the audio", audioB.status === 404);

    const transcribeB = await call('POST', `/transcribe/${meetingId}`, { token: B.token });
    ok('other user cannot start transcription', transcribeB.status === 404);

    const analyzeB = await call('POST', `/analyze/${meetingId}`, { token: B.token });
    ok('other user cannot analyze', analyzeB.status === 404);

    const deleteB = await call('DELETE', `/meetings/${meetingId}`, { token: B.token });
    ok('other user cannot delete', deleteB.status === 404);

    const stillThere = await call('GET', `/meetings/${meetingId}`, { token: A.token });
    ok('meeting survived the delete attempt', stillThere.status === 200);
  }

  // ── Transcription (the new async flow) ──────────────────────────
  section('Transcription');
  {
    const started = await call('POST', `/transcribe/${meetingId}`, { token: A.token });
    ok('POST returns 202 Accepted', started.status === 202, JSON.stringify(started.data));
    ok('202 body reports transcribing', started.data.status === 'transcribing');
    ok('202 body is not done', started.data.done === false);

    let progress = null;
    const deadline = Date.now() + 30000;
    let polls = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const res = await call('GET', `/transcribe/${meetingId}`, { token: A.token });
      polls++;
      progress = res.data;
      if (progress.done) break;
    }
    ok('polling reached a terminal state', progress && progress.done === true);
    ok('status is transcribed', progress.status === 'transcribed', progress.status);
    ok('transcript text was stored', Boolean(progress.transcript));
    ok('no error recorded', !progress.error);
    console.log(`         (finished after ${polls} poll${polls === 1 ? '' : 's'})`);

    const meeting = await call('GET', `/meetings/${meetingId}`, { token: A.token });
    ok('transcript is on the meeting document', meeting.data.transcript === progress.transcript);
    ok('transcriptId cleared after completion', !meeting.data.transcriptId);
  }

  // ── Analysis ────────────────────────────────────────────────────
  section('Analysis');
  {
    const res = await call('POST', `/analyze/${meetingId}`, { token: A.token });
    ok('analyze -> 200', res.status === 200, JSON.stringify(res.data).slice(0, 200));
    ok('status is completed', res.data.meeting.status === 'completed');
    ok('SRS produced', Boolean(res.data.meeting.srs));
    ok('requirements produced', Array.isArray(res.data.meeting.requirements) && res.data.meeting.requirements.length > 0);
    ok('user stories produced', res.data.meeting.userStories.length > 0);
    ok('api endpoints produced', res.data.meeting.apiEndpoints.length > 0);
    ok('db tables produced', res.data.meeting.dbTables.length > 0);
  }

  // ── Ephemeral-audio self-heal ───────────────────────────────────
  section('Missing audio self-heal');
  {
    // Simulate a redeploy wiping the uploads directory.
    let wiped = 0;
    createdFiles.forEach((f) => {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        wiped++;
      }
    });
    ok('audio file was actually removed from disk', wiped > 0, `createdFiles=${createdFiles.length}`);

    const detail = await call('GET', `/meetings/${meetingId}`, { token: A.token });
    ok('audioAvailable flips to false', detail.data.audioAvailable === false);
    ok('audioUrl is withdrawn', detail.data.audioUrl === '');
    ok('transcript survives the audio loss', Boolean(detail.data.transcript));

    const stream = await fetch(`${BASE}/meetings/${meetingId}/audio`, {
      headers: { Authorization: `Bearer ${A.token}` },
    });
    ok('streaming missing audio -> 404 JSON', stream.status === 404);

    const retry = await call('POST', `/transcribe/${meetingId}`, { token: A.token });
    ok('re-transcribe without audio -> 400', retry.status === 400, `got ${retry.status}`);
  }

  // ── Unknown routes ──────────────────────────────────────────────
  section('Routing');
  {
    const unknown = await call('GET', '/definitely-not-a-route');
    ok('unknown API route -> JSON 404, not the SPA shell', unknown.status === 404 && !!unknown.data.error);
    ok('404 body is JSON', /application\/json/.test(unknown.contentType || ''));

    const spa = await fetch(`http://localhost:${PORT}/some/deep/link`);
    const spaText = await spa.text();
    ok('non-API route serves the SPA shell', spa.status === 200 && /<html/i.test(spaText));
  }

  // ── Delete ──────────────────────────────────────────────────────
  section('Delete');
  {
    const del = await call('DELETE', `/meetings/${meetingId}`, { token: A.token });
    ok('delete -> 200', del.status === 200);
    const gone = await call('GET', `/meetings/${meetingId}`, { token: A.token });
    ok('deleted meeting is gone', gone.status === 404);
    meetingId = null;
  }
})()
  .catch((error) => {
    failures.push(`RUN ABORTED: ${error.message}`);
    console.log(`\n  !! ${error.message}`);
  })
  .finally(async () => {
    // ── Cleanup ───────────────────────────────────────────────────
    console.log('\n  Cleanup');
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 300));
      console.log('    server stopped');
    }

    createdFiles.forEach((f) => {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {
        console.log(`    could not remove ${f}: ${e.message}`);
      }
    });

    try {
      require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });
      const mongoose = require('mongoose');
      await mongoose.connect(process.env.MONGODB_URI);

      const users = await mongoose.connection
        .collection('users')
        .find({ email: { $regex: '@specora-e2e\\.invalid$' } })
        .toArray();
      const ids = users.map((u) => u._id);

      const meetings = await mongoose.connection
        .collection('meetings')
        .deleteMany({ user: { $in: ids } });
      const removed = await mongoose.connection
        .collection('users')
        .deleteMany({ _id: { $in: ids } });

      console.log(`    removed ${removed.deletedCount} test user(s), ${meetings.deletedCount} meeting(s)`);

      const leftoverUsers = await mongoose.connection
        .collection('users')
        .countDocuments({ email: { $regex: '@specora-e2e\\.invalid$' } });
      const leftoverMeetings = await mongoose.connection
        .collection('meetings')
        .countDocuments({ title: { $regex: '^e2e-' } });
      console.log(
        leftoverUsers === 0 && leftoverMeetings === 0
          ? '    verified: no test data remains in Atlas'
          : `    WARNING: ${leftoverUsers} user(s) and ${leftoverMeetings} meeting(s) still present`
      );
      if (leftoverUsers || leftoverMeetings) failures.push('cleanup left test data behind');

      await mongoose.disconnect();
    } catch (e) {
      console.log(`    CLEANUP FAILED: ${e.message}`);
      failures.push(`cleanup failed: ${e.message}`);
    }

    console.log(
      failures.length
        ? `\n${failures.length} FAILED (${pass} passed):\n  - ${failures.join('\n  - ')}\n`
        : `\nAll ${pass} end-to-end checks passed.\n`
    );
    process.exit(failures.length ? 1 : 0);
  });
