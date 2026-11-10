// @ts-check
'use strict';

const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { pcmToWav, calculateRms, AudioChunker } = require('./audioPipeline.js');

// Auto-load .env if available
try {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
} catch {
  // Silent fallback
}

/**
 * Speech Recognition Providers supported by Wispr Flow / IndicFlow
 * @enum {string}
 */
const STTProvider = {
  GNANI_PRISMA: 'gnani_prisma',
  GROQ: 'groq',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  LOCAL_SERVER: 'local_server',
  MOCK_OFFLINE: 'mock_offline'
};

/**
 * Flexible Speech Recognition Provider for Wispr Flow / IndicFlow
 * Supports Gnani AI Prisma STT (Indian languages & Hinglish), Groq Whisper, OpenAI Whisper,
 * Gemini audio, and Mock / Offline fallback.
 */
class STTService extends EventEmitter {
  /**
   * @param {object} [config]
   * @param {string} [config.primaryProvider]
   * @param {string} [config.gnaniApiKey]
   * @param {string} [config.gnaniModel='prisma-v3.0']
   * @param {string} [config.gnaniLanguage='indic-auto']
   * @param {string} [config.gnaniEndpoint]
   * @param {string} [config.groqApiKey]
   * @param {string} [config.groqModel='whisper-large-v3-turbo']
   * @param {string} [config.openaiApiKey]
   * @param {string} [config.openaiModel='whisper-1']
   * @param {string} [config.geminiApiKey]
   * @param {string} [config.geminiModel='gemini-2.5-flash']
   * @param {string} [config.localWhisperUrl]
   * @param {boolean} [config.enableFallback=true]
   * @param {number} [config.timeoutMs=25000]
   */
  constructor(config = {}) {
    super();

    this.gnaniApiKey = config.gnaniApiKey || process.env.GNANI_API_KEY || '';
    this.gnaniModel = config.gnaniModel || process.env.GNANI_MODEL || 'prisma-v3.0';
    this.gnaniLanguage = config.gnaniLanguage || process.env.GNANI_LANGUAGE || 'indic-auto';
    this.gnaniEndpoint = config.gnaniEndpoint || process.env.GNANI_ENDPOINT || 'https://api.vachana.ai/stt/v3';

    this.groqApiKey = config.groqApiKey || process.env.GROQ_API_KEY || '';
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY || '';
    this.geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.localWhisperUrl = config.localWhisperUrl || process.env.FLOW_LOCAL_WHISPER_URL || 'http://127.0.0.1:8080/v1/audio/transcriptions';

    this.primaryProvider = config.primaryProvider || process.env.PRIMARY_STT_PROVIDER || this._determineDefaultProvider();
    this.groqModel = config.groqModel || 'whisper-large-v3-turbo';
    this.openaiModel = config.openaiModel || 'whisper-1';
    this.geminiModel = config.geminiModel || 'gemini-3.5-flash';
    this.enableFallback = config.enableFallback !== false;
    this.timeoutMs = config.timeoutMs || 25000;

    // Mock transcript registry for deterministic testing
    /** @type {Map<string, string>} */
    this.mockResponses = new Map();
    this.defaultMockText = 'Hello world, this is a test transcription from Wispr Flow.';
  }

  /**
   * Determines best default provider based on available environment credentials.
   * @private
   */
  _determineDefaultProvider() {
    if (this.gnaniApiKey) return STTProvider.GNANI_PRISMA;
    if (this.geminiApiKey) return STTProvider.GEMINI;
    if (this.groqApiKey) return STTProvider.GROQ;
    if (this.openaiApiKey) return STTProvider.OPENAI;
    return STTProvider.MOCK_OFFLINE;
  }

  /**
   * Dynamically update API credentials and model configuration at runtime.
   * @param {object} creds
   * @param {string} [creds.gnaniApiKey]
   * @param {string} [creds.gnaniModel]
   * @param {string} [creds.gnaniLanguage]
   * @param {string} [creds.geminiApiKey]
   * @param {string} [creds.geminiModel]
   * @param {string} [creds.groqApiKey]
   * @param {string} [creds.openaiApiKey]
   * @param {string} [creds.primaryProvider]
   * @param {string} [creds.defaultProvider]
   */
  updateCredentials(creds = {}) {
    if (creds.gnaniApiKey !== undefined) this.gnaniApiKey = creds.gnaniApiKey;
    if (creds.gnaniModel !== undefined) this.gnaniModel = creds.gnaniModel;
    if (creds.gnaniLanguage !== undefined) this.gnaniLanguage = creds.gnaniLanguage;
    if (creds.geminiApiKey !== undefined) this.geminiApiKey = creds.geminiApiKey;
    if (creds.geminiModel !== undefined) this.geminiModel = creds.geminiModel;
    if (creds.groqApiKey !== undefined) this.groqApiKey = creds.groqApiKey;
    if (creds.openaiApiKey !== undefined) this.openaiApiKey = creds.openaiApiKey;
    if (creds.primaryProvider !== undefined) {
      this.primaryProvider = creds.primaryProvider;
    } else if (creds.defaultProvider !== undefined) {
      this.primaryProvider = creds.defaultProvider;
    } else {
      this.primaryProvider = this._determineDefaultProvider();
    }
  }

  /**
   * Registers a deterministic mock response for testing.
   * @param {string | RegExp} pattern 
   * @param {string} text 
   */
  registerMockResponse(pattern, text) {
    this.mockResponses.set(String(pattern), text);
  }

  /**
   * Sets default mock transcript text for offline / test mode.
   * @param {string} text 
   */
  setDefaultMockText(text) {
    this.defaultMockText = text;
  }

  /**
   * Main speech-to-text transcription entry point.
   * Accepts audio buffer (WAV, PCM Float32Array, Int16Array, or Buffer) and returns raw transcribed text (`asrText`).
   * 
   * @param {Buffer | Uint8Array | Int16Array | Float32Array} audioData 
   * @param {object} [options]
   * @param {string} [options.provider] - Explicit provider override
   * @param {string} [options.language] - ISO-639-1 language code (e.g. 'en')
   * @param {string} [options.prompt] - Contextual priming tokens
   * @param {number} [options.temperature=0.0]
   * @param {string} [options.expectedMockText] - Force specific mock text for this call
   * @returns {Promise<{
   *   text: string,
   *   rawAsrText: string,
   *   provider: string,
   *   model: string,
   *   latencyMs: number,
   *   confidence: number,
   *   usedFallbackAsr: boolean,
   *   fallbackLevel: number,
   *   durationSeconds: number,
   *   segments?: Array<{ text: string, start: number, end: number }>
   * }>}
   */
  async transcribe(audioData, options = {}) {
    const startTime = Date.now();

    // 1. Ensure audio buffer is in WAV format
    const wavBuffer = this._ensureWavFormat(audioData);

    // Approximate duration from 16kHz 16-bit mono PCM (32,000 bytes/sec)
    const pcmBytes = Math.max(0, wavBuffer.length - 44);
    const durationSeconds = Math.round((pcmBytes / 32000) * 100) / 100;

    // Check for silence to short-circuit and avoid unneeded API spend
    const rmsStats = calculateRms(wavBuffer.subarray(44));
    if (rmsStats.isSilent && pcmBytes > 16000 && !options.expectedMockText) {
      console.log(`[STTService] Skipped API: buffer is silent (rms=${rmsStats.rms.toFixed(4)}, peak=${rmsStats.peakRms?.toFixed(4)}, db=${rmsStats.db}dB)`);
      return {
        text: '',
        rawAsrText: '',
        provider: 'silence_detector',
        model: 'none',
        latencyMs: Date.now() - startTime,
        confidence: 1.0,
        usedFallbackAsr: false,
        fallbackLevel: 0,
        durationSeconds
      };
    }

    const providerOrder = this._getProviderExecutionOrder(options.provider, Boolean(options.expectedMockText));
    let lastError = null;

    for (let level = 0; level < providerOrder.length; level++) {
      const currentProvider = providerOrder[level];
      const isFallback = level > 0;

      try {
        const result = await this._executeProvider(currentProvider, wavBuffer, options);
        const latencyMs = Date.now() - startTime;

        return {
          text: result.text,
          rawAsrText: result.text,
          provider: currentProvider,
          model: result.model,
          latencyMs,
          confidence: result.confidence ?? 0.95,
          usedFallbackAsr: isFallback,
          fallbackLevel: level,
          durationSeconds,
          segments: result.segments
        };
      } catch (err) {
        lastError = err;
        this.emit('providerError', {
          provider: currentProvider,
          level,
          error: err.message,
          timestamp: Date.now()
        });

        if (!this.enableFallback) {
          throw err;
        }
        // Continue loop to try next fallback tier
      }
    }

    throw new Error(`All STT providers failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  }

  /**
   * Ensures the audio data is packaged into a valid WAV Buffer.
   * @private
   */
  _ensureWavFormat(audioData) {
    if (Buffer.isBuffer(audioData) && audioData.length >= 4) {
      // Check for RIFF (WAV)
      const riff = audioData.toString('ascii', 0, 4);
      if (riff === 'RIFF') {
        return audioData;
      }
      // Check for WebM EBML (0x1A 0x45 0xDF 0xA3) or Ogg (OggS)
      if ((audioData[0] === 0x1A && audioData[1] === 0x45) || audioData.toString('ascii', 0, 4) === 'OggS') {
        return audioData;
      }
    }
    // Convert PCM to WAV
    return pcmToWav(audioData);
  }

  /**
   * Generates prioritized list of providers to attempt.
   * @param {string} [preferredProvider]
   * @param {boolean} [allowMock=false]
   * @private
   */
  _getProviderExecutionOrder(preferredProvider, allowMock = false) {
    const list = [];
    const primary = preferredProvider || this.primaryProvider;
    list.push(primary);

    if (this.enableFallback) {
      const hasMockCustomization = this.defaultMockText !== 'Hello world, this is a test transcription from Wispr Flow.' || this.mockResponses.size > 0;
      const isTestEnv = allowMock || 
                        process.env.NODE_ENV === 'test' || 
                        primary === STTProvider.MOCK_OFFLINE ||
                        hasMockCustomization;

      // If mock response was customized for unit testing, route directly to mock to preserve API credits
      if (hasMockCustomization && !list.includes(STTProvider.MOCK_OFFLINE)) {
        list.push(STTProvider.MOCK_OFFLINE);
        return list;
      }

      // Add alternative cloud providers if credentials exist
      if (primary !== STTProvider.GNANI_PRISMA && this.gnaniApiKey) list.push(STTProvider.GNANI_PRISMA);
      if (primary !== STTProvider.GROQ && this.groqApiKey) list.push(STTProvider.GROQ);
      if (primary !== STTProvider.OPENAI && this.openaiApiKey) list.push(STTProvider.OPENAI);
      if (primary !== STTProvider.GEMINI && this.geminiApiKey) list.push(STTProvider.GEMINI);
      
      if (isTestEnv && !list.includes(STTProvider.MOCK_OFFLINE)) {
        list.push(STTProvider.MOCK_OFFLINE);
      }
    }

    return list;
  }

  /**
   * Dispatches request to the specific provider implementation.
   * @private
   */
  async _executeProvider(provider, wavBuffer, options) {
    switch (provider) {
      case STTProvider.GNANI_PRISMA:
        return await this._transcribeGnaniPrisma(wavBuffer, options);
      case STTProvider.GROQ:
        return await this._transcribeGroq(wavBuffer, options);
      case STTProvider.OPENAI:
        return await this._transcribeOpenAI(wavBuffer, options);
      case STTProvider.GEMINI:
        return await this._transcribeGemini(wavBuffer, options);
      case STTProvider.LOCAL_SERVER:
        return await this._transcribeLocalServer(wavBuffer, options);
      case STTProvider.MOCK_OFFLINE:
      default:
        return await this._transcribeMock(wavBuffer, options);
    }
  }

  /**
   * Gnani AI Prisma STT API (prisma-v3.0 / v2.5, Indian languages & English).
   * @private
   */
  async _transcribeGnaniPrisma(wavBuffer, options = {}) {
    if (!this.gnaniApiKey) {
      throw new Error('GNANI_API_KEY is missing');
    }

    const formData = new FormData();
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('audio_file', audioBlob, 'audio.wav');
    formData.append('model', options.model || this.gnaniModel || 'prisma-v3.0');
    formData.append('language_code', options.language || this.gnaniLanguage || 'indic-auto');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const endpoint = this.gnaniEndpoint || 'https://api.vachana.ai/stt/v3';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key-ID': this.gnaniApiKey
        },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gnani Prisma HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json();
      const text = (json.transcript || json.text || json.full_transcript || '').trim();
      return {
        text,
        model: json.model || this.gnaniModel || 'prisma-v3.0',
        detectedLanguage: json.detected_language_code || 'indic-auto',
        latency: json.end_to_end_latency || json.processing_time || 0,
        requestId: json.request_id || null,
        confidence: 0.95,
        provider: STTProvider.GNANI_PRISMA
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Groq Whisper API (whisper-large-v3-turbo, ultra fast <200ms latency).
   * @private
   */
  async _transcribeGroq(wavBuffer, options) {
    if (!this.groqApiKey) {
      throw new Error('GROQ_API_KEY is missing');
    }

    const formData = new FormData();
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', this.groqModel);
    formData.append('response_format', 'verbose_json');
    formData.append('temperature', String(options.temperature ?? 0.0));

    if (options.language) {
      formData.append('language', options.language);
    }
    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.groqApiKey}`
        },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq STT HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json();
      return {
        text: (json.text || '').trim(),
        model: this.groqModel,
        confidence: this._calculateVerboseConfidence(json),
        segments: json.segments || []
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * OpenAI Whisper API (whisper-1).
   * @private
   */
  async _transcribeOpenAI(wavBuffer, options) {
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is missing');
    }

    const formData = new FormData();
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', this.openaiModel);
    formData.append('response_format', 'verbose_json');
    formData.append('temperature', String(options.temperature ?? 0.0));

    if (options.language) {
      formData.append('language', options.language);
    }
    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`
        },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI STT HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json();
      return {
        text: (json.text || '').trim(),
        model: this.openaiModel,
        confidence: this._calculateVerboseConfidence(json),
        segments: json.segments || []
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Google Gemini Multimodal Audio Transcription.
   * @private
   */
  async _transcribeGemini(wavBuffer, options) {
    if (!this.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is missing');
    }

    // Determine audio mimeType
    let mimeType = 'audio/wav';
    if (wavBuffer.length >= 4) {
      if (wavBuffer[0] === 0x1A && wavBuffer[1] === 0x45) {
        mimeType = 'audio/webm';
      } else if (wavBuffer.toString('ascii', 0, 4) === 'OggS') {
        mimeType = 'audio/ogg';
      }
    }

    const base64Audio = wavBuffer.toString('base64');
    const prompt = 'Transcribe the spoken audio verbatim in English (or verbatim in Latin/English script if terms are mixed). Do NOT translate into another language. If there is no discernible speech or only silence/background noise, return an empty string. Return ONLY the verbatim transcribed text without quotes, markdown formatting, or commentary.';

    const primaryModel = this.geminiModel || 'gemini-3.5-flash';
    const modelsToTry = [primaryModel, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'].filter((v, i, a) => a.indexOf(v) === i);
    let lastError = null;

    for (const model of modelsToTry) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Audio
                    }
                  },
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: options.temperature ?? 0.0,
              maxOutputTokens: options.maxOutputTokens || 256,
              thinkingConfig: {
                thinkingBudget: 1
              }
            }
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 503) {
            console.warn(`[STT Gemini] Model ${model} returned 503, retrying with next model...`);
            lastError = new Error(`Gemini STT HTTP 503: ${errorText}`);
            continue;
          }
          throw new Error(`Gemini STT HTTP ${response.status}: ${errorText}`);
        }

        const json = await response.json();
        const parts = json.candidates?.[0]?.content?.parts || [];
        const textParts = parts.filter(p => typeof p.text === 'string' && p.text.length > 0).map(p => p.text);
        const candidate = textParts.join(' ').trim();

        if (!candidate && modelsToTry.indexOf(model) < modelsToTry.length - 1) {
          console.warn(`[STT Gemini] Model ${model} returned empty candidate, trying next model...`);
          continue;
        }

        return {
          text: candidate,
          model: model,
          confidence: 0.95
        };
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') {
          throw new Error(`Gemini STT timed out after ${this.timeoutMs}ms`);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new Error('Gemini STT failed on all candidate models');
  }

  /**
   * Checks if local whisper.cpp binary and model exist on disk.
   * @returns {{ ready: boolean, exePath: string | null, modelPath: string | null }}
   */
  hasLocalWhisperBinary() {
    const whisperDir = path.resolve(__dirname, '../../native/whisper');
    const exeCandidates = ['whisper-cli.exe', 'main.exe'];
    const explicitModel = process.env.FLOW_WHISPER_MODEL;
    const modelCandidates = explicitModel ? [explicitModel] : [
      'ggml-small.en.bin',
      'ggml-base.en.bin',
      'ggml-base.bin',
      'ggml-tiny.en.bin'
    ];

    const exe = exeCandidates.find(e => fs.existsSync(path.join(whisperDir, e)));
    const model = modelCandidates.find(m => fs.existsSync(path.join(whisperDir, m)));

    if (exe && model) {
      return {
        ready: true,
        exePath: path.join(whisperDir, exe),
        modelPath: path.join(whisperDir, model)
      };
    }
    return { ready: false, exePath: null, modelPath: null };
  }

  /**
   * Direct execution of local whisper-cli.exe / main.exe binary on disk.
   * @private
   */
  async _transcribeLocalCli(wavBuffer, options, binaryInfo) {
    const tempId = `flow_audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempWav = path.join(os.tmpdir(), `${tempId}.wav`);
    const tempOutTxt = path.join(os.tmpdir(), `${tempId}.wav.txt`);

    try {
      await fs.promises.writeFile(tempWav, wavBuffer);

      const numThreads = Math.min(8, os.cpus()?.length || 4);
      const args = [
        '-m', binaryInfo.modelPath,
        '-f', tempWav,
        '-t', String(numThreads),
        '-np',
        '-nt',
        '-ng',
        '--no-timestamps',
        '-otxt',
        '-of', path.join(os.tmpdir(), tempId)
      ];

      if (options.language) {
        args.push('-l', options.language);
      }

      const technicalPrompt = options?.prompt || 'Glossary: nodes, edges, graph, REA, Electron, C#, Caret, code, Wispr Flow.';
      args.push('--prompt', technicalPrompt);

      const result = await new Promise((resolve, reject) => {
        execFile(binaryInfo.exePath, args, { timeout: this.timeoutMs }, (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout);
        });
      });

      let text = '';
      if (fs.existsSync(tempOutTxt)) {
        text = await fs.promises.readFile(tempOutTxt, 'utf-8');
      } else {
        text = String(result || '').trim();
      }

      return {
        text: text.trim(),
        model: 'whisper.cpp-cli',
        confidence: 0.95
      };
    } finally {
      fs.promises.unlink(tempWav).catch(() => {});
      fs.promises.unlink(tempOutTxt).catch(() => {});
      fs.promises.unlink(path.join(os.tmpdir(), `${tempId}.txt`)).catch(() => {});
    }
  }

  /**
   * Local Whisper Engine (In-Memory daemon ~120ms or direct CLI process fallback).
   * @private
   */
  async _transcribeLocalServer(wavBuffer, options) {
    // 1. Try persistent in-memory daemon on port 8089 or 8080 (fastest: ~120ms)
    const daemonUrls = ['http://127.0.0.1:8089/inference', this.localWhisperUrl];
    for (const url of daemonUrls) {
      try {
        const formData = new FormData();
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        formData.append('file', audioBlob, 'audio.wav');
        formData.append('model', 'whisper');
        const technicalPrompt = options?.prompt || 'Glossary: nodes, edges, graph, REA, Electron, C#, Caret, code, Wispr Flow.';
        formData.append('prompt', technicalPrompt);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);

        try {
          const res = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          });
          if (res.ok) {
            const json = await res.json();
            const text = (json.text || '').trim();
            console.log(`[STT] In-memory local whisper response from ${url}: "${text}"`);
            return {
              text,
              model: 'whisper.cpp-server-ram',
              confidence: 0.95
            };
          }
        } finally {
          clearTimeout(timer);
        }
      } catch {}
    }

    // 2. Direct CLI process execution fallback (~1.5s cold-boot)
    const localBinary = this.hasLocalWhisperBinary();
    if (localBinary.ready) {
      try {
        console.log(`[STT] Using local whisper binary: ${localBinary.exePath}`);
        return await this._transcribeLocalCli(wavBuffer, options, localBinary);
      } catch (cliErr) {
        console.warn('[STT] Local whisper-cli execution failed:', cliErr.message);
      }
    }

    throw new Error('Local Whisper engine is not responding (daemon offline and CLI failed)');
  }

  /**
   * Deterministic Mock Provider for offline testing and development.
   * @private
   */
  async _transcribeMock(wavBuffer, options) {
    // Simulated realistic audio processing latency (15 - 40ms)
    await new Promise(resolve => setTimeout(resolve, 25));

    if (options.expectedMockText) {
      return {
        text: options.expectedMockText,
        model: 'mock-offline',
        confidence: 0.99
      };
    }

    // Look for matching registered mock responses
    for (const [key, value] of this.mockResponses.entries()) {
      if (options.prompt && options.prompt.includes(key)) {
        return { text: value, model: 'mock-offline', confidence: 0.98 };
      }
    }

    return {
      text: this.defaultMockText,
      model: 'mock-offline',
      confidence: 0.95
    };
  }

  /**
   * Computes confidence score from verbose Whisper JSON segments.
   * @private
   */
  _calculateVerboseConfidence(json) {
    if (!json.segments || json.segments.length === 0) return 0.95;
    let sumProb = 0;
    for (const seg of json.segments) {
      // avg_logprob is logarithmic, convert to linear probability approx
      const prob = Math.exp(seg.avg_logprob || -0.2);
      sumProb += prob;
    }
    return Math.min(1.0, Math.max(0.0, Math.round((sumProb / json.segments.length) * 100) / 100));
  }

  /**
   * Creates a live streaming dictation session.
   * @param {object} [sessionOptions]
   * @returns {StreamingDictationSession}
   */
  createSession(sessionOptions = {}) {
    return new StreamingDictationSession(this, sessionOptions);
  }
}

/**
 * Streaming Dictation Session
 * Handles real-time audio chunk aggregation, interim partials, and final completion.
 */
class StreamingDictationSession extends EventEmitter {
  /**
   * @param {STTService} sttService 
   * @param {object} [options]
   */
  constructor(sttService, options = {}) {
    super();
    this.sttService = sttService;
    this.options = options;
    this.chunker = new AudioChunker({ chunkDurationMs: options.chunkDurationMs || 100 });
    this.accumulatedPcm = Buffer.alloc(0);
    this.isRecording = true;
    this.startTime = Date.now();
    this.latestSeq = 0;
  }

  /**
   * Feed real-time PCM audio chunks into the session.
   * @param {Buffer | Uint8Array} chunk 
   */
  pushAudio(chunk) {
    if (!this.isRecording) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.accumulatedPcm = Buffer.concat([this.accumulatedPcm, buf]);

    const frames = this.chunker.push(buf);
    for (const frame of frames) {
      this.latestSeq = frame.seq;
      this.emit('audioFrame', frame);
    }
  }

  /**
   * Signals end of speech, flushes buffer, and transcribes final audio.
   * @returns {Promise<{ text: string, rawAsrText: string, latencyMs: number, provider: string }>}
   */
  async stopAndFinalize() {
    this.isRecording = false;
    const finalChunk = this.chunker.flush();
    if (finalChunk) {
      this.emit('audioFrame', finalChunk);
    }

    if (this.accumulatedPcm.length === 0) {
      return {
        text: '',
        rawAsrText: '',
        latencyMs: Date.now() - this.startTime,
        provider: 'none'
      };
    }

    this.emit('stateChange', { state: 'transcribing' });
    const result = await this.sttService.transcribe(this.accumulatedPcm, this.options);
    this.emit('finalTranscript', result);
    this.emit('stateChange', { state: 'completed' });
    return result;
  }

  cancel() {
    this.isRecording = false;
    this.chunker.reset();
    this.accumulatedPcm = Buffer.alloc(0);
    this.emit('stateChange', { state: 'cancelled' });
  }
}

module.exports = {
  STTService,
  StreamingDictationSession,
  STTProvider
};
