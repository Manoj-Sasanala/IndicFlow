// @ts-check
'use strict';

/**
 * Audio Streaming & Processing Pipeline for Wispr Flow
 * - 16kHz 16-bit Mono PCM chunking & buffering
 * - Fast downsampling (e.g. 48kHz/44.1kHz -> 16kHz)
 * - RIFF/WAV binary header construction for Whisper APIs
 * - Real-time RMS audio power & Voice Activity Detection (VAD)
 * - Monotonic sequence numbering and streaming transport
 */

/**
 * Generates a valid 44-byte standard RIFF/WAV header for 16-bit PCM data.
 * @param {number} dataLengthInBytes - Length of raw PCM data
 * @param {number} [sampleRate=16000] - Sample rate in Hz (Whisper default: 16000)
 * @param {number} [numChannels=1] - Number of audio channels (Whisper default: 1 mono)
 * @param {number} [bitDepth=16] - Bits per sample (16-bit standard)
 * @returns {Buffer} 44-byte WAV header Buffer
 */
function createWavHeader(dataLengthInBytes, sampleRate = 16000, numChannels = 1, bitDepth = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;

  // RIFF Chunk Descriptor
  header.write('RIFF', 0);                          // ChunkID
  header.writeUInt32LE(36 + dataLengthInBytes, 4);   // ChunkSize (4 + 24 + 8 + dataLength)
  header.write('WAVE', 8);                          // Format

  // "fmt " sub-chunk
  header.write('fmt ', 12);                         // Subchunk1ID
  header.writeUInt32LE(16, 16);                     // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);                      // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);            // NumChannels (1 = Mono)
  header.writeUInt32LE(sampleRate, 24);             // SampleRate (16000 Hz)
  header.writeUInt32LE(byteRate, 28);               // ByteRate
  header.writeUInt16LE(blockAlign, 32);             // BlockAlign
  header.writeUInt16LE(bitDepth, 34);               // BitsPerSample (16)

  // "data" sub-chunk
  header.write('data', 36);                         // Subchunk2ID
  header.writeUInt32LE(dataLengthInBytes, 40);      // Subchunk2Size

  return header;
}

/**
 * Encapsulates raw PCM buffer into a complete, playable WAV buffer.
 * @param {Buffer | Uint8Array | Int16Array | Float32Array} pcmData 
 * @param {number} [sampleRate=16000] 
 * @param {number} [numChannels=1] 
 * @param {number} [bitDepth=16] 
 * @returns {Buffer} Complete WAV file buffer
 */
function pcmToWav(pcmData, sampleRate = 16000, numChannels = 1, bitDepth = 16) {
  let pcmBuffer;

  if (pcmData instanceof Float32Array) {
    // Convert Float32Array [-1.0, 1.0] to 16-bit signed integer PCM
    pcmBuffer = Buffer.alloc(pcmData.length * 2);
    for (let i = 0; i < pcmData.length; i++) {
      const s = Math.max(-1, Math.min(1, pcmData[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      pcmBuffer.writeInt16LE(Math.floor(val), i * 2);
    }
  } else if (pcmData instanceof Int16Array) {
    pcmBuffer = Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
  } else if (Buffer.isBuffer(pcmData)) {
    pcmBuffer = pcmData;
  } else if (pcmData instanceof Uint8Array) {
    pcmBuffer = Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
  } else {
    throw new TypeError('Unsupported PCM data type. Expected Buffer, Int16Array, or Float32Array.');
  }

  const header = createWavHeader(pcmBuffer.length, sampleRate, numChannels, bitDepth);
  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Downsamples raw audio buffer to 16,000 Hz mono using linear interpolation.
 * @param {Float32Array | Int16Array} inputSamples 
 * @param {number} fromSampleRate - Source sample rate (e.g. 48000, 44100)
 * @param {number} [toSampleRate=16000] - Target sample rate
 * @returns {Int16Array} 16-bit integer PCM array at target sample rate
 */
function downsampleTo16k(inputSamples, fromSampleRate, toSampleRate = 16000) {
  if (fromSampleRate === toSampleRate && inputSamples instanceof Int16Array) {
    return inputSamples;
  }

  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(inputSamples.length / ratio);
  const result = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originalPos = i * ratio;
    const index = Math.floor(originalPos);
    const decimal = originalPos - index;

    let s0 = 0;
    let s1 = 0;

    if (inputSamples instanceof Float32Array) {
      s0 = inputSamples[index] || 0;
      s1 = inputSamples[index + 1] || s0;
    } else {
      // Int16 normalized to -1.0 .. 1.0
      s0 = (inputSamples[index] || 0) / 32768.0;
      s1 = (inputSamples[index + 1] || s0) / 32768.0;
    }

    // Linear interpolation
    const interpolated = s0 + (s1 - s0) * decimal;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
  }

  return result;
}

/**
 * Computes Root Mean Square (RMS) volume level [0.0 to 1.0] and in decibels (dBFS).
 * Used for the status pill audio visualizer and speech detection.
 * @param {Buffer | Int16Array | Float32Array} audioData 
 * @returns {{ rms: number, db: number, isSilent: boolean }}
 */
function calculateRms(audioData) {
  let sum = 0;
  let count = 0;
  let maxSample = 0;

  if (audioData instanceof Float32Array) {
    count = audioData.length;
    for (let i = 0; i < count; i++) {
      const abs = Math.abs(audioData[i]);
      if (abs > maxSample) maxSample = abs;
      sum += audioData[i] * audioData[i];
    }
  } else {
    // Int16 or Buffer
    const int16Array = audioData instanceof Int16Array
      ? audioData
      : new Int16Array(audioData.buffer, audioData.byteOffset, Math.floor(audioData.byteLength / 2));
    
    count = int16Array.length;
    if (count === 0) return { rms: 0, db: -100, isSilent: true, peakRms: 0 };

    for (let i = 0; i < count; i++) {
      const normalized = Math.abs(int16Array[i] / 32768.0);
      if (normalized > maxSample) maxSample = normalized;
      sum += normalized * normalized;
    }
  }

  if (count === 0) return { rms: 0, db: -100, isSilent: true, peakRms: 0 };

  const rms = Math.sqrt(sum / count);
  // Compute decibels relative to full scale (dBFS)
  const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
  // Truly silent only if average energy is near zero AND peak amplitude never reached speech levels (0.015)
  const isSilent = (db < -50 || rms < 0.002) && maxSample < 0.015;

  return {
    rms: Math.min(1.0, rms),
    db: Math.max(-100, Math.round(db * 10) / 10),
    isSilent,
    peakRms: maxSample
  };
}

/**
 * Generates synthetic sinusoidal test audio PCM buffer (for offline tests & benchmarks).
 * @param {number} durationSeconds - Duration in seconds
 * @param {number} [frequency=440] - Sine tone frequency in Hz
 * @param {number} [sampleRate=16000] - Sample rate
 * @returns {Buffer} Complete WAV buffer
 */
function createSyntheticAudioWav(durationSeconds = 1.0, frequency = 440, sampleRate = 16000) {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const pcm = new Int16Array(totalSamples);
  const angularFreq = 2 * Math.PI * frequency / sampleRate;

  for (let i = 0; i < totalSamples; i++) {
    // 0.5 amplitude sine wave with gentle fade in / fade out to avoid clicks
    const envelope = Math.min(1, i / (sampleRate * 0.05)) * Math.min(1, (totalSamples - i) / (sampleRate * 0.05));
    pcm[i] = Math.round(Math.sin(angularFreq * i) * 16384 * envelope);
  }

  return pcmToWav(pcm, sampleRate, 1, 16);
}

/**
 * Streaming Audio Chunking Queue
 * Buffers continuous PCM stream and yields discrete chunks (e.g. 20ms or 100ms) with sequence numbers.
 */
class AudioChunker {
  /**
   * @param {object} [options]
   * @param {number} [options.chunkDurationMs=100] - Frame duration in ms (default 100ms)
   * @param {number} [options.sampleRate=16000] - Audio sample rate (16kHz)
   */
  constructor(options = {}) {
    this.chunkDurationMs = options.chunkDurationMs || 100;
    this.sampleRate = options.sampleRate || 16000;
    // 16-bit = 2 bytes per sample
    this.bytesPerSample = 2;
    this.chunkSizeBytes = (this.sampleRate * (this.chunkDurationMs / 1000)) * this.bytesPerSample;
    this.buffer = Buffer.alloc(0);
    this.sequence = 0;
    this.totalBytesProcessed = 0;
  }

  /**
   * Push incoming audio data and get ready chunks.
   * @param {Buffer | Uint8Array} chunk 
   * @returns {Array<{ seq: number, buffer: Buffer, rms: number, timestamp: number }>}
   */
  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, buf]);
    this.totalBytesProcessed += buf.length;

    const readyChunks = [];
    while (this.buffer.length >= this.chunkSizeBytes) {
      const chunkData = this.buffer.subarray(0, this.chunkSizeBytes);
      this.buffer = this.buffer.subarray(this.chunkSizeBytes);

      const stats = calculateRms(chunkData);
      readyChunks.push({
        seq: this.sequence++,
        buffer: chunkData,
        rms: stats.rms,
        db: stats.db,
        isSilent: stats.isSilent,
        timestamp: Date.now()
      });
    }

    return readyChunks;
  }

  /**
   * Flushes any remaining bytes in the buffer as a final chunk.
   * @returns {{ seq: number, buffer: Buffer, rms: number, timestamp: number } | null}
   */
  flush() {
    if (this.buffer.length === 0) return null;
    const finalBuffer = this.buffer;
    this.buffer = Buffer.alloc(0);
    const stats = calculateRms(finalBuffer);
    return {
      seq: this.sequence++,
      buffer: finalBuffer,
      rms: stats.rms,
      db: stats.db,
      isSilent: stats.isSilent,
      timestamp: Date.now()
    };
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.sequence = 0;
    this.totalBytesProcessed = 0;
  }
}

module.exports = {
  createWavHeader,
  pcmToWav,
  downsampleTo16k,
  calculateRms,
  createSyntheticAudioWav,
  AudioChunker
};
