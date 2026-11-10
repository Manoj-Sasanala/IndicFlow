// @ts-check
'use strict';

/**
 * AudioWorkletProcessor for high-fidelity 16kHz audio capture & chunking
 * Low-latency Web Audio Worklet for IndicFlow voice streaming.
 * Emits uniform 640-sample (40ms) PCM audio packets on a high-priority audio thread.
 */

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.recording = false;
    this.chunkSize = 640; // 640 samples = 40ms at 16,000 Hz
    this.renderQuantumSize = 128;
    this.numInputStreams = (options && options.numberOfInputs) || 1;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;

    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.bufferIndex = 0;
        this.buffer.fill(0);
        this.recording = true;
      } else if (e.data === 'stop') {
        this.recording = false;
        if (this.bufferIndex > 0) {
          const partial = this.buffer.slice(0, this.bufferIndex);
          this.port.postMessage({
            data: partial,
            frame: currentFrame,
            isLast: true
          });
        }
        this.port.postMessage('recorderWorklet:done');
        this.bufferIndex = 0;
        this.buffer.fill(0);
      }
    };
  }

  process(inputs) {
    if (!this.recording) return true;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    let inputOffset = 0;
    while (inputOffset < channel.length) {
      const spaceInBuffer = this.chunkSize - this.bufferIndex;
      const copyCount = Math.min(spaceInBuffer, channel.length - inputOffset);

      this.buffer.set(channel.subarray(inputOffset, inputOffset + copyCount), this.bufferIndex);
      this.bufferIndex += copyCount;
      inputOffset += copyCount;

      if (this.bufferIndex >= this.chunkSize) {
        // Full 640-sample (40ms) block ready
        const chunk = new Float32Array(this.chunkSize);
        chunk.set(this.buffer);
        this.port.postMessage({
          data: chunk,
          frame: currentFrame + this.renderQuantumSize,
          isLast: false
        });
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);

