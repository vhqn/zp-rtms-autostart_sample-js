# Webhook and WebSocket Debug UI Design

Date: 2026-08-05

## Goal

Expose the recent Zoom Phone webhook and RTMS WebSocket activity inside the
existing browser test app, so local debugging does not require reading
container logs. The panel shows all recent events by default and highlights
events belonging to the currently entered `callId`.

## Chosen approach

Use bounded in-memory event buffers and the existing polling pattern:

1. The backend records authenticated webhook events.
2. The RTMS service records RTMS WebSocket lifecycle and message metadata.
3. The backend debug endpoint reads both buffers, merges them by timestamp, and
   returns a bounded event list to the browser.
4. The frontend polls that endpoint every two seconds.

This avoids adding a second browser WebSocket/SSE connection and keeps the
debug UI independent from the media WebSocket connection.

## User interface

Add a `Live Debug Events` panel below the existing RTMS status sections.

- Filters: `All`, `Webhook`, and `WebSocket`.
- All events remain visible by default; the selected `callId` receives a visual
  highlight and a current-call marker.
- Each event row shows timestamp, source, event name/summary, call ID when
  available, and severity.
- An expandable detail area shows the structured event JSON.
- The panel shows its last refresh time, empty state, and a non-blocking error
  state when the debug endpoint is unavailable.
- Newest events appear first and the server/client list is bounded.

## Event API and data shape

The backend exposes `GET /api/debug/events?limit=100`. The response contains
an array of normalized events:

```json
{
  "id": "rtms-42",
  "timestamp": "2026-08-05T00:00:00.000Z",
  "source": "rtms",
  "type": "websocket",
  "level": "info",
  "callId": "call-123",
  "socket": "Media",
  "summary": "message msg_type=14",
  "details": {}
}
```

The RTMS service exposes an internal bounded events endpoint for the backend
to read. Backend and RTMS event IDs are namespaced by source before merging.

## Logging and privacy

The UI uses the same safe diagnostic representation as server logs. It does
not expose webhook signatures, OAuth/access tokens, WSS query parameters,
raw audio base64, or transcript text. Audio and transcript events show type,
size, channel, and count metadata only. Event detail JSON is bounded before
being returned or rendered.

## Failure behavior

- If the debug endpoint fails, the existing call status polling and RTMS
  controls continue working; only the debug panel shows an error.
- If the RTMS event endpoint is unavailable, backend webhook events still
  appear and the response reports the RTMS source as unavailable.
- Event buffers reset when the backend or RTMS process restarts; this is
  intentional for local debugging and does not affect stored media files.

## Scope boundaries

- No persistent event database.
- No browser-side media or transcript processing.
- No new browser WebSocket or SSE connection.
- No tests, compilation, or project build commands, per the project
  instructions. Verification is limited to static syntax and diff checks.
