import assert from "node:assert/strict";
import test from "node:test";

import {
  appendLiveAssessmentAudio,
  createLiveAssessmentAudioCapture,
  LIVE_ASSESSMENT_SAMPLE_RATE,
  markLiveAssessmentActivityEnd,
  markLiveAssessmentActivityStart,
  takeLiveAssessmentAudio,
} from "../app/practice-live/live-assessment-audio.ts";

test("preserves forwarded PCM exactly when provider VAD is absent", () => {
  const capture = createLiveAssessmentAudioCapture();
  const first = Int16Array.from({ length: 2_000 }, (_, index) => index - 1_000);
  const second = Int16Array.from({ length: 2_000 }, (_, index) => 1_000 - index);

  appendLiveAssessmentAudio(capture, first);
  appendLiveAssessmentAudio(capture, second);

  const audio = takeLiveAssessmentAudio(capture);
  assert.ok(audio);
  assert.deepEqual(audio, new Int16Array([...first, ...second]));
  assert.equal(capture.sampleCount, 0);
});

test("keeps a bounded pre-roll and trims audio after activity end", () => {
  const capture = createLiveAssessmentAudioCapture();
  appendLiveAssessmentAudio(
    capture,
    new Int16Array(LIVE_ASSESSMENT_SAMPLE_RATE).fill(1),
  );
  markLiveAssessmentActivityStart(capture);
  appendLiveAssessmentAudio(capture, new Int16Array(8_000).fill(2));
  markLiveAssessmentActivityEnd(capture);
  appendLiveAssessmentAudio(capture, new Int16Array(8_000).fill(3));

  const audio = takeLiveAssessmentAudio(capture);
  assert.ok(audio);
  assert.equal(audio.length, 12_000 + 8_000);
  assert.equal(audio[0], 1);
  assert.equal(audio.at(-1), 2);
});

test("caps a stalled learner window at twenty seconds", () => {
  const capture = createLiveAssessmentAudioCapture();
  for (let second = 0; second < 25; second += 1) {
    appendLiveAssessmentAudio(
      capture,
      new Int16Array(LIVE_ASSESSMENT_SAMPLE_RATE).fill(second),
    );
  }

  const audio = takeLiveAssessmentAudio(capture);
  assert.ok(audio);
  assert.equal(audio.length, LIVE_ASSESSMENT_SAMPLE_RATE * 20);
  assert.equal(audio[0], 5);
  assert.equal(audio.at(-1), 24);
});

test("drops clips too short for a fair audio assessment", () => {
  const capture = createLiveAssessmentAudioCapture();
  appendLiveAssessmentAudio(capture, new Int16Array(1_000).fill(4));

  assert.equal(takeLiveAssessmentAudio(capture), null);
  assert.equal(capture.sampleCount, 0);
});
