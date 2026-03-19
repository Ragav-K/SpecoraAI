require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');

// Route imports
const meetingRoutes = require('./routes/meetingRoutes');
const transcriptionRoutes = require('./routes/transcriptionRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────────────────
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

// Rate limiting for all API routes (abuse mitigation)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
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
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/transcribe', transcriptionRoutes);
app.use('/api/analyze', aiRoutes);

// ── Health Check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      mongodb: !!process.env.MONGODB_URI,
    },
  });
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
  res.status(500).json({ error: err.message || 'Internal server error' });
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
