import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_ASSESSMENT_CONFIDENCES,
  calibrateLiveLearnerAssessment,
} from "../app/practice-live/live-assessment.ts";

const completeRatings = {
  intelligibility: 4,
  pronunciation: 4,
  meaning: 4,
  form: 4,
  teluguCoverage: null,
};

function assess(overrides = {}) {
  return calibrateLiveLearnerAssessment({
    sourceLanguage: "telugu",
    confidence: "high",
    ratings: completeRatings,
    feedback: "Keep the word ending steady.",
    ...overrides,
  });
}

test("keeps the audio-evidence confidence vocabulary explicit", () => {
  assert.deepEqual(LIVE_ASSESSMENT_CONFIDENCES, ["high", "medium", "low"]);
});

test("maps every 0-4 rubric band to stable product scores", () => {
  const expectedScores = [0, 40, 65, 84, 100];

  for (const [rating, expectedScore] of expectedScores.entries()) {
    const assessment = assess({
      ratings: {
        intelligibility: rating,
        pronunciation: rating,
        meaning: rating,
        form: rating,
        teluguCoverage: null,
      },
    });

    assert.equal(assessment.pronunciationScore, expectedScore, `rating ${rating}`);
    assert.equal(assessment.accuracyScore, expectedScore, `rating ${rating}`);
    assert.equal(assessment.languageScore, expectedScore, `rating ${rating}`);
  }
});

test("calibrates intelligibility and Telugu sound accuracy separately", () => {
  const clearWithInaccurateSounds = assess({
    ratings: { ...completeRatings, pronunciation: 1 },
  });
  const hardToUnderstandWithAccurateSounds = assess({
    ratings: { ...completeRatings, intelligibility: 0 },
  });

  assert.equal(clearWithInaccurateSounds.pronunciationScore, 70);
  assert.equal(hardToUnderstandWithAccurateSounds.pronunciationScore, 35);
  assert.equal(clearWithInaccurateSounds.accuracyScore, 100);
  assert.equal(hardToUnderstandWithAccurateSounds.accuracyScore, 100);
  assert.equal(clearWithInaccurateSounds.languageScore, 85);
  assert.equal(hardToUnderstandWithAccurateSounds.languageScore, 68);
});

test("lowers accuracy for broken form without confusing form with meaning", () => {
  const brokenButCorrect = assess({
    ratings: { ...completeRatings, form: 1 },
  });
  const polishedButOnlyPartlyCorrect = assess({
    ratings: { ...completeRatings, meaning: 2 },
  });

  assert.equal(brokenButCorrect.accuracyScore, 65);
  assert.equal(polishedButOnlyPartlyCorrect.accuracyScore, 72);
  assert.equal(brokenButCorrect.pronunciationScore, 100);
  assert.equal(polishedButOnlyPartlyCorrect.pronunciationScore, 100);
  assert.equal(brokenButCorrect.languageScore, 83);
  assert.equal(polishedButOnlyPartlyCorrect.languageScore, 86);
});

test("keeps one localized sound or form issue below a perfect score", () => {
  const oneSoundIssue = assess({
    ratings: { ...completeRatings, pronunciation: 3 },
  });
  const oneFormIssue = assess({
    ratings: { ...completeRatings, form: 3 },
  });
  const perfect = assess();

  assert.equal(oneSoundIssue.pronunciationScore, 94);
  assert.equal(oneFormIssue.accuracyScore, 94);
  assert.equal(perfect.pronunciationScore, 100);
  assert.equal(perfect.accuracyScore, 100);
  assert.equal(perfect.languageScore, 100);
});

test("scores medium-confidence evidence with the same deterministic rubric", () => {
  const assessment = assess({
    confidence: "medium",
    ratings: {
      intelligibility: 3,
      pronunciation: 2,
      meaning: 4,
      form: 2,
      teluguCoverage: null,
    },
  });

  assert.equal(assessment.confidence, "medium");
  assert.equal(assessment.pronunciationScore, 77);
  assert.equal(assessment.accuracyScore, 82);
  assert.equal(assessment.languageScore, 80);
});

test("caps English conversational credit locally and never invents Telugu pronunciation", () => {
  const fullyCorrectEnglish = assess({
    sourceLanguage: "english",
    ratings: {
      intelligibility: null,
      pronunciation: null,
      meaning: 4,
      form: null,
      teluguCoverage: null,
    },
  });
  const mostlyWrongEnglish = assess({
    sourceLanguage: "english",
    ratings: {
      intelligibility: null,
      pronunciation: null,
      meaning: 1,
      form: null,
      teluguCoverage: null,
    },
  });

  assert.equal(fullyCorrectEnglish.pronunciationScore, null);
  assert.equal(fullyCorrectEnglish.accuracyScore, 50);
  assert.equal(fullyCorrectEnglish.languageScore, 50);
  assert.equal(mostlyWrongEnglish.pronunciationScore, null);
  assert.equal(mostlyWrongEnglish.accuracyScore, 40);
  assert.equal(mostlyWrongEnglish.languageScore, 40);
});

test("caps mixed replies by how much Telugu the learner actually spoke", () => {
  const mostlyEnglish = assess({
    sourceLanguage: "mixed",
    ratings: {
      intelligibility: 4,
      pronunciation: 4,
      meaning: 4,
      form: 4,
      teluguCoverage: 1,
    },
  });
  const mostlyTelugu = assess({
    sourceLanguage: "mixed",
    ratings: {
      intelligibility: 4,
      pronunciation: 4,
      meaning: 4,
      form: 4,
      teluguCoverage: 3,
    },
  });

  assert.equal(mostlyEnglish.pronunciationScore, 100);
  assert.equal(mostlyEnglish.accuracyScore, 50);
  assert.equal(mostlyEnglish.languageScore, 50);
  assert.equal(mostlyTelugu.accuracyScore, 85);
  assert.equal(mostlyTelugu.languageScore, 85);
});

test("abstains completely when audio confidence is low", () => {
  const attemptedRatings = {
    intelligibility: 4,
    pronunciation: 4,
    meaning: 4,
    form: 4,
    teluguCoverage: null,
  };
  const assessment = assess({ confidence: "low", ratings: attemptedRatings });

  assert.deepEqual(assessment, {
    pronunciationScore: null,
    accuracyScore: null,
    languageScore: null,
    confidence: "low",
    ratings: {
      intelligibility: null,
      pronunciation: null,
      meaning: null,
      form: null,
      teluguCoverage: null,
    },
    feedback: "Keep the word ending steady.",
  });
});
