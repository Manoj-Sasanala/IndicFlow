// @ts-check
'use strict';

const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

class HelperSupervisor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.helperPath]
   * @param {number} [options.pingIntervalMs]
   * @param {number} [options.requestTimeoutMs]
   */
  constructor(options = {}) {
    super();
    this.helperPath = options.helperPath || path.resolve(__dirname, '../../native/FlowHelper.exe');
    this.pingIntervalMs = options.pingIntervalMs || 4000;
    this.requestTimeoutMs = options.requestTimeoutMs || 5000;

    /** @type {import('node:child_process').ChildProcess | null} */
    this.process = null;
    this.readlineInterface = null;
    this.isShuttingDown = false;
    this.reconnectAttempts = 0;
    this.reconnectBackoff = [1000, 2000, 4000, 8000, 16000];
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isReady = false;
    this.processStartedAt = null;

    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pendingRequests = new Map();
    this.requestCounter = 0;

    // Last known target context
    this.lastContext = {
      app: 'Unknown',
      windowTitle: '',
      textboxContents: '',
      caretRect: null
    };
  }

  start() {
    this.isShuttingDown = false;
    this._spawnHelper();
  }

  stop() {
    this.isShuttingDown = true;
    this._clearTimers();
    this._rejectAllPending('Helper supervisor stopped');

    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch (err) {
        console.warn('[HelperSupervisor] Error killing helper process:', err);
      }
      this.process = null;
    }
    this.isReady = false;
    this.emit('status', { status: 'stopped', ready: false });
  }

  _clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _spawnHelper() {
    this._clearTimers();

    // Check if binary or script exists
    let targetExecutable = this.helperPath;
    let spawnArgs = [];

    if (targetExecutable.endsWith('.js')) {
      spawnArgs = [targetExecutable];
      targetExecutable = process.execPath;
    } else if (!fs.existsSync(targetExecutable)) {
      // Check for mock helper in native directory
      const mockHelperPath = path.resolve(__dirname, '../../native/mockHelper.js');
      if (fs.existsSync(mockHelperPath)) {
        console.warn(`[HelperSupervisor] FlowHelper.exe not found at ${targetExecutable}. Spawning mock helper at ${mockHelperPath}`);
        targetExecutable = process.execPath; // node.exe
        spawnArgs = [mockHelperPath];
      } else {
        console.warn(`[HelperSupervisor] FlowHelper.exe not found at ${targetExecutable}. Will retry in 5s.`);
        this._scheduleReconnect();
        return;
      }
    }

    console.log(`[HelperSupervisor] Spawning helper: ${targetExecutable}`, spawnArgs);
    this.processStartedAt = Date.now();

    try {
      this.process = spawn(targetExecutable, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          FLOW_IPC_VERSION: '1.0',
          FLOW_PARENT_PID: String(process.pid)
        }
      });
    } catch (err) {
      console.error('[HelperSupervisor] Failed to spawn helper process:', err);
      this._scheduleReconnect();
      return;
    }

    if (!this.process || !this.process.stdout || !this.process.stdin) {
      console.error('[HelperSupervisor] Helper process spawned without standard streams');
      this._scheduleReconnect();
      return;
    }

    this.readlineInterface = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    this.readlineInterface.on('line', (line) => {
      this._handleLine(line);
    });

    this.process.stderr?.on('data', (data) => {
      console.warn(`[Helper stderr]: ${data.toString('utf8').trim()}`);
    });

    this.process.on('error', (err) => {
      console.error('[HelperSupervisor] Helper process error:', err);
    });

    this.process.on('close', (code, signal) => {
      console.warn(`[HelperSupervisor] Helper process exited (code=${code}, signal=${signal})`);
      this.isReady = false;
      this.process = null;
      this.readlineInterface = null;
      this._rejectAllPending(`Helper process closed with code ${code}`);
      this.emit('status', { status: 'disconnected', exitCode: code, signal });

      if (!this.isShuttingDown) {
        this._scheduleReconnect();
      }
    });

    // Mark ready on spawn and start ping loop
    this.isReady = true;
    this.emit('status', { status: 'connected', ready: true, pid: this.process.pid });
    this._startKeepalive();
  }

  _scheduleReconnect() {
    if (this.isShuttingDown) return;

    // Reset attempts if it ran successfully for more than 60 seconds
    if (this.processStartedAt && Date.now() - this.processStartedAt > 60000) {
      this.reconnectAttempts = 0;
    }

    const delayIndex = Math.min(this.reconnectAttempts, this.reconnectBackoff.length - 1);
    const delay = this.reconnectBackoff[delayIndex];
    this.reconnectAttempts++;

    console.log(`[HelperSupervisor] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms...`);
    this.emit('status', { status: 'reconnecting', attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this._spawnHelper();
    }, delay);
  }

  _startKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(async () => {
      if (!this.isReady || !this.process) return;

      try {
        await this.sendRequest('Ping', {}, 3000);
      } catch (err) {
        console.warn('[HelperSupervisor] Keepalive ping timed out or failed:', err.message);
      }
    }, this.pingIntervalMs);
  }

  /**
   * @param {string} line
   */
  _handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      console.warn('[HelperSupervisor] Received non-JSON output from helper:', trimmed);
      return;
    }

    // 1. Is this a response to a pending request?
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.success === false || msg.error) {
        pending.reject(new Error(msg.error || 'Helper request returned error'));
      } else {
        pending.resolve(msg.result !== undefined ? msg.result : msg.payload);
      }
      return;
    }

    // 2. Is this an event notification from helper?
    if (msg.event) {
      this._handleEvent(msg.event, msg.payload || msg);
      return;
    }

    // 3. Fallback broadcast
    this.emit('message', msg);
  }

  _handleEvent(eventName, payload) {
    // Keep local cache up to date
    if (eventName === 'FocusChanged' || eventName === 'CaretPositionChanged') {
      if (payload.app) this.lastContext.app = payload.app;
      if (payload.windowTitle) this.lastContext.windowTitle = payload.windowTitle;
      if (payload.textboxContents !== undefined) this.lastContext.textboxContents = payload.textboxContents;
      if (payload.caretRect) this.lastContext.caretRect = payload.caretRect;
    }

    this.emit(eventName, payload);
    this.emit('event', { event: eventName, payload });
  }

  /**
   * Send a JSON-RPC request to the helper process over stdin.
   * @param {string} method
   * @param {object} [payload]
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  sendRequest(method, payload = {}, timeoutMs) {
    if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
      return Promise.reject(new Error('Helper process stdin is not writable'));
    }

    const id = `req_${++this.requestCounter}_${Date.now()}`;
    const timeout = timeoutMs || this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Helper request '${method}' (${id}) timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const envelope = JSON.stringify({ id, method, payload }) + '\n';
      try {
        this.process.stdin.write(envelope, 'utf8', (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  _rejectAllPending(reason) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // --- High-level helper actions ---

  async getTextBoxInfo() {
    try {
      const result = await this.sendRequest('GetTextBoxInfo');
      if (result) {
        Object.assign(this.lastContext, result);
      }
      return result;
    } catch (err) {
      return this.lastContext;
    }
  }

  async pasteText(text) {
    return this.sendRequest('PasteText', { text, method: 'delayed_clipboard' });
  }
}

module.exports = { HelperSupervisor };
