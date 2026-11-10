// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import our services
import {
  pcmToWav,
  downsampleTo16k,
  calculateRms,
  createSyntheticAudioWav,
  AudioChunker,
  STTService,
  STTProvider,
  ContextFormatter,
  AppCategory,
  CommandClassifier,
  CommandType,
  PersonalizationEngine,
  computeLevenshteinDistance,
  computeSimilarity
} from './src/services/index.js';

// Import Database for integration test
import dbModule from './src/db/database.js';
const { FlowDatabase } = dbModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test Runner Infrastructure
let passedTests = 0;
let failedTests = 0;
const testResults = [];

async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const duration = (performance.now() - start).toFixed(2);
    passedTests++;
    testResults.push({ name, status: 'PASS', duration: `${duration}ms` });
    console.log(`  \x1b[32m✔ PASS\x1b[0m [${duration}ms] ${name}`);
  } catch (err) {
    const duration = (performance.now() - start).toFixed(2);
    failedTests++;
    testResults.push({ name, status: 'FAIL', duration: `${duration}ms`, error: err.message });
    console.error(`  \x1b[31m✖ FAIL\x1b[0m [${duration}ms] ${name}`);
    console.error(`    \x1b[33mError: ${err.message}\x1b[0m`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
  }
}

console.log('\n======================================================');
console.log('       WISPR FLOW AI SERVICES TEST SUITE');
console.log('======================================================\n');

// -----------------------------------------------------------
// 1. AUDIO PIPELINE TESTS
// -----------------------------------------------------------
console.log('\x1b[36m▶ 1. Audio Processing & Streaming Pipeline\x1b[0m');

await test('WAV Header Construction & Validation', async () => {
  const syntheticWav = createSyntheticAudioWav(0.5, 440, 16000);
  assert.ok(Buffer.isBuffer(syntheticWav), 'Output must be a Buffer');
  assert.ok(syntheticWav.length > 44, 'Buffer must be longer than 44 bytes');

  // Verify RIFF / WAVE headers
  assert.equal(syntheticWav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(syntheticWav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(syntheticWav.toString('ascii', 12, 16), 'fmt ');

  // Format type (1 = PCM)
  assert.equal(syntheticWav.readUInt16LE(20), 1);
  // Channels (1 = Mono)
  assert.equal(syntheticWav.readUInt16LE(22), 1);
  // Sample Rate (16000)
  assert.equal(syntheticWav.readUInt32LE(24), 16000);
  // Bits per sample (16)
  assert.equal(syntheticWav.readUInt16LE(34), 16);
  // Data sub-chunk
  assert.equal(syntheticWav.toString('ascii', 36, 40), 'data');
});

await test('Linear Downsampling (48kHz -> 16kHz)', async () => {
  const sampleCount48k = 48000; // 1 second at 48kHz
  const pcm48k = new Int16Array(sampleCount48k);
  for (let i = 0; i < sampleCount48k; i++) {
    pcm48k[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 16000);
  }

  const pcm16k = downsampleTo16k(pcm48k, 48000, 16000);
  assert.equal(pcm16k.length, 16000, 'Downsampled audio must contain exactly 16000 samples');
  assert.ok(pcm16k instanceof Int16Array, 'Result must be an Int16Array');
});

await test('RMS Volume and Silence Detection', async () => {
  // Silent buffer
  const silentPcm = new Int16Array(1600); // 100ms of zeros
  const silentStats = calculateRms(silentPcm);
  assert.equal(silentStats.isSilent, true, 'Zero PCM must be classified as silent');
  assert.equal(silentStats.rms, 0, 'RMS of zero PCM must be 0');

  // Audible tone buffer
  const tonePcm = new Int16Array(1600);
  for (let i = 0; i < tonePcm.length; i++) {
    tonePcm[i] = Math.round(Math.sin(i * 0.1) * 15000);
  }
  const toneStats = calculateRms(tonePcm);
  assert.equal(toneStats.isSilent, false, 'Audible sine tone must not be silent');
  assert.ok(toneStats.rms > 0.2, 'RMS should be greater than 0.2');
  assert.ok(toneStats.db > -20, 'dB should be higher than -20 dBFS');
});

await test('AudioChunker Real-time Sequencing', async () => {
  const chunker = new AudioChunker({ chunkDurationMs: 50, sampleRate: 16000 });
  // 50ms at 16kHz 16-bit mono = 800 samples * 2 bytes = 1600 bytes per chunk
  const inputData = Buffer.alloc(3500); // ~2.18 chunks

  const chunks = chunker.push(inputData);
  assert.equal(chunks.length, 2, 'Should have emitted 2 complete 50ms chunks');
  assert.equal(chunks[0].seq, 0);
  assert.equal(chunks[1].seq, 1);
  assert.equal(chunks[0].buffer.length, 1600);
  assert.equal(chunks[1].buffer.length, 1600);

  // Flush remaining 300 bytes
  const finalChunk = chunker.flush();
  assert.ok(finalChunk !== null);
  assert.equal(finalChunk.seq, 2);
  assert.equal(finalChunk.buffer.length, 300);
});

// -----------------------------------------------------------
// 2. SPEECH RECOGNITION (STT) TESTS
// -----------------------------------------------------------
console.log('\n\x1b[36m▶ 2. Speech-to-Text Recognition & Failover\x1b[0m');

await test('STT Service Offline / Mock Provider', async () => {
  const stt = new STTService({ primaryProvider: STTProvider.MOCK_OFFLINE });
  const audio = createSyntheticAudioWav(0.5, 440);

  const result = await stt.transcribe(audio, {
    expectedMockText: 'hello this is a test dictation'
  });

  assert.equal(result.text, 'hello this is a test dictation');
  assert.equal(result.provider, 'mock_offline');
  assert.ok(result.latencyMs >= 10, 'Should measure simulated latency');
  assert.ok(result.confidence >= 0.9, 'Confidence should be high');
  assert.equal(result.usedFallbackAsr, false);
});

await test('Multi-tier Fallback Mechanism on Provider Failure', async () => {
  const stt = new STTService({
    primaryProvider: STTProvider.GROQ,
    groqApiKey: 'invalid_dummy_key_to_force_error',
    enableFallback: true,
    timeoutMs: 1500
  });

  stt.setDefaultMockText('fallback transcription recovered seamlessly');
  const audio = createSyntheticAudioWav(0.3, 440);

  const capturedErrors = [];
  stt.on('providerError', (evt) => {
    capturedErrors.push(evt);
  });

  const result = await stt.transcribe(audio);
  assert.ok(capturedErrors.length > 0, 'Should emit providerError event on primary failure');
  assert.ok(capturedErrors.some(e => e.provider === 'groq'), 'Should have attempted Groq');
  assert.equal(result.usedFallbackAsr, true, 'usedFallbackAsr must be true');
  assert.ok(result.fallbackLevel >= 1, 'fallbackLevel must be >= 1');
  assert.ok(result.text.length > 0, 'Transcript must be recovered via fallback');
});

await test('Gnani AI Prisma Provider Configuration & STTProvider Enum', async () => {
  assert.equal(STTProvider.GNANI_PRISMA, 'gnani_prisma', 'STTProvider enum must include GNANI_PRISMA');
  const gnaniStt = new STTService({
    gnaniApiKey: 'test_vach_dummy_key',
    gnaniModel: 'prisma-v3.0',
    gnaniLanguage: 'indic-auto'
  });
  assert.equal(gnaniStt.primaryProvider, STTProvider.GNANI_PRISMA, 'Gnani Prisma must be primary provider when API key is set');
  assert.equal(gnaniStt.gnaniModel, 'prisma-v3.0');
  assert.equal(gnaniStt.gnaniLanguage, 'indic-auto');
});

await test('Streaming Dictation Session Lifecycle', async () => {
  const stt = new STTService({ primaryProvider: STTProvider.MOCK_OFFLINE });
  const session = stt.createSession({ chunkDurationMs: 50 });

  let framesEmitted = 0;
  session.on('audioFrame', (frame) => {
    framesEmitted++;
  });

  // Push 100ms of audio in two 50ms pushes
  const pcmBlock = Buffer.alloc(1600);
  session.pushAudio(pcmBlock);
  session.pushAudio(pcmBlock);

  assert.ok(framesEmitted >= 2, 'Audio frames should be emitted as pushed');

  const finalResult = await session.stopAndFinalize();
  assert.ok(finalResult.text.length > 0, 'Final transcript should be returned on finalize');
  assert.equal(session.isRecording, false, 'Recording state should be false after finalize');
});

// -----------------------------------------------------------
// 3. CONTEXT-AWARE PROMPT FORMATTER TESTS
// -----------------------------------------------------------
console.log('\n\x1b[36m▶ 3. Context-Aware Prompt Formatter\x1b[0m');

const formatter = new ContextFormatter();

await test('Terminal Formatting: Shell commands, casing, trailing punctuation', async () => {
  // Command with trailing period
  const res1 = await formatter.formatContext({
    asrText: 'git push origin main period',
    activeApp: 'powershell.exe',
    windowTitle: 'Windows PowerShell'
  });

  assert.equal(res1.formattedText, 'git push origin main', 'Trailing period must be stripped in terminal');
  assert.equal(res1.detectedCategory, AppCategory.TERMINAL);
  assert.ok(res1.rulesApplied.includes('strip_terminal_trailing_punctuation'));
});

await test('Terminal Formatting: Flags and arguments (--help, -v)', async () => {
  const res = await formatter.formatContext({
    asrText: 'npm run build dash dash dry run dash v',
    activeApp: 'cmd.exe',
    windowTitle: 'Command Prompt'
  });

  assert.equal(res.formattedText, 'npm run build --dry-run -v');
});

await test('Terminal Formatting: camelCase & snake_case identifiers', async () => {
  const resCamel = await formatter.formatContext({
    asrText: 'camel case user profile details',
    activeApp: 'wt.exe',
    windowTitle: 'Terminal'
  });
  assert.equal(resCamel.formattedText, 'userProfileDetails');

  const resSnake = await formatter.formatContext({
    asrText: 'snake case max connection pool',
    activeApp: 'bash',
    windowTitle: 'MINGW64:/c/project'
  });
  assert.equal(resSnake.formattedText, 'max_connection_pool');
});

await test('Terminal Formatting: NUL Byte Sanitization (\u0000 -> space)', async () => {
  const res = await formatter.formatContext({
    asrText: 'docker\u0000compose\u0000up\u0000dash\u0000d',
    activeApp: 'powershell.exe',
    windowTitle: 'PowerShell'
  });

  assert.equal(res.formattedText, 'docker compose up -d');
  assert.ok(res.rulesApplied.includes('sanitize_nul_bytes'));
});

await test('Casual Chat Formatting (Slack / Discord)', async () => {
  const res = await formatter.formatContext({
    asrText: 'hey are you free for a sync at three question mark',
    activeApp: 'Slack.exe',
    windowTitle: '#general - Slack'
  });

  assert.equal(res.detectedCategory, AppCategory.CHAT);
  assert.equal(res.formattedText, 'Hey are you free for a sync at three?');
  assert.ok(!res.formattedText.endsWith('.'), 'Casual chat should not append stiff trailing period');
});

await test('Formal Document Formatting (Word / Outlook)', async () => {
  const res = await formatter.formatContext({
    asrText: 'dear team comma we must finalize the budget by friday period',
    activeApp: 'WINWORD.EXE',
    windowTitle: 'Annual Report - Word'
  });

  assert.equal(res.detectedCategory, AppCategory.DOCUMENT);
  assert.equal(res.formattedText, 'Dear team, we must finalize the budget by Friday.');
});

await test('Spoken Punctuation: Full vocabulary parsing', async () => {
  const res = await formatter.formatContext({
    asrText: 'hello world comma how are you question mark new line bullet point task one new line bullet point task two',
    activeApp: 'Notepad.exe'
  });

  assert.ok(res.formattedText.toLowerCase().includes('hello world, how are you?'));
  assert.ok(res.formattedText.includes('\n- Task one'));
  assert.ok(res.formattedText.includes('\n- Task two'));
});

await test('Caret Spacing & Alignment: Unfinished clause lowercase continuation', async () => {
  const res = await formatter.formatContext({
    asrText: 'it is much faster',
    activeApp: 'chrome.exe',
    precedingText: 'We prefer this approach because '
  });

  // Should keep "it" lowercase and NOT prepend extra space since preceding ends with space
  assert.equal(res.pastedText, 'it is much faster');
});

await test('Caret Spacing & Alignment: Missing space insertion', async () => {
  const res = await formatter.formatContext({
    asrText: 'world',
    activeApp: 'slack.exe',
    precedingText: 'Hello'
  });

  // Preceding has no trailing space -> prepend space
  assert.equal(res.pastedText, ' world');
});

await test('Caret Spacing & Alignment: Sentence terminator capitalization', async () => {
  const res = await formatter.formatContext({
    asrText: 'next step is verification',
    activeApp: 'outlook.exe',
    precedingText: 'The build succeeded. '
  });

  // Preceding ended with ". " -> start with capital letter
  assert.equal(res.pastedText, 'Next step is verification.');
});

// -----------------------------------------------------------
// 4. COMMAND MODE INTENT CLASSIFIER TESTS
// -----------------------------------------------------------
console.log('\n\x1b[36m▶ 4. Command Mode & Voice Action Intent Classifier\x1b[0m');

const classifier = new CommandClassifier();

await test('Intent Classification: Literal Dictation', async () => {
  const res = classifier.classify('We have scheduled the team offsite for next month.');
  assert.equal(res.isCommand, false);
  assert.equal(res.type, CommandType.DICTATION);
});

await test('Intent Classification: Translation Command', async () => {
  const res = classifier.classify('Wispr, translate to French: I will see you tomorrow at lunch');
  assert.equal(res.isCommand, true);
  assert.equal(res.type, CommandType.TRANSLATE);
  assert.equal(res.targetLanguage.toLowerCase(), 'french');
  assert.equal(res.payload, 'I will see you tomorrow at lunch');
});

await test('Intent Classification: Context-Assisted Text Polish (Bullet Points)', async () => {
  const res = classifier.classify('make it bullet points', {
    hasSelectedText: true,
    selectedText: 'First item. Second item. Third item.'
  });

  assert.equal(res.isCommand, true);
  assert.equal(res.type, CommandType.BULLET_POINTS);
  assert.equal(res.payload, 'First item. Second item. Third item.');
});

await test('Intent Classification: Grammar Fix Command', async () => {
  const res = classifier.classify('fix grammar', {
    hasSelectedText: true,
    selectedText: 'teh user dont have access to database'
  });

  assert.equal(res.isCommand, true);
  assert.equal(res.type, CommandType.FIX_GRAMMAR);
});

await test('Command Execution: Bullet Points Transformation', async () => {
  const cmd = classifier.classify('make it bullet points', {
    hasSelectedText: true,
    selectedText: 'Design UI architecture. Implement STT pipeline. Run test suites.'
  });

  const executed = await classifier.executeCommand(cmd);
  assert.equal(executed.success, true);
  assert.equal(
    executed.resultText,
    '- Design UI architecture\n- Implement STT pipeline\n- Run test suites.'
  );
});

await test('Command Execution: Fix Grammar Transformation', async () => {
  const cmd = classifier.classify('fix grammar', {
    hasSelectedText: true,
    selectedText: 'i dont want teh server to crash'
  });

  const executed = await classifier.executeCommand(cmd);
  assert.equal(executed.success, true);
  assert.equal(executed.resultText, "I don't want the server to crash.");
});

await test('Command Execution: Formal Tone Transformation', async () => {
  const cmd = classifier.classify('make it formal', {
    hasSelectedText: true,
    selectedText: 'hey gonna check this out asap thanks a lot'
  });

  const executed = await classifier.executeCommand(cmd);
  assert.equal(executed.success, true);
  assert.ok(executed.resultText.includes('going to'));
  assert.ok(executed.resultText.includes('earliest convenience'));
});

await test('Command Execution: Instant Translation Transformation', async () => {
  const cmd = classifier.classify('translate to French: I love programming');
  const executed = await classifier.executeCommand(cmd);
  assert.equal(executed.success, true);
  assert.equal(executed.resultText, "J'aime la programmation");
});

await test('Intent Classification: MCP Search Tool Routing', async () => {
  const res = classifier.classify('search web for electron audio worklet latency');
  assert.equal(res.isCommand, true);
  assert.equal(res.type, CommandType.MCP_TOOL);
  assert.equal(res.mcpToolCall.name, 'search_web');
  assert.equal(res.mcpToolCall.args.query, 'electron audio worklet latency');
});

// -----------------------------------------------------------
// 5. PERSONALIZATION & LEARNING ENGINE TESTS
// -----------------------------------------------------------
console.log('\n\x1b[36m▶ 5. Personalization & User Correction Learning\x1b[0m');

const tempStoragePath = path.join(__dirname, 'test_user_dictionary.json');
if (fs.existsSync(tempStoragePath)) fs.unlinkSync(tempStoragePath);

const personalization = new PersonalizationEngine({
  storagePath: tempStoragePath,
  autoLearnThreshold: 2
});

await test('Dictionary Replacement: Custom Acronyms & Jargon', async () => {
  personalization.addWord('k8s', 'Kubernetes');
  personalization.addWord('pr', 'PR');
  personalization.addWord('wisper', 'Wispr Flow');

  const raw = 'I opened a new pr for k8s using wisper today.';
  const replaced = personalization.applyDictionary(raw);

  assert.equal(replaced, 'I opened a new PR for Kubernetes using Wispr Flow today.');

  // Verify word boundaries: "problem" should NOT be replaced by PR
  const boundaryCheck = personalization.applyDictionary('That is a big problem.');
  assert.equal(boundaryCheck, 'That is a big problem.');
});

await test('Levenshtein Distance & Similarity Calculation', async () => {
  assert.equal(computeLevenshteinDistance('kitten', 'sitting'), 3);
  assert.equal(computeLevenshteinDistance('flow', 'flow'), 0);
  assert.equal(computeLevenshteinDistance('', 'test'), 4);

  const sim = computeSimilarity('Kathryn', 'Catherine');
  assert.ok(sim >= 0.5 && sim <= 0.8, 'Kathryn and Catherine should have similarity between 0.5 and 0.8');
});

await test('Learning from User Edits: Auto-learning word replacement', async () => {
  const dictated = 'Let us schedule a meeting with Kathryn tomorrow.';
  const edited = 'Let us schedule a meeting with Catherine tomorrow.';

  // Attempt 1: Count becomes 1 (below autoLearnThreshold 2)
  const step1 = personalization.learnFromEdit(dictated, edited);
  assert.equal(step1.correctionDetected, true);
  assert.equal(step1.learned, false);
  assert.equal(step1.candidate.phrase, 'Kathryn');
  assert.equal(step1.candidate.replacement, 'Catherine');
  assert.equal(step1.candidate.count, 1);

  // Dictionary should not have it yet
  assert.equal(personalization.applyDictionary('Meeting with Kathryn'), 'Meeting with Kathryn');

  // Attempt 2: Count reaches 2 -> auto-learned!
  const step2 = personalization.learnFromEdit(dictated, edited);
  assert.equal(step2.learned, true);
  assert.equal(step2.candidate.count, 2);

  // Now, dictionary automatically replaces Kathryn with Catherine!
  const learnedResult = personalization.applyDictionary('Meeting with Kathryn');
  assert.equal(learnedResult, 'Meeting with Catherine');
});

// -----------------------------------------------------------
// 6. SQLITE DATABASE INTEGRATION TESTS
// -----------------------------------------------------------
console.log('\n\x1b[36m▶ 6. FlowDatabase SQLite Integration\x1b[0m');

const tempDbPath = path.join(__dirname, 'test_flow.sqlite');
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

await test('FlowDatabase History & Dictionary SQLite Persistence', async () => {
  const db = new FlowDatabase(tempDbPath);

  // 1. History record
  const historyItem = db.addHistory({
    asrText: 'git status',
    formattedText: 'git status',
    pastedText: 'git status',
    app: 'powershell.exe',
    duration: 1200,
    metadata: { latencyMs: 145, provider: 'groq' }
  });
  assert.ok(historyItem.id);

  const historyList = db.getHistory(10, 0);
  assert.equal(historyList.length, 1);
  assert.equal(historyList[0].asrText, 'git status');

  // 2. Personalization integration with SQLite
  const dbPersonalization = new PersonalizationEngine({
    database: db,
    autoLearnThreshold: 1
  });

  dbPersonalization.addWord('dockerfile', 'Dockerfile');
  assert.equal(dbPersonalization.applyDictionary('edit the dockerfile now'), 'edit the Dockerfile now');

  // Verify SQLite dictionary table was updated
  const dictWords = db.getDictionary();
  const found = dictWords.find(w => w.phrase.toLowerCase() === 'dockerfile');
  assert.ok(found, 'Word should be persisted in SQLite Dictionary table');
  assert.equal(found.replacement, 'Dockerfile');
});

// Cleanup temp files
try {
  if (fs.existsSync(tempStoragePath)) fs.unlinkSync(tempStoragePath);
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempDbPath + '-wal')) fs.unlinkSync(tempDbPath + '-wal');
  if (fs.existsSync(tempDbPath + '-shm')) fs.unlinkSync(tempDbPath + '-shm');
} catch (e) {}

// -----------------------------------------------------------
// TEST SUMMARY REPORT
// -----------------------------------------------------------
console.log('\n======================================================');
console.log('                 TEST SUMMARY REPORT');
console.log('======================================================');
console.log(`  Total Tests Run:  ${passedTests + failedTests}`);
console.log(`  \x1b[32mPassed:           ${passedTests}\x1b[0m`);
console.log(`  \x1b[31mFailed:           ${failedTests}\x1b[0m`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\x1b[32m✔ All Wispr Flow AI & Audio Services passed successfully!\x1b[0m\n');
  process.exit(0);
}
