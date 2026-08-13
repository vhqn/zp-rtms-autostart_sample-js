const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { securityHeaders } = require('./middleware/security');

const app = express();
const server = http.createServer(app);

const PORT = process.env.BACKEND_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const FRONTEND_INTERNAL_URL = process.env.FRONTEND_INTERNAL_URL || FRONTEND_URL;
const OAUTH_REDIRECT_URL = process.env.ZOOM_REDIRECT_URL
  || `${process.env.PUBLIC_URL || 'http://localhost:3001'}/api/auth/callback`;
const ZOOM_API_BASE_URL = process.env.ZOOM_API_BASE_URL || 'https://api.zoom.us/v2';
const LOG_FULL_WEBHOOK_PAYLOAD = process.env.LOG_FULL_WEBHOOK_PAYLOAD === 'true'
  || (process.env.NODE_ENV !== 'production' && process.env.LOG_FULL_WEBHOOK_PAYLOAD !== 'false');

// Middleware - IMPORTANT: Order matters!
// 1. CORS must come FIRST
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 2. Body parsers — capture raw body for webhook signature verification
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3. Security headers AFTER CORS
app.use(securityHeaders);

// Session configuration
if (!process.env.SESSION_SECRET) {
  console.warn('[WARN] SESSION_SECRET is not set. Using an ephemeral secret; set SESSION_SECRET before deploying.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be configured in production');
  }
}
if (!process.env.ZOOM_SECRET_TOKEN) {
  console.warn('[WARN] ZOOM_SECRET_TOKEN is not set. Zoom webhooks will be rejected.');
}

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static frontend files (for production/ngrok deployment)
// Only serve static files if build directory exists (not in Docker dev mode)
const frontendBuildPath = path.join(__dirname, '../frontend/build');
const fs = require('fs');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug: Log all incoming requests to /api/webhooks/zoom
app.use('/api/webhooks/zoom', (req, _res, next) => {
  console.log('Webhook request received');
  next();
});

// Home endpoint - serves the React app (for Zoom Marketplace)
// In Docker mode, this redirects to root which is proxied to frontend
app.get('/api/home', (req, res) => {
  // Redirect to root - the proxy will handle serving the frontend
  res.redirect('/');
});

// Start a normal-browser OAuth flow for manual RTMS testing.
app.get('/api/auth/login', (req, res) => {
  if (!process.env.ZOOM_APP_CLIENT_ID || !process.env.ZOOM_APP_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Zoom application credentials are not configured' });
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;

  const authorizeUrl = new URL(
    '/oauth/authorize',
    `${process.env.ZOOM_HOST || 'https://zoom.us'}/`
  );
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ZOOM_APP_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URL,
    state
  }).toString();

  return req.session.save((error) => {
    if (error) {
      console.error('OAuth session setup failed:', error.message);
      return res.status(500).json({ error: 'Unable to start authorization' });
    }
    return res.redirect(authorizeUrl.toString());
  });
});

// OAuth: Authorize endpoint
app.get('/api/auth/authorize', (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // Exchange code for tokens
  const tokenUrl = `${process.env.ZOOM_HOST || 'https://zoom.us'}/oauth/token`;
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: OAUTH_REDIRECT_URL
  });

  const authHeader = Buffer.from(
    `${process.env.ZOOM_APP_CLIENT_ID}:${process.env.ZOOM_APP_CLIENT_SECRET}`
  ).toString('base64');

  axios.post(tokenUrl, params.toString(), {
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then(response => {
    const { access_token, refresh_token } = response.data;

    // Store tokens in session
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.save();

    res.json({ success: true, message: 'Authorization successful' });
  })
  .catch(error => {
    console.error('Token exchange failed:', error.response?.status || error.message);
    res.status(500).json({
      error: 'Failed to exchange authorization code'
    });
  });
});

// OAuth: Callback endpoint
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  if (req.session.oauthState) {
    if (typeof state !== 'string' || state !== req.session.oauthState) {
      return res.status(400).send('Invalid authorization state');
    }
    delete req.session.oauthState;
  }

  try {
    const tokenUrl = `${process.env.ZOOM_HOST || 'https://zoom.us'}/oauth/token`;
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: OAUTH_REDIRECT_URL
    });

    const authHeader = Buffer.from(
      `${process.env.ZOOM_APP_CLIENT_ID}:${process.env.ZOOM_APP_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token } = response.data;

    // Store tokens in session
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    await req.session.save();

    // Redirect back to app
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  } catch (error) {
    console.error('OAuth callback failed:', error.response?.status || error.message);
    res.status(500).send('Authentication failed');
  }
});

// Verify x-zm-signature header on incoming Zoom webhooks
function verifyZoomWebhook(req) {
  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];
  const secretToken = process.env.ZOOM_SECRET_TOKEN;

  if (typeof timestamp !== 'string' || typeof signature !== 'string' || !secretToken) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const message = `v0:${timestamp}:${req.rawBody || ''}`;
  const hash = crypto
    .createHmac('sha256', secretToken)
    .update(message)
    .digest('hex');
  const expected = `v0=${hash}`;

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

const SENSITIVE_WEBHOOK_KEY_PATTERN = /(^|_)(access_token|authorization|client_secret|password|plain_token|refresh_token|secret_token|signature|token)(_|$)/;
const PERSONAL_WEBHOOK_KEY_PATTERN = /(^|_)(callee_number|caller_number|display_name|email|first_name|last_name|phone|phone_number)(_|$)/;

function normalizeWebhookLogKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function redactWebhookUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '[REDACTED]';
      url.password = '[REDACTED]';
    }
    if (url.search) url.search = '?[REDACTED]';
    if (url.hash) url.hash = '#[REDACTED]';
    return url.toString();
  } catch (_error) {
    return '[REDACTED_URL]';
  }
}

function redactWebhookValue(value, key = '') {
  const normalizedKey = normalizeWebhookLogKey(key);
  if (SENSITIVE_WEBHOOK_KEY_PATTERN.test(normalizedKey)
    || PERSONAL_WEBHOOK_KEY_PATTERN.test(normalizedKey)) {
    return '[REDACTED]';
  }

  if (normalizedKey === 'data' && typeof value === 'string') {
    return `[REDACTED_CONTENT_BYTES:${Buffer.byteLength(value)}]`;
  }

  if (typeof value === 'string' && /^(https?|wss?):\/\//i.test(value)) {
    return redactWebhookUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactWebhookValue(item));
  }

  if (value && typeof value === 'object') {
    const redacted = Object.create(null);
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactWebhookValue(entryValue, entryKey);
    }
    return redacted;
  }

  return value;
}

function logWebhookPayload(body) {
  if (!LOG_FULL_WEBHOOK_PAYLOAD) return;

  try {
    console.log(
      'Webhook payload (sensitive fields redacted):',
      JSON.stringify(redactWebhookValue(body), null, 2)
    );
  } catch (error) {
    console.error('Failed to log webhook payload:', error.message);
  }
}

const MAX_DEBUG_EVENTS = 200;
const MAX_DEBUG_DETAILS_BYTES = 32 * 1024;
const debugEvents = [];
let debugEventSequence = 0;

function limitDebugDetails(details) {
  if (!details || typeof details !== 'object') {
    return {};
  }

  try {
    const serialized = JSON.stringify(details);
    if (Buffer.byteLength(serialized) <= MAX_DEBUG_DETAILS_BYTES) {
      return details;
    }

    return {
      truncated: true,
      preview: serialized.slice(0, MAX_DEBUG_DETAILS_BYTES)
    };
  } catch (_error) {
    return { unavailable: true };
  }
}

function recordDebugEvent(event) {
  const normalized = {
    id: `backend-${++debugEventSequence}`,
    timestamp: typeof event?.timestamp === 'string'
      ? event.timestamp
      : new Date().toISOString(),
    source: 'backend',
    type: event?.type === 'websocket' ? 'websocket' : 'webhook',
    level: ['info', 'warn', 'error'].includes(event?.level) ? event.level : 'info',
    callId: isSafeIdentifier(event?.callId) ? event.callId : null,
    socket: typeof event?.socket === 'string' ? event.socket.slice(0, 32) : null,
    summary: typeof event?.summary === 'string' ? event.summary.slice(0, 200) : 'Backend event',
    details: limitDebugDetails(event?.details)
  };

  debugEvents.unshift(normalized);
  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.length = MAX_DEBUG_EVENTS;
  }

  return normalized;
}

function parseDebugLimit(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), MAX_DEBUG_EVENTS);
}

function normalizeRemoteDebugEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }

  const parsedTimestamp = Date.parse(event.timestamp);
  const rawId = typeof event.id === 'string' || Number.isInteger(event.id)
    ? String(event.id)
    : `event-${Date.now()}`;

  return {
    id: rawId.startsWith('rtms-') ? rawId : `rtms-${rawId}`,
    timestamp: Number.isNaN(parsedTimestamp)
      ? new Date().toISOString()
      : new Date(parsedTimestamp).toISOString(),
    source: 'rtms',
    type: event.type === 'websocket' ? 'websocket' : 'system',
    level: ['info', 'warn', 'error'].includes(event.level) ? event.level : 'info',
    callId: isSafeIdentifier(event.callId) ? event.callId : null,
    socket: typeof event.socket === 'string' ? event.socket.slice(0, 32) : null,
    direction: event.direction === 'sent' || event.direction === 'received'
      ? event.direction
      : null,
    summary: typeof event.summary === 'string' ? event.summary.slice(0, 200) : 'RTMS event',
    details: limitDebugDetails(redactWebhookValue(event.details || {}))
  };
}

// Store recent webhook event signatures to prevent duplicates
const recentWebhooks = new Map();
const WEBHOOK_DEDUP_WINDOW_MS = 5000; // 5 seconds
const PHONE_RTMS_EVENT_ALIASES = new Map([
  ['phone.call_rtms_started', 'phone.rtms_started'],
  ['phone.call_rtms_stopped', 'phone.rtms_stopped'],
  ['phone.call_rtms_interrupted', 'phone.rtms_interrupted']
]);
const PHONE_RTMS_EVENTS = new Set([
  'phone.rtms_started',
  'phone.rtms_stopped',
  'phone.rtms_interrupted'
]);
const PHONE_RTMS_ACTIONS = new Set(['start', 'stop']);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeIdentifier(value) {
  const candidate = Number.isInteger(value) ? String(value) : value;
  return typeof candidate === 'string' && SAFE_IDENTIFIER_PATTERN.test(candidate);
}

function normalizePhoneRtmsEvent(event) {
  return PHONE_RTMS_EVENT_ALIASES.get(event) || event;
}

function getZoomAccessToken(req) {
  if (typeof req.session?.accessToken === 'string' && req.session.accessToken.length > 0) {
    return req.session.accessToken;
  }

  // A test-only token is useful when the browser OAuth callback is not available.
  // Never allow this fallback in production.
  if (
    process.env.NODE_ENV !== 'production'
    && typeof process.env.ZOOM_TEST_ACCESS_TOKEN === 'string'
    && process.env.ZOOM_TEST_ACCESS_TOKEN.length > 0
  ) {
    return process.env.ZOOM_TEST_ACCESS_TOKEN;
  }

  return null;
}

function buildZoomApiUrl(pathname) {
  const baseUrl = new URL(ZOOM_API_BASE_URL);
  if (baseUrl.protocol !== 'https:') {
    throw new Error('Zoom API base URL must use HTTPS');
  }

  return `${baseUrl.toString().replace(/\/$/, '')}${pathname}`;
}

// Webhook endpoint for Zoom events
app.post('/api/webhooks/zoom', async (req, res) => {
  if (!verifyZoomWebhook(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Log every authenticated webhook, including unknown event types, so manual
  // testing can inspect the complete event shape without exposing secrets.
  logWebhookPayload(req.body);

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Invalid webhook body' });
  }

  const { event, payload } = req.body;

  if (typeof event !== 'string') {
    return res.status(400).json({ error: 'Invalid webhook event' });
  }

  const safeWebhookBody = redactWebhookValue(req.body);
  recordDebugEvent({
    type: 'webhook',
    level: 'info',
    callId: isSafeIdentifier(payload?.call_id) ? payload.call_id : null,
    summary: event,
    details: safeWebhookBody
  });
  console.log('Webhook received:', event);

  // Handle URL validation
  if (event === 'endpoint.url_validation') {
    if (typeof payload?.plainToken !== 'string' || payload.plainToken.length > 256) {
      return res.status(400).json({ error: 'Missing plainToken' });
    }

    const encryptedToken = crypto
      .createHmac('sha256', process.env.ZOOM_SECRET_TOKEN)
      .update(payload.plainToken)
      .digest('hex');

    return res.json({
      plainToken: payload.plainToken,
      encryptedToken
    });
  }

  // Forward Phone RTMS events to the RTMS media service.
  const normalizedEvent = normalizePhoneRtmsEvent(event);
  if (PHONE_RTMS_EVENTS.has(normalizedEvent)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isSafeIdentifier(payload.call_id)) {
      return res.status(400).json({ error: 'Invalid Phone RTMS payload' });
    }

    // Create unique signature for this webhook to detect duplicates
    const eventTimestamp = req.body.event_ts === undefined
      ? ''
      : String(req.body.event_ts).slice(0, 64);
    const webhookSignature = `${normalizedEvent}:${payload.call_id}:${eventTimestamp}`;

    // Check if we've recently processed this exact webhook
    if (recentWebhooks.has(webhookSignature)) {
      console.log(`Duplicate webhook detected (${webhookSignature}), skipping forward`);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Mark this webhook as processed
    recentWebhooks.set(webhookSignature, Date.now());

    // Clean up old entries after dedup window
    setTimeout(() => {
      recentWebhooks.delete(webhookSignature);
    }, WEBHOOK_DEDUP_WINDOW_MS);

    const rtmsServerUrl = process.env.RTMS_SERVER_URL || 'http://localhost:8080';
    console.log(`Forwarding ${event} as ${normalizedEvent} to RTMS server at ${rtmsServerUrl}`);
    const forwardedBody = { event: normalizedEvent, payload };
    if (req.body.event_ts !== undefined) {
      forwardedBody.event_ts = req.body.event_ts;
    }

    axios.post(rtmsServerUrl, forwardedBody, {
      headers: { 'Content-Type': 'application/json' }
    }).then(() => {
      console.log(`Successfully forwarded ${event} as ${normalizedEvent} to RTMS server`);
    }).catch((error) => {
      console.error(`Failed to forward ${event} to RTMS server:`, error.message);
    });
  }

  res.status(200).json({ received: true });
});

// Local development endpoint for the in-app webhook/WebSocket event panel.
app.get('/api/debug/events', async (req, res) => {
  const limit = parseDebugLimit(req.query.limit);
  const rtmsServerUrl = process.env.RTMS_SERVER_URL || 'http://localhost:8080';
  let rtmsAvailable = false;
  let remoteEvents = [];

  try {
    const response = await axios.get(`${rtmsServerUrl}/events`, { timeout: 1500 });
    remoteEvents = Array.isArray(response.data?.events)
      ? response.data.events.map(normalizeRemoteDebugEvent).filter(Boolean)
      : [];
    rtmsAvailable = true;
  } catch (error) {
    console.warn('RTMS debug events unavailable:', error.response?.status || error.code || error.message);
  }

  const events = [...debugEvents, ...remoteEvents]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, limit);

  return res.json({
    events,
    sources: {
      backend: true,
      rtms: rtmsAvailable
    },
    checkedAt: new Date().toISOString()
  });
});

// Manual test-mode status endpoint. It only reports whether the RTMS server
// currently has an active session for the selected call ID.
app.get('/api/rtms/calls/:callId', async (req, res) => {
  const { callId } = req.params;
  if (!isSafeIdentifier(callId)) {
    return res.status(400).json({ error: 'Invalid call ID' });
  }

  const rtmsServerUrl = process.env.RTMS_SERVER_URL || 'http://localhost:8080';

  try {
    const response = await axios.get(`${rtmsServerUrl}/health`, { timeout: 2500 });
    const activeCalls = Array.isArray(response.data?.calls) ? response.data.calls : [];
    const active = activeCalls.includes(callId);

    return res.json({
      callId,
      active,
      status: active ? 'active' : 'waiting',
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('RTMS status check failed:', error.response?.status || error.message);
    return res.status(503).json({ error: 'RTMS status unavailable' });
  }
});

// Manual test-mode control endpoint. Zoom performs the asynchronous RTMS
// start/stop operation and sends the resulting Phone webhook to this app.
app.patch('/api/rtms/calls/:callId', async (req, res) => {
  const { callId } = req.params;
  const action = typeof req.body?.action === 'string'
    ? req.body.action.trim().toLowerCase()
    : '';

  if (!isSafeIdentifier(callId)) {
    return res.status(400).json({ error: 'Invalid call ID' });
  }
  if (!PHONE_RTMS_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Action must be start or stop' });
  }

  const accessToken = getZoomAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({
      error: 'Zoom authorization required',
      authorizePath: '/api/auth/login'
    });
  }

  let zoomUrl;
  try {
    zoomUrl = buildZoomApiUrl(
      `/phone/calls/${encodeURIComponent(callId)}/rtms_app/status`
    );
  } catch (error) {
    console.error('Zoom API URL configuration failed:', error.message);
    return res.status(500).json({ error: 'Zoom API is not configured securely' });
  }

  try {
    await axios.patch(zoomUrl, { action }, {
      timeout: 5000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return res.status(202).json({
      callId,
      action,
      accepted: true
    });
  } catch (error) {
    const status = error.response?.status;
    console.error(`Phone RTMS ${action} request failed:`, status || error.code || error.message);

    if (status === 401 || status === 403) {
      return res.status(status).json({ error: 'Zoom authorization or RTMS permission denied' });
    }
    if (status === 400 || status === 404 || status === 429) {
      return res.status(status).json({ error: 'Zoom rejected the RTMS action' });
    }
    return res.status(502).json({ error: 'Unable to request the RTMS action' });
  }
});

// Proxy endpoint for Zoom API calls
app.all('/api/zoom/*', async (req, res) => {
  const accessToken = req.session.accessToken;

  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const zoomUrl = `${process.env.ZOOM_HOST || 'https://zoom.us'}`

  try {
    const response = await axios({
      method: req.method,
      url: zoomUrl,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data: req.body,
      params: req.query
    });

    res.json(response.data);
  } catch (error) {
    console.error('Zoom API proxy failed:', error.response?.status || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Zoom API request failed'
    });
  }
});

// Proxy all other requests to frontend React dev server (Docker mode)
// This allows the backend to serve as single entry point
app.use('/', createProxyMiddleware({
  target: FRONTEND_INTERNAL_URL,
  changeOrigin: true,
  ws: true, // Proxy websockets for React hot reload
  logLevel: 'silent',
  onError: (err, req, res) => {
    console.log('Proxy error:', err.message);
    res.writeHead(500, {
      'Content-Type': 'text/plain',
    });
    res.end('Frontend proxy error. Is the frontend container running?');
  }
}));

// Start server
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL (OAuth redirects): ${FRONTEND_URL}`);
  console.log(`Frontend Internal URL (proxy): ${FRONTEND_INTERNAL_URL}`);
  console.log(`Public URL: ${process.env.PUBLIC_URL || 'http://localhost:3001'}`);
  console.log(`All requests to http://localhost:${PORT} are proxied to frontend at ${FRONTEND_INTERNAL_URL}`);
  console.log(`OAuth redirects go to: ${FRONTEND_URL}`);
  console.log(`API requests to /api/* are handled by this backend`);
});
