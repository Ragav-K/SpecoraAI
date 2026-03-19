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
   cp backend/.env.example backend/.env   # create file if missing
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

| Key | Description |
| --- | ----------- |
| `PORT` | Server port (default 5000) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ASSEMBLYAI_API_KEY` | Speech-to-text API key |
| `OPENAI_API_KEY` | GPT analysis key |
| `BREVO_API_KEY` | Email (OTP/password reset) |
| `EMAIL_FROM` | Sender email for Brevo (default `noreply@specora.ai`) |

Optional but recommended:
- `NODE_ENV` for production settings.

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

2. **Skip Transcription**  
   - Frontend shows status message “Transcription skipped (check API key)” if `/api/transcribe/:id` fails (e.g., missing key).  
   - Ensures rest of pipeline continues.

3. **Mock Transcript & Analysis**  
   - Manually set `meeting.transcript` in MongoDB or add a temporary admin route.  
   - Then call `/api/analyze/:id` to test GPT integration (requires OpenAI key).  
   - Alternatively stub `aiService` to return sample JSON for UI testing.

4. **Polling Endpoint**  
   - Hit `GET /api/transcribe/:meetingId` to confirm status returns even without real AssemblyAI jobs.

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
| DELETE | `/meetings/:id` | Delete meeting (does not remove file yet) |

### Transcription

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/transcribe/:meetingId` | Uploads to AssemblyAI and starts transcription |
| GET | `/transcribe/:meetingId` | Returns `status` + `transcript` without triggering new jobs |

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
