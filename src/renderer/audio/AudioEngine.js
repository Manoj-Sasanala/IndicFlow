// @ts-check
'use strict';

/**
 * AudioEngine - Modular Client Audio Capture, VAD & RIFF/WAV Construction
 * High-performance Web Audio recording architecture for IndicFlow.
 */

class AudioEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.speechThresholdRms=0.016]    // ~ -36 dB: Speech detection threshold
   * @param {number} [options.silenceThresholdRms=0.011]   // ~ -39 dB: Background room silence floor
   * @param {number} [options.silenceAutoStopMs=1600]      // 1.6s silence post-speech auto-stops
   * @param {number} [options.initialSilenceTimeoutMs=8000]// 8s timeout if user never speaks
   * @param {number} [options.maxDurationMs=60000]         // 60s hard ceiling
   * @param {function} [options.onVolume]                  // (levels: { rms: number, db: number, normalized: number }) => void
   * @param {function} [options.onAutoStop]                // (wavBytes: number[]) => void
   * @param {string} [options.workletPath]                 // Path to recorderWorklet.js
   */
  constructor(options = {}) {
    this.speechThresholdRms = options.speechThresholdRms || 0.008;
    this.silenceThresholdRms = options.silenceThresholdRms || 0.005;
    this.silenceAutoStopMs = options.silenceAutoStopMs || 3000; // 3.0s speech pause gap before auto-transcribing
    this.initialSilenceTimeoutMs = options.initialSilenceTimeoutMs || 8000;
    this.maxDurationMs = options.maxDurationMs || 60000;
    this.onVolume = options.onVolume || null;
    this.onAutoStop = options.onAutoStop || null;
    this.workletPath = options.workletPath || '../audio/recorderWorklet.js';

    this.audioCtx = null;
    this.micStream = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.recorderNode = null;
    this.muteGainNode = null;
    this.scriptProcessorNode = null;

    this.isRecording = false;
    this.isAutoStopping = false;
    this.hasDetectedSpeech = false;
    this.silenceStartTime = 0;
    this.recordingStartTime = 0;

    /** @type {Int16Array[]} */
    this.pcmChunks = [];
    /** @type {number[]} */
    this.chunkVolumes = []; // dB volume history for speech trimming
  }

  /**
   * Calculates Root Mean Square (RMS) and decibels for a PCM sample buffer.
   * @param {Float32Array | Int16Array} samples
   * @returns {{ rms: number, db: number, normalized: number }}
   */
  static calculateMetrics(samples) {
    if (!samples || samples.length === 0) {
      return { rms: 0, db: -100, normalized: 0 };
    }

    let sum = 0;
    const isFloat = samples instanceof Float32Array;

    for (let i = 0; i < samples.length; i++) {
      const val = isFloat ? samples[i] : samples[i] / 32768.0;
      sum += val * val;
    }

    const rms = Math.sqrt(sum / samples.length);
    const db = 20 * Math.log10(rms + 1e-10);
    // Normalize -50 dB ... 0 dB into 0.0 ... 1.0
    const normalized = Math.max(0, Math.min(1, (db + 50) / 50));

    return { rms, db, normalized };
  }

  /**
   * Generates clean, zero-latency Web Audio sound effects for state transitions.
   * Pure procedural synthesis: requires no external audio files or licenses.
   * @param {'start' | 'stop' | 'success' | 'error'} type
   */
  static playSound(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.10);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'stop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.10);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.06);
        osc.frequency.setValueAtTime(783.99, now + 0.12);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      }
    } catch {}
  }

  /**
   * Starts microphone capture and audio worklet processing.
   */
  async start() {
    if (this.isRecording) return;

    this.pcmChunks = [];
    this.chunkVolumes = [];
    this.hasDetectedSpeech = false;
    this.silenceStartTime = 0;
    this.recordingStartTime = Date.now();
    this.isAutoStopping = false;

    // 1. Acquire microphone stream with driver-safe fallback
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    // 2. Initialize AudioContext at standard 16 kHz
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
      latencyHint: 'interactive'
    });

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

    // 3. Audio Analyser for FFT spectrum visualizer
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 64;
    this.analyserNode.smoothingTimeConstant = 0.75;
    this.sourceNode.connect(this.analyserNode);

    // 4. Mute gain node prevents feedback through local speakers
    this.muteGainNode = this.audioCtx.createGain();
    this.muteGainNode.gain.value = 0;
    this.muteGainNode.connect(this.audioCtx.destination);

    // 5. Try loading AudioWorklet, with graceful fallback to ScriptProcessor
    let workletLoaded = false;
    try {
      if (this.audioCtx.audioWorklet) {
        await this.audioCtx.audioWorklet.addModule(this.workletPath);
        this.recorderNode = new AudioWorkletNode(this.audioCtx, 'recorder-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1
        });

        this.recorderNode.port.onmessage = (e) => {
          this._handleWorkletMessage(e);
        };

        this.sourceNode.connect(this.recorderNode);
        this.recorderNode.connect(this.muteGainNode);
        this.recorderNode.port.postMessage('start');
        workletLoaded = true;
      }
    } catch (workletErr) {
      console.warn('[AudioEngine] AudioWorklet load failed, falling back to ScriptProcessor:', workletErr.message);
      workletLoaded = false;
    }

    if (!workletLoaded) {
      // ScriptProcessor fallback
      this.scriptProcessorNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording || this.isAutoStopping) return;
        const channel = e.inputBuffer.getChannelData(0);
        this._processPcmFloatBlock(channel);
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.muteGainNode);
    }

    this.isRecording = true;
  }

  /**
   * Internal handler for AudioWorklet messages
   * @private
   */
  _handleWorkletMessage(e) {
    if (!this.isRecording || this.isAutoStopping) return;

    if (e.data && e.data.data) {
      this._processPcmFloatBlock(e.data.data);
    }
  }

  /**
   * Processes a block of Float32 audio samples:
   * - Converts to 16-bit PCM
   * - Calculates RMS energy & decibels
   * - Updates Voice Activity Detection (VAD) state
   * @private
   */
  _processPcmFloatBlock(floatSamples) {
    const pcm16 = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.pcmChunks.push(pcm16);

    // Compute metrics
    const metrics = AudioEngine.calculateMetrics(floatSamples);
    this.chunkVolumes.push(metrics.db);

    if (this.onVolume) {
      this.onVolume(metrics);
    }

    // Voice Activity Detection & Silence Auto-Stop
    const now = Date.now();

    if (metrics.rms >= this.speechThresholdRms) {
      this.hasDetectedSpeech = true;
      this.silenceStartTime = 0; // Reset silence counter while user speaks
    } else {
      if (this.hasDetectedSpeech) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime >= this.silenceAutoStopMs) {
          console.log(`[AudioEngine] VAD: Silence auto-stop triggered (${now - this.silenceStartTime}ms after speech)`);
          this._triggerAutoStop();
          return;
        }
      } else if (metrics.rms < this.silenceThresholdRms) {
        if (now - this.recordingStartTime >= this.initialSilenceTimeoutMs) {
          console.log('[AudioEngine] VAD: Initial silence timeout (no speech detected in 8s)');
          this._triggerAutoStop();
          return;
        }
      }
    }

    if (now - this.recordingStartTime >= this.maxDurationMs) {
      console.log('[AudioEngine] VAD: Hard ceiling timeout (60s)');
      this._triggerAutoStop();
    }
  }

  /**
   * Automatically stops recording and fires onAutoStop callback
   * @private
   */
  _triggerAutoStop() {
    this.isAutoStopping = true;
    const wavBytes = this.stopAndGetWav();
    if (this.onAutoStop) {
      this.onAutoStop(wavBytes);
    }
  }

  /**
   * Stops recording and returns the final WAV audio buffer with leading/trailing silence trimmed.
   * @returns {number[] | null}
   */
  stopAndGetWav() {
    this.isRecording = false;

    if (this.recorderNode) {
      try {
        this.recorderNode.port.postMessage('stop');
        this.recorderNode.disconnect();
      } catch {}
      this.recorderNode = null;
    }

    if (this.scriptProcessorNode) {
      try {
        this.scriptProcessorNode.disconnect();
      } catch {}
      this.scriptProcessorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.muteGainNode) {
      try {
        this.muteGainNode.disconnect();
      } catch {}
      this.muteGainNode = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.pcmChunks.length === 0) {
      this.isAutoStopping = false;
      return null;
    }

    // Apply Speech Trimming (Dynamic speech edge trimming algorithm)
    let startChunk = 0;
    let endChunk = this.pcmChunks.length - 1;

    if (this.hasDetectedSpeech && this.chunkVolumes.length === this.pcmChunks.length) {
      const speechCutoffDb = -46; // dB floor
      let firstSpeech = -1;
      let lastSpeech = -1;

      for (let i = 0; i < this.chunkVolumes.length; i++) {
        if (this.chunkVolumes[i] >= speechCutoffDb) {
          if (firstSpeech === -1) firstSpeech = i;
          lastSpeech = i;
        }
      }

      if (firstSpeech !== -1) {
        startChunk = Math.max(0, firstSpeech - 2); // 2 frames leading margin
        endChunk = Math.min(this.pcmChunks.length - 1, lastSpeech + 2); // 2 frames trailing margin
      }
    }

    // Merge PCM chunks in trimmed range
    let totalSamples = 0;
    for (let c = startChunk; c <= endChunk; c++) {
      totalSamples += this.pcmChunks[c].length;
    }

    if (totalSamples === 0) {
      this.isAutoStopping = false;
      return null;
    }

    const mergedPcm = new Int16Array(totalSamples);
    let offset = 0;
    for (let c = startChunk; c <= endChunk; c++) {
      mergedPcm.set(this.pcmChunks[c], offset);
      offset += this.pcmChunks[c].length;
    }

    // Construct 44-byte standard RIFF/WAVE container
    const sampleRate = 16000;
    const numChannels = 1;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const dataSize = mergedPcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(v, o, str) {
      for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
    }

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const uint8 = new Uint8Array(buffer);
    uint8.set(new Uint8Array(mergedPcm.buffer), 44);

    this.pcmChunks = [];
    this.chunkVolumes = [];
    this.isAutoStopping = false;

    return Array.from(uint8);
  }
}

// Support both Browser/Electron Renderer and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioEngine };
}
