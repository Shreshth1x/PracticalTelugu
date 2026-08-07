import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnscoredLiveLearnerCaption,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveMayuTurnToolCall,
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
  learnerAssessmentConfidence: "high",
  learnerIntelligibilityRating: 4,
  learnerPronunciationRating: 3,
  learnerMeaningRating: 4,
  learnerFormRating: 4,
  learnerFeedback: "Hold the long aa sound in tinnaanu.",
};

test("retains native Telugu for internal validation without adding it to visible captions", () => {
  const parsed = parseLiveTurnToolCall(completeToolCall);

  assert.equal(parsed?.mayu.teluguInternal, "తిన్నావా?");
  assert.equal(parsed?.learner?.teluguInternal, "తిన్నాను.");
  assert.equal(parsed?.learner?.sourceLanguage, "telugu");
  assert.deepEqual(parsed?.learner?.assessment, {
    pronunciationScore: 94,
    accuracyScore: 100,
    languageScore: 97,
    confidence: "high",
    ratings: {
      intelligibility: 4,
      pronunciation: 3,
      meaning: 4,
      form: 4,
      teluguCoverage: null,
    },
    feedback: "Hold the long aa sound in tinnaanu.",
  });
});

test("requires complete judgeable Telugu captions, ratings, and coaching feedback", () => {
  const learnerFields = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerAssessmentConfidence",
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerMeaningRating",
    "learnerFormRating",
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
  for (const learnerAssessmentConfidence of [undefined, "uncertain", 1]) {
    assert.equal(
      parseLiveTurnToolCall({
        ...completeToolCall,
        learnerAssessmentConfidence,
      }),
      null,
      `accepted confidence ${String(learnerAssessmentConfidence)}`,
    );
  }

  const ratingFields = [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerMeaningRating",
    "learnerFormRating",
  ];
  for (const ratingField of ratingFields) {
    for (const invalidRating of [-1, 5, 2.5, "4", null, Number.NaN]) {
      assert.equal(
        parseLiveTurnToolCall({
          ...completeToolCall,
          [ratingField]: invalidRating,
        }),
        null,
        `accepted ${ratingField}=${String(invalidRating)}`,
      );
    }
  }
  assert.equal(
    parseLiveTurnToolCall({
      ...completeToolCall,
      learnerTeluguCoverageRating: 4,
    }),
    null,
    "an entirely Telugu reply must not include a mixed-language coverage rating",
  );
  for (const deprecatedOrUnknownField of [
    "learnerAccuracyRating",
    "learnerAccentRating",
    "unexpectedField",
  ]) {
    assert.equal(
      parseLiveTurnToolCall({
        ...completeToolCall,
        [deprecatedOrUnknownField]: 4,
      }),
      null,
      `accepted unknown field ${deprecatedOrUnknownField}`,
    );
  }
  assert.equal(
    parseLiveTurnToolCall({
      ...completeToolCall,
      learnerFeedback: "తెలుగు script must stay private.",
    }),
    null,
  );
});

test("keeps a valid Mayu response usable when optional learner coaching is malformed", () => {
  const missingLearnerPronunciation = { ...completeToolCall };
  delete missingLearnerPronunciation.learnerPronunciation;

  assert.equal(
    parseLiveTurnToolCall(missingLearnerPronunciation),
    null,
    "incomplete coaching must never be treated as an authoritative grade",
  );

  const mayuTurn = parseLiveMayuTurnToolCall({
    ...missingLearnerPronunciation,
    unexpectedLearnerMetadata: "ignored",
  });
  assert.deepEqual(mayuTurn, {
    mayu: {
      teluguInternal: "తిన్నావా?",
      roman: "tinnaavaa?",
      pronunciation: "tin-NAA-vaa?",
      english: "Have you eaten?",
      cueId: "have-you-eaten__primary",
      sourceLanguage: "telugu",
    },
    replay: false,
  });

  assert.deepEqual(
    createUnscoredLiveLearnerCaption(
      "Keep the conversation going and try the next reply naturally.",
      "incomplete-assessment",
    ),
    {
      teluguInternal: "",
      roman: "Reply received",
      english: "Your reply was heard, but this turn was not scored.",
      assessment: {
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
        feedback:
          "Keep the conversation going and try the next reply naturally.",
      },
    },
  );
});

test("accepts all four ratings with medium-confidence Telugu audio", () => {
  const parsed = parseLiveTurnToolCall({
    ...completeToolCall,
    learnerAssessmentConfidence: "medium",
  });

  assert.equal(parsed?.learner?.assessment.confidence, "medium");
  assert.equal(parsed?.learner?.assessment.pronunciationScore, 94);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 100);
  assert.equal(parsed?.learner?.assessment.languageScore, 97);
});

test("requires only meaning and locally caps an entirely English reply", () => {
  const englishReply = { ...completeToolCall };
  delete englishReply.learnerIntelligibilityRating;
  delete englishReply.learnerPronunciationRating;
  delete englishReply.learnerFormRating;
  englishReply.learnerSourceLanguage = "english";
  englishReply.learnerMeaningRating = 4;

  const parsed = parseLiveTurnToolCall(englishReply);
  assert.equal(parsed?.learner?.assessment.pronunciationScore, null);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 50);
  assert.equal(parsed?.learner?.assessment.languageScore, 50);
  assert.deepEqual(parsed?.learner?.assessment.ratings, {
    intelligibility: null,
    pronunciation: null,
    meaning: 4,
    form: null,
    teluguCoverage: null,
  });

  for (const requiredField of [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerAssessmentConfidence",
    "learnerMeaningRating",
    "learnerFeedback",
  ]) {
    const missingField = { ...englishReply };
    delete missingField[requiredField];
    assert.equal(
      parseLiveTurnToolCall(missingField),
      null,
      `an English reply must require ${requiredField}`,
    );
  }

  for (const prohibitedRating of [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerFormRating",
    "learnerTeluguCoverageRating",
  ]) {
    assert.equal(
      parseLiveTurnToolCall({
        ...englishReply,
        [prohibitedRating]: 4,
      }),
      null,
      `an English reply must reject ${prohibitedRating}`,
    );
  }

  delete englishReply.learnerMeaningRating;
  assert.equal(parseLiveTurnToolCall(englishReply), null);
});

test("requires all four quality ratings plus Telugu coverage for mixed audio", () => {
  const mixedReply = {
    ...completeToolCall,
    learnerSourceLanguage: "mixed",
    learnerTeluguCoverageRating: 2,
  };
  const parsed = parseLiveTurnToolCall(mixedReply);

  assert.equal(parsed?.learner?.assessment.pronunciationScore, 94);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 70);
  assert.equal(parsed?.learner?.assessment.languageScore, 70);
  assert.equal(parsed?.learner?.assessment.ratings.teluguCoverage, 2);

  for (const requiredRating of [
    "learnerIntelligibilityRating",
    "learnerPronunciationRating",
    "learnerMeaningRating",
    "learnerFormRating",
  ]) {
    const missingRating = { ...mixedReply };
    delete missingRating[requiredRating];
    assert.equal(
      parseLiveTurnToolCall(missingRating),
      null,
      `mixed audio must require ${requiredRating}`,
    );
  }

  delete mixedReply.learnerTeluguCoverageRating;
  assert.equal(parseLiveTurnToolCall(mixedReply), null);

  assert.equal(
    parseLiveTurnToolCall({
      ...mixedReply,
      learnerTeluguCoverageRating: 0,
    }),
    null,
    "zero Telugu coverage must use the English source contract",
  );

  for (const invalidRating of [-1, 5, 2.5, "2", null, Number.NaN]) {
    assert.equal(
      parseLiveTurnToolCall({
        ...mixedReply,
        learnerTeluguCoverageRating: invalidRating,
      }),
      null,
      `accepted learnerTeluguCoverageRating=${String(invalidRating)}`,
    );
  }
});

test("accepts only a captionless abstention when audio confidence is low", () => {
  const lowConfidenceReply = {
    mayuTeluguInternal: completeToolCall.mayuTeluguInternal,
    mayuRoman: completeToolCall.mayuRoman,
    mayuPronunciation: completeToolCall.mayuPronunciation,
    mayuEnglish: completeToolCall.mayuEnglish,
    learnerAssessmentConfidence: "low",
    learnerFeedback: "Please repeat once at a comfortable volume.",
  };

  const parsed = parseLiveTurnToolCall(lowConfidenceReply);
  assert.deepEqual(parsed?.learner, {
    teluguInternal: "",
    roman: "Audio unclear",
    english: "This reply was not scored. Please try it once more.",
    assessment: {
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
      feedback: "Please repeat once at a comfortable volume.",
    },
  });
  assert.deepEqual(parsed?.learner?.assessment, {
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
    feedback: "Please repeat once at a comfortable volume.",
  });

  const forbiddenLowConfidenceFields = {
    learnerTeluguInternal: "తిన్నాను.",
    learnerRoman: "tinnaanu.",
    learnerPronunciation: "tin-NAA-noo.",
    learnerEnglish: "I ate.",
    learnerSourceLanguage: "telugu",
    learnerIntelligibilityRating: 4,
    learnerPronunciationRating: 4,
    learnerMeaningRating: 4,
    learnerFormRating: 4,
    learnerTeluguCoverageRating: 4,
  };
  for (const [field, value] of Object.entries(forbiddenLowConfidenceFields)) {
    assert.equal(
      parseLiveTurnToolCall({ ...lowConfidenceReply, [field]: value }),
      null,
      `a low-confidence reply must reject ${field}`,
    );
  }
  assert.equal(
    parseLiveTurnToolCall({
      ...lowConfidenceReply,
      learnerAccuracyRating: 4,
    }),
    null,
    "a low-confidence reply must reject deprecated learner ratings",
  );

  const missingFeedback = { ...lowConfidenceReply };
  delete missingFeedback.learnerFeedback;
  assert.equal(parseLiveTurnToolCall(missingFeedback), null);
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
