// @ts-check
'use strict';

const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Local Whisper Daemon Supervisor
 * Keeps whisper-server.exe running in the background with the model permanently loaded in RAM.
 * Drops transcription latency from ~1,800ms down to ~120ms!
 */
class LocalWhisperSupervisor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.port=8089]
   * @param {number} [options.threads=4]
   */
  constructor(options = {}) {
    super();
    this.port = options.port || 8089;
    this.threads = options.threads || 4; // Optimal 4 threads for Intel P-cores
    this.whisperDir = path.resolve(__dirname, '../../native/whisper');
    this.serverExe = path.join(this.whisperDir, 'whisper-server.exe');
    this.modelPath = this.resolveBestModelPath();

    /** @type {import('node:child_process').ChildProcess | null} */
    this.process = null;
    this.isReady = false;
    this.isShuttingDown = false;
  }

  /**
   * Resolves the best available model on disk.
   * On Intel CPU/Iris Xe, ggml-base.en (~120ms) and ggml-small.en (~350ms) provide instant real-time dictation.
   * ggml-large-v3-turbo (809M params) requires discrete GPU; on CPU it takes ~25s.
   * @returns {string}
   */
  resolveBestModelPath() {
    // Explicit override via environment variable or options
    const explicitModel = process.env.FLOW_WHISPER_MODEL;
    if (explicitModel && fs.existsSync(path.join(this.whisperDir, explicitModel))) {
      return path.join(this.whisperDir, explicitModel);
    }

    // High-accuracy real-time balance: small.en (~450ms, 244M params) -> base.en (~120ms fallback)
    const candidates = [
      'ggml-small.en.bin',
      'ggml-base.en.bin',
      'ggml-base.bin'
    ];
    for (const c of candidates) {
      const full = path.join(this.whisperDir, c);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    return path.join(this.whisperDir, 'ggml-base.en.bin');
  }

  isInstalled() {
    const currentBest = this.resolveBestModelPath();
    return fs.existsSync(this.serverExe) && fs.existsSync(currentBest);
  }

  start() {
    if (!this.isInstalled()) {
      console.log('[LocalWhisper] Binary or model not found on disk. Skipping daemon start.');
      return;
    }

    if (this.process) return;

    this.isShuttingDown = false;
    this.modelPath = this.resolveBestModelPath();
    console.log(`[LocalWhisper] Spawning persistent background daemon on port ${this.port} with model: ${path.basename(this.modelPath)}...`);

    const args = [
      '-m', this.modelPath,
      '--port', String(this.port),
      '-t', String(this.threads),
      '--inference-path', '/inference',
      '-ng',
      '-nf',
      '-bo', '1',
      '-nt'
    ];

    try {
      this.process = spawn(this.serverExe, args, {
        cwd: this.whisperDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.process.stdout?.on('data', (data) => {
        const str = data.toString();
        if (str.includes('Listening') || str.includes('HTTP server listening') || str.includes('inference')) {
          this.isReady = true;
          this.emit('ready', { port: this.port });
        }
      });

      this.process.stderr?.on('data', (data) => {
        const str = data.toString();
        if (str.includes('listening on') || str.includes('HTTP server')) {
          this.isReady = true;
          this.emit('ready', { port: this.port });
        }
      });

      this.process.on('error', (err) => {
        console.warn('[LocalWhisper] Process error:', err.message);
        this.isReady = false;
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[LocalWhisper] Daemon exited (code=${code}, signal=${signal})`);
        this.process = null;
        this.isReady = false;
        if (!this.isShuttingDown) {
          // Restart if unexpected exit
          setTimeout(() => this.start(), 3000);
        }
      });

      // Mark ready after 1 second if alive
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.isReady = true;
          this.emit('ready', { port: this.port });
        }
      }, 1000);
    } catch (err) {
      console.warn('[LocalWhisper] Failed to spawn whisper-server.exe:', err.message);
    }
  }

  stop() {
    this.isShuttingDown = true;
    this.isReady = false;
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {}
      this.process = null;
    }
  }
}

module.exports = { LocalWhisperSupervisor };

