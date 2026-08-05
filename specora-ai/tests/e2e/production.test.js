/**
 * Production smoke test — drives the LIVE deployment:
 *   frontend  https://specoraai.web.app        (Firebase Hosting)
 *   backend   https://specoraai.onrender.com   (Render)
 *
 * Test accounts are seeded directly into Atlas as already-verified users, so
 * production never sends a real OTP email. Everything created is tagged and
 * removed in the finally block.
 *
 * Cost note: production has no MOCK_AI, so the transcription step submits a
 * ~1 second clip to AssemblyAI for real. That is a fraction of a cent. The
 * analysis step is NOT exercised, to avoid burning AI-provider quota.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = process.env.SPECORA_SITE || 'https://specoraai.web.app';
const API = process.env.SPECORA_API || 'https://specoraai.onrender.com/api';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });

const TAG = `prod-e2e-${Date.now()}`;
const PASSWORD = 'test-pw-1234';
const emailA = `${TAG}-a@specora-e2e.invalid`;
const emailB = `${TAG}-b@specora-e2e.invalid`;

let pass = 0;
const failures = [];
let currentSection = '';
const section = (n) => {
  currentSection = n;
  console.log(`\n  ${n}`);
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

async function call(method, endpoint, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { _nonJson: text.slice(0, 200) };
  }
  return { status: res.status, data, headers: res.headers };
}

function makeWav() {
  const samples = 8000;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 12) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const cleanup = { meetingIds: [] };

(async () => {
  console.log(`\nSpecora AI production smoke test  (tag: ${TAG})\n`);

  // ── Seed verified users straight into Atlas (no OTP email sent) ──
  await mongoose.connect(process.env.MONGODB_URI);
  const users = mongoose.connection.collection('users');
  const hash = await bcrypt.hash(PASSWORD, 10);
  await users.insertMany([
    { email: emailA, name: 'Prod E2E A', password: hash, isVerified: true, createdAt: new Date() },
    { email: emailB, name: 'Prod E2E B', password: hash, isVerified: true, createdAt: new Date() },
  ]);
  console.log('  seeded 2 verified test users (no email sent)');

  // ── Hosting ─────────────────────────────────────────────────────
  section('Hosting (specoraai.web.app)');
  {
    const res = await fetch(SITE, { signal: AbortSignal.timeout(60000) });
    const html = await res.text();
    ok('site returns 200', res.status === 200);
    ok('served over HTTPS with HSTS', !!res.headers.get('strict-transport-security'));
    ok('serves the app shell', /<html/i.test(html));

    const apiJs = await (await fetch(`${SITE}/api.js?v=1.3`)).text();
    ok('deployed api.js has the new polling client', apiJs.includes('transcribeAndWait'));
    ok('deployed api.js has the header-merge fix', apiJs.includes('return { ...options, headers }'));
    ok('deployed api.js has the legacy-contract shim', apiJs.includes('isTerminal'));

    const appJs = await (await fetch(`${SITE}/app.js?v=1.3`)).text();
    ok('deployed app.js polls for the transcript', appJs.includes('transcribeAndWait'));

    const index = await (await fetch(`${SITE}/index.html`)).text();
    ok('index.html busts the cache at v=1.3', index.includes('api.js?v=1.3') && index.includes('app.js?v=1.3'));

    // The local working tree and the deployed bundle must agree.
    const localApi = fs.readFileSync(path.join(ROOT, 'frontend', 'api.js'), 'utf8');
    ok('deployed api.js matches the committed source',
      apiJs.replace(/\r/g, '') === localApi.replace(/\r/g, ''));
  }

  // ── Backend health ──────────────────────────────────────────────
  section('Backend health');
  let health;
  {
    const res = await call('GET', '/health');
    health = res.data;
    ok('health returns 200', res.status === 200);
    ok('mongodb configured', health.services.mongodb === true);
    ok('assemblyai configured', health.services.assemblyai === true);
    ok('AI provider configured', health.services.ai.configured === true);
    ok('email provider configured', health.services.email.configured === true);
    ok('email provider is not the console stub', health.services.email.provider !== 'console');
    console.log(`         ai=${health.services.ai.provider}/${health.services.ai.model} email=${health.services.email.provider}`);
  }

  // ── New backend contract is actually deployed ───────────────────
  section('Deployed backend version');
  {
    const res = await call('GET', '/transcribe/507f1f77bcf86cd799439011');
    ok('transcribe polls have their own rate limit (new code)',
      res.headers.get('ratelimit-limit') === '1000',
      `got ${res.headers.get('ratelimit-limit')}`);
    const general = await call('GET', '/meetings');
    ok('general routes keep the 100 limit',
      general.headers.get('ratelimit-limit') === '100',
      `got ${general.headers.get('ratelimit-limit')}`);
  }

  // ── Auth ────────────────────────────────────────────────────────
  section('Auth');
  let tokenA, tokenB;
  {
    const login = await call('POST', '/auth/login', { body: { email: emailA, password: PASSWORD } });
    ok('login succeeds', login.status === 200, JSON.stringify(login.data));
    tokenA = login.data.token;
    ok('token issued', Boolean(tokenA));

    const bad = await call('POST', '/auth/login', { body: { email: emailA, password: 'nope' } });
    ok('wrong password -> 401', bad.status === 401);

    const unknown = await call('POST', '/auth/login', {
      body: { email: `${TAG}-ghost@specora-e2e.invalid`, password: 'nope' },
    });
    ok('unknown email indistinguishable from wrong password',
      unknown.status === bad.status && unknown.data.error === bad.data.error);

    const loginB = await call('POST', '/auth/login', { body: { email: emailB, password: PASSWORD } });
    tokenB = loginB.data.token;
    ok('second account logged in', Boolean(tokenB));

    ok('no token -> 401', (await call('GET', '/meetings')).status === 401);
    ok('bad token -> 401', (await call('GET', '/meetings', { token: 'x.y.z' })).status === 401);
  }

  // ── CORS ────────────────────────────────────────────────────────
  section('CORS');
  {
    const good = await fetch(`${API}/health`, {
      headers: { Origin: SITE },
      signal: AbortSignal.timeout(60000),
    });
    ok('hosted origin allowed', good.headers.get('access-control-allow-origin') === SITE);
    const bad = await fetch(`${API}/health`, {
      headers: { Origin: 'https://evil.example' },
      signal: AbortSignal.timeout(60000),
    });
    ok('unknown origin blocked -> 403', bad.status === 403);
  }

  // ── Meetings + upload ───────────────────────────────────────────
  section('Meetings and upload');
  let meetingId;
  {
    const created = await call('POST', '/meetings', {
      token: tokenA,
      body: { title: `${TAG} meeting` },
    });
    ok('create meeting -> 201', created.status === 201, JSON.stringify(created.data));
    meetingId = created.data._id;
    cleanup.meetingIds.push(meetingId);
    ok('new meeting reports no audio', created.data.audioAvailable === false);

    const form = new FormData();
    form.append('audio', new Blob([makeWav()], { type: 'audio/wav' }), 'clip.wav');
    const up = await fetch(`${API}/meetings/${meetingId}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    const upBody = await up.json();
    ok('audio upload -> 200', up.status === 200, JSON.stringify(upBody));
    ok('audio reported available', upBody.meeting.audioAvailable === true);

    const badForm = new FormData();
    badForm.append('audio', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'x.exe');
    const bad = await fetch(`${API}/meetings/${meetingId}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: badForm,
      signal: AbortSignal.timeout(120000),
    });
    ok('non-audio upload rejected -> 400', bad.status === 400);

    const stream = await fetch(`${API}/meetings/${meetingId}/audio`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      signal: AbortSignal.timeout(120000),
    });
    const bytes = Buffer.from(await stream.arrayBuffer());
    ok('audio streams back', stream.status === 200);
    ok('audio bytes intact', bytes.length === makeWav().length);
    ok('audio requires auth', (await fetch(`${API}/meetings/${meetingId}/audio`)).status === 401);
  }

  // ── Isolation ───────────────────────────────────────────────────
  section('Cross-account isolation');
  {
    ok("other user's meeting -> 404",
      (await call('GET', `/meetings/${meetingId}`, { token: tokenB })).status === 404);
    ok('other user cannot transcribe',
      (await call('POST', `/transcribe/${meetingId}`, { token: tokenB })).status === 404);
    ok('other user cannot delete',
      (await call('DELETE', `/meetings/${meetingId}`, { token: tokenB })).status === 404);
    const audioB = await fetch(`${API}/meetings/${meetingId}/audio`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      signal: AbortSignal.timeout(60000),
    });
    ok('other user cannot stream audio', audioB.status === 404);
  }

  // ── The new async transcription contract, in production ─────────
  section('Transcription contract (live AssemblyAI)');
  {
    const t0 = Date.now();
    const started = await call('POST', `/transcribe/${meetingId}`, { token: tokenA });
    const startMs = Date.now() - t0;
    ok('POST returns 202 Accepted, not 200', started.status === 202, `got ${started.status}`);
    // The whole point of the change: the request must return long before the
    // transcription itself could possibly have finished.
    ok('POST returns without waiting for the job', startMs < 10000, `took ${startMs}ms`);
    ok('body reports transcribing', started.data.status === 'transcribing');
    ok('body carries the done flag', started.data.done === false);

    const dup = await call('POST', `/transcribe/${meetingId}`, { token: tokenA });
    ok('duplicate POST does not start a second job', dup.status === 202);

    let progress = null;
    const deadline = Date.now() + 120000;
    let polls = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await call('GET', `/transcribe/${meetingId}`, { token: tokenA });
      polls++;
      progress = res.data;
      ok(`poll ${polls} returns the done flag`, typeof progress.done === 'boolean');
      if (progress.done) break;
    }
    ok('job reached a terminal state', progress && progress.done === true, JSON.stringify(progress));
    console.log(`         final status: ${progress && progress.status} after ${polls} poll(s)`);
    if (progress && progress.status === 'error') {
      console.log(`         reported reason: ${progress.error}`);
      ok('failure carries a reason (rather than a bare error status)', Boolean(progress.error));
    } else {
      ok('completed without error', progress.status === 'transcribed');
    }
  }

  // ── Delete ──────────────────────────────────────────────────────
  section('Delete');
  {
    const del = await call('DELETE', `/meetings/${meetingId}`, { token: tokenA });
    ok('delete -> 200', del.status === 200);
    ok('deleted meeting gone',
      (await call('GET', `/meetings/${meetingId}`, { token: tokenA })).status === 404);
    cleanup.meetingIds = [];
  }
})()
  .catch((e) => {
    failures.push(`RUN ABORTED: ${e.message}`);
    console.log(`\n  !! ${e.message}`);
  })
  .finally(async () => {
    console.log('\n  Cleanup');
    try {
      const db = mongoose.connection;
      const seeded = await db
        .collection('users')
        .find({ email: { $regex: '@specora-e2e\\.invalid$' } })
        .toArray();
      const ids = seeded.map((u) => u._id);
      const m = await db.collection('meetings').deleteMany({ user: { $in: ids } });
      const u = await db.collection('users').deleteMany({ _id: { $in: ids } });
      console.log(`    removed ${u.deletedCount} test user(s), ${m.deletedCount} meeting(s)`);

      const leftU = await db
        .collection('users')
        .countDocuments({ email: { $regex: '@specora-e2e\\.invalid$' } });
      const leftM = await db.collection('meetings').countDocuments({ title: { $regex: 'e2e-' } });
      console.log(
        leftU === 0 && leftM === 0
          ? '    verified: no test data remains in Atlas'
          : `    WARNING: ${leftU} user(s), ${leftM} meeting(s) remain`
      );
      if (leftU || leftM) failures.push('cleanup left data behind');
      console.log(`    real users still present: ${await db.collection('users').countDocuments({ email: { $not: /specora-e2e/ } })}`);
      await mongoose.disconnect();
    } catch (e) {
      console.log(`    CLEANUP FAILED: ${e.message}`);
      failures.push(`cleanup failed: ${e.message}`);
    }

    console.log(
      failures.length
        ? `\n${failures.length} FAILED (${pass} passed):\n  - ${failures.join('\n  - ')}\n`
        : `\nAll ${pass} production checks passed.\n`
    );
    process.exit(failures.length ? 1 : 0);
  });
