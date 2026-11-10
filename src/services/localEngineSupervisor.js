// @ts-check
'use strict';

const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Local Engine Supervisor (On-Device STT Daemon)
 * Keeps a local inference server running in the background with the model permanently loaded in RAM.
 * Drops transcription latency down to ~120ms when running offline!
 */
class LocalEngineSupervisor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.port=8089]
   * @param {number} [options.threads=4]
   */
  constructor(options = {}) {
    super();
    this.port = options.port || 8089;
    this.threads = options.threads || 4;
    this.engineDir = path.resolve(__dirname, '../../native/local-engine');
    this.serverExe = path.join(this.engineDir, 'whisper-server.exe');
    this.modelPath = this.resolveBestModelPath();

    /** @type {import('node:child_process').ChildProcess | null} */
    this.process = null;
    this.isReady = false;
    this.isShuttingDown = false;
  }

  /**
   * Resolves the best available local model on disk.
   * @returns {string}
   */
  resolveBestModelPath() {
    const explicitModel = process.env.FLOW_LOCAL_MODEL;
    if (explicitModel && fs.existsSync(path.join(this.engineDir, explicitModel))) {
      return path.join(this.engineDir, explicitModel);
    }

    const candidates = [
      'ggml-small.en.bin',
      'ggml-base.en.bin',
      'ggml-base.bin'
    ];
    for (const c of candidates) {
      const full = path.join(this.engineDir, c);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    return path.join(this.engineDir, 'ggml-base.en.bin');
  }

  isInstalled() {
    const currentBest = this.resolveBestModelPath();
    return fs.existsSync(this.serverExe) && fs.existsSync(currentBest);
  }

  start() {
    if (!this.isInstalled()) {
      console.log('[LocalEngine] Binary or model not found on disk. Skipping daemon start.');
      return;
    }

    if (this.process) return;

    this.isShuttingDown = false;
    this.modelPath = this.resolveBestModelPath();
    console.log(`[LocalEngine] Spawning persistent background daemon on port ${this.port} with model: ${path.basename(this.modelPath)}...`);

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
        cwd: this.engineDir,
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
        console.warn('[LocalEngine] Process error:', err.message);
        this.isReady = false;
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[LocalEngine] Daemon exited (code=${code}, signal=${signal})`);
        this.process = null;
        this.isReady = false;
        if (!this.isShuttingDown) {
          setTimeout(() => this.start(), 3000);
        }
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.isReady = true;
          this.emit('ready', { port: this.port });
        }
      }, 1000);
    } catch (err) {
      console.warn('[LocalEngine] Failed to spawn server:', err.message);
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

module.exports = { LocalEngineSupervisor };
