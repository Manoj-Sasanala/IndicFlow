// @ts-check
'use strict';

/**
 * Floating Status Pill Renderer
 * Uses modular AudioEngine (16kHz 40ms AudioWorklet + VAD silence auto-stop)
 */

const pillContainer = document.getElementById('pill-container');
const pillTimer = document.getElementById('pill-timer');
const waveform = document.getElementById('waveform');
const btnStop = document.getElementById('btn-stop-dictation');
const successPreview = document.getElementById('success-preview');
const bars = Array.from(document.querySelectorAll('.bar'));

let audioEngine = null;
let timerInterval = null;
let startTime = 0;
let visualizerLoopId = null;

function initAudioCapture() {
  if (audioEngine && audioEngine.isRecording) return;

  // @ts-ignore
  audioEngine = new AudioEngine({
    workletPath: '../audio/recorderWorklet.js',
    silenceAutoStopMs: 3000, // 3.0-second pause buffer before auto-transcribing
    onVolume: (metrics) => {
      updateWaveformFromVolume(metrics);
    },
    onAutoStop: (wavBytes) => {
      console.log('[Pill] VAD auto-stop triggered after speech silence');
      if (window.flowAPI) {
        window.flowAPI.stopDictation(wavBytes);
      }
    }
  });

  audioEngine.start().then(() => {
    startVisualizerLoop();
  }).catch((err) => {
    console.warn('[Pill] AudioEngine start failed:', err.message);
    waveform?.classList.add('pulsing');
  });
}

function stopAudioCaptureAndGetWav() {
  stopVisualizerLoop();
  if (!audioEngine) {
    resetWaveformBars();
    return null;
  }
  const wavBytes = audioEngine.stopAndGetWav();
  audioEngine = null;
  resetWaveformBars();
  return wavBytes;
}

function updateWaveformFromVolume(metrics) {
  // Map normalized 0..1 volume to dynamic heights
  const norm = metrics.normalized; // 0.0 (silence) to 1.0 (loud speech)
  const multipliers = [0.6, 0.9, 1.2, 1.1, 0.85, 0.5];

  bars.forEach((bar, idx) => {
    const factor = multipliers[idx % multipliers.length];
    const height = Math.max(4, Math.min(22, Math.round(norm * 22 * factor)));
    bar.style.height = `${height}px`;
  });
}

function resetWaveformBars() {
  bars.forEach((bar) => {
    bar.style.height = '6px';
  });
}

function startVisualizerLoop() {
  if (!audioEngine || !audioEngine.analyserNode) return;

  const analyser = audioEngine.analyserNode;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function render() {
    if (!audioEngine || !audioEngine.isRecording) return;

    analyser.getByteFrequencyData(dataArray);
    const step = Math.floor(bufferLength / bars.length);
    const levels = [];

    bars.forEach((bar, idx) => {
      const val = dataArray[idx * step] || 0;
      const height = Math.max(4, Math.min(22, Math.round((val / 255) * 22)));
      bar.style.height = `${height}px`;
      levels.push(val / 255);
    });

    if (window.flowAPI?.sendAudioLevels && Math.random() < 0.25) {
      window.flowAPI.sendAudioLevels(levels);
    }

    visualizerLoopId = requestAnimationFrame(render);
  }

  visualizerLoopId = requestAnimationFrame(render);
}

function stopVisualizerLoop() {
  if (visualizerLoopId) {
    cancelAnimationFrame(visualizerLoopId);
    visualizerLoopId = null;
  }
}

function startTimer() {
  startTime = Date.now();
  updateTimerText();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerText, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerText() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  if (pillTimer) {
    pillTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

function setPillState(state, data = {}) {
  if (!pillContainer) return;

  pillContainer.className = `pill state-${state}`;

  if (state === 'listening') {
    startTimer();
    initAudioCapture();
    AudioEngine.playSound('start');
  } else if (state === 'processing') {
    stopTimer();
    stopVisualizerLoop();
    resetWaveformBars();
    AudioEngine.playSound('stop');
  } else {
    stopTimer();
    stopAudioCaptureAndGetWav();
  }

  if (state === 'success') {
    AudioEngine.playSound('success');
    if (successPreview) {
      successPreview.textContent = data.text ? 'Done' : 'Pasted';
    }
  } else if (state === 'error') {
    AudioEngine.playSound('error');
  }
}

// Manual stop button
btnStop?.addEventListener('click', (e) => {
  e.stopPropagation();
  const wavBytes = stopAudioCaptureAndGetWav();
  if (window.flowAPI) {
    window.flowAPI.stopDictation(wavBytes);
  }
});

// IPC Event Listeners
if (window.flowAPI) {
  window.flowAPI.onStateChange((data) => {
    setPillState(data.state, data);
  });

  // Handle hotkey release / toggle stop requesting audio
  window.flowAPI.onRequestAudioStop?.(() => {
    console.log('[Pill] Hotkey release / remote stop: capturing audio buffer');
    const wavBytes = stopAudioCaptureAndGetWav();
    window.flowAPI.stopDictation(wavBytes);
  });

  // Check initial state & theme
  window.flowAPI.getSettings?.().then((settings) => {
    if (settings?.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }).catch(() => {});

  window.flowAPI.getState().then((stateInfo) => {
    if (stateInfo && stateInfo.state) {
      setPillState(stateInfo.state);
    }
  }).catch(() => {});
} else {
  // Standalone browser dev preview
  console.log('[Pill] Running in browser preview mode');
  setPillState('listening');
}
