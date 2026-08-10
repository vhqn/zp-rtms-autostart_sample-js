import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeChannelIdentifier(channelId) {
  const candidate = Number.isInteger(channelId) ? String(channelId) : channelId;
  if (typeof candidate !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(candidate)) {
    throw new Error('Invalid channel identifier');
  }
  return candidate;
}

// Cache of open write streams keyed by file path
const writeStreams = new Map();


export function makeSessionTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export function getChannelRawPath(sessionDir, channelId) {
  return path.join(sessionDir, `channel_${normalizeChannelIdentifier(channelId)}.raw`);
}

export function getChannelWavPath(sessionDir, channelId) {
  return path.join(sessionDir, `channel_${normalizeChannelIdentifier(channelId)}.wav`);
}

export function saveRawAudio(chunk, rawPath) {
  const dir = path.dirname(rawPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let stream = writeStreams.get(rawPath);
  if (!stream) {
    stream = fs.createWriteStream(rawPath, { flags: 'a' });
    writeStreams.set(rawPath, stream);
  }

  stream.write(chunk);
}

export async function convertRawToWav(inputFile, outputFile, options = {}) {
  const sampleRate = Number.isInteger(options.sampleRate) && options.sampleRate > 0
    ? options.sampleRate
    : 16000;
  const channels = Number.isInteger(options.channels) && options.channels > 0
    ? options.channels
    : 1;

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 's16le',
      '-ar', String(sampleRate),
      '-ac', String(channels),
      '-i', inputFile,
      outputFile
    ], { maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    // Keep recording finalization working even when an older runtime image
    // does not contain ffmpeg. The input is already signed 16-bit little-
    // endian PCM, so adding a WAV header is sufficient for this conversion.
    if (error.code === 'ENOENT') {
      const pcm = fs.readFileSync(inputFile);
      if (pcm.length % (channels * 2) !== 0) {
        throw new Error(`Raw PCM size is not aligned to ${channels} channel(s): ${pcm.length} bytes`);
      }
      fs.writeFileSync(outputFile, Buffer.concat([
        buildWavHeader(pcm.length, channels),
        pcm
      ]));
      console.warn(`ffmpeg was not found; wrote WAV header directly: ${outputFile}`);
      return;
    }
    throw new Error(`FFmpeg conversion failed: ${error.message}`);
  }
}

export function closeRawStream(rawPath) {
  const stream = writeStreams.get(rawPath);
  if (!stream) return Promise.resolve();
  return new Promise((resolve) => {
    stream.end(() => {
      writeStreams.delete(rawPath);
      resolve();
    });
  });
}

export function closeAllAudioStreams() {
  const promises = Array.from(writeStreams.entries()).map(([, stream]) =>
    new Promise((resolve) => stream.end(resolve))
  );
  writeStreams.clear();
  return Promise.all(promises);
}

// WAV params: 16kHz, 16-bit
const WAV_SAMPLE_RATE = 16000;
const WAV_BITS_PER_SAMPLE = 16;

// Build 44-byte WAV header for raw PCM data
export function buildWavHeader(dataSize, channels) {
  const bitsPerSample = WAV_BITS_PER_SAMPLE;
  const byteRate = WAV_SAMPLE_RATE * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const fileSize = 36 + dataSize;

  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);               // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(WAV_SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

// Interleave two mono 16-bit PCM buffers into stereo L-R-L-R...
export function interleaveStereo(left, right) {
  const nSamples = Math.max(Math.floor(left.length / 2), Math.floor(right.length / 2));
  const result = Buffer.alloc(nSamples * 4, 0);
  for (let i = 0; i < nSamples; i++) {
    const off = i * 4;
    if (i * 2 + 1 < left.length) {
      result[off]     = left[i * 2];
      result[off + 1] = left[i * 2 + 1];
    }
    if (i * 2 + 1 < right.length) {
      result[off + 2] = right[i * 2];
      result[off + 3] = right[i * 2 + 1];
    }
  }
  return result;
}

// Read per-channel raw files, interleave them, and write interleaved.wav
// Stereo when two channels (L=first, R=second), mono when one channel
export async function finalizeInterleavedWav(sessionDir, channelPaths) {
  if (channelPaths.size === 0) return;

  const ordered = Array.from(channelPaths.keys());
  const outPath = path.join(sessionDir, 'mixed.wav');

  let pcm;
  let channels;

  if (ordered.length >= 2) {
    const left  = fs.readFileSync(channelPaths.get(ordered[0]).rawPath);
    const right = fs.readFileSync(channelPaths.get(ordered[1]).rawPath);
    pcm = interleaveStereo(left, right);
    channels = 2;
    console.log(`  Interleaved stereo (L=${ordered[0]}, R=${ordered[1]}): ${outPath}`);
  } else {
    pcm = fs.readFileSync(channelPaths.get(ordered[0]).rawPath);
    channels = 1;
    console.log(`  Interleaved mono (${ordered[0]}): ${outPath}`);
  }

  const header = buildWavHeader(pcm.length, channels);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
}
