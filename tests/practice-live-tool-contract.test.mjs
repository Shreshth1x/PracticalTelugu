import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveLearnerTranscriptFallback,
  createUnscoredLiveLearnerCaption,
  finalizeLiveTranscriptForEnd,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveLearnerAssessment,
  parseLiveLearnerCaption,
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

const nullLearnerFields = {
  learnerTeluguInternal: null,
  learnerRoman: null,
  learnerPronunciation: null,
  learnerEnglish: null,
  learnerSourceLanguage: null,
  learnerAssessmentConfidence: null,
  learnerIntelligibilityRating: null,
  learnerPronunciationRating: null,
  learnerMeaningRating: null,
  learnerFormRating: null,
  learnerTeluguCoverageRating: null,
  learnerFeedback: null,
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

test("treats the required all-null learner contract as an opening turn", () => {
  const parsed = parseLiveTurnToolCall({
    mayuTeluguInternal: completeToolCall.mayuTeluguInternal,
    mayuRoman: completeToolCall.mayuRoman,
    mayuPronunciation: completeToolCall.mayuPronunciation,
    mayuEnglish: completeToolCall.mayuEnglish,
    ...nullLearnerFields,
  });

  assert.equal(parsed?.learner, null);
});

test("requires safe core captions and independently preserves valid score dimensions", () => {
  const learnerFields = [
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerAssessmentConfidence",
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

  for (const [missingField, missingMetric, preservedMetric] of [
    ["learnerIntelligibilityRating", "pronunciationScore", "accuracyScore"],
    ["learnerPronunciationRating", "pronunciationScore", "accuracyScore"],
    ["learnerMeaningRating", "accuracyScore", "pronunciationScore"],
    ["learnerFormRating", "accuracyScore", "pronunciationScore"],
  ]) {
    const partial = { ...completeToolCall };
    delete partial[missingField];
    const parsed = parseLiveTurnToolCall(partial);
    assert.equal(parsed?.learner?.assessment[missingMetric], null);
    assert.notEqual(parsed?.learner?.assessment[preservedMetric], null);
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
    for (const invalidRating of [-1, 5, 2.5, "4", Number.NaN]) {
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
    })?.learner?.assessment.feedback,
    "Keep the conversation going and try the next reply naturally.",
    "unsafe optional coaching is replaced locally instead of erasing scores",
  );
});

test("keeps transcript and scores when the optional pronunciation guide is missing", () => {
  const missingLearnerPronunciation = { ...completeToolCall };
  delete missingLearnerPronunciation.learnerPronunciation;

  const recovered = parseLiveTurnToolCall(missingLearnerPronunciation);
  assert.equal(recovered?.learner?.roman, "tinnaanu.");
  assert.equal(recovered?.learner?.pronunciation, undefined);
  assert.equal(recovered?.learner?.assessment.pronunciationScore, 94);
  assert.equal(recovered?.learner?.assessment.accuracyScore, 100);
  assert.equal(
    parseLiveLearnerCaption(missingLearnerPronunciation)?.roman,
    "tinnaanu.",
  );
  assert.equal(
    parseLiveLearnerAssessment(missingLearnerPronunciation)?.languageScore,
    97,
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

  assert.deepEqual(
    createLiveLearnerTranscriptFallback("నీళ్లు ఇస్తారా?"),
    {
      teluguInternal: "",
      roman: "neellu istaaraa?",
      english:
        "Automatic transcript from your microphone; English meaning unavailable.",
    },
  );
});

test("preserves the exact natural Telugu payload observed in live audio", () => {
  const parsed = parseLiveTurnToolCall({
    mayuTeluguInternal: "ఇగోండి నీళ్లు. ఇంకేమైనా కావాలా?",
    mayuRoman: "eegodee neellu. inkaymainaa kaavaalaa?",
    mayuPronunciation: "EE-go-DEE NEEL-loo. in-KAY-my-NAA KAA-vaa-LAA?",
    mayuEnglish: "Here is water. Do you want anything else?",
    learnerTeluguInternal: "నీళ్లు ఇస్తారా?",
    learnerRoman: "neellu istaaraa?",
    learnerPronunciation: null,
    learnerEnglish: "Will you give water?",
    learnerSourceLanguage: "telugu",
    learnerAssessmentConfidence: "high",
    learnerIntelligibilityRating: 4,
    learnerPronunciationRating: 4,
    learnerMeaningRating: 4,
    learnerFormRating: 4,
    learnerTeluguCoverageRating: null,
    learnerFeedback:
      "Good question! Try asking for water with neellu kaavaali next time.",
  });

  assert.equal(parsed?.learner?.roman, "neellu istaaraa?");
  assert.equal(parsed?.learner?.pronunciation, undefined);
  assert.equal(parsed?.learner?.assessment.pronunciationScore, 100);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 100);
  assert.equal(parsed?.learner?.assessment.languageScore, 100);
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

test("keeps valid ratings scored when learner feedback is explicitly null", () => {
  const parsed = parseLiveTurnToolCall({
    ...completeToolCall,
    learnerFeedback: null,
  });

  assert.equal(parsed?.learner?.assessment.pronunciationScore, 94);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 100);
  assert.equal(parsed?.learner?.assessment.languageScore, 97);
  assert.equal(
    parsed?.learner?.assessment.feedback,
    "Keep the conversation going and try the next reply naturally.",
    "nullable optional coaching must use the deterministic local fallback",
  );
});

test("finalizes pending ASR as a visible unscored learner row at session end", () => {
  const finalized = finalizeLiveTranscriptForEnd([
    {
      id: "you-pending",
      speaker: "you",
      roman: "",
      provisionalRoman: "nenu baagunnaanu",
      english: "",
      final: false,
    },
  ]);

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].id, "you-pending");
  assert.equal(finalized[0].speaker, "you");
  assert.equal(finalized[0].final, true);
  assert.equal(finalized[0].roman, "nenu baagunnaanu");
  assert.equal(
    finalized[0].english,
    "Automatic transcript from your microphone; English meaning unavailable.",
  );
  assert.equal(finalized[0].provisionalRoman, undefined);
  assert.deepEqual(finalized[0].assessment, {
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
    feedback: "The session ended before this reply could be assessed.",
  });

  assert.deepEqual(
    finalizeLiveTranscriptForEnd([
      {
        id: "you-empty",
        speaker: "you",
        roman: "",
        english: "",
        final: false,
      },
    ]),
    [],
    "an empty pending placeholder still disappears at session end",
  );
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
    "learnerEnglish",
    "learnerSourceLanguage",
    "learnerAssessmentConfidence",
    "learnerMeaningRating",
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

test("keeps safe partial mixed scores and requires coverage for accuracy", () => {
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

  const missingPronunciationRating = { ...mixedReply };
  delete missingPronunciationRating.learnerPronunciationRating;
  assert.equal(
    parseLiveTurnToolCall(missingPronunciationRating)?.learner?.assessment
      .pronunciationScore,
    null,
  );
  assert.equal(
    parseLiveTurnToolCall(missingPronunciationRating)?.learner?.assessment
      .accuracyScore,
    70,
  );

  const missingMeaningRating = { ...mixedReply };
  delete missingMeaningRating.learnerMeaningRating;
  assert.equal(
    parseLiveTurnToolCall(missingMeaningRating)?.learner?.assessment
      .pronunciationScore,
    94,
  );
  assert.equal(
    parseLiveTurnToolCall(missingMeaningRating)?.learner?.assessment
      .accuracyScore,
    null,
  );

  delete mixedReply.learnerTeluguCoverageRating;
  const withoutCoverage = parseLiveTurnToolCall(mixedReply);
  assert.equal(withoutCoverage?.learner?.assessment.pronunciationScore, 94);
  assert.equal(withoutCoverage?.learner?.assessment.accuracyScore, null);
  assert.equal(withoutCoverage?.learner?.assessment.languageScore, null);

  assert.equal(
    parseLiveTurnToolCall({
      ...mixedReply,
      learnerTeluguCoverageRating: 0,
    }),
    null,
    "zero Telugu coverage must use the English source contract",
  );

  for (const invalidRating of [-1, 5, 2.5, "2", Number.NaN]) {
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
    ...nullLearnerFields,
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
  assert.equal(
    parseLiveTurnToolCall(missingFeedback)?.learner?.assessment.feedback,
    "Please try that reply once more at a comfortable pace.",
    "missing optional coaching uses the safe low-confidence fallback",
  );
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
