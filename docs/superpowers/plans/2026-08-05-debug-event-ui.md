# Webhook and WebSocket Debug UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show recent authenticated webhook and RTMS WebSocket activity in the existing browser test app, with all events visible by default and the current `callId` highlighted.

**Architecture:** Backend and RTMS keep bounded in-memory event buffers. The backend merges its webhook events with RTMS WebSocket events through an internal RTMS events endpoint and exposes one browser-facing `/api/debug/events` endpoint. React polls that endpoint every two seconds and renders a filterable, expandable event timeline; it does not create another browser WebSocket or SSE connection.

**Tech Stack:** Express, Axios, Node.js ESM RTMS service, React, existing CSS, Podman Compose.

## Global Constraints

- Keep `phone.rtms_started`, `phone.rtms_stopped`, and `phone.rtms_interrupted` event names unchanged.
- Keep `call_id` in webhook/RTMS payloads and `callId` in browser state/UI.
- Keep event buffers in memory and bounded to 200 entries per service.
- Do not log or return webhook signatures, OAuth/access tokens, WSS query parameters, raw audio base64, or transcript text.
- Preserve existing RTMS status polling and manual start/stop behavior if the debug endpoint is unavailable.
- Do not write or run unit tests, compile, build, bundle, or install dependencies.
- Verify only with static syntax checks where applicable and `git diff --check`.

---

### Task 1: Add the backend debug event buffer and aggregation endpoint

**Files:**
- Modify: `backend/server.js` near the existing webhook redaction helpers and API routes.
- Modify: `README.md` in the backend API endpoint table and local debugging instructions.

**Interfaces:**
- Produces `GET /api/debug/events?limit=100` with `{ events, sources, checkedAt }`.
- Each event has `{ id, timestamp, source, type, level, callId, socket, summary, details }`; `socket` and `callId` may be `null`.
- Consumes the RTMS service endpoint `GET /events`, which returns `{ events }` using the same normalized event shape without the final source namespace.

- [ ] **Step 1: Define the bounded backend event buffer.**

Add a `MAX_DEBUG_EVENTS = 200` constant, a monotonic sequence counter, and a `debugEvents` array. Add `recordDebugEvent(event)` that copies only the normalized fields, assigns an ID such as `backend-${sequence}`, limits `details` to the already-redacted object, appends newest-first, and removes entries beyond 200.

- [ ] **Step 2: Record authenticated webhook events.**

After webhook signature verification and body/event validation, record the full safe diagnostic body with:

```js
recordDebugEvent({
  timestamp: new Date().toISOString(),
  source: 'backend',
  type: 'webhook',
  level: 'info',
  callId: isSafeIdentifier(payload?.call_id) ? payload.call_id : null,
  socket: null,
  summary: event,
  details: redactWebhookValue(req.body)
});
```

Unknown but authenticated events remain visible. Invalid signatures remain out of the detailed buffer.

- [ ] **Step 3: Implement `GET /api/debug/events`.**

Parse `limit` as an integer bounded to `1..200`. Read local events, request `GET ${RTMS_SERVER_URL}/events` with a short timeout, mark the RTMS source unavailable on failure instead of failing the endpoint, merge the two lists, sort by descending timestamp, and return only the requested number of events. Do not include Axios error bodies or credentials in the response.

- [ ] **Step 4: Document the endpoint and fallback behavior.**

Document that the endpoint is a local development diagnostic API, its buffers reset on service restart, and call status/control continue working when it is unavailable.

- [ ] **Step 5: Run the backend static verifier.**

Run:

```bash
node --check backend/server.js
git diff --check
```

Expected: both commands exit successfully; no tests or build commands are run.

### Task 2: Expose RTMS WebSocket events to the backend

**Files:**
- Modify: `rtms/server.js` in the existing WebSocket logging helpers, call state, cleanup flow, and Express routes.
- Modify: `.env.example` only if the event buffer configuration needs a documented limit; do not add a dependency.

**Interfaces:**
- Produces `GET /events` on the internal RTMS service with `{ events, checkedAt }`.
- `logWebSocketEvent` and `logWebSocketMessage` remain the single points for console and UI diagnostic events.

- [ ] **Step 1: Define the bounded RTMS event buffer.**

Add `MAX_DEBUG_EVENTS = 200`, a sequence counter, and `recordDebugEvent`. Store WebSocket lifecycle events with `type: 'websocket'`, `source: 'rtms'`, `socket`, `callId`, `summary`, and safe `details`.

- [ ] **Step 2: Extend existing WebSocket log helpers.**

Keep the current console output, and additionally record the same normalized event. For message records, store `msg_type`, transport byte count, binary flag, and the redacted message structure already produced by `redactWebSocketMessage`. For audio and transcript messages, retain only count/size/channel metadata and never store `content.data`.

- [ ] **Step 3: Add the internal `GET /events` route.**

Return the newest bounded RTMS events and `checkedAt`. Keep it behind the existing internal service network; do not expose a new host port.

- [ ] **Step 4: Run the RTMS static verifier.**

Run:

```bash
node --check rtms/server.js
git diff --check
```

Expected: both commands exit successfully.

### Task 3: Poll debug events in the React app

**Files:**
- Modify: `frontend/src/App.js`.

**Interfaces:**
- `App` passes `debugEvents`, `debugError`, and `debugUpdatedAt` to `Call`.
- Poll URL: `${BACKEND_URL}/debug/events?limit=100`.

- [ ] **Step 1: Add independent debug polling state.**

Create state for the event list, last successful update timestamp, and a non-blocking error. Poll on the same two-second interval as call status, but keep the effect independent of `listeningCallId` so the panel can show all events before a call is selected.

- [ ] **Step 2: Preserve the existing listener behavior on debug failures.**

On a failed debug request, keep the previous event list and set only the debug error. On success, replace the list with the bounded server response and clear the debug error.

- [ ] **Step 3: Pass the state to `Call`.**

Keep the current manual listener props and add only the three debug props required by the new panel.

### Task 4: Build the Live Debug Events panel

**Files:**
- Create: `frontend/src/components/DebugEventPanel.js`.
- Create: `frontend/src/components/DebugEventPanel.css`.
- Modify: `frontend/src/components/Call.js` to render the panel below the RTMS information section.

**Interfaces:**
- `DebugEventPanel({ events, currentCallId, error, updatedAt })`.
- Filter values are `all`, `webhook`, and `websocket`; initial filter is `all`.

- [ ] **Step 1: Implement filter and current-call matching.**

Filter only by event `type`. Keep all events visible for the default `all` filter. Add a `current-call` class when `event.callId` equals the trimmed current call ID; do not hide nonmatching events.

- [ ] **Step 2: Implement event rows and expandable details.**

Render source/type badges, severity, formatted timestamp, summary, call ID, socket, and a `<details>` block containing `JSON.stringify(event.details, null, 2)`. Render a stable empty state when no events exist and a compact error status when polling fails.

- [ ] **Step 3: Add responsive styling.**

Use the existing purple/blue visual language, readable monospace detail blocks, clear Webhook/WebSocket color differences, a highlighted current-call border, bounded detail overflow, and a mobile layout that stacks metadata without horizontal page overflow.

- [ ] **Step 4: Mount the panel in `Call`.**

Place it after `RTMS Information` and before the footer. The existing listener controls and status alerts remain unchanged.

### Task 5: Final static verification and handoff

**Files:**
- Inspect: all files changed by Tasks 1–4.

- [ ] **Step 1: Check edited JavaScript and repository whitespace.**

Run:

```bash
node --check backend/server.js
node --check rtms/server.js
git diff --check
```

- [ ] **Step 2: Check event naming and endpoint wiring.**

Run:

```bash
rg -n "api/debug/events|/events|DebugEventPanel|phone\.rtms_(started|stopped|interrupted)" backend rtms frontend/src README.md
```

Confirm the browser endpoint is backend-facing, RTMS `/events` is internal, and no old `engagement`/`phone.call_rtms` identifiers were introduced.

- [ ] **Step 3: Report verification limits.**

State explicitly that no unit tests, compile, build, or bundle commands were run, and that the remaining runtime check is to open the app, trigger a webhook/RTMS session, and observe the panel.
