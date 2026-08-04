import assert from "node:assert/strict";
import test from "node:test";

import {
  describeLiveScoreProgress,
  isComparableLiveSession,
} from "../app/practice-live/live-session-comparison.ts";

function session(overrides = {}) {
  return {
    id: "current",
    scenarioId: "family-check-in",
    familyVoice: "grandma",
    voiceMode: "gemini",
    relationship: "respectful",
    sessionLimitSeconds: 60,
    grade: { rubricVersion: 2, overallScore: 80 },
    ...overrides,
  };
}

test("compares only the same setup and grading rubric", () => {
  const current = session();
  assert.equal(
    isComparableLiveSession(current, session({ id: "previous" })),
    true,
  );
  assert.equal(
    isComparableLiveSession(current, session({ id: "previous", sessionLimitSeconds: 120 })),
    false,
  );
  assert.equal(
    isComparableLiveSession(
      current,
      session({ id: "legacy", grade: { overallScore: 80 } }),
    ),
    false,
  );
  assert.equal(isComparableLiveSession(current, current), false);
  assert.equal(
    isComparableLiveSession(
      current,
      session({ id: "unscored", grade: { rubricVersion: 2, overallScore: null } }),
    ),
    false,
  );
});

test("treats small score movement as the same coaching range", () => {
  assert.match(describeLiveScoreProgress(80, null), /Baseline saved/);
  assert.match(describeLiveScoreProgress(80, 76), /same range/);
  assert.match(describeLiveScoreProgress(80, 84), /same range/);
  assert.equal(
    describeLiveScoreProgress(85, 80),
    "Up 5 points from your last matching practice.",
  );
  assert.equal(
    describeLiveScoreProgress(75, 80),
    "Today: 75. Last matching practice: 80.",
  );
});
