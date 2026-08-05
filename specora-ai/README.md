# Specora AI

Specora AI converts raw client meetings into structured software documentation. It captures audio (live or uploaded), transcribes via AssemblyAI, and summarizes with GPT-powered analysis to produce SRS, user stories, API suggestions, and more.

---

## Table of Contents

1. [Project Overview](#project-overview)  
2. [Tech Stack](#tech-stack)  
3. [Setup Instructions](#setup-instructions)  
4. [Environment Variables](#environment-variables)  
5. [Running the App Locally](#running-the-app-locally)  
6. [Mock Testing Before AssemblyAI Access](#mock-testing-before-assemblyai-access)  
7. [API Reference](#api-reference)  
8. [Known Limitations & To‑Dos](#known-limitations--to-dos)

---

## Project Overview

1. **Record or Upload Audio** – Browser-based MediaRecorder and drag‑and‑drop upload support.  
2. **Transcribe** – Sends audio to AssemblyAI; progress is tracked per meeting.  
3. **Analyze** – GPT-4/OpenAI generates structured documentation (SRS, user stories, APIs, DB schema, architecture notes).  
4. **Review & Export** – Rich UI to review docs, edit, and export markdown (PDF/DOCX pending).  
5. **Auth & Sessions** – OTP-based signup/login with password-reset.

---

## Tech Stack

- **Frontend**: HTML, CSS, vanilla JS  
- **Backend**: Node.js, Express.js  
- **Database**: MongoDB (Atlas)  
- **AI Services**: AssemblyAI (speech), OpenAI (GPT analysis)  
- **Email**: Brevo transactional API  
- **Other**: Multer for uploads, Axios for HTTP

---

## Setup Instructions

1. **Clone repo**  
   ```bash
   git clone <repo-url>
   cd specora-ai
   ```

2. **Install backend dependencies** (includes frontend build assets)  
   ```bash
   npm install
   ```

3. **Create uploads dir**  
   ```bash
   mkdir -p uploads
   ```

4. **Copy environment template**  
   ```bash
   cp ../.env.example backend/.env
   ```

5. **Fill .env** (see below).

6. **Run backend**  
   ```bash
   npm run dev
   ```

7. **Open frontend**  
   Visit `http://localhost:5000/` (served by Express). Auth page at `/auth.html`.

---

## Environment Variables

Create `backend/.env` with:

| Key | Required | Description |
| --- | --- | ----------- |
| `MONGODB_URI` | yes | MongoDB Atlas connection string |
| `JWT_SECRET` | in production | Signs session tokens. The server **refuses to start in production without it**; in development a random per-process secret is used instead, which invalidates sessions on every restart. |
| `ASSEMBLYAI_API_KEY` | yes | Speech-to-text API key |
| `PORT` | no | Server port (default 5000) |
| `NODE_ENV` | no | Set to `production` when deploying |

**AI analysis** — `AI_PROVIDER` picks the backend (`openai` \| `groq` \| `mock`); only the selected provider's key is needed.

| Key | Description |
| --- | ----------- |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | For `AI_PROVIDER=openai` (default model `gpt-4o`) |
| `GROQ_API_KEY` / `GROQ_MODEL` | For `AI_PROVIDER=groq` |
| `MOCK_AI` | `true` forces a mock transcript **and** mock analysis — no AssemblyAI or AI calls at all |

**Email (OTP + password reset)** — `EMAIL_PROVIDER` picks the backend (`resend` \| `brevo` \| `console`).

| Key | Description |
| --- | ----------- |
| `RESEND_API_KEY` | For `EMAIL_PROVIDER=resend`. Needs a DNS-verified domain, or it only delivers to the Resend account owner. |
| `BREVO_API_KEY` | For `EMAIL_PROVIDER=brevo`. No domain needed, but `EMAIL_FROM` must be a verified sender. |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Sender identity. Required for Brevo; Resend falls back to `onboarding@resend.dev`. |

`EMAIL_PROVIDER=console` prints the code to the server log instead of sending it — development only, and the server rejects it in production so new users are never silently locked out.

See [`.env.example`](../.env.example) for a copy-ready file.

---

## Running the App Locally

1. **Backend / API**  
   ```bash
   npm run dev  # nodemon backend/server.js
   ```
   - Serves frontend static files.
   - Exposes `/api/*` routes.

2. **Frontend**  
   Hosted by the backend; visit `http://localhost:5000/auth.html` for auth, `index.html` after login.

3. **MongoDB**  
   - Use local MongoDB or Atlas cluster.
   - Ensure IP whitelist includes localhost if using Atlas.

4. **Auth Flow**  
   - Signup triggers OTP email via Brevo.
   - To bypass during local dev, either mock `sendOTPEmail` or set `BREVO_API_KEY` and verify sender domain.

---

## Mock Testing Before AssemblyAI Access

Tasks to verify without calling AssemblyAI:

1. **Create Meeting + Upload**  
   - Use a dummy audio file; backend stores it locally without contacting AssemblyAI.

2. **Mock Transcript & Analysis**  
   - Set `MOCK_AI=true` to run the whole pipeline with a canned transcript and
     canned analysis — no AssemblyAI or AI provider calls, and no billing.

3. **Failed Transcription**  
   - With a bad `ASSEMBLYAI_API_KEY`, the job fails and stores the reason; the
     UI shows it on the transcription step and the rest of the pipeline
     continues.

4. **Polling Endpoint**  
   - Hit `GET /api/transcribe/:meetingId` to confirm status reporting without
     starting a real AssemblyAI job.

---

## API Reference

All routes prefixed with `/api`.

### Auth

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/auth/signup` | Request signup OTP (email, name, password) |
| POST | `/auth/verify-otp` | Verify OTP to activate account |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/forgot-password` | Send reset OTP |
| POST | `/auth/reset-password` | Validate OTP + set new password |

### Meetings

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/meetings` | Create meeting (`title`) |
| GET | `/meetings` | List meetings |
| GET | `/meetings/:id` | Fetch meeting |
| POST | `/meetings/:id/upload` | Upload audio (`audio` form field) |
| GET | `/meetings/:id/audio` | Stream the meeting's audio |
| DELETE | `/meetings/:id` | Delete meeting and its audio file |

> **Audio storage:** uploads are written to the local `uploads/` directory. On
> platforms with an ephemeral filesystem (Render, Heroku, most containers) that
> directory is wiped on every redeploy. The API checks the file actually exists
> before reporting `audioAvailable`/`audioUrl`, and clears the stale pointer
> when it doesn't, so a meeting whose audio is gone reports itself honestly
> instead of serving a player that cannot load. Transcripts and analysis live in
> MongoDB and are unaffected. Durable audio retention needs object storage
> (S3/R2/GCS) — that is not wired up.

### Transcription

Transcription runs as a **background job**, because a long recording takes far
longer than any hosting platform will hold an HTTP request open. Start the job,
then poll until `done`.

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/transcribe/:meetingId` | Starts (or resumes) transcription. Returns **202** immediately with `{ status, transcript, error, done }` — it does not wait for the transcript. Calling it again while a job is running reports progress instead of starting a second, separately billed job. Returns 400 if no audio is attached, 410 if the stored audio file is gone. |
| GET | `/transcribe/:meetingId` | Poll progress: `{ status, transcript, error, done }`. `done` is true once the job reaches `transcribed` or `error`; on failure, `error` carries the reason. |

The client helper `API.transcribeAndWait(meetingId, { onProgress })` wraps both
calls and resolves with the transcript text.

If the server restarts mid-job, the meeting keeps `status: 'transcribing'` and
the AssemblyAI job id, and the next poll resumes that same job rather than
re-uploading the audio.

### AI Analysis

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/analyze/:meetingId` | Runs GPT analysis using stored transcript |

---

## Known Limitations & To‑Dos

1. **Front-End Security**: Sanitization improvements ongoing (recent XSS fix). Continue auditing for unsafe `innerHTML` usage.  
2. **Uploads Cleanup**: Deleted meetings do not remove files from disk; add cleanup process.  
3. **Multer Storage**: Saves files locally; production should use cloud storage (S3, GCS).  
4. **AssemblyAI Timeout**: Basic 5‑minute timeout implemented; consider webhooks for long audio.  
5. **OpenAI Costs**: No rate limiting or caching; add quotas per user.  
6. **Exports**: PDF/DOCX exports planned but currently disabled.  
7. **Testing**: Need automated tests (unit/integration) for auth, meeting flows, and services.  
8. **Frontend Build**: No bundler or asset pipeline; consider Vite/React for scalability.  
9. **Access Control**: API lacks server-side auth middleware; rely on future JWT/ session verification.  
10. **DevOps**: Add Dockerfile, CI, and deployment instructions.

---

## Contributing

1. Fork & branch (`codex/<feature>`).  
2. Run lint/tests (when available).  
3. Submit PR with explanation & screenshots/GIFs.  
4. Coordinate on environment variables before pushing features requiring new secrets.

---

## License

© Specora AI. Internal project; do not redistribute without permission.
