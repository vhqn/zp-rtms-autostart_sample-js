import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { appendFileSync } from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import WebSocket from 'ws';
import {
  saveRawAudio,
  convertRawToWav,
  closeRawStream,
  closeAllAudioStreams,
  getChannelRawPath,
  getChannelWavPath,
  ensureDir,
  makeWorldReadable,
  removeSessionRawDir
} from './audioHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const PORT = process.env.RTMS_PORT || 8080;
const CLIENT_ID = process.env.ZOOM_APP_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_APP_CLIENT_SECRET;
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
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_WEBSOCKET_PAYLOAD = 4 * 1024 * 1024;
const MAX_LOGGED_WEBSOCKET_MESSAGE = 16 * 1024;
const MAX_DEBUG_EVENTS = 200;
const MAX_DEBUG_DETAILS_BYTES = 32 * 1024;
const LOG_WEBSOCKET_EVENTS = process.env.LOG_WEBSOCKET_EVENTS === 'true'
  || (process.env.NODE_ENV !== 'production' && process.env.LOG_WEBSOCKET_EVENTS !== 'false');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('[WARN] ZOOM_APP_CLIENT_ID and ZOOM_APP_CLIENT_SECRET must be configured for RTMS handshakes.');
}

const dataDir = process.env.RTMS_DATA_DIR || join(__dirname, 'data');
const audioDir = join(dataDir, 'audio');
const transcriptsDir = join(dataDir, 'transcripts');

try {
  [dataDir, audioDir, transcriptsDir].forEach(ensureDir);
} catch (error) {
  console.warn(`[WARN] Data directories not ready yet (${error.message}); will create on write.`);
}

// Store active Phone calls keyed by the Phone call ID.
const activeCalls = new Map();
const debugEvents = [];
let debugEventSequence = 0;

function normalizeIdentifier(value) {
  const candidate = Number.isInteger(value) ? String(value) : value;
  return typeof candidate === 'string' && SAFE_IDENTIFIER_PATTERN.test(candidate)
    ? candidate
    : null;
}

function normalizePhoneRtmsEvent(event) {
  return PHONE_RTMS_EVENT_ALIASES.get(event) || event;
}

function getServerUrl(serverUrls) {
  if (typeof serverUrls === 'string') {
    return serverUrls;
  }

  if (Array.isArray(serverUrls)) {
    return serverUrls[0];
  }

  if (serverUrls && typeof serverUrls === 'object') {
    return serverUrls.signaling || serverUrls.signal || serverUrls.all || serverUrls.audio;
  }

  return null;
}

function normalizeWebSocketUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
      return null;
    }
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function describeWebSocketEndpoint(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch (_error) {
    return '[REDACTED_ENDPOINT]';
  }
}

function getWebSocketPayloadSize(data) {
  if (Buffer.isBuffer(data)) return data.length;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return Buffer.byteLength(String(data));
}

const SENSITIVE_WEBSOCKET_KEY_PATTERN = /(^|_)(authorization|password|secret|signature|token)(_|$)/;

function normalizeWebSocketLogKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function redactWebSocketMessage(value, key = '') {
  const normalizedKey = normalizeWebSocketLogKey(key);
  if (SENSITIVE_WEBSOCKET_KEY_PATTERN.test(normalizedKey)) {
    return '[REDACTED]';
  }

  if (normalizedKey === 'data' && typeof value === 'string') {
    return `[REDACTED_CONTENT_BYTES:${Buffer.byteLength(value)}]`;
  }

  if (typeof value === 'string' && /^(https?|wss?):\/\//i.test(value)) {
    return describeWebSocketEndpoint(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactWebSocketMessage(item));
  }

  if (value && typeof value === 'object') {
    const redacted = Object.create(null);
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] = redactWebSocketMessage(entryValue, entryKey);
    }
    return redacted;
  }

  return value;
}

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
    id: `rtms-${++debugEventSequence}`,
    timestamp: typeof event?.timestamp === 'string'
      ? event.timestamp
      : new Date().toISOString(),
    source: 'rtms',
    type: 'websocket',
    level: ['info', 'warn', 'error'].includes(event?.level) ? event.level : 'info',
    callId: normalizeIdentifier(event?.callId),
    socket: typeof event?.socket === 'string' ? event.socket.slice(0, 32) : null,
    direction: event?.direction === 'sent' || event?.direction === 'received'
      ? event.direction
      : null,
    summary: typeof event?.summary === 'string' ? event.summary.slice(0, 200) : 'RTMS event',
    details: limitDebugDetails(redactWebSocketMessage(event?.details || {}))
  };

  debugEvents.unshift(normalized);
  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.length = MAX_DEBUG_EVENTS;
  }

  return normalized;
}

function logWebSocketEvent(callId, socketName, detail, details = {}) {
  recordDebugEvent({
    callId,
    socket: socketName,
    summary: detail,
    details: { detail, ...details }
  });

  if (!LOG_WEBSOCKET_EVENTS) return;
  console.log(`[${callId}] ${socketName} WebSocket ${detail}`);
}

function logWebSocketError(callId, socketName, error) {
  recordDebugEvent({
    callId,
    socket: socketName,
    level: 'error',
    summary: 'WebSocket error',
    details: {
      code: typeof error?.code === 'string' ? error.code.slice(0, 64) : null
    }
  });
  console.error(`[${callId}] ${socketName} WebSocket error:`, error.message);
}

function logWebSocketMessage(callId, socketName, data, message, isBinary) {
  logWebSocketMessageWithDirection(callId, socketName, data, message, isBinary, 'received');
}

function logWebSocketMessageWithDirection(callId, socketName, data, message, isBinary, direction) {
  const messageType = Number.isInteger(message?.msg_type) ? message.msg_type : 'unknown';
  const transportBytes = getWebSocketPayloadSize(data);
  const safeMessageObject = redactWebSocketMessage(message);
  recordDebugEvent({
    callId,
    socket: socketName,
    direction,
    summary: `${direction} message msg_type=${messageType}`,
    details: {
      direction,
      msg_type: messageType,
      transport_bytes: transportBytes,
      binary: Boolean(isBinary),
      message: safeMessageObject
    }
  });

  if (!LOG_WEBSOCKET_EVENTS) return;

  let serializedMessage;
  try {
    serializedMessage = JSON.stringify(safeMessageObject, null, 2);
  } catch (error) {
    serializedMessage = `[Unable to serialize message: ${error.message}]`;
  }

  if (serializedMessage.length > MAX_LOGGED_WEBSOCKET_MESSAGE) {
    serializedMessage = `${serializedMessage.slice(0, MAX_LOGGED_WEBSOCKET_MESSAGE)}... [TRUNCATED]`;
  }

  console.log(
    `[${callId}] ${socketName} WebSocket ${direction}: msg_type=${messageType}, `
      + `transport_bytes=${transportBytes}, binary=${Boolean(isBinary)}\n${serializedMessage}`
  );
}

function sendWebSocketJson(callId, socketName, ws, message) {
  const serializedMessage = JSON.stringify(message);
  ws.send(serializedMessage);

  // Removed verbose "sent" logging - only keep [TEST] logs
  // if (LOG_WEBSOCKET_EVENTS) {
  //   logWebSocketMessageWithDirection(
  //     callId,
  //     socketName,
  //     Buffer.from(serializedMessage),
  //     message,
  //     false,
  //     'sent'
  //   );
  // }
}

function getCloseReasonSize(reason) {
  if (!reason) return 0;
  return Buffer.isBuffer(reason) ? reason.length : Buffer.byteLength(String(reason));
}

function parseWebSocketMessage(data, callId) {
  try {
    const message = JSON.parse(data.toString());
    return message && typeof message === 'object' && !Array.isArray(message)
      ? message
      : null;
  } catch (_error) {
    console.error(`[${callId}] Ignoring malformed RTMS WebSocket message.`);
    return null;
  }
}

function saveTranscript(callId, streamId, data) {
  const safeCallId = normalizeIdentifier(callId);
  const safeStreamId = normalizeIdentifier(streamId);
  if (!safeCallId || !safeStreamId) {
    return;
  }

  const timestamp = new Date().toISOString();
  const callTranscriptDir = join(transcriptsDir, safeCallId);
  const filePath = join(callTranscriptDir, `${safeStreamId}.txt`);
  ensureDir(callTranscriptDir);
  appendFileSync(filePath, `[${timestamp}] ${JSON.stringify(data)}\n`);
  makeWorldReadable(filePath);
}

// Generate HMAC-SHA256(client_id + "," + call_id + "," + rtms_stream_id, secret).
function generateSignature(callId, rtmsStreamId) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('RTMS credentials are not configured');
  }

  const message = `${CLIENT_ID},${callId},${rtmsStreamId}`;

  console.log(`[${callId}] Generating RTMS signature.`);
  return crypto
    .createHmac('sha256', CLIENT_SECRET)
    .update(message)
    .digest('hex');
}

function createWebSocket(url) {
  return new WebSocket(url, { maxPayload: MAX_WEBSOCKET_PAYLOAD });
}

async function finalizeChannel(callId, channelId, channel) {
  try {
    await closeRawStream(channel.rawPath);
    await convertRawToWav(channel.rawPath, channel.wavPath);
    console.log(`[${callId}] Finalized channel ${channelId}.`);
  } catch (error) {
    console.error(`[${callId}] Failed to finalize channel ${channelId}:`, error.message);
  }
}

function connectToSignalingWebSocket(callId, rtmsStreamId, serverUrl, callData) {
  const normalizedUrl = normalizeWebSocketUrl(serverUrl);
  if (!normalizedUrl) {
    throw new Error('RTMS signaling URL must be a valid wss:// URL');
  }

  logWebSocketEvent(
    callId,
    'Signaling',
    `connecting to ${describeWebSocketEndpoint(normalizedUrl)}.`
  );
  const ws = createWebSocket(normalizedUrl);
  callData.signalingWs = ws;

  ws.on('open', () => {
    try {
      logWebSocketEvent(callId, 'Signaling', 'opened; sending handshake.');
      const handshake = {
        msg_type: 1,
        protocol_version: 1,
        call_id: callId,
        rtms_stream_id: rtmsStreamId,
        sequence: 0,
        signature: generateSignature(callId, rtmsStreamId)
      };

      // Test log: print handshake request
      console.log(`[${callId}] [TEST] Signaling handshake request:`, JSON.stringify(handshake, null, 2));

      sendWebSocketJson(callId, 'Signaling', ws, handshake);
    } catch (error) {
      console.error(`[${callId}] Failed to send signaling handshake:`, error.message);
    }
  });

  ws.on('message', async (data, isBinary) => {
    if (callData.cleaningUp || activeCalls.get(callId) !== callData) {
      return;
    }

    const message = parseWebSocketMessage(data, callId);
    if (!message) {
      return;
    }

    callData.signalingMessageCount++;
    if (message.msg_type === 12) {
      callData.signalingHeartbeatCount++;
      // Removed verbose "received" logging
      // if (callData.signalingHeartbeatCount === 1 || callData.signalingHeartbeatCount % 100 === 0) {
      //   logWebSocketMessage(callId, 'Signaling', data, message, isBinary);
      // }
    } else {
      // Removed verbose "received" logging
      // logWebSocketMessage(callId, 'Signaling', data, message, isBinary);
    }

    try {
      if (message.msg_type === 2) {
        // Test log: print handshake response
        console.log(`[${callId}] [TEST] Signaling handshake response:`, JSON.stringify(message, null, 2));

        if (message.status_code !== 0) {
          console.error(`[${callId}] RTMS signaling handshake failed.`);
          return;
        }

        logWebSocketEvent(callId, 'Signaling', 'handshake accepted.');
        connectMediaStreams(message.media_server?.server_urls, callId, rtmsStreamId, ws, callData);
      } else if (message.msg_type === 6) {
        const event = message.event;
        const eventType = event?.event_type;
        if (eventType !== 21 && eventType !== 18) {
          return;
        }

        const channelId = normalizeIdentifier(event?.paticipant_info?.channel_id);
        if (!channelId || !callData.channelPaths.has(channelId)) {
          return;
        }

        const channel = callData.channelPaths.get(channelId);
        await finalizeChannel(callId, channelId, channel);
        callData.channelPaths.delete(channelId);
      } else if (message.msg_type === 12 && ws.readyState === WebSocket.OPEN) {
        sendWebSocketJson(callId, 'Signaling', ws, {
          msg_type: 13,
          timestamp: message.timestamp
        });
        if (callData.signalingHeartbeatCount === 1 || callData.signalingHeartbeatCount % 100 === 0) {
          logWebSocketEvent(callId, 'Signaling', 'heartbeat acknowledged.');
        }
      }
    } catch (error) {
      console.error(`[${callId}] Error handling signaling message:`, error.message);
    }
  });

  ws.on('error', (error) => {
    logWebSocketError(callId, 'Signaling', error);
  });

  ws.on('close', (code, reason) => {
    logWebSocketEvent(
      callId,
      'Signaling',
      `closed (code=${code}, reason_bytes=${getCloseReasonSize(reason)}).`
    );
  });
}

const AUDIO_MEDIA_PARAMS = {
  audio: {
    content_type: 2,
    sample_rate: 1,
    channel: 1,
    codec: 1,
    data_opt: 1,
    send_rate: 20
  }
};

const TRANSCRIPT_MEDIA_PARAMS = {
  transcript: {
    content_type: 5,
    src_language: 9,
    enable_lid: true
  }
};

function pickMediaUrl(serverUrls, preferredKey) {
  if (serverUrls && typeof serverUrls === 'object' && !Array.isArray(serverUrls)) {
    return getServerUrl(serverUrls[preferredKey]) || getServerUrl(serverUrls.all);
  }

  return getServerUrl(serverUrls);
}

function maybeSendClientReadyAck(callId, rtmsStreamId, signalingWs, callData) {
  if (callData.clientReadyAckSent || callData.pendingMediaHandshakes > 0) {
    return;
  }
  if (callData.successfulMediaHandshakes <= 0) {
    console.error(`[${callId}] All RTMS media handshakes failed.`);
    return;
  }
  if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
    return;
  }

  callData.clientReadyAckSent = true;
  sendWebSocketJson(callId, 'Signaling', signalingWs, {
    msg_type: 7,
    rtms_stream_id: rtmsStreamId
  });
  logWebSocketEvent(callId, 'Signaling', 'media handshake acknowledgement sent.');
}

function connectMediaStreams(serverUrls, callId, rtmsStreamId, signalingWs, callData) {
  const streams = [
    {
      kind: 'audio',
      socketName: 'Audio',
      wsField: 'audioWs',
      mediaType: 1,
      mediaParams: AUDIO_MEDIA_PARAMS,
      url: pickMediaUrl(serverUrls, 'audio')
    },
    {
      kind: 'transcript',
      socketName: 'Transcript',
      wsField: 'transcriptWs',
      mediaType: 8,
      mediaParams: TRANSCRIPT_MEDIA_PARAMS,
      url: pickMediaUrl(serverUrls, 'transcript')
    }
  ];

  const started = streams.filter((stream) => {
    if (stream.url) {
      return true;
    }
    console.error(`[${callId}] RTMS signaling response did not include a ${stream.kind} URL.`);
    return false;
  });

  if (started.length === 0) {
    console.error(`[${callId}] RTMS signaling response did not include a media URL.`);
    return;
  }

  callData.pendingMediaHandshakes = started.length;
  callData.successfulMediaHandshakes = 0;
  callData.clientReadyAckSent = false;

  for (const stream of started) {
    connectToMediaWebSocket(stream, callId, rtmsStreamId, signalingWs, callData);
  }
}

function connectToMediaWebSocket(stream, callId, rtmsStreamId, signalingWs, callData) {
  const normalizedUrl = normalizeWebSocketUrl(stream.url);
  if (!normalizedUrl) {
    console.error(`[${callId}] RTMS ${stream.kind} URL is not a valid wss:// URL.`);
    callData.pendingMediaHandshakes = Math.max(0, callData.pendingMediaHandshakes - 1);
    maybeSendClientReadyAck(callId, rtmsStreamId, signalingWs, callData);
    return;
  }

  logWebSocketEvent(
    callId,
    stream.socketName,
    `connecting to ${describeWebSocketEndpoint(normalizedUrl)}.`
  );
  const ws = createWebSocket(normalizedUrl);
  callData[stream.wsField] = ws;

  ws.on('open', () => {
    try {
      logWebSocketEvent(callId, stream.socketName, 'opened; sending handshake.');
      const handshake = {
        msg_type: 3,
        protocol_version: 1,
        call_id: callId,
        rtms_stream_id: rtmsStreamId,
        signature: generateSignature(callId, rtmsStreamId),
        media_type: stream.mediaType,
        payload_encryption: false,
        media_params: stream.mediaParams
      };

      console.log(
        `[${callId}] [TEST] ${stream.socketName} handshake request:`,
        JSON.stringify(handshake, null, 2)
      );

      sendWebSocketJson(callId, stream.socketName, ws, handshake);
    } catch (error) {
      console.error(`[${callId}] Failed to send ${stream.kind} handshake:`, error.message);
    }
  });

  ws.on('message', (data, _isBinary) => {
    if (callData.cleaningUp || activeCalls.get(callId) !== callData) {
      return;
    }

    const message = parseWebSocketMessage(data, callId);
    if (!message) {
      return;
    }

    callData.mediaMessageCount++;
    if (message.msg_type === 12) {
      callData.mediaHeartbeatCount++;
    }

    try {
      if (message.msg_type === 4) {
        console.log(
          `[${callId}] [TEST] ${stream.socketName} handshake response:`,
          JSON.stringify(message, null, 2)
        );

        callData.pendingMediaHandshakes = Math.max(0, callData.pendingMediaHandshakes - 1);
        if (message.status_code !== 0) {
          console.error(`[${callId}] RTMS ${stream.kind} handshake failed.`);
          maybeSendClientReadyAck(callId, rtmsStreamId, signalingWs, callData);
          return;
        }

        callData.successfulMediaHandshakes++;
        logWebSocketEvent(callId, stream.socketName, 'handshake accepted.');
        maybeSendClientReadyAck(callId, rtmsStreamId, signalingWs, callData);
      } else if (message.msg_type === 12 && ws.readyState === WebSocket.OPEN) {
        sendWebSocketJson(callId, stream.socketName, ws, {
          msg_type: 13,
          timestamp: message.timestamp
        });
        if (callData.mediaHeartbeatCount === 1 || callData.mediaHeartbeatCount % 100 === 0) {
          logWebSocketEvent(callId, stream.socketName, 'heartbeat acknowledged.');
        }
      } else if (message.msg_type === 14) {
        const content = message.content;
        const channelId = normalizeIdentifier(content?.channel_id);
        if (!channelId || typeof content?.data !== 'string' || content.data.length === 0) {
          return;
        }

        const audioBuffer = Buffer.from(content.data, 'base64');
        if (audioBuffer.length === 0) {
          return;
        }

        if (!callData.channelPaths.has(channelId)) {
          const rawPath = getChannelRawPath(callData.sessionDir, channelId);
          const wavPath = getChannelWavPath(callData.sessionDir, channelId);
          callData.channelPaths.set(channelId, { rawPath, wavPath });
          console.log(`[${callId}] New audio channel ${channelId}.`);
        }

        const { rawPath } = callData.channelPaths.get(channelId);
        saveRawAudio(audioBuffer, rawPath);
        callData.audioChunkCount++;

        if (callData.audioChunkCount === 1 || callData.audioChunkCount % 100 === 0) {
          logWebSocketEvent(
            callId,
            stream.socketName,
            `audio chunk #${callData.audioChunkCount} received (channel=${channelId}, bytes=${audioBuffer.length}).`,
            {
              kind: 'audio',
              chunk: callData.audioChunkCount,
              channel: channelId,
              bytes: audioBuffer.length,
              transport_bytes: getWebSocketPayloadSize(data)
            }
          );
        }
      } else if (message.msg_type === 17 && typeof message.content?.data === 'string') {
        callData.transcriptCount++;
        logWebSocketEvent(
          callId,
          stream.socketName,
          `transcript received #${callData.transcriptCount} (${message.content.data}).`,
          {
            kind: 'transcript',
            count: callData.transcriptCount,
            content_bytes: Buffer.byteLength(message.content.data),
            transport_bytes: getWebSocketPayloadSize(data)
          }
        );
        saveTranscript(callId, callData.rtmsStreamId, message.content.data);
      }
    } catch (error) {
      console.error(`[${callId}] Error handling ${stream.kind} message:`, error.message);
    }
  });

  ws.on('error', (error) => {
    logWebSocketError(callId, stream.socketName, error);
  });

  ws.on('close', (code, reason) => {
    logWebSocketEvent(
      callId,
      stream.socketName,
      `closed (code=${code}, reason_bytes=${getCloseReasonSize(reason)}).`
    );
  });
}

function handleRTMSStarted(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('Invalid Phone RTMS start payload.');
    return;
  }

  const callId = normalizeIdentifier(payload.call_id);
  const rtmsStreamId = normalizeIdentifier(payload.rtms_stream_id);
  const serverUrl = normalizeWebSocketUrl(getServerUrl(payload.server_urls));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('RTMS credentials are not configured; ignoring Phone RTMS start event.');
    return;
  }

  if (!callId || !rtmsStreamId || !serverUrl) {
    console.error('Invalid Phone RTMS start payload.');
    return;
  }

  if (activeCalls.has(callId)) {
    return;
  }

  const sessionDir = join(audioDir, callId, rtmsStreamId);
  ensureDir(sessionDir);
  ensureDir(join(sessionDir, 'raw'));
  const callData = {
    callId,
    rtmsStreamId,
    serverUrl,
    sessionDir,
    channelPaths: new Map(),
    audioChunkCount: 0,
    transcriptCount: 0,
    signalingMessageCount: 0,
    signalingHeartbeatCount: 0,
    mediaMessageCount: 0,
    mediaHeartbeatCount: 0,
    startedAt: new Date(),
    signalingWs: null,
    audioWs: null,
    transcriptWs: null,
    pendingMediaHandshakes: 0,
    successfulMediaHandshakes: 0,
    clientReadyAckSent: false,
    cleaningUp: false
  };

  activeCalls.set(callId, callData);
  console.log(`[${callId}] Recording session started (stream=${rtmsStreamId}).`);

  try {
    connectToSignalingWebSocket(callId, rtmsStreamId, serverUrl, callData);
  } catch (error) {
    console.error(`[${callId}] Failed to start RTMS session:`, error.message);
    void cleanupCall(callId);
  }
}

async function handleRTMSStopped(payload, event) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error(`Invalid Phone RTMS ${event} payload.`);
    return;
  }

  const callId = normalizeIdentifier(payload.call_id);
  if (!callId) {
    console.error(`Invalid Phone RTMS ${event} payload.`);
    return;
  }

  const stopReason = Number.isInteger(payload.stop_reason)
    ? payload.stop_reason
    : 'not_provided';
  console.log(`[${callId}] Phone RTMS ${event} received (stop_reason=${stopReason}).`);

  await cleanupCall(callId);
}

async function cleanupCall(callId) {
  const data = activeCalls.get(callId);
  if (!data) {
    return;
  }
  if (data.cleaningUp) {
    return;
  }
  data.cleaningUp = true;

  try {
    if (data.signalingWs) {
      logWebSocketEvent(callId, 'Signaling', 'closing.');
      data.signalingWs.close();
    }
    if (data.audioWs) {
      logWebSocketEvent(callId, 'Audio', 'closing.');
      data.audioWs.close();
    }
    if (data.transcriptWs) {
      logWebSocketEvent(callId, 'Transcript', 'closing.');
      data.transcriptWs.close();
    }

    for (const [channelId, channel] of data.channelPaths) {
      await finalizeChannel(callId, channelId, channel);
    }

    try {
      removeSessionRawDir(data.sessionDir);
    } catch (error) {
      console.error(`[${callId}] Failed to remove raw directory:`, error.message);
    }

    console.log(
      `[${callId}] Recording saved with ${data.audioChunkCount} audio chunks and ${data.transcriptCount} transcripts.`
    );
  } catch (error) {
    console.error(`[${callId}] RTMS cleanup error:`, error.message);
  } finally {
    activeCalls.delete(callId);
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.post('/', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Invalid webhook body' });
  }

  const { event, payload } = req.body;
  if (typeof event !== 'string') {
    return res.status(400).json({ error: 'Invalid webhook event' });
  }

  const normalizedEvent = normalizePhoneRtmsEvent(event);
  if (normalizedEvent === 'phone.rtms_started') {
    handleRTMSStarted(payload);
  } else if (normalizedEvent === 'phone.rtms_stopped' || normalizedEvent === 'phone.rtms_interrupted') {
    void handleRTMSStopped(payload, normalizedEvent).catch((error) => {
      console.error(`[${normalizedEvent}] Cleanup failed:`, error.message);
    });
  } else if (!PHONE_RTMS_EVENTS.has(normalizedEvent)) {
    return res.status(200).json({ received: true });
  }

  return res.status(200).json({ received: true });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    activeCalls: activeCalls.size,
    calls: Array.from(activeCalls.keys())
  });
});

app.get('/events', (_req, res) => {
  res.json({
    events: debugEvents,
    checkedAt: new Date().toISOString()
  });
});

process.on('SIGINT', async () => {
  console.log('Shutting down RTMS server...');
  for (const callId of Array.from(activeCalls.keys())) {
    await cleanupCall(callId);
  }
  await closeAllAudioStreams();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log('Zoom Phone RTMS Server');
  console.log('='.repeat(50));
  console.log(`Port: ${PORT}`);
  console.log(`Audio directory: ${audioDir}`);
  console.log(`Transcripts directory: ${transcriptsDir}`);
  console.log('='.repeat(50));
  console.log('Server ready - waiting for Phone RTMS webhooks');
});
