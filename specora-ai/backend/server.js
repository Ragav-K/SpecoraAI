require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const aiService = require('./services/aiService');
const emailService = require('./services/emailService');

// Fail fast if JWT_SECRET is missing in production (see config/jwt.js)
require('./config/jwt');

// Route imports
const meetingRoutes = require('./routes/meetingRoutes');
const transcriptionRoutes = require('./routes/transcriptionRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Behind a reverse proxy (Render), the client IP is in X-Forwarded-For.
// Without this, express-rate-limit keys every request to the proxy IP and one
// user hitting the limit locks out everybody.
app.set('trust proxy', 1);

// ── Middleware ──────────────────────────────────────────────────
// Security headers. CSP is disabled because the frontend relies on inline
// onclick handlers and inline styles; CORP is cross-origin because the
// frontend is served from Firebase Hosting while the API runs elsewhere.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5001',
  'https://specoraai.web.app',
];
// SECURITY: whitelist exact frontends and log any blocked origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true); // allow server-to-server or curl without Origin
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`Blocked CORS origin: ${origin}`);
    const corsError = new Error(`CORS policy violation: ${origin} is not allowed`);
    corsError.statusCode = 403;
    return callback(corsError);
  },
  credentials: true,
}));

/**
 * Transcription progress polls are GET /api/transcribe/:id, issued every few
 * seconds for as long as a job runs. They are normal client behaviour, not
 * abuse, and would otherwise consume the entire general budget within a couple
 * of minutes — so they are excluded here and metered separately below.
 */
const isTranscriptionPoll = (req) =>
  req.method === 'GET' && /^\/api\/transcribe\/[^/]+\/?$/.test(req.originalUrl.split('?')[0]);

// Rate limiting for all API routes (abuse mitigation)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTranscriptionPoll,
  message: { error: 'Too many requests. Please try again later.' },
});

// Polls are cheap (one indexed read) but must still be bounded. This ceiling
// comfortably covers a full-length job at the client's poll interval.
const transcriptionPollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status requests. Please try again later.' },
});

// Tighter limit on auth: the global 100/15min is far too loose to slow down
// brute-forcing a 6-digit OTP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

app.use('/api', apiLimiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/transcribe', transcriptionPollLimiter, transcriptionRoutes);
app.use('/api/analyze', aiRoutes);

// ── Health Check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
      mongodb: !!process.env.MONGODB_URI,
      // Which providers are active, and whether their keys are present.
      ai: aiService.describeProvider(),
      email: emailService.describeProvider(),
    },
  });
});

// ── Unknown API routes: JSON 404, never the SPA shell ──────────
// Must come before the catch-all, otherwise a mistyped endpoint returns
// index.html and the client fails with an HTML parse error.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

// ── Fallback: serve index.html for SPA ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ── Global Error Handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.statusCode === 403 || /CORS/i.test(err.message || '')) {
    console.error('CORS error:', err.message, 'Origin:', req.headers.origin);
    return res.status(403).json({ error: err.message || 'CORS policy violation' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start Server ───────────────────────────────────────────────
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();

    app.listen(PORT, () => {
      console.log(`\n🚀 Specora AI server running on http://localhost:${PORT}`);
      console.log(`📁 Frontend served from /frontend`);
      console.log(`📡 API available at http://localhost:${PORT}/api\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
