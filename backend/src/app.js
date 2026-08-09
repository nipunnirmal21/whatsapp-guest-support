require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const logger                     = require('./utils/logger');
const errorHandler               = require('./middleware/errorHandler');
const requireDashboardAuth       = require('./middleware/auth');
const validateWebhookSignature   = require('./middleware/validateWebhookSignature');
const supabase                   = require('./db/client');

// Route modules
const webhookWhatsappRouter  = require('./routes/webhooks/whatsapp');
const messagesRouter         = require('./routes/api/messages');
const conversationsRouter    = require('./routes/api/conversations');
const escalationsRouter      = require('./routes/api/escalations');
const intentsRouter          = require('./routes/api/intents');
const settingsRouter         = require('./routes/api/settings');
const adminUsersRouter       = require('./routes/api/adminUsers');

const app = express();

// ---------------------------------------------------------------------------
// Security & general middleware
// ---------------------------------------------------------------------------
app.use(helmet());

app.use(
  cors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.BASE_URL
      : '*',
  })
);

// HTTP request logger (uses winston stream)
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    // Skip health-check noise in production
    skip: (req) =>
      process.env.NODE_ENV === 'production' && req.path === '/health',
  })
);

// ---------------------------------------------------------------------------
// Body parsing
// We need the raw body buffer on the webhook route for signature validation.
// All other routes use standard JSON parsing.
// ---------------------------------------------------------------------------
app.use(
  '/webhooks/whatsapp',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    // Expose the raw buffer so validateWebhookSignature can HMAC it
    req.rawBody = req.body;
    // Now parse the JSON so downstream handlers work with req.body as an object
    try {
      req.body = JSON.parse(req.body.toString());
    } catch {
      req.body = {};
    }
    next();
  }
);

// Standard JSON parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api/', apiLimiter);

// Stricter limit for the send endpoint to prevent accidental bulk sends
const sendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Send rate limit reached.' },
});
app.use('/api/messages/send', sendLimiter);

// AI classification is comparatively expensive; keep previews from being
// used as an unbounded LLM proxy.
const classifyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Classification rate limit reached.' },
});
app.use('/api/intents/classify', classifyLimiter);

// ---------------------------------------------------------------------------
// Health endpoint — verifies process + database reachability
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  const payload = {
    service: 'whatsapp-guest-support',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    // Lightweight round-trip to confirm Supabase / Postgres is reachable
    const { error } = await supabase
      .from('conversations')
      .select('id')
      .limit(1);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      ...payload,
      status: 'ok',
      database: 'connected',
    });
  } catch (err) {
    logger.error('Health check failed — database unreachable', {
      message: err.message,
    });

    return res.status(503).json({
      ...payload,
      status: 'degraded',
      database: 'unreachable',
      error: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Webhook routes (Meta signature validation applied only to POST)
// ---------------------------------------------------------------------------
// GET  /webhooks/whatsapp  — Meta verification handshake (no signature)
// POST /webhooks/whatsapp  — inbound messages / status updates (with signature)
// Mount context is required so router.get('/') matches correctly
app.use('/webhooks/whatsapp', (req, res, next) => {
  if (req.method === 'GET') {
    return webhookWhatsappRouter.handle(req, res, next);
  }
  next();
});

app.post(
  '/webhooks/whatsapp',
  validateWebhookSignature,
  (req, res, next) => {
    req.url = '/';
    req.baseUrl = '/webhooks/whatsapp';
    webhookWhatsappRouter.handle(req, res, next);
  }
);

// ---------------------------------------------------------------------------
// API routes (dashboard) — require API key; webhooks stay unauthenticated
// ---------------------------------------------------------------------------
app.use('/api', requireDashboardAuth);
app.use('/api/messages',      messagesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/escalations',   escalationsRouter);
app.use('/api/intents',       intentsRouter);
app.use('/api/settings',      settingsRouter);
app.use('/api/admin-users',   adminUsersRouter);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
