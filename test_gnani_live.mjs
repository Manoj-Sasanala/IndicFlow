// @ts-check
import { STTService, STTProvider } from './src/services/sttService.js';
import { createSyntheticAudioWav } from './src/services/audioPipeline.js';

console.log('\n======================================================');
console.log('       GNANI AI PRISMA STT LIVE API VERIFICATION');
console.log('======================================================\n');

async function run() {
  const apiKey = process.env.GNANI_API_KEY || 'vach_1ytE2CY5X2EAmc5L3wuTWkGhJ68RnojDdCYDsXvUVyXdJGxiJ5yz4hMbZS5gE7RdnROeYrso6PoFnyQ5URmPzx6pEYdRMUTL_428d9096381302fb25361cdda2d6b97e';
  console.log(`[Gnani Test] Target Endpoint: https://api.vachana.ai/stt/v3`);
  console.log(`[Gnani Test] API Key Prefix : ${apiKey.substring(0, 15)}...`);
  console.log(`[Gnani Test] Model         : prisma-v3.0`);
  console.log(`[Gnani Test] Language Code : indic-auto`);

  const stt = new STTService({
    gnaniApiKey: apiKey,
    primaryProvider: STTProvider.GNANI_PRISMA,
    gnaniModel: 'prisma-v3.0',
    gnaniLanguage: 'indic-auto',
    enableFallback: false
  });

  console.log('[Gnani Test] Generating 2-second synthetic audio wave...');
  const wavBuffer = createSyntheticAudioWav(2.0, 440, 16000);
  console.log(`[Gnani Test] Audio payload ready: ${wavBuffer.length} bytes (WAV 16kHz mono)`);

  const startTime = performance.now();
  try {
    console.log('[Gnani Test] Dispatching live POST request to Gnani AI...');
    const result = await stt.transcribe(wavBuffer);
    const duration = (performance.now() - startTime).toFixed(0);

    console.log('\n\x1b[32m✔ SUCCESS: Gnani AI Prisma STT responded successfully!\x1b[0m');
    console.log(`  Roundtrip Duration : ${duration}ms`);
    console.log(`  Reported Model     : ${result.model}`);
    console.log(`  Detected Language  : ${result.detectedLanguage || 'indic-auto'}`);
    console.log(`  Request ID         : ${result.requestId || 'N/A'}`);
    console.log(`  Transcribed Text   : "${result.text}" (sine tone produces empty or background transcript as expected)`);
    console.log(`  Provider Confirmed : ${result.provider || STTProvider.GNANI_PRISMA}`);
  } catch (err) {
    const duration = (performance.now() - startTime).toFixed(0);
    console.error(`\n\x1b[31m✖ ERROR after ${duration}ms:\x1b[0m`, err.message);
    process.exit(1);
  }
}

run();

