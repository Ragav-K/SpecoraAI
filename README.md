<div align="center">
  <h1>🎙️ Specora AI</h1>
  <p><strong>Convert raw client meetings into structured software documentation.</strong></p>
</div>

<p align="center">
  <img alt="Firebase" src="https://img.shields.io/badge/Firebase-ffca28?style=flat-square&logo=firebase&logoColor=black" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-4EA94B?style=flat-square&logo=mongodb&logoColor=white" />
  <img alt="OpenAI" src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white" />
</p>

## 📖 Overview

Specora AI captures audio (live or uploaded) from client meetings, transcribes the conversation using AssemblyAI, and leverages GPT-powered analysis to produce structured documentation such as Software Requirements Specifications (SRS), user stories, API suggestions, and architecture notes.

### ✨ Features
- **Record or Upload Audio**: Browser-based MediaRecorder and drag-and-drop file upload support.
- **Automated Transcription**: Highly accurate speech-to-text processing via AssemblyAI.
- **GPT-Powered Analysis**: Generates comprehensive documentation including SRS, user stories, API routes, DB schema, and architecture notes using OpenAI's GPT-4.
- **Review & Export**: Interactive UI for reviewing and editing documents. Export documentation to Markdown (PDF/DOCX pending).
- **Secure Authentication**: OTP-based signup and login with secure session management and password reset functionality.

---

## 🛠️ Tech Stack

### Frontend
- **Technologies**: HTML5, CSS3, Vanilla JavaScript
- **Hosting**: Firebase Hosting

### Backend
- **Framework**: Node.js, Express.js
- **Database**: MongoDB (Atlas)
- **Functions**: Firebase Cloud Functions

### AI & Integrations
- **Speech-to-Text**: AssemblyAI
- **LLM/Analysis**: OpenAI (GPT-4)
- **Email Delivery**: Brevo (Transactional API)

---

## 📂 Repository Structure

```text
.
├── specora-ai/          # Main application (Backend & Frontend)
│   ├── backend/         # Node.js + Express.js API
│   ├── frontend/        # Vanilla JS Client
│   └── package.json     # App dependencies
├── functions/           # Firebase Cloud Functions
├── public/              # Firebase static hosting assets
├── firebase.json        # Firebase configuration
└── .firebaserc          # Firebase project definitions
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- MongoDB Database (Local or Atlas)
- Firebase CLI (for deployment and local emulation)

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd specora-ai
   ```

2. **Install application dependencies**
   ```bash
   cd specora-ai
   npm install
   ```

3. **Install Firebase Function dependencies**
   ```bash
   cd ../functions
   npm install
   ```

4. **Environment Configuration**
   Copy the `.env.example` in the `specora-ai/backend` directory to `.env` and fill in your keys:
   ```bash
   cd ../specora-ai/backend
   cp .env.example .env
   ```

   **Required `.env` Variables:**
   | Variable | Description |
   | --- | --- |
   | `PORT` | Server port (default 5000) |
   | `MONGODB_URI` | MongoDB connection string |
   | `ASSEMBLYAI_API_KEY` | AssemblyAI speech-to-text API key |
   | `OPENAI_API_KEY` | OpenAI GPT analysis API key |
   | `BREVO_API_KEY` | Brevo Email API key (for OTP/password reset) |
   | `EMAIL_FROM` | Sender email address (e.g., `noreply@specora.ai`) |

### Running Locally

1. **Start the main backend & frontend**
   ```bash
   cd specora-ai
   npm run dev
   ```
   *The backend serves the frontend static files on `http://localhost:5000/`.*

2. **Firebase Functions** (Optional)
   ```bash
   cd functions
   npm run serve
   ```

---

## 📡 API Reference

All backend routes are prefixed with `/api`.

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/signup` | Request signup OTP (email, name, password) |
| `POST` | `/verify-otp` | Verify OTP to activate account |
| `POST` | `/login` | Login with email and password |
| `POST` | `/forgot-password` | Send password reset OTP |
| `POST` | `/reset-password` | Validate OTP and set a new password |

### Meetings (`/api/meetings`)
| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/` | Create a new meeting (`title`) |
| `GET` | `/` | List all meetings |
| `GET` | `/:id` | Fetch specific meeting details |
| `POST` | `/:id/upload` | Upload audio file for a meeting |
| `DELETE`| `/:id` | Delete a meeting |

### AI & Transcription (`/api`)
| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/transcribe/:meetingId` | Uploads audio to AssemblyAI and begins transcription |
| `GET` | `/transcribe/:meetingId` | Retrieves transcription status and text |
| `POST` | `/analyze/:meetingId` | Triggers GPT documentation generation using the transcript |

---

## 🧪 Mock Testing (Without AI Keys)

If you lack AssemblyAI or OpenAI keys during development:
1. **Upload Audio**: Backend will store it locally without hitting AssemblyAI.
2. **Skip Transcription**: UI will display "Transcription skipped" if the API call fails.
3. **Mock Analysis**: Manually inject a `transcript` payload into your MongoDB document and hit the `/api/analyze/:id` endpoint or mock the response from `aiService`.

---

## ☁️ Firebase Deployment

The project utilizes Firebase for hosting and cloud functions.

**Deploy everything:**
```bash
firebase deploy
```

**Deploy hosting only:**
```bash
firebase deploy --only hosting
```

**Deploy functions only:**
```bash
firebase deploy --only functions
```

---

## 📌 Known Limitations & To-Dos

- [ ] **Frontend Build Pipeline:** Migrate vanilla JS to a bundler (Vite) or React for better state management.
- [ ] **Cloud Storage:** Migrate local Multer uploads to AWS S3 or Google Cloud Storage.
- [ ] **Export Options:** Implement PDF and DOCX export options.
- [ ] **Cleanup Jobs:** Implement automated file cleanup when meetings are deleted.
- [ ] **Automated Tests:** Add robust unit and integration testing workflows.

---

## 📄 License

© Specora AI. **Internal project; do not redistribute without permission.**
