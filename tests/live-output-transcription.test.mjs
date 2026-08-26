import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputTranscriptionUpdate,
  createOutputTranscriptionState,
  isOutputTranscriptionReady,
} from "../scripts/live-output-transcription.mjs";

test("waits for both the completed turn and the final transcription", () => {
  let state = createOutputTranscriptionState();
  state = applyOutputTranscriptionUpdate(state, { text: "ఏం" });

  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: false,
      settleElapsed: false,
    }),
    false,
  );
  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: true,
      settleElapsed: false,
    }),
    false,
  );

  state = applyOutputTranscriptionUpdate(state, {
    text: "తిన్నారు?",
    finished: true,
  });
  assert.equal(state.text, "ఏం తిన్నారు?");
  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: true,
      settleElapsed: false,
    }),
    true,
  );
});

test("uses a bounded post-turn settle when Gemini omits finished", () => {
  const state = applyOutputTranscriptionUpdate(
    createOutputTranscriptionState(),
    { text: "ఏం తిన్నావు?" },
  );

  assert.equal(state.finished, false);
  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: true,
      settleElapsed: false,
    }),
    false,
  );
  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: true,
      settleElapsed: true,
    }),
    true,
  );
});

test("a finished transcription still waits for the audio turn boundary", () => {
  const state = applyOutputTranscriptionUpdate(
    createOutputTranscriptionState(),
    { text: "ఏం తిన్నావు?", finished: true },
  );

  assert.equal(
    isOutputTranscriptionReady(state, {
      responseComplete: false,
      settleElapsed: true,
    }),
    false,
  );
});
