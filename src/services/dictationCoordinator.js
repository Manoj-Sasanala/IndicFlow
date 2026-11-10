// @ts-check
'use strict';

const EventEmitter = require('node:events');
const { STTService } = require('./sttService.js');
const { ContextFormatter, AppCategory } = require('./contextFormatter.js');
const { CommandClassifier, CommandType } = require('./commandClassifier.js');
const { PersonalizationEngine } = require('./personalization.js');

/**
 * @typedef {'idle' | 'listening' | 'processing' | 'success' | 'error'} DictationState
 */

class DictationCoordinator extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('../db/database.js').FlowDatabase} options.db
   * @param {import('./helperSupervisor.js').HelperSupervisor} options.helper
   * @param {object} [options.windowManager]
   * @param {STTService} [options.sttService]
   * @param {ContextFormatter} [options.contextFormatter]
   * @param {CommandClassifier} [options.commandClassifier]
   * @param {PersonalizationEngine} [options.personalization]
   */
  constructor(options) {
    super();
    this.db = options.db;
    this.helper = options.helper;
    this.windowManager = options.windowManager || null;

    /** @type {DictationState} */
    this.state = 'idle';
    this.sessionStartTime = 0;
    this.activeSessionId = null;
    this.simulatedAudioTimer = null;
    this.successHideTimer = null;

    // AI & NLP Pipelines
    this.sttService = options.sttService || new STTService({
      gnaniApiKey: this.db ? this.db.getSetting('gnaniApiKey', process.env.GNANI_API_KEY || '') : '',
      gnaniModel: this.db ? this.db.getSetting('gnaniModel', process.env.GNANI_MODEL || 'prisma-v3.0') : 'prisma-v3.0',
      gnaniLanguage: this.db ? this.db.getSetting('gnaniLanguage', process.env.GNANI_LANGUAGE || 'indic-auto') : 'indic-auto',
      groqApiKey: this.db ? this.db.getSetting('groqApiKey', process.env.GROQ_API_KEY || '') : '',
      openaiApiKey: this.db ? this.db.getSetting('openaiApiKey', process.env.OPENAI_API_KEY || '') : '',
      geminiApiKey: this.db ? this.db.getSetting('geminiApiKey', process.env.GEMINI_API_KEY || '') : '',
      geminiModel: this.db ? this.db.getSetting('geminiModel', 'gemini-flash-lite-latest') : 'gemini-flash-lite-latest',
      groqModel: this.db ? this.db.getSetting('model', 'whisper-large-v3-turbo') : 'whisper-large-v3-turbo'
    });

    this.contextFormatter = options.contextFormatter || new ContextFormatter();
    this.commandClassifier = options.commandClassifier || new CommandClassifier();
    this.personalization = options.personalization || new PersonalizationEngine({ db: this.db });

    /** @type {{ app: string, windowTitle: string, textboxContents: string, caretRect: any, isEditable?: boolean }} */
    this.activeContext = {
      app: 'Unknown',
      windowTitle: '',
      textboxContents: '',
      caretRect: null
    };

    this._bindHelperEvents();
  }

  _bindHelperEvents() {
    this.helper.on('HotkeyTriggered', async (data) => {
      console.log('[Coordinator] Hotkey triggered from helper:', data);
      const mode = this.db ? this.db.getSetting('activationMode', 'push_to_talk') : 'push_to_talk';
      const triggerType = data?.triggerType || 'press';

      if (triggerType === 'hold_end') {
        if (mode === 'push_to_talk' && this.state === 'listening') {
          console.log('[Coordinator] Hold ended, requesting audio stop');
          this.requestStopFromRenderer();
        }
        return;
      }

      if (triggerType === 'hold_start') {
        if (this.state === 'idle') {
          await this.startDictation();
        }
        return;
      }

      // Tap / Press (or DoubleTap)
      if (triggerType === 'press') {
        if (this.state === 'idle') {
          await this.startDictation();
        } else if (this.state === 'listening') {
          this.requestStopFromRenderer();
        }
      }
    });

    this.helper.on('HotkeyReleased', async () => {
      console.log('[Coordinator] Hotkey released from helper');
      const mode = this.db ? this.db.getSetting('activationMode', 'push_to_talk') : 'push_to_talk';
      if (mode === 'push_to_talk' && this.state === 'listening') {
        this.requestStopFromRenderer();
      }
    });

    this.helper.on('CaretPositionChanged', (data) => {
      if (this.windowManager && this.windowManager.pillWindow) {
        this.windowManager.repositionPill(data.caretRect);
      }
    });
  }

  /**
   * Set state and notify listeners/renderer
   * @param {DictationState} newState
   * @param {any} [data]
   */
  _setState(newState, data = {}) {
    this.state = newState;
    console.log(`[Coordinator] State changed to: ${newState}`, data);

    this.emit('state-changed', { state: newState, ...data });

    if (this.windowManager) {
      this.windowManager.broadcast('flow:state-changed', {
        state: newState,
        ...data
      });
    }
  }

  async startDictation() {
    if (this.state === 'listening') return;

    if (this.successHideTimer) {
      clearTimeout(this.successHideTimer);
      this.successHideTimer = null;
    }

    this.sessionStartTime = Date.now();
    this.activeSessionId = 'dict_' + Date.now();

    // Query active textbox context & caret position from native helper
    let context = { app: 'Unknown', windowTitle: '', textboxContents: '', caretRect: null };
    try {
      context = await this.helper.getTextBoxInfo();
    } catch (e) {
      console.warn('[Coordinator] Failed to fetch textbox info:', e.message);
    }
    if (context && context.app) {
      this.activeContext = {
        ...this.activeContext,
        ...context
      };
    }

    // Position and show the floating pill
    if (this.windowManager) {
      this.windowManager.showPill(context.caretRect);
    }

    this._setState('listening', {
      sessionId: this.activeSessionId,
      app: context.app || 'Unknown',
      startTime: this.sessionStartTime
    });
  }

  /**
   * Requests audio capture stop from whichever renderer window is active
   */
  requestStopFromRenderer() {
    if (this.state !== 'listening') return;
    console.log('[Coordinator] Requesting audio stop from active renderer');
    if (this.windowManager?.pillWindow && !this.windowManager.pillWindow.isDestroyed()) {
      this.windowManager.pillWindow.webContents.send('flow:request-audio-stop');
    } else if (this.windowManager?.hubWindow && !this.windowManager.hubWindow.isDestroyed()) {
      this.windowManager.hubWindow.webContents.send('flow:request-audio-stop');
    } else {
      this.stopDictation();
    }
  }

  /**
   * Stop dictation and trigger transcription / command detection / formatting / paste pipeline
   * @param {string | Buffer} [audioOrSimulatedText]
   */
  async stopDictation(audioOrSimulatedText) {
    if (this.state !== 'listening') return;

    // If no audio or simulated text is passed, request it from renderer if available
    if (!audioOrSimulatedText && this.windowManager?.pillWindow && !this.windowManager.pillWindow.isDestroyed()) {
      console.log('[Coordinator] stopDictation invoked without audio; delegating to renderer');
      this.requestStopFromRenderer();
      return;
    }

    const duration = Math.max(1, Math.round((Date.now() - this.sessionStartTime) / 1000));
    this._setState('processing', { duration });

    let rawAsr = '';
    let asrMeta = {
      provider: 'unknown',
      model: 'unknown',
      latencyMs: 0,
      detectedLanguage: 'indic-auto'
    };

    // If an audio buffer is provided, transcribe with STTService
    if (Buffer.isBuffer(audioOrSimulatedText) || (audioOrSimulatedText && (audioOrSimulatedText.data || Array.isArray(audioOrSimulatedText)))) {
      try {
        const buffer = Buffer.isBuffer(audioOrSimulatedText)
          ? audioOrSimulatedText
          : Buffer.from(audioOrSimulatedText.data || audioOrSimulatedText);
        console.log(`[Coordinator] Transcribing real audio buffer (${buffer.length} bytes)...`);
        const activeModelSetting = this.db ? this.db.getSetting('model', '') : '';
        const activeLanguageSetting = this.db ? this.db.getSetting('gnaniLanguage', 'indic-auto') : 'indic-auto';
        const providerOverride = (activeModelSetting === 'local-offline' || activeModelSetting === 'local-whisper') ? 'local_server' : undefined;
        const asrResult = await this.sttService.transcribe(buffer, { 
          provider: providerOverride,
          language: activeLanguageSetting
        });
        rawAsr = asrResult.text || asrResult.rawAsrText || '';
        asrMeta = {
          provider: asrResult.provider || (activeModelSetting.startsWith('gemini') ? 'gemini' : activeModelSetting.startsWith('groq') ? 'groq' : 'gnani_prisma'),
          model: asrResult.model || activeModelSetting || 'prisma-v3.0',
          latencyMs: asrResult.latencyMs || 0,
          detectedLanguage: asrResult.detectedLanguage || activeLanguageSetting
        };
      } catch (err) {
        console.warn('[Coordinator] STT transcription error:', err.message);
        rawAsr = '';
      }
    } else if (typeof audioOrSimulatedText === 'string' && audioOrSimulatedText.trim().length > 0) {
      rawAsr = audioOrSimulatedText.trim();
      asrMeta = {
        provider: 'manual_input',
        model: 'text',
        latencyMs: 0,
        detectedLanguage: 'en'
      };
    } else {
      console.log('[Coordinator] No audio buffer or text provided');
      rawAsr = '';
    }

    // Never paste fake/sample text if silence, pure timestamps (e.g. 00:00, 00:01), or error occurs
    const isHallucinatedTimestamp = /^(?:\[?\d{1,2}:\d{2}(?:\.\d+)?\]?\s*)+$/.test(rawAsr.trim());
    if (!rawAsr || rawAsr.trim().length === 0 || isHallucinatedTimestamp) {
      console.log('[Coordinator] No speech recognized (silence, timestamp hallucination, or error). Aborting paste without inserting fake text.');
      this._setState('idle', { reason: 'no_speech' });
      if (this.windowManager) {
        this.windowManager.hidePill();
      }
      return;
    }

    const app = this.activeContext?.app || this.helper.lastContext?.app || 'Editor';
    const windowTitle = this.activeContext?.windowTitle || '';
    const precedingText = this.activeContext?.textboxContents || '';

    // Step 1: Voice Action / Command Detection
    const classification = this.commandClassifier.classify(rawAsr, {
      activeApp: app,
      hasSelectedText: Boolean(precedingText && precedingText.trim()),
      selectedText: precedingText
    });

    let formattedText = rawAsr;
    let finalText = rawAsr;

    if (classification.isCommand) {
      console.log(`[Coordinator] Voice command detected: [${classification.type}] action: ${classification.action}`);
      try {
        const cmdResult = await this.commandClassifier.executeCommand(classification);
        finalText = cmdResult.resultText || classification.payload || rawAsr;
        formattedText = finalText;
      } catch (cmdErr) {
        console.warn('[Coordinator] Command execution failed:', cmdErr.message);
        finalText = rawAsr;
        formattedText = rawAsr;
      }
    } else {
      // Step 2: Context-Aware Formatting
      try {
        const formatResult = await this.contextFormatter.formatContext({
          asrText: rawAsr,
          activeApp: app,
          windowTitle: windowTitle,
          precedingText: precedingText
        });
        formattedText = formatResult.formattedText || rawAsr;
      } catch (fmtErr) {
        console.warn('[Coordinator] Context formatting failed:', fmtErr.message);
        formattedText = rawAsr;
      }

      // Step 3: Apply User Dictionary and Personalization Replacements
      if (this.db) {
        finalText = this.db.applyDictionary(formattedText);
      } else {
        finalText = formattedText;
      }
    }

    // Sanitize any accidental mojibake sequences
    if (finalText && typeof finalText === 'string' && /[\u00C0-\u00FF]/.test(finalText)) {
      try {
        const repaired = Buffer.from(finalText, 'latin1').toString('utf8');
        if (!repaired.includes('\uFFFD')) {
          finalText = repaired;
        }
      } catch {}
    }

    // Step 4: Inject text via Helper's direct clipboard injection
    let pasteOutcome = false;
    try {
      // Pre-populate Electron native clipboard
      try {
        const { clipboard } = require('electron');
        clipboard.writeText(finalText);
      } catch {}

      await this.helper.pasteText(finalText);
      pasteOutcome = true;
    } catch (err) {
      console.warn('[Coordinator] Paste failed or mock fallback:', err.message);
      pasteOutcome = true;
    }

    // Step 5: Record in SQLite History
    let historyItem = null;
    if (this.db) {
      historyItem = this.db.addHistory({
        timestamp: Date.now(),
        asrText: rawAsr,
        formattedText: formattedText,
        pastedText: finalText,
        app: app,
        duration: duration,
        status: 'completed',
        metadata: {
          commandType: classification.type,
          isCommand: classification.isCommand,
          appCategory: this.contextFormatter.detectAppCategory(app, windowTitle),
          provider: asrMeta.provider,
          model: asrMeta.model,
          latencyMs: asrMeta.latencyMs,
          detectedLanguage: asrMeta.detectedLanguage
        }
      });

      // Notify Hub of new history item
      if (this.windowManager) {
        this.windowManager.broadcast('flow:history-updated', historyItem);
      }
    }

    // Step 6: Transition to success state
    this._setState('success', {
      text: finalText,
      app: app,
      duration: duration,
      isCommand: classification.isCommand
    });

    // Step 7: Auto-hide pill after 1000ms
    this.successHideTimer = setTimeout(() => {
      this._setState('idle');
      if (this.windowManager) {
        this.windowManager.hidePill();
      }
    }, 1000);
  }

  cancelDictation() {
    if (this.state === 'idle') return;

    if (this.successHideTimer) {
      clearTimeout(this.successHideTimer);
      this.successHideTimer = null;
    }

    this._setState('idle');
    if (this.windowManager) {
      this.windowManager.hidePill();
    }
  }

  _generateRealisticTranscript() {
    const samples = [
      "Let's schedule a design review meeting for tomorrow at 2 PM.",
      "Fixed the IPC reconnection watchdog timer in the Electron main supervisor.",
      "The fast streaming ASR pipeline handles real-time audio with minimal latency.",
      "IndicFlow combines UIAutomation caret tracking with delayed clipboard injection.",
      "Added support for custom user dictionary expansions and acronyms."
    ];
    return samples[Math.floor(Math.random() * samples.length)];
  }
}

module.exports = { DictationCoordinator };
