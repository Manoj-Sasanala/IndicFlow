import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const helperExePath = path.join(__dirname, 'FlowHelper.exe');

console.log('='.repeat(72));
console.log('       INDICFLOW NATIVE HELPER AUTOMATED TEST SUITE');
console.log('       Target:', helperExePath);
console.log('='.repeat(72));

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('\n>>> Step 1: Spawning FlowHelper.exe process...');
  const child = spawn(helperExePath, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  child.stderr.on('data', (data) => {
    console.warn('  [Helper Stderr]:', data.toString().trim());
  });

  const pendingRequests = new Map();
  const eventHistory = [];
  const eventWaiters = [];

  function waitForEvent(predicate, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      // Check existing history
      const foundIdx = eventHistory.findIndex(predicate);
      if (foundIdx !== -1) {
        const item = eventHistory.splice(foundIdx, 1)[0];
        return resolve(item);
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
      }, timeoutMs);

      eventWaiters.push({
        predicate,
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        }
      });
    });
  }

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve } = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        resolve(msg);
      } else {
        // Check if any waiter matches
        const waiterIdx = eventWaiters.findIndex((w) => w.predicate(msg));
        if (waiterIdx !== -1) {
          const waiter = eventWaiters.splice(waiterIdx, 1)[0];
          waiter.resolve(msg);
        } else {
          eventHistory.push(msg);
        }
      }
    } catch (err) {
      console.error('  Failed to parse helper JSON line:', line, err);
    }
  });

  function sendCommand(method, payload = {}) {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Command ${method} (id=${id}) timed out after 5000ms`));
      }, 5000);

      pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject
      });

      const reqObj = { id, method, ...payload };
      child.stdin.write(JSON.stringify(reqObj) + '\n');
    });
  }

  // 1. Initial Handshake & Ready Event
  console.log('\n>>> Step 2: Verifying Initial Handshake & Ready Event...');
  const readyEvt = await waitForEvent((e) => e.event === 'ready', 3000);
  assert(readyEvt !== null && typeof readyEvt === 'object', 'Received initial "ready" event from FlowHelper.exe');
  assert(typeof readyEvt.pid === 'number' && readyEvt.pid > 0, `Valid Process ID announced (${readyEvt.pid})`);
  assert(readyEvt.hotkey === 'Ctrl+Shift+Space', `Default hotkey is "Ctrl+Shift+Space"`);

  // 2. Ping Command
  console.log('\n>>> Step 3: Verifying Ping Command...');
  const pong = await sendCommand('Ping');
  assert(pong.success === true, 'Ping response success flag is true');
  assert(pong.event === 'pong', 'Ping response event is "pong"');
  assert(typeof pong.timestamp === 'string', `Ping timestamp is valid ISO string: ${pong.timestamp}`);

  // 3. UIAutomation GetTextBoxInfo
  console.log('\n>>> Step 4: Verifying UIAutomation GetTextBoxInfo Command...');
  const tbInfo = await sendCommand('GetTextBoxInfo');
  assert(tbInfo.success === true, 'GetTextBoxInfo returned success: true');
  assert(typeof tbInfo.app === 'string', `Active app reported: "${tbInfo.app}"`);
  assert(typeof tbInfo.title === 'string', `Active window title reported: "${tbInfo.title}"`);
  assert(typeof tbInfo.text === 'string', 'Active textbox text returned as string');
  assert(typeof tbInfo.textboxContents === 'string', 'Active textboxContents returned as string');
  assert(typeof tbInfo.isEditable === 'boolean', `isEditable reported as boolean: ${tbInfo.isEditable}`);
  assert(typeof tbInfo.caretRect === 'object' && tbInfo.caretRect !== null, 'caretRect returned as object');
  if (tbInfo.caretRect) {
    assert(typeof tbInfo.caretRect.x === 'number', `caretRect.x is number (${tbInfo.caretRect.x})`);
    assert(typeof tbInfo.caretRect.y === 'number', `caretRect.y is number (${tbInfo.caretRect.y})`);
    assert(typeof tbInfo.caretRect.width === 'number', `caretRect.width is number (${tbInfo.caretRect.width})`);
    assert(typeof tbInfo.caretRect.height === 'number', `caretRect.height is number (${tbInfo.caretRect.height})`);
  }

  // 4. SetHotkey Configuration
  console.log('\n>>> Step 5: Verifying SetHotkey Configuration Command...');
  const hotkeyRes1 = await sendCommand('SetHotkey', { hotkey: 'Alt+Space' });
  assert(hotkeyRes1.success === true, 'SetHotkey (Alt+Space) returned success: true');
  assert(hotkeyRes1.hotkey === 'Alt+Space', 'Confirmed hotkey updated to Alt+Space');

  const hotkeyRes2 = await sendCommand('SetHotkey', { hotkey: 'Ctrl+Shift+Space' });
  assert(hotkeyRes2.success === true, 'SetHotkey (Ctrl+Shift+Space) returned success: true');
  assert(hotkeyRes2.hotkey === 'Ctrl+Shift+Space', 'Confirmed hotkey restored to Ctrl+Shift+Space');

  // 5. Hotkey Events: Push-to-Talk (press vs hold) & Double-Tap
  console.log('\n>>> Step 6: Verifying Hotkey Event Emission (Press, Hold, Double-Tap)...');
  
  // 5a. Short press
  const pressPromise = waitForEvent((e) => e.event === 'HotkeyTriggered' && e.triggerType === 'press');
  await sendCommand('SimulateHotkeyTrigger', { triggerType: 'press' });
  const pressEvt = await pressPromise;
  assert(pressEvt.shortcut === 'Ctrl+Shift+Space', 'Hotkey press event includes configured shortcut');
  assert(pressEvt.triggerType === 'press', 'Hotkey press event has triggerType = "press"');

  // 5b. Push-to-talk hold start
  const holdStartPromise = waitForEvent((e) => e.event === 'HotkeyTriggered' && e.triggerType === 'hold_start');
  await sendCommand('SimulateHotkeyTrigger', { triggerType: 'hold_start' });
  const holdStartEvt = await holdStartPromise;
  assert(holdStartEvt.triggerType === 'hold_start', 'Push-to-talk event emitted triggerType = "hold_start"');

  // 5c. Push-to-talk hold end
  const holdEndPromise = waitForEvent((e) => e.event === 'HotkeyTriggered' && e.triggerType === 'hold_end');
  await sendCommand('SimulateHotkeyTrigger', { triggerType: 'hold_end' });
  const holdEndEvt = await holdEndPromise;
  assert(holdEndEvt.triggerType === 'hold_end', 'Push-to-talk release emitted triggerType = "hold_end"');

  // 5d. Double-tap toggle
  const doubleTapPromise = waitForEvent((e) => e.event === 'HotkeyTriggered' && e.isDoubleTap === true);
  await sendCommand('SimulateHotkeyTrigger', { triggerType: 'press', isDoubleTap: 'true' });
  const doubleTapEvt = await doubleTapPromise;
  assert(doubleTapEvt.isDoubleTap === true, 'Double-tap toggle event emitted isDoubleTap = true');

  // 6. FocusChanged Event Emission
  console.log('\n>>> Step 7: Verifying FocusChanged Event Emission...');
  const focusPromise = waitForEvent((e) => e.event === 'FocusChanged' && e.app === 'code.exe');
  await sendCommand('SimulateFocusChanged', { app: 'code.exe', title: 'FlowHelper.cs - Visual Studio Code' });
  const focusEvt = await focusPromise;
  assert(focusEvt.app === 'code.exe', 'FocusChanged event contains expected app executable name');
  assert(focusEvt.title === 'FlowHelper.cs - Visual Studio Code', 'FocusChanged event contains expected window title');

  // 7. Synthetic Paste Injection (Ctrl+V) & Delayed Clipboard Rendering
  console.log('\n>>> Step 8: Verifying PasteText Command (Delayed Rendering / SendInput)...');
  const pasteRes = await sendCommand('PasteText', { text: 'IndicFlow native paste verification test' });
  assert(pasteRes.success === true, 'PasteText returned success: true');
  assert(pasteRes.event === 'PasteOutcome', 'PasteText returned event: "PasteOutcome"');

  // 8. Clean Exit
  console.log('\n>>> Step 9: Verifying Clean Process Termination...');
  const exitPromise = new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  child.stdin.write(JSON.stringify({ method: 'Exit' }) + '\n');
  const exitCode = await Promise.race([
    exitPromise,
    new Promise((_, r) => setTimeout(() => r(new Error('Exit timed out')), 2500))
  ]).catch(() => {
    child.kill();
    return -1;
  });

  assert(exitCode === 0, `FlowHelper.exe exited cleanly with code ${exitCode}`);

  // Summary
  console.log('\n' + '='.repeat(72));
  console.log(`  ALL TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(72));

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL ERROR IN TEST SUITE]:', err);
  process.exit(1);
});
