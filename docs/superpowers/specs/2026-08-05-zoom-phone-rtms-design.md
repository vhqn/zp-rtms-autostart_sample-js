# Zoom Phone RTMS Migration Design

Date: 2026-08-05

## Goal

Adapt this sample from Zoom Contact Center RTMS auto-start to Zoom Phone RTMS while preserving the existing webhook-first media flow. The Phone call identifier is `call_id` in webhook/RTMS payloads and `callId` in the browser test UI; the former ZCC `engagement_id`/`engagementId` terminology is removed from runtime behavior and user-facing documentation.

## Confirmed Phone interfaces

- RTMS webhook events:
  - `phone.rtms_started`
  - `phone.rtms_stopped`
  - `phone.rtms_interrupted`
- Phone RTMS session scopes:
  - `phone:read:rtms_session`
  - `phone:write:rtms_session`
- The Phone task list exposes `GET` and `PATCH` `/phone/calls/{callId}/rtms_app/status`. Manual test mode uses the PATCH endpoint server-side for explicit start/stop; the media connection still begins only after the corresponding Phone webhook.
- Browser test mode does not depend on the Zoom Apps SDK or a Zoom Phone webview.

## Scope

### In scope

1. Replace ZCC webhook event filtering, deduplication, lifecycle handling, and labels with the three Phone RTMS events.
2. Replace `engagement_id`/`engagementId` with `call_id`/`callId` throughout the backend, RTMS bridge, frontend state, filenames, signatures, and documentation.
3. Keep the existing RTMS signal/media handshake and transcript/audio behavior, changing only the call identifier field and related names; the Phone RTMS media protocol still delivers audio through the existing message handlers.
4. Treat `phone.rtms_interrupted` as a terminal cleanup event for the affected call.
5. Replace the Contact Center Zoom Apps surface with a normal-browser test UI that accepts a manual `callId` and displays RTMS state.
6. Update scopes, package metadata, environment text, container/network labels, and setup documentation for Phone.
7. Apply bounded security hardening in touched paths: validate event payloads and identifiers, avoid logging raw webhook payloads, require secure RTMS WebSocket URLs, keep file paths within the audio directory, and invoke FFmpeg without a shell.

### Out of scope

- Implementing a full Phone call discovery/app-selection flow; the test UI accepts a manually supplied call ID.
- Supporting both ZCC and Phone event schemas in the same sample.
- Changing the media formats, transcript protocol, or deployment architecture beyond the manual test controls and OAuth entry point.
- Writing or running unit tests, compiling, bundling, or otherwise building the project, per the user instruction.

## Data flow

1. Either Phone auto-start or the manual test action causes Zoom Phone to send `phone.rtms_started` to the backend with `call_id`, `rtms_stream_id`, and RTMS server URL data.
2. The backend verifies the webhook signature, deduplicates the event, and forwards the validated event to the RTMS bridge.
3. The RTMS bridge opens the signal WebSocket, sends the RTMS handshake signed with `CLIENT_ID`, `call_id`, and `rtms_stream_id`, and obtains the media URL.
4. The bridge opens the media WebSocket, receives mixed audio/transcript messages, and stores them under a safe call-specific directory.
5. `phone.rtms_stopped` or `phone.rtms_interrupted` closes sockets, finalizes audio/transcript files, and removes the call from active state.
6. The browser UI polls the backend's local RTMS health state; it does not open a media socket or process audio in the browser.

## Security and error-handling requirements

- Treat webhook bodies, RTMS identifiers, channel identifiers, server URLs, and WebSocket messages as untrusted input.
- Accept only the configured Phone event names and object-shaped payloads; reject malformed requests without exposing internal details.
- Validate `call_id` and channel IDs before using them as map keys, signature inputs, or filesystem path components.
- Require an absolute secure `wss://` RTMS endpoint without embedded credentials before opening a WebSocket.
- Do not log complete webhook payloads because they can contain caller metadata and media/session identifiers. Log only event names and non-sensitive operational status.
- Use argument-based FFmpeg execution so external identifiers cannot become shell syntax.
- Preserve existing HMAC verification and replay checks; missing production secrets must not silently create a trusted webhook configuration.
- Catch malformed WebSocket JSON and cleanup failures so one bad message does not terminate the process.

## Planned file areas

- `backend/server.js`: Phone event allowlist, `call_id` deduplication, safe forwarding/logging, manual Phone RTMS start/stop control, and Phone labels.
- `rtms/server.js`: call-keyed lifecycle, Phone event names, `call_id` RTMS handshake/signature/storage, interrupted cleanup, input validation, and safe URL/path handling.
- `rtms/audioHelper.js`: shell-free FFmpeg invocation and Phone-neutral comments.
- `frontend/src/App.js` and `frontend/src/components/Call.js`: browser-only manual call input, RTMS start/stop controls, status polling, and call-oriented UI labels/state.
- `frontend/package.json` and lock metadata: remove the unused Apps SDK dependency for browser-only testing.
- `README.md`, `.env.example`, `package.json`, package metadata, `docker-compose.yml`, and `verify-setup.sh`: Phone terminology, scopes, event setup, and deployment labels.

## Static acceptance checks

Because tests and compilation are explicitly prohibited, completion will be assessed with static checks only: syntax parsing for touched JavaScript files where possible, JSON parsing for edited manifests, `git diff --check`, targeted searches for stale ZCC/engagement runtime references, and manual diff/security review. No `npm test`, build, bundling, or compiler command will be run.

## Test-mode amendment

For local testing, the frontend does not use the Zoom Apps SDK or require a Zoom Phone webview. A user enters a validated `callId`, clicks **Listen** to observe local RTMS state, or explicitly clicks **Start RTMS** to ask the backend to call `/phone/calls/{callId}/rtms_app/status`. The audio session still starts from `phone.rtms_started`, because a `callId` alone does not contain the `rtms_stream_id` and `server_urls` required for the RTMS handshake.
