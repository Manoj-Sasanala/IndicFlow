// @ts-check
import { FlowDatabase } from './src/db/database.js';
import { HelperSupervisor } from './src/services/helperSupervisor.js';
import { DictationCoordinator } from './src/services/dictationCoordinator.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('========================================================');
console.log('   WISPR FLOW DESKTOP CLIENT SUITE - VERIFICATION TEST   ');
console.log('========================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  }
}

async function runTests() {
  // -----------------------------------------------------------
  // 1. File Structure & Syntax Check
  // -----------------------------------------------------------
  console.log('--- Step 1: File Structure & Syntax Checks ---');
  const requiredFiles = [
    'package.json',
    'src/main/index.js',
    'src/main/preload.js',
    'src/main/windowManager.js',
    'src/db/database.js',
    'src/services/helperSupervisor.js',
    'src/services/dictationCoordinator.js',
    'src/renderer/pill/index.html',
    'src/renderer/pill/pill.css',
    'src/renderer/pill/pill.js',
    'src/renderer/hub/index.html',
    'src/renderer/hub/hub.css',
    'src/renderer/hub/hub.js',
    'native/mockHelper.js'
  ];

  for (const relPath of requiredFiles) {
    const fullPath = path.join(__dirname, relPath);
    assert(fs.existsSync(fullPath), `File exists: ${relPath}`);
  }

  // Syntax check JS files using node --check
  const jsFiles = [
    'src/main/index.js',
    'src/main/preload.js',
    'src/main/windowManager.js',
    'src/db/database.js',
    'src/services/helperSupervisor.js',
    'src/services/dictationCoordinator.js',
    'src/renderer/pill/pill.js',
    'src/renderer/hub/hub.js',
    'native/mockHelper.js'
  ];

  for (const jsFile of jsFiles) {
    const fullPath = path.join(__dirname, jsFile);
    try {
      execSync(`node --check "${fullPath}"`);
      assert(true, `Syntax check clean: ${jsFile}`);
    } catch (e) {
      assert(false, `Syntax check error in ${jsFile}: ${e.message}`);
    }
  }

  // -----------------------------------------------------------
  // 2. Database & WAL Mode Verification
  // -----------------------------------------------------------
  console.log('\n--- Step 2: SQLite (node:sqlite) Database Operations ---');
  const testDbPath = path.join(__dirname, 'test_flow.sqlite');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new FlowDatabase(testDbPath);
  try {
    // Check WAL mode
    const walStmt = db.db.prepare('PRAGMA journal_mode;');
    const walRow = walStmt.get();
    assert(walRow && walRow.journal_mode === 'wal', `SQLite WAL mode enabled: ${walRow.journal_mode}`);

    // Verify default settings
    const hotkey = db.getSetting('hotkey');
    assert(hotkey === 'Double-Fn / CapsLock', `Default hotkey loaded: ${hotkey}`);

    const model = db.getSetting('model');
    assert(model === 'prisma-v3.0' || model === 'local-whisper' || model === 'whisper-large-v3-turbo', `Default model loaded: ${model}`);

    // Test Settings update
    db.setSetting('theme', 'dark');
    assert(db.getSetting('theme') === 'dark', 'Settings update succeeded');

    // Test Dictionary operations
    const dictEntry = db.addDictionaryWord('wip', 'work in progress');
    assert(dictEntry && dictEntry.phrase === 'wip', 'Dictionary word added');

    const dictList = db.getDictionary();
    assert(dictList.some(d => d.phrase === 'wip' && d.replacement === 'work in progress'), 'Dictionary word retrieved');

    // Test Dictionary string application
    const expanded = db.applyDictionary('This feature is currently wip.');
    assert(expanded === 'This feature is currently work in progress.', `Dictionary replacement applied: "${expanded}"`);

    // Verify frequency incremented
    const updatedDict = db.getDictionary().find(d => d.phrase === 'wip');
    assert(updatedDict && updatedDict.frequencyUsed >= 1, `Dictionary usage frequency tracked: ${updatedDict?.frequencyUsed}`);

    // Test History operations
    const historyItem = db.addHistory({
      asrText: 'launch the server on port 3000',
      formattedText: 'Launch the server on port 3000.',
      pastedText: 'Launch the server on port 3000.',
      app: 'Terminal',
      duration: 3,
      status: 'completed'
    });
    assert(historyItem && historyItem.id, `History item created with ID: ${historyItem.id}`);

    const retrievedHistory = db.getHistory(10, 0, 'port 3000');
    assert(retrievedHistory.length === 1 && retrievedHistory[0].app === 'Terminal', 'History search by text query verified');

    // Test Notes operations
    const newNote = db.saveNote('Architecture Meeting', '# Summary\nReviewing Electron main architecture.');
    assert(newNote && newNote.id, `Note created with ID: ${newNote.id}`);

    const allNotes = db.getNotes();
    assert(allNotes.some(n => n.id === newNote.id && n.title === 'Architecture Meeting'), 'Note retrieved successfully');

    db.deleteNote(newNote.id);
    assert(!db.getNote(newNote.id), 'Note deleted successfully');
  } finally {
    db.close();
    // Clean up temporary database files
    for (const f of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
    }
  }

  // -----------------------------------------------------------
  // 3. Helper Supervisor & IPC Protocol Verification
  // -----------------------------------------------------------
  console.log('\n--- Step 3: Helper Supervisor & JSON-Lines IPC Protocol ---');
  const mockHelperPath = path.join(__dirname, 'native/mockHelper.js');
  const supervisor = new HelperSupervisor({
    helperPath: mockHelperPath,
    pingIntervalMs: 2000,
    requestTimeoutMs: 3000
  });

  try {
    supervisor.start();

    // Wait for helper process to spawn
    await new Promise(r => setTimeout(r, 600));
    assert(supervisor.isReady, 'Helper process spawned and marked ready');
    assert(supervisor.process && supervisor.process.pid > 0, `Helper running with PID: ${supervisor.process?.pid}`);

    // Test Ping RPC
    const pingRes = await supervisor.sendRequest('Ping');
    assert(pingRes && pingRes.pong === true, 'Ping RPC request / response succeeded');

    // Test GetTextBoxInfo RPC
    const textBoxInfo = await supervisor.getTextBoxInfo();
    assert(textBoxInfo && textBoxInfo.app === 'Code.exe', `GetTextBoxInfo RPC returned app: ${textBoxInfo?.app}`);
    assert(textBoxInfo.caretRect && textBoxInfo.caretRect.x === 600, 'GetTextBoxInfo returned valid caretRect');

    // Test PasteText RPC
    const pasteRes = await supervisor.pasteText('Hello from Wispr Flow!');
    assert(pasteRes && pasteRes.pasted === true, 'PasteText RPC request / response succeeded');

    // Test Helper Event Emission
    const eventPromise = new Promise((resolve) => {
      supervisor.once('HotkeyTriggered', (data) => resolve(data));
    });
    await supervisor.sendRequest('TriggerHotkey', { shortcut: 'FnDoubleTap' });
    const eventData = await eventPromise;
    assert(eventData && eventData.shortcut === 'FnDoubleTap', `Helper event HotkeyTriggered received: ${eventData?.shortcut}`);
  } finally {
    supervisor.stop();
  }

  // -----------------------------------------------------------
  // 4. Dictation Coordinator State Machine Verification
  // -----------------------------------------------------------
  console.log('\n--- Step 4: Dictation Coordinator State Machine ---');
  const testDb2 = new FlowDatabase(':memory:');
  const mockSupervisor = new HelperSupervisor({
    helperPath: mockHelperPath,
    pingIntervalMs: 5000
  });
  mockSupervisor.start();
  await new Promise(r => setTimeout(r, 400));

  const coordinator = new DictationCoordinator({
    db: testDb2,
    helper: mockSupervisor,
    windowManager: null
  });

  try {
    assert(coordinator.state === 'idle', 'Coordinator initial state is idle');

    await coordinator.startDictation();
    assert(coordinator.state === 'listening', 'Coordinator transitioned to listening state');

    // Stop dictation with test text
    await coordinator.stopDictation('Testing the speech pipeline');
    assert(coordinator.state === 'success', 'Coordinator transitioned to success state');

    // Verify history was saved to SQLite
    const history = testDb2.getHistory(5);
    assert(history.length === 1, 'Dictation history was persisted to SQLite');
    assert(history[0].formattedText.includes('Testing the speech pipeline'), 'Recorded text matches transcript');

    // Wait for auto-hide timer (1000ms)
    await new Promise(r => setTimeout(r, 1100));
    assert(coordinator.state === 'idle', 'Coordinator auto-returned to idle after 1000ms');
  } finally {
    mockSupervisor.stop();
    testDb2.close();
  }

  // -----------------------------------------------------------
  // 5. Electron Binary & Application Boot Verification
  // -----------------------------------------------------------
  console.log('\n--- Step 5: Electron Executable & Application Boot Verification ---');
  const electronExe = path.join(__dirname, 'node_modules/electron/dist/electron.exe');
  assert(fs.existsSync(electronExe), `Electron binary exists at ${electronExe}`);

  // Clean environment without ELECTRON_RUN_AS_NODE so Electron runs as GUI app
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  cleanEnv.FLOW_TEST_LAUNCH = '1';
  cleanEnv.ELECTRON_ENABLE_LOGGING = '1';

  const electronVer = execSync(`"${electronExe}" -v`, { env: cleanEnv }).toString().trim();
  assert(electronVer.startsWith('v'), `Electron executable responds with version: ${electronVer}`);

  // Test full application boot in test mode
  console.log('Testing full Electron application boot...');
  const testUserData = path.join(__dirname, 'test_user_data');
  try {
    const launchOutput = execSync(`"${electronExe}" . --user-data-dir="${testUserData}"`, {
      cwd: __dirname,
      timeout: 10000,
      env: cleanEnv
    }).toString();
    assert(launchOutput.includes('Desktop application shell initialized successfully'), 'Electron app boot verified: initialization succeeded');
    assert(launchOutput.includes('Local SQLite initialized at'), 'Electron app boot verified: SQLite initialized');
  } catch (err) {
    const out = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    if (out.includes('Desktop application shell initialized successfully')) {
      assert(true, 'Electron app boot verified: initialization succeeded');
    } else {
      throw err;
    }
  }

  console.log('\n========================================================');
  console.log(`   ALL TESTS PASSED: ${testsPassed} passed, ${testsFailed} failed   `);
  console.log('========================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
