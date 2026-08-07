# Zoom Phone RTMS Basic Sample App

## Overview

This application captures live audio and transcript streams from Zoom Phone calls through RTMS webhooks, supporting both auto-start and explicit manual start. It runs as three containerized services:

- **Frontend**: React-based manual test UI for monitoring a selected Phone call
- **Backend**: Express API server handling OAuth, webhook verification, and event forwarding
- **RTMS server**: RTMS signaling/media WebSocket client that stores audio and transcripts

## Features

- Real-time Phone call audio and transcript capture
- Per-channel raw/WAV output plus a mixed WAV file
- Call-keyed transcript files
- Automatic cleanup on stopped and interrupted RTMS events
- Duplicate webhook prevention
- Docker-based local development

## Prerequisites

- Docker and Docker Compose
- A Zoom account with Zoom Phone RTMS access and administrator permission to configure an RTMS app
- An RTMS-enabled Zoom Phone policy or configuration for the users/numbers being tested
- An ngrok account, or another HTTPS endpoint that Zoom can reach for webhook and OAuth callbacks

## Docker setup (recommended)

Docker provides Node.js, npm, and FFmpeg inside the service containers.

### 1. Configure the environment

```bash
cp .env.example .env
```

Fill in the Zoom credentials and public callback URL described in [Application variables](#application-variables).

### 2. Start the services

```bash
docker compose up
```

The local entry point is:

- App (frontend through the backend proxy): http://localhost:3001
- Backend health/API: http://localhost:3001/health
- RTMS server: internal to the container network

### 3. Expose the backend for Zoom

In another terminal:

```bash
ngrok http 3001
```

Use the HTTPS URL in `PUBLIC_URL`, `FRONTEND_URL`, and `ZOOM_REDIRECT_URL`, then restart the services.

### 4. Monitor a call manually

Open `http://localhost:3001` in a normal browser, enter the Phone `callId`, and click **Listen**. The page polls the backend for the active RTMS session for that call. It does not require the Zoom Apps SDK or a Zoom Phone webview.

The **Live Debug Events** panel shows all recent authenticated webhook and RTMS WebSocket events in the browser. Events for the entered `callId` are highlighted, and each event can be expanded to inspect its safe structured details. The panel polls `GET /api/debug/events`; its in-memory history resets when the backend or RTMS container restarts.

To start audio capture manually, click **Authorize Zoom** once, then click **Start RTMS**. The backend calls `PATCH /phone/calls/{callId}/rtms_app/status` and waits for `phone.rtms_started`; the RTMS server then opens the media WebSocket and stores audio. **Stop RTMS** uses the same API with `action: stop`.

## Manual setup

> Requires Node.js 18 or later, npm, and FFmpeg installed locally.

```bash
npm run install:all
cp .env.example .env
npm run dev:local
```

For webhook testing, expose port 3001 with ngrok or another HTTPS reverse proxy.

## Zoom Marketplace setup

### 1. Create the app

1. Open [Zoom Marketplace](https://marketplace.zoom.us/) and choose **Develop** > **Build App**.
2. Create a user-managed **General app**.
3. Set the OAuth redirect URL to `https://your-public-host/api/auth/callback`.
4. Add a webhook event subscription with notification URL `https://your-public-host/api/webhooks/zoom`.
5. Subscribe to these Phone RTMS events:
   - `phone.rtms_started`
   - `phone.rtms_stopped`
   - `phone.rtms_interrupted`
6. Set the app home URL to `https://your-public-host/api/home`. The current manual test mode does not require the Zoom Phone surface or Zoom Apps SDK.
7. Add these Phone RTMS scopes:
   - `phone:read:rtms_session`
   - `phone:write:rtms_session`

The app uses Phone webhooks for the media connection. Manual start/stop is sent server-side after OAuth; the browser never calls Zoom directly and never uses the Phone SDK.

### 2. Configure credentials

Copy the following values from the Marketplace app into `.env`:

- `ZOOM_APP_CLIENT_ID`
- `ZOOM_APP_CLIENT_SECRET`
- `ZOOM_SECRET_TOKEN`

The secret token is used to verify Zoom webhook signatures and URL validation requests.

### 3. Enable Phone RTMS auto-start

Install the app for local testing, then enable RTMS for the Phone users, lines, or policy that will place/receive the test call. The exact administrator location depends on the Phone account configuration. The sample supports both Phone webhook auto-start and the manual Start RTMS button.

## Phone RTMS status API reference

The Phone task configuration exposes these APIs for RTMS app status:

- `GET /phone/calls/{callId}/rtms_app/status`
- `PATCH /phone/calls/{callId}/rtms_app/status`

The manual Start/Stop buttons call the PATCH endpoint through the backend. The browser status view polls the local RTMS health endpoint and waits for the corresponding Phone webhook before showing audio capture as active.

## Application variables

### Required credentials

| Variable | Description | Example |
|----------|-------------|---------|
| `ZOOM_APP_CLIENT_ID` | Zoom Marketplace client ID | `abc123xyz` |
| `ZOOM_APP_CLIENT_SECRET` | Zoom Marketplace client secret | `secret123` |
| `ZOOM_SECRET_TOKEN` | Zoom webhook secret token | `token123` |
| `SESSION_SECRET` | Random Express session secret | `random-secret-value` |
| `ZOOM_TEST_ACCESS_TOKEN` | Optional development-only token for manual RTMS control | empty |

### URLs

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_URL` | Public URL used by Zoom webhooks | `http://localhost:3001` |
| `ZOOM_REDIRECT_URL` | OAuth callback URL | `http://localhost:3001/api/auth/callback` |
| `FRONTEND_URL` | Browser/OAuth redirect URL | `http://localhost:3000` |
| `FRONTEND_INTERNAL_URL` | Internal frontend proxy URL | `http://frontend:3000` |
| `RTMS_SERVER_URL` | Internal backend-to-RTMS URL | `http://rtms:8080` |
| `LOG_FULL_WEBHOOK_PAYLOAD` | Development diagnostic logging; prints the full authenticated webhook structure with sensitive fields redacted | enabled outside production |
| `LOG_WEBSOCKET_EVENTS` | Development diagnostic logging for WebSocket lifecycle and inbound/outbound message types, sizes, and counters; signatures and media/audio content are redacted | enabled outside production |
| `BACKEND_URL` | Backend URL visible to the RTMS service | `http://backend:3001` |

### Ports

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Frontend port | `3000` |
| `BACKEND_PORT` | Backend port | `3001` |
| `RTMS_PORT` | RTMS server port | `8080` |

### Other configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ZOOM_HOST` | Zoom OAuth host; use the appropriate GovCloud host when required | `https://zoom.us` |
| `ZOOM_API_BASE_URL` | Zoom REST API base for manual RTMS control | `https://api.zoom.us/v2` |
| `NODE_ENV` | Runtime environment | `development` |

## Application flow

### 1. Phone RTMS session starts

```text
Phone call starts
        ↓
Zoom sends phone.rtms_started
        ↓
Backend verifies and forwards the webhook
        ↓
RTMS server reads call_id, rtms_stream_id, and server_urls
        ↓
RTMS server connects to the signaling WebSocket
```

For manual testing, the first two steps can instead be initiated from the browser:

```text
User enters callId and clicks Start RTMS
        ↓
Backend sends PATCH /phone/calls/{callId}/rtms_app/status
        ↓
Zoom sends phone.rtms_started
        ↓
The normal webhook-to-media capture path continues
```

### 2. RTMS connection

```text
Signaling handshake with call_id and HMAC-SHA256 signature
        ↓
Receive the media WebSocket URL
        ↓
Media handshake requests 16kHz, mono, L16 audio and transcripts
        ↓
Send CLIENT_READY_ACK
```

RTMS endpoints supplied by Zoom must be secure `wss://` URLs. The server rejects malformed or non-secure endpoints.

### 3. Audio and transcript capture

```text
Audio message (msg_type: 14)
        ↓
Decode base64 PCM by channel_id
        ↓
Append to rtms/data/audio/{session_timestamp}_{callId}/channel_N.raw
        ↓
Finalize per-channel WAV and mixed.wav when the call ends

Transcript message (msg_type: 17)
        ↓
Append to rtms/data/transcripts/{callId}.txt
```

### 4. Phone RTMS session ends

Both `phone.rtms_stopped` and `phone.rtms_interrupted` close the WebSockets and finalize the active call's files.

## Data storage

### Audio files

Each call creates a timestamped, call-keyed directory:

- `rtms/data/audio/{YYYY-MM-DD_HH-MM-SS}_{callId}/`
- `channel_N.raw`: raw 16-bit PCM per channel
- `channel_N.wav`: individual 16kHz, 16-bit mono WAV files
- `mixed.wav`: interleaved stereo output for two channels, or mono for one channel

### Transcript files

- Location: `rtms/data/transcripts/`
- Naming: `{callId}.txt`
- Format: one JSON transcript entry per line with an ISO timestamp prefix

Audio and transcript data can contain sensitive call content. Protect the `rtms/data` directory and use a secrets manager instead of committing `.env` values in production.

## Development commands

### Docker

```bash
npm start
npm run logs
npm run logs:frontend
npm run logs:backend
npm run logs:rtms
npm stop
```

### Local services

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd rtms && npm run dev

# Terminal 3
cd frontend && npm start

# Terminal 4
ngrok http 3001
```

### Data inspection

```bash
ls -lh rtms/data/audio/
cat rtms/data/transcripts/<callId>.txt
npm run clean:data
```

## API endpoints

### Backend (port 3001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Backend health check |
| `/api/home` | GET | Zoom App home redirect |
| `/api/auth/authorize` | GET | OAuth authorization handler |
| `/api/auth/login` | GET | Starts normal-browser OAuth for manual RTMS control |
| `/api/auth/callback` | GET | OAuth callback handler |
| `/api/webhooks/zoom` | POST | Verifies and forwards Phone RTMS webhooks |
| `/api/debug/events` | GET | Returns recent backend webhook and RTMS WebSocket debug events for the browser panel |
| `/api/rtms/calls/:callId` | GET | Manual test-mode RTMS status check |
| `/api/rtms/calls/:callId` | PATCH | Requests Phone RTMS start/stop for the selected call |
| `/api/zoom/*` | ALL | Authenticated proxy to Zoom APIs |

### RTMS server (port 8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | POST | Phone RTMS webhook handler |
| `/health` | GET | Health check with active calls |
| `/events` | GET | Internal bounded RTMS WebSocket debug event buffer |

## Production considerations

This is a development sample. Before production use:

- Store `ZOOM_APP_CLIENT_SECRET`, `ZOOM_SECRET_TOKEN`, and `SESSION_SECRET` in a secrets manager.
- Replace the in-memory Express session store and `activeCalls`/webhook deduplication maps with shared durable storage.
- Add webhook retry/backoff and WebSocket reconnection handling.
- Add rate limiting and centralized TLS termination.
- Restrict access to stored audio/transcripts and define retention/deletion policies.
- Return sanitized error details to clients and keep caller/media content out of logs.
