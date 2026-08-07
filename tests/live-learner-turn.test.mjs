import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceLearnerTurn,
  createLearnerTurnState,
  learnerActivityEventFromSignal,
  learnerCaptionRequired,
} from "../app/practice-live/live-learner-turn.ts";

function run(events) {
  let state = createLearnerTurnState();
  let pendingRows = 0;
  let countedTurns = 0;
  let appliedLearnerCaptions = 0;
  const transitions = [];

  for (const event of events) {
    const transition = advanceLearnerTurn(state, event);
    state = transition.state;
    if (transition.effects.beginPendingCaption) pendingRows += 1;
    if (transition.effects.countLearnerTurn) countedTurns += 1;
    if (transition.effects.applyLearnerCaption) {
      appliedLearnerCaptions += 1;
    }
    transitions.push(transition);
  }

  return {
    state,
    pendingRows,
    countedTurns,
    appliedLearnerCaptions,
    transitions,
  };
}

test("maps both Gemini activity signal shapes to learner-turn boundaries", () => {
  assert.deepEqual(
    learnerActivityEventFromSignal("ACTIVITY_START", undefined),
    { type: "activity-start" },
  );
  assert.deepEqual(
    learnerActivityEventFromSignal(undefined, "VAD_SIGNAL_TYPE_SOS"),
    { type: "activity-start" },
  );
  assert.deepEqual(
    learnerActivityEventFromSignal("ACTIVITY_END", undefined),
    { type: "activity-end" },
  );
  assert.deepEqual(
    learnerActivityEventFromSignal(undefined, "VAD_SIGNAL_TYPE_EOS"),
    { type: "activity-end" },
  );
});

test("tool-before-final captions and counts one VAD epoch exactly once", () => {
  const result = run([
    { type: "activity-start" },
    { type: "learner-caption" },
    { type: "interim-transcription" },
    { type: "final-transcription", text: "nenu baagunnaanu" },
  ]);

  assert.equal(result.pendingRows, 1);
  assert.equal(result.appliedLearnerCaptions, 1);
  assert.equal(result.countedTurns, 1);
  assert.equal(result.state.currentEpoch.id, 1);
  assert.equal(result.state.currentEpoch.captioned, true);
  assert.equal(result.state.currentEpoch.finalText, "nenu baagunnaanu");
  assert.equal(
    result.transitions[2].effects.beginPendingCaption,
    false,
    "late interim transcription cannot reopen the settled learner row",
  );
  assert.equal(
    result.transitions[3].effects.countLearnerTurn,
    false,
    "late final transcription cannot double-count the epoch",
  );
});

test("final-before-tool fills the pending row without double-counting", () => {
  const result = run([
    { type: "activity-start" },
    { type: "final-transcription", text: "avunu" },
    { type: "learner-caption" },
  ]);

  assert.equal(result.pendingRows, 1);
  assert.equal(result.appliedLearnerCaptions, 1);
  assert.equal(result.countedTurns, 1);
  assert.equal(result.state.currentEpoch.id, 1);
  assert.equal(result.state.currentEpoch.captioned, true);
  assert.equal(result.transitions[2].effects.countLearnerTurn, false);
});

test("model-audio-before-final remains in one epoch and one count", () => {
  const result = run([
    { type: "activity-start" },
    { type: "model-output" },
    { type: "final-transcription", text: "sare" },
    { type: "learner-caption" },
  ]);

  assert.equal(result.pendingRows, 1);
  assert.equal(result.appliedLearnerCaptions, 1);
  assert.equal(result.countedTurns, 1);
  assert.equal(result.state.currentEpoch.id, 1);
  assert.equal(result.transitions[1].state.currentEpoch.modelOutputSeen, true);
  assert.equal(result.state.currentEpoch.modelOutputSeen, true);
  assert.equal(
    result.state.currentEpoch.modelBoundaryAfterCaption,
    false,
    "pre-caption model output cannot become a post-caption exchange boundary",
  );
  assert.equal(
    result.transitions[2].effects.startLatencyClock,
    false,
    "late transcription must not start a clock for the next model turn",
  );
});

test("deduplicates a retried caption but accepts the next tool-only learner reply", () => {
  const result = run([
    { type: "activity-start" },
    { type: "model-output" },
    { type: "final-transcription", text: "nenu baagunnaanu" },
    { type: "learner-caption" },
    { type: "learner-caption" },
    { type: "model-turn-complete" },
    { type: "learner-caption" },
  ]);

  assert.equal(result.pendingRows, 1);
  assert.equal(result.appliedLearnerCaptions, 2);
  assert.equal(result.countedTurns, 2);
  assert.equal(
    result.transitions[4].state.currentEpoch.id,
    1,
    "model output observed before the accepted caption cannot make its retry a new exchange",
  );
  assert.equal(
    result.transitions[4].effects.applyLearnerCaption,
    false,
    "a provider retry cannot create another transcript row",
  );
  assert.equal(
    result.transitions[4].effects.countLearnerTurn,
    false,
    "a provider retry cannot increment the learner turn count",
  );
  assert.equal(
    result.transitions[6].effects.applyLearnerCaption,
    true,
    "a caption after a new post-acceptance model boundary is a genuine next tool-only reply",
  );
  assert.equal(result.state.currentEpoch.id, 2);
  assert.equal(result.state.currentEpoch.captioned, true);
});

test("requires response captions while permitting opening, replay, and closing control", () => {
  let state = createLearnerTurnState();
  assert.equal(learnerCaptionRequired(state), false, "opening turn");

  state = advanceLearnerTurn(state, {
    type: "mayu-turn-presented",
    expectsReply: true,
  }).state;
  assert.equal(learnerCaptionRequired(state), true, "user-response turn");
  assert.equal(learnerCaptionRequired(state, true), false, "replay turn");

  state = advanceLearnerTurn(state, {
    type: "control-turn-requested",
  }).state;
  assert.equal(learnerCaptionRequired(state), false, "closing control turn");

  state = advanceLearnerTurn(state, { type: "activity-start" }).state;
  assert.equal(
    learnerCaptionRequired(state),
    true,
    "a real response still needs a caption even during closing control",
  );

  state = advanceLearnerTurn(state, { type: "learner-caption" }).state;
  assert.equal(learnerCaptionRequired(state), false);
});
