/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_SAMPLE_RATE = 16_000;
const INPUT_FRAME_SIZE = 1_024;

class PracticalTeluguPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(INPUT_FRAME_SIZE);
    this.pendingLength = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    let inputOffset = 0;
    while (inputOffset < input.length) {
      const writable = Math.min(
        INPUT_FRAME_SIZE - this.pendingLength,
        input.length - inputOffset,
      );
      this.pending.set(
        input.subarray(inputOffset, inputOffset + writable),
        this.pendingLength,
      );
      this.pendingLength += writable;
      inputOffset += writable;

      if (this.pendingLength === INPUT_FRAME_SIZE) {
        this.emitPcm(this.pending);
        this.pendingLength = 0;
      }
    }

    return true;
  }

  emitPcm(input) {
    const ratio = Math.max(1, sampleRate / TARGET_SAMPLE_RATE);
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Int16Array(outputLength);
    let levelSum = 0;

    for (let inputIndex = 0; inputIndex < input.length; inputIndex += 1) {
      levelSum += input[inputIndex] * input[inputIndex];
    }

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.min(
        input.length,
        Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)),
      );
      let total = 0;

      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        total += input[inputIndex];
      }

      const sample = Math.max(-1, Math.min(1, total / (end - start)));
      output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    this.port.postMessage(
      {
        level: Math.min(1, Math.sqrt(levelSum / input.length) * 4.2),
        pcm: output.buffer,
      },
      [output.buffer],
    );
  }
}

registerProcessor("practicaltelugu-live-pcm", PracticalTeluguPcmProcessor);
