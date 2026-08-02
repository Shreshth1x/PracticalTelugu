import assert from "node:assert/strict";
import test from "node:test";

import {
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveTurnToolCall,
} from "../app/practice-live/live-transcript.ts";

const reviewedCue = {
  telugu: "తిన్నావా?",
  roman: "tinnaavaa?",
  pronunciation: "tin-NAA-vaa?",
  english: "have you eaten?",
};

const completeToolCall = {
  mayuTeluguInternal: "తిన్నావా?",
  mayuRoman: "tinnaavaa?",
  mayuPronunciation: "tin-NAA-vaa?",
  mayuEnglish: "Have you eaten?",
  cueId: "have-you-eaten__primary",
  learnerTeluguInternal: "తిన్నాను.",
  learnerRoman: "tinnaanu.",
  learnerPronunciation: "tin-NAA-noo.",
  learnerEnglish: "I ate.",
  learnerSourceLanguage: "telugu",
  learnerPronunciationRating: 3,
  learnerAccuracyRating: 4,
  learnerFeedback: "Hold the long aa sound in tinnaanu.",
};

test("retains native Telugu for internal validation without adding it to visible captions", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);

  assert.equal(parsed?.mayu.teluguInternal, "తిన్నావా?");
  assert.equal(parsed?.learner?.teluguInternal, "తిన్నాను.");
  assert.equal(parsed?.learner?.sourceLanguage, "telugu");
  assert.deepEqual(parsed?.learner?.assessment, {
    pronunciationScore: 75,
    accuracyScore: 100,
    feedback: "Hold the long aa sound in tinnaanu.",
  });
});

test("requires complete learner captions, ratings, and coaching feedback", () => {
  const learnerFields = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerPronunciationRating",
    "learnerAccuracyRating",
    "learnerFeedback",
  ];

  for (const missingField of learnerFields) {
    const adversarial = { ...completeToolCall };
    delete adversarial[missingField];
    assert.equal(
      parseLiveTurnToolCall(adversarial),
      null,
      `accepted learner caption without ${missingField}`,
    );
  }

  assert.equal(
    parseLiveTurnToolCall({
      mayuTeluguInternal: completeToolCall.mayuTeluguInternal,
      mayuRoman: completeToolCall.mayuRoman,
      mayuPronunciation: completeToolCall.mayuPronunciation,
      mayuEnglish: completeToolCall.mayuEnglish,
      learnerSourceLanguage: "telugu",
    }),
    null,
  );
  assert.equal(
    parseLiveTurnToolCall({
      ...completeToolCall,
      learnerSourceLanguage: "unknown",
    }),
    null,
  );
  assert.equal(
    parseLiveTurnToolCall({
      ...completeToolCall,
      learnerPronunciationRating: 5,
    }),
    null,
  );
  assert.equal(
    parseLiveTurnToolCall({
      ...completeToolCall,
      learnerFeedback: "తెలుగు script must stay private.",
    }),
    null,
  );
});

test("omits pronunciation only for an entirely English learner reply", () => {
  const englishReply = { ...completeToolCall };
  delete englishReply.learnerPronunciationRating;
  englishReply.learnerSourceLanguage = "english";
  englishReply.learnerAccuracyRating = 2;

  const parsed = parseLiveTurnToolCall(englishReply);
  assert.equal(parsed?.learner?.assessment.pronunciationScore, null);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 50);
});

test("rejects a malformed cueId instead of silently treating it as omitted", () => {
  assert.equal(
    parseLiveTurnToolCall({
      mayuTeluguInternal: completeToolCall.mayuTeluguInternal,
      mayuRoman: completeToolCall.mayuRoman,
      mayuPronunciation: completeToolCall.mayuPronunciation,
      mayuEnglish: completeToolCall.mayuEnglish,
      cueId: 17,
    }),
    null,
  );
});

test("accepts a cueId only when all four normalized reviewed fields match exactly", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);
  assert.ok(parsed);
  assert.equal(matchesReviewedLiveCue(parsed.mayu, reviewedCue), true);

  const adversarialSubstitutions = {
    teluguInternal: "తిన్నారా?",
    roman: "tinnaaraa?",
    pronunciation: "tin-NAA-raa?",
    english: "Did you eat already?",
  };

  for (const [field, value] of Object.entries(adversarialSubstitutions)) {
    assert.equal(
      matchesReviewedLiveCue({ ...parsed.mayu, [field]: value }, reviewedCue),
      false,
      `accepted a cue whose ${field} did not match`,
    );
  }

  assert.equal(
    matchesReviewedLiveCue(
      {
        ...parsed.mayu,
        roman: "  TINNAAVAA!  ",
        pronunciation: "tin NAA vaa",
        english: "HAVE YOU EATEN!",
      },
      reviewedCue,
    ),
    true,
  );
  assert.equal(
    matchesReviewedLiveCue(
      { ...parsed.mayu, roman: "tinnaavaa ippudu?" },
      reviewedCue,
    ),
    false,
  );
});

test("blocks copied-English fillers from Mayu's audible Telugu", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);
  assert.ok(parsed);
  assert.equal(hasForbiddenAudibleEnglish(parsed.mayu), false);

  for (const turn of [
    { teluguInternal: "ఓ, అవునా?", roman: "oh, avunnaa?" },
    { teluguInternal: "ఓకే, చెప్తాను.", roman: "okay, cheptaanu." },
    { teluguInternal: "సారీ, మళ్లీ చెప్పండి.", roman: "sorry, malli cheppandi." },
  ]) {
    assert.equal(hasForbiddenAudibleEnglish(turn), true);
  }
});

test("rejects the known pasi-for-hunger learner caption mistake", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);
  assert.ok(parsed?.learner);
  assert.equal(hasKnownLearnerMeaningMismatch(parsed.learner), false);

  assert.equal(
    hasKnownLearnerMeaningMismatch({
      ...parsed.learner,
      teluguInternal: "నాకు ఇంకా కొంచెం పసిగా ఉంది.",
      roman: "naaku inkaa koncham pasigaa undi.",
      english: "I am still a little hungry.",
    }),
    true,
  );
  assert.equal(
    hasKnownLearnerMeaningMismatch({
      ...parsed.learner,
      teluguInternal: "నాకు ఇంకా ఆకలిగా ఉంది.",
      roman: "naaku inkaa aakaligaa undi.",
      english: "I am still hungry.",
    }),
    false,
  );
});

test("rejects provider mistakes in the high-confidence hunger follow-up", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);
  assert.ok(parsed);

  assert.equal(
    hasKnownMayuMeaningMismatch({
      ...parsed.mayu,
      teluguInternal: "అవున్నా? మీరు ఏమీ తింటారా?",
      roman: "avunnaa? meeru emee tintaaraa?",
      english: "What would you like to eat?",
    }),
    true,
  );
  assert.equal(
    hasKnownMayuMeaningMismatch({
      ...parsed.mayu,
      teluguInternal: "అవునా? ఇంకా ఏమైనా తింటారా?",
      roman: "avunaa? inkaa emainaa tintaaraa?",
      english: "Would you like to eat anything else?",
    }),
    false,
  );
});

test("keeps the hunger follow-up in the locked listener relationship", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);
  assert.ok(parsed);
  const closeTurn = {
    ...parsed.mayu,
    teluguInternal: "అవునా? ఇంకా ఏమైనా తింటావా?",
    roman: "avunaa? inkaa emainaa tintaavaa?",
    english: "Would you like to eat anything else?",
  };
  const respectfulTurn = {
    ...parsed.mayu,
    teluguInternal: "అవునా? ఇంకా ఏమైనా తింటారా?",
    roman: "avunaa? inkaa emainaa tintaaraa?",
    english: "Would you like to eat anything else?",
  };

  assert.equal(hasKnownMayuRelationshipMismatch(closeTurn, "close"), false);
  assert.equal(
    hasKnownMayuRelationshipMismatch(closeTurn, "respectful"),
    true,
  );
  assert.equal(
    hasKnownMayuRelationshipMismatch(respectfulTurn, "respectful"),
    false,
  );
  assert.equal(hasKnownMayuRelationshipMismatch(respectfulTurn, "close"), true);
});
