/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_SAMPLE_RATE = 16_000;
const INPUT_FRAME_SIZE = 1_024;

class PracticalTeluguPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(INPUT_FRAME_SIZE);
    this.pendingLength = 0;
    // Resampler state carried across blocks so no input sample is dropped at
    // block boundaries (a per-block floor drops ~0.1% and drifts the clock).
    this.resampleTail = new Float32Array(0);
    this.resampleFraction = 0;
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
    let levelSum = 0;
    for (let inputIndex = 0; inputIndex < input.length; inputIndex += 1) {
      levelSum += input[inputIndex] * input[inputIndex];
    }
    const level = Math.min(1, Math.sqrt(levelSum / input.length) * 4.2);

    if (sampleRate <= TARGET_SAMPLE_RATE) {
      // No downsampling possible; label the frames with the context's true
      // rate so low-rate audio is never mislabeled as 16 kHz.
      const output = new Int16Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, input[index]));
        output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.port.postMessage(
        { level, pcm: output.buffer, sampleRate },
        [output.buffer],
      );
      return;
    }

    const ratio = sampleRate / TARGET_SAMPLE_RATE;
    const work = new Float32Array(this.resampleTail.length + input.length);
    work.set(this.resampleTail, 0);
    work.set(input, this.resampleTail.length);

    const outputLength = Math.floor(
      (work.length - this.resampleFraction) / ratio,
    );
    const output = new Int16Array(Math.max(0, outputLength));
    let position = this.resampleFraction;

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(position);
      const end = Math.min(
        work.length,
        Math.max(start + 1, Math.floor(position + ratio)),
      );
      let total = 0;
      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        total += work[inputIndex];
      }
      const sample = Math.max(-1, Math.min(1, total / (end - start)));
      output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      position += ratio;
    }

    const consumed = Math.min(work.length, Math.floor(position));
    this.resampleTail = work.slice(consumed);
    this.resampleFraction = position - consumed;

    if (!output.length) return;
    this.port.postMessage(
      { level, pcm: output.buffer, sampleRate: TARGET_SAMPLE_RATE },
      [output.buffer],
    );
  }
}

registerProcessor("practicaltelugu-live-pcm", PracticalTeluguPcmProcessor);
