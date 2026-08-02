import assert from "node:assert/strict";
import test from "node:test";

import {
  gradeLiveSession,
  isLiveSessionGrade,
  scoreLiveResponseTime,
} from "../app/practice-live/live-session-grading.ts";

function learnerTurn(overrides = {}) {
  return {
    id: "learner-turn",
    speaker: "you",
    roman: "nenu baagunnaanu",
    english: "I am well",
    final: true,
    ...overrides,
  };
}

test("returns an honest, actionable empty grade when there are no turns", () => {
  const grade = gradeLiveSession([]);

  assert.deepEqual(grade, {
    averageResponseMs: null,
    assessedTurns: 0,
    overallScore: null,
    pronunciationScore: null,
    accuracyScore: null,
    responseScore: null,
    strongestMetric: null,
    summary: "No learner responses were assessed in this session.",
    nextStep:
      "Complete a learner response in Practice Live to get a focused next step.",
  });
  assert.equal(isLiveSessionGrade(grade), true);
});

test("grades only final learner turns and computes the 40/40/20 aggregate", () => {
  const grade = gradeLiveSession([
    learnerTurn({
      id: "one",
      responseLatencyMs: 3_000,
      assessment: {
        pronunciationScore: 80,
        accuracyScore: 90,
        feedback: "Keep the long vowel steady.",
      },
    }),
    learnerTurn({
      id: "two",
      responseLatencyMs: 5_000,
      assessment: {
        pronunciationScore: 60,
        accuracyScore: 70,
        feedback: "Repeat the second phrase slowly.",
      },
    }),
    learnerTurn({
      id: "pending",
      final: false,
      responseLatencyMs: 0,
      assessment: {
        pronunciationScore: 100,
        accuracyScore: 100,
        feedback: "This pending turn must be ignored.",
      },
    }),
    {
      ...learnerTurn({
        id: "mayu",
        responseLatencyMs: 0,
        assessment: {
          pronunciationScore: 100,
          accuracyScore: 100,
          feedback: "This Mayu turn must be ignored.",
        },
      }),
      speaker: "mayu",
    },
  ]);

  assert.equal(grade.assessedTurns, 2);
  assert.equal(grade.pronunciationScore, 70);
  assert.equal(grade.accuracyScore, 80);
  assert.equal(grade.averageResponseMs, 4_000);
  assert.equal(grade.responseScore, 92);
  assert.equal(grade.overallScore, 78);
  assert.equal(grade.strongestMetric, "response");
});

test("normalizes available weights when English has no pronunciation score", () => {
  const grade = gradeLiveSession([
    learnerTurn({
      sourceLanguage: "english",
      responseLatencyMs: 4_001,
      assessment: {
        pronunciationScore: null,
        accuracyScore: 94,
        feedback: "Try answering with the Telugu phrase next time.",
      },
    }),
  ]);

  assert.equal(grade.pronunciationScore, null);
  assert.equal(grade.accuracyScore, 94);
  assert.equal(grade.responseScore, 82);
  assert.equal(grade.overallScore, 90);
  assert.equal(grade.strongestMetric, "accuracy");
});

test("uses novice-friendly response-time bands at every boundary", () => {
  const cases = [
    [0, 100],
    [2_500, 100],
    [2_501, 92],
    [4_000, 92],
    [4_001, 82],
    [6_000, 82],
    [6_001, 70],
    [9_000, 70],
    [9_001, 55],
    [13_000, 55],
    [13_001, 40],
    [18_000, 40],
    [18_001, 25],
  ];

  for (const [milliseconds, expected] of cases) {
    assert.equal(
      scoreLiveResponseTime(milliseconds),
      expected,
      `${milliseconds}ms`,
    );
  }
  assert.equal(scoreLiveResponseTime(-1), null);
  assert.equal(scoreLiveResponseTime(Number.NaN), null);
  assert.equal(scoreLiveResponseTime(Number.POSITIVE_INFINITY), null);
});

test("takes nextStep from the weakest assessed turn's feedback", () => {
  const grade = gradeLiveSession([
    learnerTurn({
      id: "strong",
      assessment: {
        pronunciationScore: 92,
        accuracyScore: 88,
        feedback: "Keep going.",
      },
    }),
    learnerTurn({
      id: "weak",
      assessment: {
        pronunciationScore: 45,
        accuracyScore: 65,
        feedback: "  Practice the retroflex sound once more.  ",
      },
    }),
    learnerTurn({
      id: "middle",
      assessment: {
        pronunciationScore: null,
        accuracyScore: 70,
        feedback: "Use Telugu instead of English.",
      },
    }),
  ]);

  assert.equal(
    grade.nextStep,
    "Practice the retroflex sound once more.",
  );
});

test("keeps response-only data but does not invent an overall grade", () => {
  const grade = gradeLiveSession([
    learnerTurn({ responseLatencyMs: 2_000 }),
  ]);

  assert.equal(grade.assessedTurns, 0);
  assert.equal(grade.averageResponseMs, 2_000);
  assert.equal(grade.responseScore, 100);
  assert.equal(grade.overallScore, null);
  assert.equal(grade.strongestMetric, null);
  assert.match(grade.nextStep, /Complete a learner response/);
  assert.equal(isLiveSessionGrade(grade), true);
});

test("rounds and clamps all aggregated metric scores to integer 0-100", () => {
  const grade = gradeLiveSession([
    learnerTurn({
      id: "one",
      responseLatencyMs: 1_000.4,
      assessment: {
        pronunciationScore: 101.4,
        accuracyScore: -3,
        feedback: "Review this phrase.",
      },
    }),
    learnerTurn({
      id: "two",
      responseLatencyMs: 1_001.4,
      assessment: {
        pronunciationScore: 80.6,
        accuracyScore: 90.4,
        feedback: "Keep practicing.",
      },
    }),
  ]);

  assert.equal(grade.pronunciationScore, 91);
  assert.equal(grade.accuracyScore, 45);
  assert.equal(grade.averageResponseMs, 1_001);
  assert.equal(grade.responseScore, 100);
  assert.equal(grade.overallScore, 74);
});

test("type guard rejects malformed and internally inconsistent grades", () => {
  const valid = gradeLiveSession([
    learnerTurn({
      assessment: {
        pronunciationScore: 82,
        accuracyScore: 88,
        feedback: "Review the ending.",
      },
    }),
  ]);

  assert.equal(isLiveSessionGrade(valid), true);
  assert.equal(isLiveSessionGrade(null), false);
  assert.equal(isLiveSessionGrade({ ...valid, overallScore: 101 }), false);
  assert.equal(isLiveSessionGrade({ ...valid, accuracyScore: 88.5 }), false);
  assert.equal(isLiveSessionGrade({ ...valid, assessedTurns: -1 }), false);
  assert.equal(
    isLiveSessionGrade({ ...valid, strongestMetric: "fluency" }),
    false,
  );
  assert.equal(
    isLiveSessionGrade({ ...valid, averageResponseMs: 2_000 }),
    false,
    "an average response time must have a response score",
  );
  assert.equal(
    isLiveSessionGrade({
      ...valid,
      overallScore: null,
      pronunciationScore: null,
      accuracyScore: null,
      strongestMetric: "response",
    }),
    false,
  );
});
