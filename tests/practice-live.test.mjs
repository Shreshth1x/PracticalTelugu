import assert from "node:assert/strict";
import test from "node:test";

import {
  findLivePhraseCue,
  getLivePhraseCues,
  getRelatedLivePhraseCues,
  resolveLivePhraseCue,
} from "../app/practice-live/live-follow-along.ts";
import {
  LIVE_MODEL,
  PRESENT_TURN_TOOL_NAME,
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
  buildScenarioVocabulary,
  buildLiveTokenConstraintConfig,
} from "../app/practice-live/live-config.ts";
import {
  applyLiveCaptionTurn,
  applyProvisionalLearnerTranscript,
  beginPendingLearnerTurn,
  parseLiveTurnToolCall,
  removePendingLiveTurns,
  sanitizeLiveProvisionalTranscript,
} from "../app/practice-live/live-transcript.ts";

const words = [
  {
    id: "have-you-eaten",
    progressKey: "తిన్నారా?::have you eaten?",
    telugu: "తిన్నావా?",
    roman: "tinnaavaa?",
    pronunciation: "tin-NAA-vaa?",
    english: "have you eaten?",
    note: "A warm family check-in.",
    usage: {
      audience: "familiar",
      kind: "relationship",
    },
    alternatives: [
      {
        label: "With elders or someone new",
        telugu: "తిన్నారా?",
        roman: "tinnaaraa?",
        pronunciation: "tin-NAA-raa?",
        usage: {
          audience: "respectful",
          kind: "relationship",
        },
      },
    ],
  },
  {
    id: "say-slowly",
    progressKey: "మెల్లగా చెప్పండి::please say it slowly",
    telugu: "కొంచెం మెల్లగా చెప్పండి",
    roman: "konchem mellagaa cheppandi",
    pronunciation: "KON-chem mel-LA-gaa chep-PUN-dee",
    english: "please say it slowly",
    usage: {
      audience: "respectful",
      kind: "relationship",
    },
    alternatives: [
      {
        label: "With family or friends",
        telugu: "కొంచెం మెల్లగా చెప్పు",
        roman: "konchem mellagaa cheppu",
        pronunciation: "KON-chem mel-LA-gaa CHEP-poo",
        usage: {
          audience: "familiar",
          kind: "relationship",
        },
      },
    ],
  },
  {
    id: "food-good",
    progressKey: "చాలా బాగుంది::this is really good",
    telugu: "చాలా బాగుంది",
    roman: "chaalaa baagundi",
    pronunciation: "CHAA-laa baa-GOON-dee",
    english: "this is really good",
  },
];

const scenario = {
  id: "family-check-in",
  eyebrow: "WITH FAMILY",
  pickerLabel: "With family",
  title: "Check in with family",
  description: "Answer the familiar questions that begin every visit.",
  openingCue: "Start a family visit.",
  words,
};

test("builds accurate primary and register-specific phrase cues", () => {
  const cues = getLivePhraseCues(words);
  const primary = findLivePhraseCue(words, "have-you-eaten__primary");
  const respectful = findLivePhraseCue(words, "have-you-eaten__alt_0");
  const politeSlowly = findLivePhraseCue(words, "say-slowly__primary");

  assert.equal(cues.length, 5);
  assert.deepEqual(primary, {
    id: "have-you-eaten__primary",
    wordId: "have-you-eaten",
    progressKey: "తిన్నారా?::have you eaten?",
    english: "have you eaten?",
    roman: "tinnaavaa?",
    pronunciation: "tin-NAA-vaa?",
    telugu: "తిన్నావా?",
    audience: "familiar",
    contextLabel: "Someone close",
    contextGuidance:
      "Use this with a sibling, close friend, or someone you genuinely know well. Being the same age is not enough by itself.",
    note: "A warm family check-in.",
    variant: "primary",
  });
  assert.equal(respectful?.english, "have you eaten?");
  assert.equal(respectful?.note, "A warm family check-in.");
  assert.equal(respectful?.audience, "respectful");
  assert.equal(respectful?.contextLabel, "Elder or someone new");
  assert.match(respectful?.contextGuidance ?? "", /even if they are your age/);
  assert.equal(respectful?.variant, "alternative");
  assert.equal(politeSlowly?.contextLabel, "Elder or someone new");
  assert.deepEqual(
    getRelatedLivePhraseCues(words, "have-you-eaten__primary").map(
      (cue) => cue.id,
    ),
    ["have-you-eaten__alt_0"],
  );
});

test("resolves only unique curated Telugu, roman, English, or strong English overlap", () => {
  assert.equal(
    resolveLivePhraseCue("  తిన్నారా?! ", words)?.id,
    "have-you-eaten__alt_0",
  );
  assert.equal(
    resolveLivePhraseCue("KONCHEM MELLAGAA CHEPPU", words)?.id,
    "say-slowly__alt_0",
  );
  assert.equal(
    resolveLivePhraseCue("this is really good", words)?.id,
    "food-good__primary",
  );
  assert.equal(
    resolveLivePhraseCue("Honestly, this food is really good today.", words)?.id,
    "food-good__primary",
  );
  assert.equal(
    resolveLivePhraseCue("Have you eaten? తిన్నారా?", words)?.id,
    "have-you-eaten__alt_0",
  );
  assert.equal(
    resolveLivePhraseCue("Try saying tinnaavaa? once.", words)?.id,
    "have-you-eaten__primary",
  );

  // English is intentionally ambiguous when familiar and respectful variants
  // share a meaning. The UI must not guess the social register.
  assert.equal(resolveLivePhraseCue("have you eaten?", words), null);
  assert.equal(resolveLivePhraseCue("I understand now", words), null);
  assert.equal(resolveLivePhraseCue("something unrelated", words), null);
  assert.equal(resolveLivePhraseCue("", words), null);
});

test("accepts complete English-letter captions and blocks Telugu script", () => {
  const parsed = parseLiveTurnToolCall({
    mayuTeluguInternal: "ఇంకా కొంచెం తింటావా?",
    mayuRoman: "Inkaa konchem tintaavaa?",
    mayuPronunciation: "in-KAA KON-chem tin-TAA-vaa?",
    mayuEnglish: "Will you eat a little more?",
    learnerTeluguInternal: "చాలు, కడుపు నిండింది.",
    learnerRoman: "Chaalu, kadupu nindindi.",
    learnerPronunciation: "CHAA-loo, ka-DOO-poo nin-DIN-dee.",
    learnerEnglish: "That is enough, I am full.",
    learnerSourceLanguage: "telugu",
    learnerAssessmentConfidence: "high",
    learnerIntelligibilityRating: 4,
    learnerPronunciationRating: 3,
    learnerMeaningRating: 4,
    learnerFormRating: 4,
    learnerFeedback: "Keep the long aa sound steady in chaalu.",
    cueId: "have-you-eaten__primary",
  });

  assert.equal(parsed?.mayu.roman, "Inkaa konchem tintaavaa?");
  assert.equal(parsed?.mayu.english, "Will you eat a little more?");
  assert.equal(parsed?.learner?.sourceLanguage, "telugu");
  assert.equal(parsed?.learner?.assessment.confidence, "high");
  assert.equal(parsed?.learner?.assessment.pronunciationScore, 94);
  assert.equal(parsed?.learner?.assessment.accuracyScore, 100);
  assert.equal(parsed?.learner?.assessment.languageScore, 97);
  assert.equal(parsed?.replay, false);

  assert.equal(
    parseLiveTurnToolCall({
      mayuTeluguInternal: "తిన్నావా?",
      mayuRoman: "తిన్నావా?",
      mayuPronunciation: "tin-NAA-vaa?",
      mayuEnglish: "Have you eaten?",
    }),
    null,
  );
  assert.equal(
    parseLiveTurnToolCall({
      mayuTeluguInternal: "తిన్నావా?",
      mayuRoman: "tinnaavaa?",
      mayuPronunciation: "tin-NAA-vaa?",
      mayuEnglish: "Have you eaten?",
      learnerRoman: "tinnaanu",
    }),
    null,
  );
});

test("replaces a private learner placeholder with the paired visible caption", () => {
  let turns = beginPendingLearnerTurn([], "you-pending");
  turns = beginPendingLearnerTurn(turns, "duplicate-pending");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].final, false);
  assert.equal(turns[0].roman, "");

  turns = applyLiveCaptionTurn(turns, {
    id: "tool-1-learner",
    speaker: "you",
    roman: "Tinnaanu.",
    pronunciation: "tin-NAA-noo.",
    english: "I ate.",
    sourceLanguage: "telugu",
  });
  assert.deepEqual(turns[0], {
    id: "you-pending",
    speaker: "you",
    roman: "Tinnaanu.",
    pronunciation: "tin-NAA-noo.",
    english: "I ate.",
    final: true,
    cueId: undefined,
    sourceLanguage: "telugu",
  });

  const withPending = beginPendingLearnerTurn(turns, "you-unfinished");
  assert.equal(removePendingLiveTurns(withPending).length, 1);
});

test("transliterates Telugu ASR into a disposable English-letter live draft", () => {
  assert.equal(
    sanitizeLiveProvisionalTranscript("  nenu   baagunnaanu?  "),
    "nenu baagunnaanu?",
  );
  assert.equal(
    sanitizeLiveProvisionalTranscript("nenu బాగున్నాను"),
    "nenu baagunnaanu",
    "mixed Telugu and Latin input stays readable without exposing script",
  );
  assert.equal(
    sanitizeLiveProvisionalTranscript("నీళ్లు ఇస్తారా?"),
    "neellu istaaraa?",
  );
  assert.equal(
    sanitizeLiveProvisionalTranscript("привет"),
    "",
    "other non-Latin scripts are rejected",
  );

  let turns = beginPendingLearnerTurn([], "you-pending");
  turns = applyProvisionalLearnerTranscript(turns, "nenu baagunnaanu");
  turns = beginPendingLearnerTurn(turns, "duplicate-pending");

  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0], {
    id: "you-pending",
    speaker: "you",
    roman: "",
    provisionalRoman: "nenu baagunnaanu",
    english: "",
    final: false,
  });

  turns = applyProvisionalLearnerTranscript(turns, "నేను బాగున్నాను");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].provisionalRoman, "neenu baagunnaanu");

  turns = applyProvisionalLearnerTranscript(turns, "nenu baagunnaanu");
  turns = applyLiveCaptionTurn(turns, {
    id: "tool-1-learner",
    speaker: "you",
    roman: "Nenu baagunnaanu.",
    pronunciation: "NAY-noo BAA-goon-NAA-noo.",
    english: "I am well.",
    sourceLanguage: "telugu",
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].final, true);
  assert.equal(turns[0].provisionalRoman, undefined);
  assert.equal(turns[0].roman, "Nenu baagunnaanu.");
});

test("preserves the complete alternating conversation transcript in order", () => {
  let turns = [];
  for (let index = 0; index < 30; index += 1) {
    turns = applyLiveCaptionTurn(turns, {
      id: `turn-${index}`,
      speaker: index % 2 ? "you" : "mayu",
      roman: `telugu line ${index}`,
      pronunciation: `spoken line ${index}`,
      english: `English meaning ${index}`,
      sourceLanguage: "telugu",
    });
  }

  assert.equal(turns.length, 30);
  assert.equal(turns[0].id, "turn-0");
  assert.equal(turns.at(-1).id, "turn-29");
  assert.deepEqual(
    turns.map((turn) => turn.speaker),
    Array.from({ length: 30 }, (_, index) => (index % 2 ? "you" : "mayu")),
  );
});

test("builds a deduplicated bilingual ASR vocabulary", () => {
  const vocabulary = buildScenarioVocabulary(scenario);

  assert.ok(vocabulary.includes("తిన్నావా?"));
  assert.ok(vocabulary.includes("తిన్నారా?"));
  assert.ok(vocabulary.includes("tinnaavaa?"));
  assert.ok(vocabulary.includes("tinnaaraa?"));
  assert.ok(!vocabulary.includes("have you eaten?"));
  assert.ok(!vocabulary.includes("tin-NAA-raa?"));
});

test("configures low-latency Telugu Live audio with one non-blocking presentation tool", () => {
  const config = buildLiveConnectConfig(scenario);
  const vad = config.realtimeInputConfig?.automaticActivityDetection;
  const declarations = config.tools?.[0]?.functionDeclarations ?? [];
  const presentDeclaration = declarations.find(
    (declaration) => declaration.name === PRESENT_TURN_TOOL_NAME,
  );
  const presentSchema = presentDeclaration?.parametersJsonSchema;

  assert.equal(LIVE_MODEL, "gemini-2.5-flash-native-audio-preview-12-2025");
  assert.deepEqual(config.responseModalities, ["AUDIO"]);
  assert.equal(
    config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
    "Aoede",
  );
  assert.equal(config.speechConfig?.languageCode, undefined);
  assert.deepEqual(config.inputAudioTranscription?.languageCodes, [
    "te-IN",
    "en-US",
  ]);
  assert.equal(config.outputAudioTranscription, undefined);
  assert.ok(config.inputAudioTranscription?.customVocabulary?.includes("తిన్నారా?"));
  assert.equal(vad?.startOfSpeechSensitivity, "START_SENSITIVITY_HIGH");
  assert.equal(vad?.endOfSpeechSensitivity, "END_SENSITIVITY_HIGH");
  assert.equal(vad?.prefixPaddingMs, 100);
  assert.equal(vad?.silenceDurationMs, 500);
  assert.equal(
    config.realtimeInputConfig?.activityHandling,
    "START_OF_ACTIVITY_INTERRUPTS",
  );
  assert.equal(
    config.realtimeInputConfig?.turnCoverage,
    "TURN_INCLUDES_ONLY_ACTIVITY",
  );
  assert.equal(config.thinkingConfig?.thinkingBudget, 0);
  assert.equal(config.thinkingConfig?.thinkingLevel, undefined);
  assert.ok(config.contextWindowCompression?.slidingWindow);
  assert.equal(config.temperature, 0.35);
  assert.equal(declarations.length, 1);
  assert.deepEqual(
    declarations.map((declaration) => declaration.name),
    [PRESENT_TURN_TOOL_NAME],
  );
  assert.equal(presentDeclaration?.behavior, "NON_BLOCKING");
  assert.deepEqual(presentSchema?.required, [
    "mayuTeluguInternal",
    "mayuRoman",
    "mayuPronunciation",
    "mayuEnglish",
  ]);
  assert.deepEqual(
    presentSchema?.properties?.cueId?.enum,
    getLivePhraseCues(words).map((cue) => cue.id),
  );
  for (const optionalField of [
    "cueId",
    "replay",
    "learnerTeluguInternal",
    "learnerRoman",
    "learnerPronunciation",
    "learnerEnglish",
    "learnerSourceLanguage",
  ]) {
    assert.ok(presentSchema?.properties?.[optionalField], optionalField);
    assert.ok(!presentSchema?.required?.includes(optionalField), optionalField);
  }
  assert.deepEqual(presentSchema?.properties?.learnerSourceLanguage?.enum, [
    "telugu",
    "english",
    "mixed",
  ]);
  assert.equal(
    presentSchema?.properties?.learnerAssessmentConfidence,
    undefined,
  );
  assert.equal(presentSchema?.properties?.learnerMeaningRating, undefined);
  assert.equal(presentSchema?.properties?.learnerFeedback, undefined);

  assert.match(String(config.systemInstruction), /present_turn/);
  assert.doesNotMatch(String(config.systemInstruction), /assess_learner/);
  assert.match(
    String(config.systemInstruction),
    /before EVERY audible Mayu turn/i,
  );
});

test("keeps Mayu Telugu-only while captioning flexible learner replies", () => {
  const instruction = buildLiveSystemInstruction(scenario);

  assert.match(
    instruction,
    /RESPOND IN TELUGU\. YOU MUST RESPOND UNMISTAKABLY IN TELUGU\./,
  );
  assert.match(
    instruction,
    /Every Mayu turn is spoken entirely in natural Telugu/,
  );
  assert.match(
    instruction,
    /learner may answer in Telugu, English, or a mix/,
  );
  assert.match(
    instruction,
    /mayuEnglish is a faithful, natural English meaning/,
  );
  assert.match(
    instruction,
    /interface never renders the internal fields/,
  );
  assert.match(
    instruction,
    /Never speak as the learner, invent a learner reply, or repeat the learner's self-report/,
  );
  assert.match(
    instruction,
    /latest meaning.{0,120}one small natural step forward/is,
  );
  assert.match(instruction, /Never .* run through a generic checklist/);
  assert.match(
    instruction,
    /Immediately before EVERY audible Mayu turn.{0,180}speak immediately without waiting/is,
  );
  assert.match(
    instruction,
    /function-response continuation is still the same Mayu turn.{0,180}do not call it again/is,
  );
  assert.match(
    instruction,
    /On every present_turn call after a learner reply, include learnerTeluguInternal, learnerRoman, learnerEnglish, and learnerSourceLanguage/,
  );
  assert.match(instruction, /Include learnerPronunciation only when useful/);
  assert.match(instruction, /claim phoneme-level certainty/);
  assert.doesNotMatch(instruction, /assess_learner|learnerAssessmentConfidence/);
  assert.doesNotMatch(instruction, /learnerAccuracyRating/);
  assert.doesNotMatch(instruction, /Use short English connective words/i);
  assert.doesNotMatch(instruction, /brief English scene-setting sentence/i);
  assert.match(instruction, /RESPECTFUL RELATIONSHIP LOCK/);
  assert.match(instruction, /including a new person of the learner's own age/);
  assert.match(instruction, /Never switch or mix close and respectful/);
});

test("anchors a natural water handoff at the table", () => {
  const instruction = buildLiveSystemInstruction({
    ...scenario,
    id: "at-the-table",
  });

  assert.match(
    instruction,
    /tappakundaa, idigoo neellu teesukondi respectfully/,
  );
  assert.match(instruction, /idigoo neellu teesukoo with someone close/);
  assert.match(instruction, /Never use deenigaa/);
});

test("keeps Live settings locked while leaving the repeated caption tool token-safe", () => {
  const config = buildLiveConnectConfig(scenario);
  const tokenConfig = buildLiveTokenConstraintConfig(config);

  assert.equal(tokenConfig.tools, undefined);
  assert.deepEqual(
    { ...tokenConfig, tools: config.tools },
    config,
  );
  assert.equal(tokenConfig.systemInstruction, config.systemInstruction);
  assert.deepEqual(
    tokenConfig.realtimeInputConfig,
    config.realtimeInputConfig,
  );
  assert.deepEqual(
    tokenConfig.inputAudioTranscription,
    config.inputAudioTranscription,
  );
});
