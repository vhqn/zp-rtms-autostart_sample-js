# Zoom Phone RTMS Migration Implementation Plan

> **Execution note:** Follow this plan task by task. The user explicitly forbids writing or running unit tests and forbids compiling/building the project. Verification is limited to static checks and manual diff review.

## Goal

Convert the ZCC RTMS auto-start sample into a Zoom Phone RTMS sample using Phone webhook events, Phone RTMS scopes, `call_id`/`callId`, browser-based manual call control, and the existing RTMS signal/media capture flow.

## Task 1: Migrate backend webhook routing and validation

**Files:** `backend/server.js`

1. Replace the ZCC RTMS event allowlist with `phone.rtms_started`, `phone.rtms_stopped`, and `phone.rtms_interrupted`.
2. Validate the request body, event, and payload shape before reading fields; use `payload.call_id` for deduplication and accept only safe bounded identifiers.
3. Preserve Zoom signature verification and replay protection, but avoid insecure secret fallbacks for webhook trust and avoid logging complete webhook payloads.
4. Forward the Phone RTMS event body to the RTMS service and add a server-side manual start/stop proxy for `/phone/calls/{callId}/rtms_app/status`.
5. Update comments and operational logs to use Phone/call terminology.

## Task 2: Migrate RTMS lifecycle, handshake, and storage to calls

**Files:** `rtms/server.js`

1. Rename active state and lifecycle helpers from engagement terminology to call terminology.
2. Read `call_id` from Phone webhook payloads, validate `call_id` and `rtms_stream_id`, and deduplicate active calls.
3. Send `call_id` instead of `engagement_id` in signaling and media handshakes; generate the HMAC signature from `CLIENT_ID`, `call_id`, and `rtms_stream_id`.
4. Validate RTMS server URLs as secure `wss://` URLs before opening signaling/media sockets.
5. Handle malformed WebSocket JSON and incomplete media messages without crashing the process; validate channel IDs before constructing file paths.
6. Route `phone.rtms_stopped` and `phone.rtms_interrupted` through common cleanup, finalizing audio/transcripts and removing active call state.
7. Expose call-oriented health data and shutdown cleanup.

## Task 3: Harden audio conversion and file boundaries

**Files:** `rtms/audioHelper.js`, `rtms/server.js`

1. Replace shell-command FFmpeg execution with argument-based `execFile` invocation.
2. Keep call/session/channel output inside the configured RTMS data directories.
3. Preserve raw PCM, per-channel WAV, and mixed WAV output behavior.

## Task 4: Add a browser-based manual call listener

**Files:** `frontend/src/App.js`, `frontend/src/components/Call.js`, `frontend/src/components/Call.css`, `frontend/package.json`, `frontend/package-lock.json`, `backend/server.js`

1. Remove runtime use of the Zoom Apps SDK so the UI can run in a normal browser during testing.
2. Add a validated manual `callId` input and start/stop controls.
3. Poll a backend status endpoint and display whether the selected call has an active RTMS session.
4. Add explicit Start RTMS and Stop RTMS actions through the backend; the frontend does not start a media WebSocket and waits for Phone webhooks to transition the audio state.
5. Remove the unused Apps SDK dependency from the frontend manifest and lock metadata.

## Task 5: Update Phone metadata, deployment labels, and documentation

**Files:** `README.md`, `.env.example`, root `package.json` and `package-lock.json`, `backend/package.json` and lock metadata, `rtms/package.json`, `docker-compose.yml`, `verify-setup.sh`

1. Replace ZCC/Contact Center descriptions, scopes, event names, admin setup, and flow diagrams with Phone RTMS instructions.
2. Document `phone:read:rtms_session` and `phone:write:rtms_session`, the Phone status endpoints, and the manual server-side start/stop path.
3. Update package names/descriptions/keywords and Docker container/network labels to Phone-neutral names, without inventing a new repository URL.
4. Update environment/setup verification text while preserving existing commands and service topology.
5. Correct documentation that currently describes engagement-indexed files or Contact Center queue configuration.

## Task 6: Static verification and completion audit

**Files:** all touched files

1. Run `git diff --check`.
2. Parse touched CommonJS/ES module JavaScript with `node --check` where applicable; do not start servers, run tests, or build/bundle the frontend.
3. Parse edited JSON manifests with a direct JSON parser; do not install dependencies.
4. Search for stale ZCC event names, Contact Center runtime capabilities, and `engagement_id`/`engagementId` in runtime/docs/config files, allowing only historical references in the migration design/plan.
5. Review the complete diff for scope correctness, secret/PII logging, path traversal, shell injection, untrusted WebSocket URLs, and user-visible terminology.

## Expected result

The sample accepts and processes the three Phone RTMS lifecycle webhooks using `call_id`, connects to Phone RTMS with the call-based handshake/signature, cleans up on stopped/interrupted events, lets a browser user monitor and explicitly start/stop a selected `callId`, advertises the Phone scopes, and contains no stale ZCC runtime configuration. Runtime behavior remains unverified because tests, compilation, and dependency installation are prohibited by the user.
