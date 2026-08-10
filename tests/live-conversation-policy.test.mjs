import assert from "node:assert/strict";
import test from "node:test";

import { applyLiveConversationPolicy } from "../app/practice-live/live-conversation-policy.ts";
import { getLiveFamilyAteFollowup } from "../app/practice-live/live-scenarios.ts";

const stockQuestion = {
  teluguInternal: "బాగున్నారా?",
  roman: "baagunnaaraa?",
  pronunciation: "baa-goon-NAA-raa?",
  english: "Are you doing well?",
  sourceLanguage: "telugu",
};

function learner(english, roman = "tinnaanu.") {
  return {
    teluguInternal: "తిన్నాను.",
    roman,
    english,
    sourceLanguage: "english",
  };
}

function policyTurn(learnerTurn, overrides = {}) {
  return {
    scenarioId: "family-check-in",
    relationship: "respectful",
    turn: {
      mayu: stockQuestion,
      learner: learnerTurn,
      replay: false,
      ...overrides,
    },
  };
}

test("turns a bare meal answer into the direct family follow-up", () => {
  for (const english of [
    "I ate.",
    "I have eaten.",
    "Yes, I ate.",
    "Yes, I have already eaten.",
  ]) {
    const result = applyLiveConversationPolicy(policyTurn(learner(english)));
    assert.deepEqual(result.mayu, {
      teluguInternal: getLiveFamilyAteFollowup("respectful").telugu,
      roman: getLiveFamilyAteFollowup("respectful").roman,
      pronunciation: getLiveFamilyAteFollowup("respectful").pronunciation,
      english: getLiveFamilyAteFollowup("respectful").english,
      sourceLanguage: "telugu",
    });
  }

  const close = applyLiveConversationPolicy({
    ...policyTurn(learner("I ate.")),
    relationship: "close",
  });
  assert.deepEqual(close.mayu, {
    teluguInternal: getLiveFamilyAteFollowup("close").telugu,
    roman: getLiveFamilyAteFollowup("close").roman,
    pronunciation: getLiveFamilyAteFollowup("close").pronunciation,
    english: getLiveFamilyAteFollowup("close").english,
    sourceLanguage: "telugu",
  });
});

test("does not flatten distinct meal meanings into the bare-answer branch", () => {
  for (const english of [
    "I ate dosa.",
    "I am full.",
    "I am still hungry.",
    "I did not eat.",
  ]) {
    const input = policyTurn(learner(english));
    assert.equal(applyLiveConversationPolicy(input), input.turn);
  }

  const replay = policyTurn(learner("I ate."), { replay: true });
  assert.equal(applyLiveConversationPolicy(replay), replay.turn);

  const otherScenario = {
    ...policyTurn(learner("I ate.")),
    scenarioId: "at-the-table",
  };
  assert.equal(
    applyLiveConversationPolicy(otherScenario),
    otherScenario.turn,
  );
});
