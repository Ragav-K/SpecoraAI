# Specora AI

Turn client meetings into structured software documentation. Record or upload audio, transcribe it with AssemblyAI, and let an LLM generate SRS, user stories, API suggestions, DB schema and architecture notes.

## Features

- Record in the browser or upload meeting audio
- Background transcription via AssemblyAI with progress polling
- AI analysis (OpenAI or Groq) producing structured documentation
- Review and export docs as Markdown
- OTP-based signup/login with password reset
- Mock mode (`MOCK_AI=true`) to run the full pipeline with no API calls

## Tech Stack

HTML/CSS/vanilla JS frontend, Node.js + Express backend, MongoDB, AssemblyAI, OpenAI/Groq, Resend/Brevo for email.

## Repository Layout

```
Specora AI/
├── specora-ai/      # The application (backend, frontend, tests)
│   ├── backend/
│   ├── frontend/
│   ├── tests/
│   └── README.md    # Full docs: setup, env vars, API reference
├── .env.example     # Environment template
├── firebase.json    # Firebase hosting config
└── firestore.rules
```

## Quick Start

```bash
cd specora-ai
npm install
mkdir uploads
cp ../.env.example backend/.env   # then fill in your values
npm run dev
```

Open `http://localhost:5000`. Set `MOCK_AI=true` and `EMAIL_PROVIDER=console` in `backend/.env` to try it without any API keys.

## Documentation

See [specora-ai/README.md](specora-ai/README.md) for environment variables, the API reference, and testing instructions.

## License

Internal project; do not redistribute without permission.
