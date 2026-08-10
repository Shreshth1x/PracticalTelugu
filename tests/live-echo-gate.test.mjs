import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveEchoGate,
  ECHO_GATE_ECHO_MULTIPLIER,
  ECHO_GATE_FLOOR_MAX,
  ECHO_GATE_HOLD_MS,
  ECHO_GATE_MIN_SPEECH_LEVEL,
} from "../app/practice-live/live-echo-gate.ts";

test("forwards every frame while playback is idle", () => {
  const gate = createLiveEchoGate();

  for (const level of [0, 0.02, 0.4, 1]) {
    const decision = gate.decide({
      level,
      outputAudible: false,
      timestampMs: 1_000,
    });
    assert.deepEqual(decision, { forward: true, reason: "idle" });
  }
});

test("blocks quiet echo-level frames while Mayu is audible", () => {
  const gate = createLiveEchoGate();

  const decision = gate.decide({
    level: ECHO_GATE_MIN_SPEECH_LEVEL / 2,
    outputAudible: true,
    timestampMs: 1_000,
  });
  assert.deepEqual(decision, { forward: false, reason: "echo" });
});

test("passes a loud interjection during playback", () => {
  const gate = createLiveEchoGate();

  // A few frames of echo bed first, as during normal playback.
  for (let index = 0; index < 5; index += 1) {
    gate.decide({ level: 0.04, outputAudible: true, timestampMs: index * 21 });
  }

  const onset = gate.decide({
    level: 0.6,
    outputAudible: true,
    timestampMs: 200,
  });
  assert.deepEqual(onset, { forward: false, reason: "echo" });
  const decision = gate.decide({
    level: 0.6,
    outputAudible: true,
    timestampMs: 221,
  });
  assert.deepEqual(decision, { forward: true, reason: "speech" });
});

test("hysteresis keeps the gate open across sub-threshold speech tails", () => {
  const gate = createLiveEchoGate();

  gate.decide({
    level: 0.6,
    outputAudible: true,
    timestampMs: 1_000,
  });
  const opened = gate.decide({
    level: 0.6,
    outputAudible: true,
    timestampMs: 1_021,
  });
  assert.equal(opened.forward, true);

  const withinHold = gate.decide({
    level: 0.03,
    outputAudible: true,
    timestampMs: 1_000 + ECHO_GATE_HOLD_MS - 1,
  });
  assert.deepEqual(withinHold, { forward: true, reason: "hold" });

  const afterHold = gate.decide({
    level: 0.03,
    outputAudible: true,
    timestampMs: 1_021 + ECHO_GATE_HOLD_MS + 1,
  });
  assert.deepEqual(afterHold, { forward: false, reason: "echo" });
});

test("continuous speech refreshes the hold instead of expiring mid-utterance", () => {
  const gate = createLiveEchoGate();

  gate.decide({ level: 0.6, outputAudible: true, timestampMs: 979 });
  gate.decide({ level: 0.6, outputAudible: true, timestampMs: 1_000 });
  gate.decide({
    level: 0.6,
    outputAudible: true,
    timestampMs: 1_000 + ECHO_GATE_HOLD_MS - 50,
  });

  const stillOpen = gate.decide({
    level: 0.03,
    outputAudible: true,
    timestampMs: 1_000 + 2 * ECHO_GATE_HOLD_MS - 100,
  });
  assert.equal(stillOpen.forward, true);
});

test("a louder echo bed adapts within a bounded speech threshold", () => {
  const gate = createLiveEchoGate();

  // Sustained sub-threshold echo residue above the seed floor. (A bed above
  // the threshold reads as speech by design — that regime is what the
  // no-AEC half-duplex fallback covers.)
  for (let index = 0; index < 200; index += 1) {
    gate.decide({ level: 0.1, outputAudible: true, timestampMs: index * 21 });
  }

  // This level clears the fixed minimum but not the adapted threshold.
  const decision = gate.decide({
    level: 0.2,
    outputAudible: true,
    timestampMs: 5_000,
  });
  assert.deepEqual(decision, { forward: false, reason: "echo" });
  assert.ok(
    ECHO_GATE_FLOOR_MAX * ECHO_GATE_ECHO_MULTIPLIER < 0.25,
    "the adaptive floor must not make ordinary barge-in effectively impossible",
  );
});

test("an idle frame clears the hold and adaptive floor before playback resumes", () => {
  const gate = createLiveEchoGate();

  for (let index = 0; index < 200; index += 1) {
    gate.decide({ level: 0.1, outputAudible: true, timestampMs: index * 21 });
  }
  gate.decide({ level: 0.5, outputAudible: false, timestampMs: 1_050 });

  const firstSpeechFrame = gate.decide({
    level: ECHO_GATE_MIN_SPEECH_LEVEL + 0.01,
    outputAudible: true,
    timestampMs: 1_100,
  });
  const nextPlayback = gate.decide({
    level: ECHO_GATE_MIN_SPEECH_LEVEL + 0.01,
    outputAudible: true,
    timestampMs: 1_121,
  });
  assert.deepEqual(firstSpeechFrame, { forward: false, reason: "echo" });
  assert.deepEqual(nextPlayback, { forward: true, reason: "speech" });
});

test("reset restores the seed floor", () => {
  const gate = createLiveEchoGate();

  for (let index = 0; index < 200; index += 1) {
    gate.decide({ level: 0.1, outputAudible: true, timestampMs: index * 21 });
  }
  const adapted = gate.decide({
    level: 0.2,
    outputAudible: true,
    timestampMs: 5_000,
  });
  assert.equal(adapted.forward, false);

  gate.reset();

  gate.decide({
    level: 0.2,
    outputAudible: true,
    timestampMs: 10_000,
  });
  const decision = gate.decide({
    level: 0.2,
    outputAudible: true,
    timestampMs: 10_021,
  });
  assert.deepEqual(decision, { forward: true, reason: "speech" });
});
