import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { describeLiveSessionCompletion } from "../app/practice-live/live-session-completion.ts";

function evidence(overrides = {}) {
  return {
    learnerTurns: 2,
    grade: {
      assessedTurns: 2,
      unscoredTurns: 0,
      strongestMetric: "accuracy",
      summary: "Good progress. Accuracy was your strongest area.",
    },
    ...overrides,
  };
}

test("does not claim progress when the practice ends before a reply", () => {
  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 0,
        grade: {
          assessedTurns: 0,
          unscoredTurns: 0,
          strongestMetric: null,
          summary: "No learner responses were assessed in this session.",
        },
      }),
    ),
    {
      headline: "This practice ended before your first reply.",
      subcopy: "No learner response was captured, so there was nothing to score.",
    },
  );
});

test("reports one captured but unscored reply without inventing success", () => {
  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 1,
        grade: {
          assessedTurns: 0,
          unscoredTurns: 1,
          strongestMetric: null,
          summary: "No learner responses were assessed in this session.",
        },
      }),
    ),
    {
      headline: "Your reply was captured.",
      subcopy: "It could not be scored reliably this time.",
    },
  );
});

test("reports multiple captured but unscored replies truthfully", () => {
  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 3,
        grade: {
          assessedTurns: 0,
          unscoredTurns: 3,
          strongestMetric: null,
          summary: "No learner responses were assessed in this session.",
        },
      }),
    ),
    {
      headline: "3 replies were captured.",
      subcopy: "They could not be scored reliably this time.",
    },
  );
});

test("uses the score-specific grade summary once all replies are scored", () => {
  assert.deepEqual(describeLiveSessionCompletion(evidence()), {
    headline: "Good progress. Accuracy was your strongest area.",
    subcopy: "Both replies were scored in this conversation.",
  });
});

test("reports partial scoring with singular and plural agreement", () => {
  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 3,
        grade: {
          assessedTurns: 1,
          unscoredTurns: 2,
          strongestMetric: "pronunciation",
          summary: "Strong session. Pronunciation was your strongest area.",
        },
      }),
    ),
    {
      headline: "One reply had enough reliable evidence to score.",
      subcopy:
        "Pronunciation was strongest in that reply. 2 replies were left unscored.",
    },
  );

  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 3,
        grade: {
          assessedTurns: 2,
          unscoredTurns: 1,
          strongestMetric: "accuracy",
          summary: "Good progress. Accuracy was your strongest area.",
        },
      }),
    ),
    {
      headline: "2 replies had enough reliable evidence to score.",
      subcopy:
        "Accuracy was strongest in those replies. 1 reply was left unscored.",
    },
  );
});

test("falls back to the session reply count for a legacy grade", () => {
  assert.deepEqual(
    describeLiveSessionCompletion(
      evidence({
        learnerTurns: 2,
        grade: {
          assessedTurns: 1,
          strongestMetric: "accuracy",
          summary: "You are building consistency. Accuracy was your strongest area.",
        },
      }),
    ),
    {
      headline: "One reply had enough reliable evidence to score.",
      subcopy:
        "Accuracy was strongest in that reply. 1 reply was left unscored.",
    },
  );
});

test("renders evidence-based completion copy instead of the old fixed headline", async () => {
  const source = await readFile(
    new URL("../app/practice-live/PracticeLive.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /describeLiveSessionCompletion/);
  assert.match(source, /\{completionCopy\.headline\}/);
  assert.match(source, /\{completionCopy\.subcopy\}/);
  assert.doesNotMatch(source, /You kept the conversation going\./);
  assert.doesNotMatch(source, /title: "Nice work"/);
  assert.doesNotMatch(source, /<p>\{grade\.summary\}<\/p>/);
});
