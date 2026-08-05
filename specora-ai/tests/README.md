# Tests

Four suites, no test framework — plain Node scripts that exit non-zero on
failure, so they work anywhere Node runs.

| Command | What it does | Needs |
| --- | --- | --- |
| `npm test` | Both unit suites | nothing |
| `npm run test:unit` | Same as `npm test` | nothing |
| `npm run test:e2e` | Boots the real server and drives the full pipeline over HTTP | `backend/.env` (Mongo) |
| `npm run test:prod` | Smoke-tests the live deployment | `backend/.env` (Mongo) |

## Unit (`tests/unit`) — 48 checks

No database, no network, no API keys. The model and service layers are stubbed
via the require cache, and the frontend client runs in a `vm` sandbox with a
scripted `fetch`.

- **`transcription-job.test.js`** — the background job: happy path, failure
  capture, de-duplication (a second POST must not start a second billed
  AssemblyAI job), restart-resume (a stored job id must be polled, not
  re-uploaded), missing-audio handling, and cross-account isolation.
- **`api-client.test.js`** — the polling client: header merging (the
  `Authorization` header must survive a caller's own `headers`), transient
  network retry, immediate abort on 401, overall timeout, and the two
  legacy-backend compatibility shims.

## End-to-end (`tests/e2e`)

### `local.test.js` — 66 checks

Spawns the real server on port 5099 and drives it over HTTP: auth (signup →
OTP → verify → login, plus the account-enumeration defences), auth enforcement,
meetings, upload (including rejection of non-audio and the randomised storage
filename), cross-account isolation, the async transcription contract, analysis,
the missing-audio self-heal, routing, and delete.

Runs with `MOCK_AI=true` and `EMAIL_PROVIDER=console`, so **no AssemblyAI, AI
provider or email calls are made** — nothing is billed and no mail is sent. The
OTP is read from the server's own log output.

### `production.test.js` — 49 checks

Points at the live deployment (override with `SPECORA_SITE` / `SPECORA_API`).
Verifies the deployed bundle byte-matches the committed source, the cache-busting
version is current, the new backend contract is actually live, and then drives
auth, CORS, meetings, upload, isolation and the 202-plus-polling flow.

Two deliberate differences from the local suite:

- Test users are **seeded straight into Atlas as already-verified**, because
  production emails OTPs through Resend rather than logging them. No real email
  is ever sent.
- **Analysis is not exercised**, to avoid spending AI-provider quota. The
  transcription step does submit a ~1 second clip to AssemblyAI for real, which
  costs a fraction of a cent. That clip is a synthesised tone rather than
  speech, so AssemblyAI rejects it — the assertion is that the failure is
  *reported with its reason*, which is the behaviour being tested.

## Test data safety

Both end-to-end suites write to whatever `MONGODB_URI` points at, which is your
real cluster. Every record they create is tagged `@specora-e2e.invalid` and
deleted in a `finally` block that runs even if the suite throws. The final lines
of each run confirm the cleanup:

```
removed 2 test user(s), 0 meeting(s)
verified: no test data remains in Atlas
```

If you ever see a `WARNING: N user(s) remain`, the run left data behind and the
suite exits non-zero. Clean it up with:

```bash
node -e "require('dotenv').config({path:'./backend/.env'});const m=require('mongoose');(async()=>{await m.connect(process.env.MONGODB_URI);const u=await m.connection.collection('users').find({email:{\$regex:'@specora-e2e\\\\.invalid\$'}}).toArray();const ids=u.map(x=>x._id);console.log('meetings',(await m.connection.collection('meetings').deleteMany({user:{\$in:ids}})).deletedCount,'users',(await m.connection.collection('users').deleteMany({_id:{\$in:ids}})).deletedCount);await m.disconnect()})()"
```
