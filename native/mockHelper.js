// @ts-check
'use strict';

/**
 * Mock FlowHelper daemon implementing the JSON-lines stdio IPC protocol.
 * Used during automated tests and desktop client development when native C# AOT FlowHelper.exe is not yet built.
 */

const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let simulatedCaret = { x: 600, y: 450, width: 2, height: 20 };
let currentApp = 'Code.exe';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed);
    const { id, method, payload } = req;

    switch (method) {
      case 'Ping':
        send({ id, success: true, result: { pong: true, timestamp: Date.now() } });
        break;

      case 'GetTextBoxInfo':
        send({
          id,
          success: true,
          result: {
            app: currentApp,
            windowTitle: 'Wispr Flow Dev — Visual Studio Code',
            url: null,
            textboxContents: 'Writing code with AI voice-typing... ',
            caretRect: simulatedCaret,
            isEditable: true
          }
        });
        break;

      case 'PasteText':
        send({
          id,
          success: true,
          result: {
            pasted: true,
            bytesInjected: (payload?.text || '').length,
            targetApp: currentApp
          }
        });
        // Emit paste outcome event
        send({
          event: 'PasteOutcome',
          payload: { success: true, length: (payload?.text || '').length }
        });
        break;

      case 'SetSimulatedContext':
        if (payload?.app) currentApp = payload.app;
        if (payload?.caretRect) simulatedCaret = payload.caretRect;
        send({ id, success: true, result: { updated: true } });
        break;

      case 'TriggerHotkey':
        // Test simulation helper trigger
        send({
          event: 'HotkeyTriggered',
          payload: { shortcut: payload?.shortcut || 'FnDoubleTap', timestamp: Date.now() }
        });
        send({ id, success: true, result: { triggered: true } });
        break;

      default:
        send({ id, success: true, result: { acknowledged: true, method } });
        break;
    }
  } catch (err) {
    send({ success: false, error: err.message });
  }
});

// Periodic simulated caret update (optional heartbeat)
setInterval(() => {
  send({
    event: 'CaretPositionChanged',
    payload: { caretRect: simulatedCaret, app: currentApp }
  });
}, 15000);

process.stderr.write('[MockHelper] Started mock helper successfully (PID: ' + process.pid + ')\n');
