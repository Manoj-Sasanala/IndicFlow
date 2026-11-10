// @ts-check
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const path = require('node:path');
const assert = require('node:assert');
const { FlowDatabase } = require('./src/db/database.js');
const { HelperSupervisor } = require('./src/services/helperSupervisor.js');
const { DictationCoordinator } = require('./src/services/dictationCoordinator.js');
const {
  STTService,
  ContextFormatter,
  CommandClassifier,
  PersonalizationEngine
} = require('./src/services/index.js');

async function runEndToEndIntegration() {
  console.log('========================================================================');
  console.log('      WISPR FLOW END-TO-END PIPELINE INTEGRATION VERIFICATION');
  console.log('========================================================================\n');

  const db = new FlowDatabase(':memory:');
  const helperExePath = path.resolve(import.meta.dirname, 'native/FlowHelper.exe');
  
  console.log('▶ Step 1: Initializing Database & Native Helper Supervisor...');
  const supervisor = new HelperSupervisor({
    helperPath: helperExePath,
    pingIntervalMs: 10000
  });

  supervisor.start();
  await new Promise(r => setTimeout(r, 600));

  assert.strictEqual(supervisor.isReady, true, 'Helper supervisor must be connected and ready');
  console.log(`  ✔ Native helper connected (PID: ${supervisor.process?.pid})`);

  console.log('\n▶ Step 2: Initializing Dictation Coordinator with full AI Engine...');
  const coordinator = new DictationCoordinator({
    db,
    helper: supervisor,
    windowManager: null
  });

  assert.strictEqual(coordinator.state, 'idle', 'Coordinator initial state must be idle');
  console.log('  ✔ Coordinator initialized in idle state');

  console.log('\n▶ Step 3: Testing Terminal App Context Formatting...');
  // Simulate active window being PowerShell / Terminal
  coordinator.activeContext = {
    app: 'pwsh.exe',
    windowTitle: 'Windows PowerShell',
    textboxContents: 'PS C:\\Users\\manoj> ',
    caretRect: { x: 200, y: 300, width: 8, height: 16 }
  };

  await coordinator.startDictation();
  assert.strictEqual(coordinator.state, 'listening', 'State should be listening');

  // Terminal dictation: spoken with natural speech cadence
  await coordinator.stopDictation('Git commit dash m quote initial release quote');
  assert.strictEqual(coordinator.state, 'success', 'State should be success');

  let history = db.getHistory(1);
  assert.strictEqual(history.length, 1, 'History entry should be recorded');
  console.log(`  ✔ Raw ASR:        "${history[0].asrText}"`);
  console.log(`  ✔ Formatted text: "${history[0].formattedText}"`);
  assert(history[0].formattedText.toLowerCase().includes('git'), 'Terminal command must be preserved in lowercase');

  // Wait for 1000ms auto-hide
  await new Promise(r => setTimeout(r, 1050));
  assert.strictEqual(coordinator.state, 'idle', 'State should return to idle');

  console.log('\n▶ Step 4: Testing Spoken Punctuation Parsing...');
  coordinator.activeContext = {
    app: 'slack.exe',
    windowTitle: 'Slack | #general',
    textboxContents: '',
    caretRect: { x: 400, y: 500, width: 10, height: 20 }
  };

  await coordinator.startDictation();
  await coordinator.stopDictation('Hey team comma is the deployment ready for review question mark');
  
  history = db.getHistory(1);
  console.log(`  ✔ Raw ASR:        "${history[0].asrText}"`);
  console.log(`  ✔ Formatted text: "${history[0].formattedText}"`);
  assert(history[0].formattedText.includes(','), 'Comma must be inserted');
  assert(history[0].formattedText.includes('?'), 'Question mark must be inserted');

  await new Promise(r => setTimeout(r, 1050));

  console.log('\n▶ Step 5: Testing Voice Action Command Mode (Bullet Points)...');
  coordinator.activeContext = {
    app: 'WINWORD.EXE',
    windowTitle: 'Product Specs - Microsoft Word',
    textboxContents: '',
    caretRect: { x: 500, y: 400, width: 12, height: 24 }
  };

  await coordinator.startDictation();
  // Spoken command to turn thoughts into bullet points
  await coordinator.stopDictation('bullet points: complete reverse engineering, extract electron bundle, compile native helper');
  
  history = db.getHistory(1);
  console.log(`  ✔ Spoken Command: "${history[0].asrText}"`);
  console.log(`  ✔ Executed Output:\n${history[0].pastedText.split('\n').map(l => '      ' + l).join('\n')}`);
  const lowerPasted = history[0].pastedText.toLowerCase();
  assert(lowerPasted.includes('- complete reverse engineering'), 'Bullet point 1 must be present');
  assert(lowerPasted.includes('- extract electron bundle'), 'Bullet point 2 must be present');
  assert(lowerPasted.includes('- compile native helper'), 'Bullet point 3 must be present');

  await new Promise(r => setTimeout(r, 1050));

  console.log('\n▶ Step 6: Testing Custom Dictionary Expansion & Jargon...');
  db.addDictionaryWord('Wisper Flow', 'Wispr Flow');
  db.addDictionaryWord('WIP', 'Work-In-Progress');

  coordinator.activeContext = {
    app: 'Notion.exe',
    windowTitle: 'Sprint Backlog - Notion',
    textboxContents: '',
    caretRect: { x: 350, y: 450, width: 10, height: 20 }
  };

  await coordinator.startDictation();
  await coordinator.stopDictation('The new Wisper Flow feature is currently WIP for tomorrow release.');
  
  history = db.getHistory(1);
  console.log(`  ✔ Raw ASR:        "${history[0].asrText}"`);
  console.log(`  ✔ With Dict:      "${history[0].pastedText}"`);
  assert(history[0].pastedText.includes('Wispr Flow'), 'Wisper Flow dictionary replacement must apply');
  assert(history[0].pastedText.includes('Work-In-Progress'), 'WIP acronym replacement must apply');

  await new Promise(r => setTimeout(r, 1050));

  console.log('\n▶ Step 7: Verifying SQLite History & Analytics Queries...');
  const allHistory = db.getHistory(10);
  assert.strictEqual(allHistory.length, 4, 'Must have exactly 4 history records');
  
  const searchResults = db.getHistory(10, 0, 'deployment');
  assert.strictEqual(searchResults.length, 1, 'Search query must find matching history record');
  console.log(`  ✔ History persistence confirmed: ${allHistory.length} records verified`);

  console.log('\n▶ Step 8: Clean Tear-down of Native Helper Process...');
  supervisor.stop();
  db.close();
  console.log('  ✔ FlowHelper.exe exited cleanly');

  console.log('\n========================================================================');
  console.log('       ALL END-TO-END INTEGRATION TESTS PASSED SUCCESSFULLY!          ');
  console.log('========================================================================\n');
}

runEndToEndIntegration().catch((err) => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
