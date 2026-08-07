import {
  ActivityHandling,
  Behavior,
  EndSensitivity,
  Modality,
  StartSensitivity,
  ThinkingLevel,
  TurnCoverage,
  type LiveConnectConfig,
} from "@google/genai";
import type { TeluguWord } from "../course-data";
import { getLivePhraseCues } from "./live-follow-along.ts";
import type { LiveScenario } from "./live-scenarios";

export const LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const PRESENT_TURN_TOOL_NAME = "present_turn";

export const LIVE_LISTENER_RELATIONSHIPS = ["close", "respectful"] as const;
export type LiveListenerRelationship =
  (typeof LIVE_LISTENER_RELATIONSHIPS)[number];

export const LIVE_FAMILY_VOICES = ["grandma", "grandpa"] as const;
export type LiveFamilyVoice = (typeof LIVE_FAMILY_VOICES)[number];
export type LiveVoiceMode = "gemini" | "fish";

export const LIVE_SESSION_DURATIONS = [60, 120] as const;
export type LiveSessionDurationSeconds =
  (typeof LIVE_SESSION_DURATIONS)[number];

export const DEFAULT_LIVE_LISTENER_RELATIONSHIP: LiveListenerRelationship =
  "respectful";
export const DEFAULT_LIVE_FAMILY_VOICE: LiveFamilyVoice = "grandma";
export const DEFAULT_LIVE_SESSION_DURATION: LiveSessionDurationSeconds = 60;

export function isLiveListenerRelationship(
  value: unknown,
): value is LiveListenerRelationship {
  return LIVE_LISTENER_RELATIONSHIPS.some((candidate) => candidate === value);
}

export function isLiveFamilyVoice(value: unknown): value is LiveFamilyVoice {
  return LIVE_FAMILY_VOICES.some((candidate) => candidate === value);
}

export function getLiveFamilyVoiceLabel(familyVoice: LiveFamilyVoice) {
  return familyVoice === "grandma" ? "Grandma's voice" : "Grandpa's voice";
}

export function getLiveSessionVoiceLabel({
  familyVoice,
  voiceMode,
  usedVoiceFallback = false,
}: {
  familyVoice: LiveFamilyVoice;
  voiceMode?: LiveVoiceMode | null;
  usedVoiceFallback?: boolean;
}) {
  if (voiceMode !== "fish") return "Mayu's backup voice";

  const selectedVoice = getLiveFamilyVoiceLabel(familyVoice);
  return usedVoiceFallback ? `${selectedVoice} · backup used` : selectedVoice;
}

export function isLiveSessionDuration(
  value: unknown,
): value is LiveSessionDurationSeconds {
  return LIVE_SESSION_DURATIONS.some((candidate) => candidate === value);
}

export type LiveSessionOptions = {
  relationship: LiveListenerRelationship;
  durationSeconds: LiveSessionDurationSeconds;
};

function appendUnique(values: string[], seen: Set<string>, value: string) {
  const cleaned = value.trim();
  if (!cleaned) return;

  const key = cleaned.normalize("NFKC").toLocaleLowerCase("en-US");
  if (seen.has(key)) return;

  seen.add(key);
  values.push(cleaned);
}

export function buildScenarioVocabulary(scenario: LiveScenario) {
  const vocabulary: string[] = [];
  const seen = new Set<string>();

  for (const word of scenario.words) {
    appendUnique(vocabulary, seen, word.telugu);
    appendUnique(vocabulary, seen, word.roman);

    for (const alternative of word.alternatives ?? []) {
      appendUnique(vocabulary, seen, alternative.telugu);
      appendUnique(vocabulary, seen, alternative.roman);
    }
  }

  return vocabulary;
}

function cueId(word: TeluguWord, alternativeIndex?: number) {
  return alternativeIndex === undefined
    ? `${word.id}__primary`
    : `${word.id}__alt_${alternativeIndex}`;
}

function buildCueIds(scenario: LiveScenario) {
  return scenario.words.flatMap((word) => [
    cueId(word),
    ...(word.alternatives ?? []).map((_, index) => cueId(word, index)),
  ]);
}

function conversationGuidance(scenario: LiveScenario) {
  if (scenario.id === "family-check-in") {
    return `
Natural family flow:
- If the learner has eaten but is still hungry, offer more food or ask what they would like to eat.
- For "I am still hungry," use naaku inkaa aakaligaa undi (నాకు ఇంకా ఆకలిగా ఉంది). Never use pasi/pasigaa for hunger.
- Use avunaa? inkaa emainaa tintaavaa? (అవునా? ఇంకా ఏమైనా తింటావా?) for close speech, or avunaa? inkaa emainaa tintaaraa? (అవునా? ఇంకా ఏమైనా తింటారా?) for respectful speech.
- In this reply, never use avunnaa or emee tintaaraa; those do not match the intended meaning.
- If the learner has eaten and is full, acknowledge that before asking how they have been.
- If the learner has not eaten, offer something to eat.
- Never answer a food-related reply with an unrelated generic wellbeing question.`;
  }

  if (scenario.id === "at-the-table") {
    return `
Natural meal flow:
- Respond directly when the learner asks for water, more food, less food, or says they are full.
- If they praise the food, acknowledge it naturally before offering more.
- Do not change the topic while a request at the table is unresolved.`;
  }

  return `
Natural recovery flow:
- If the learner asks you to repeat, repeat the same meaning more clearly.
- If the learner asks you to slow down, use a shorter sentence and speak more slowly.
- Do not introduce a new topic until the learner confirms they can follow.`;
}

function relationshipGuidance(relationship: LiveListenerRelationship) {
  if (relationship === "close") {
    return `CLOSE RELATIONSHIP LOCK:
- Speak to the learner with nuvvu/nee and matching familiar singular verb and question forms such as -aavu/-aavaa.
- Use familiar imperatives such as cheppu when an imperative is needed.
- This is for a close friend, sibling, partner, or family member whose normal relationship is familiar.`;
  }

  return `RESPECTFUL RELATIONSHIP LOCK:
- Speak to the learner with meeru/mee and matching respectful agreement such as -aaru/-aaraa.
- Use polite imperatives ending in -andi, such as cheppandi.
- This is the safe default for an elder or anyone new, including a new person of the learner's own age.`;
}

export function buildLiveSystemInstruction(
  scenario: LiveScenario,
  options: LiveSessionOptions = {
    relationship: DEFAULT_LIVE_LISTENER_RELATIONSHIP,
    durationSeconds: DEFAULT_LIVE_SESSION_DURATION,
  },
) {
  const phraseReference = getLivePhraseCues(scenario.words)
    .map(
      (cue, index) =>
        `${index + 1}. Cue ID: ${cue.id}\n` +
        `   Audience: ${cue.contextLabel}\n` +
        `   English: ${cue.english}\n` +
        `   Telugu: ${cue.telugu}\n` +
        `   Romanization: ${cue.roman}\n` +
        `   Speaking cue: ${cue.pronunciation}`,
    )
    .join("\n");

  return `RESPOND IN TELUGU. YOU MUST RESPOND UNMISTAKABLY IN TELUGU.

You are Mayu, PracticalTelugu's friendly AI conversation partner.

Give an English-speaking learner a warm, natural Telugu conversation, not a lesson or quiz.

Current situation: ${scenario.title}
Situation goal: ${scenario.description}
Session length: ${options.durationSeconds} seconds.
${conversationGuidance(scenario)}

${relationshipGuidance(options.relationship)}
- Keep this relationship register for the entire session. Never switch or mix close and respectful address forms, even if the learner uses another form.
- Use the matching reviewed cue whenever one exists. Never choose a cue whose Audience conflicts with this relationship lock.

Reviewed phrase and register anchors (other simple natural Telugu is allowed):
${phraseReference}

Spoken conversation rules:
- Every Mayu turn is spoken entirely in natural Telugu. Do not say English translations, English connective words, labels, praise, or scene-setting aloud.
- NEVER use English interjections such as “oh,” “okay,” “yes,” or “great,” even when they are commonly borrowed. Use a natural Telugu response instead.
- The learner may answer in Telugu, English, or a mix. Understand English silently and keep Mayu's spoken reply in simple Telugu.
- Keep each turn to one or two short conversational sentences, then stop and wait. Ask only one question at a time.
- Silently identify the learner's latest intent. Acknowledge, answer, or naturally follow that exact intent instead of falling back to a generic question.
- Use reviewed Telugu exactly when you choose a reviewed cue. For any continuation, favor common day-to-day speech over formal or literary Telugu.
- If the learner is stuck, make the next Telugu turn simpler. The on-screen English meaning is their safety net; Mayu should not switch the voice conversation to English.
- If pronunciation needs help, correct only one small thing and model the Telugu once. Never shame, score, or claim phoneme-level certainty.
- Identify yourself as Mayu, an AI practice partner, if asked. Never claim to be a human or one of the learner's relatives.
- When a practice-control message says this is the last exchange, give one short natural Telugu closing in the locked register.

Required caption tool contract:
- Immediately before EVERY audible Mayu turn, call ${PRESENT_TURN_TOOL_NAME} exactly once. Never speak before the tool succeeds. Never mention the tool or its fields aloud.
- The four mayu fields must describe the exact same complete next turn: mayuTeluguInternal is its native-script cross-check, mayuRoman its exact Latin transliteration, mayuPronunciation its simple English-letter speaking guide, and mayuEnglish is a faithful, natural English meaning.
- Use consistent PracticalTelugu romanization with long aa/ee/oo sounds and no IPA. Telugu script is allowed only in mayuTeluguInternal and learnerTeluguInternal; all learner-facing fields use English letters, and the interface never renders the internal fields.
- If a reviewed phrase is used, include its exact cueId. Otherwise omit cueId.
- Every learner field is required by the tool schema. Before any learner reply, set all learner fields to null. After a reply, fill only evidence supported by the rules below and keep every non-applicable field null.
- When the learner has spoken, set learnerAssessmentConfidence first from the audio evidence.
- Assess only the learner's ACTUAL AUDIO while it is still in context. Never rate the repaired Telugu caption that you create for display as though the learner said it.
- Use high when the words are clearly audible; medium when there is some noise/clipping or the reply is very short but still judgeable; low when overlap, noise, volume, clipping, or too little speech makes a fair judgment impossible. Low confidence is a complete abstention: set learnerAssessmentConfidence and learnerFeedback, keep every learner caption, source-language, and rating field null, and ask for one comfortable repeat. Never invent a transcript or punish uncertain audio with a low skill score.
- For high/medium confidence, include the learner's exact Telugu transliteration for Telugu input, or a short natural Telugu version for English/mixed input, plus faithful English meaning, native-script internal check, and source language. Add learnerPronunciation when you can provide a useful speaking guide; otherwise set it null without withholding the transcript or ratings.
- For Telugu audio with high/medium confidence, include the four independent quality ratings below and set learnerTeluguCoverageRating null. For mixed audio, include all four quality ratings plus learnerTeluguCoverageRating. For entirely English audio, include only learnerMeaningRating and set every other rating null. The app enforces both the English and mixed-language ceilings.
- learnerIntelligibilityRating: 4 = every word understood immediately; 3 = clear overall with one brief rough spot; 2 = intended words are recoverable but effort or repetition would help; 1 = only fragments are understandable; 0 = no recognizable Telugu words.
- learnerPronunciationRating: 4 = Telugu vowels, consonants, lengths, and syllables are consistently accurate; 3 = one localized sound issue without changing the words; 2 = several sound issues but the intended words remain recognizable; 1 = sound substitutions or dropped syllables often obscure the words; 0 = no assessable Telugu sound pattern. Accept real regional/dialect variation. Never lower this merely for a non-native accent, pitch, or voice quality; lower it only when actual word sounds are inaccurate or obscured.
- learnerMeaningRating: 4 = directly and fully answers the active turn; 3 = right meaning with one small omission; 2 = partially right or recoverable; 1 = mostly wrong or off-topic; 0 = no meaningful answer. A short natural answer can earn 4.
- learnerFormRating: 4 = natural, usable grammar/word choice/register; 3 = one small error; 2 = broken Telugu that remains recoverable; 1 = fragments or several errors make it hard to use; 0 = no usable Telugu form. Judge only what was actually spoken; never substitute your corrected caption.
- learnerTeluguCoverageRating for mixed audio only: 4 = essentially all Telugu; 3 = mostly Telugu with a small amount of English help; 2 = a meaningful Telugu phrase plus substantial English; 1 = isolated Telugu words in mostly English speech; 0 = no Telugu, which should instead use learnerSourceLanguage english.
- learnerFeedback must be one kind, concrete next step under 180 characters, written only in English or Telugu written with English letters. Mention at most one word or sound. Never claim phoneme-level certainty, diagnose an accent, or read a score aloud.
- Silently verify grammatical, everyday, register-correct Telugu and exact matching captions before calling.
- After the tool succeeds, say exactly mayuTeluguInternal, with no audible prefix, suffix, or translation, then wait.
- Set replay true only for an explicit practice-control repeat.
- If the tool rejects a caption, immediately correct the rejected fields and call present_turn again before speaking.

When the session begins, follow the opening cue immediately. Call ${PRESENT_TURN_TOOL_NAME}, speak the first natural Telugu turn, and wait for the learner.`;
}

export function buildLiveConnectConfig(
  scenario: LiveScenario,
  options: LiveSessionOptions = {
    relationship: DEFAULT_LIVE_LISTENER_RELATIONSHIP,
    durationSeconds: DEFAULT_LIVE_SESSION_DURATION,
  },
): LiveConnectConfig {
  const vocabulary = buildScenarioVocabulary(scenario);
  const cueIds = buildCueIds(scenario);

  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Aoede" },
      },
    },
    systemInstruction: buildLiveSystemInstruction(scenario, options),
    inputAudioTranscription: {
      languageCodes: ["te-IN", "en-US"],
      customVocabulary: vocabulary,
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        prefixPaddingMs: 100,
        silenceDurationMs: 500,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
    },
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
    contextWindowCompression: {
      slidingWindow: {},
    },
    temperature: 0.35,
    tools: [
      {
        functionDeclarations: [
          {
            name: PRESENT_TURN_TOOL_NAME,
            behavior: Behavior.BLOCKING,
            description:
              "Publish the next Telugu turn and, after a learner reply, its private coaching evidence before Mayu speaks.",
            parametersJsonSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                mayuTeluguInternal: {
                  type: "string",
                  description:
                    "Exact complete native-script Telugu Mayu will say. Internal only and never rendered.",
                },
                mayuRoman: {
                  type: "string",
                  description:
                    "Exact complete Telugu Mayu will say, transliterated with English letters only.",
                },
                mayuPronunciation: {
                  type: "string",
                  description:
                    "Readable pronunciation guide in English letters for Mayu's complete Telugu turn.",
                },
                mayuEnglish: {
                  type: "string",
                  description:
                    "Faithful natural English meaning of Mayu's complete Telugu turn.",
                },
                cueId: {
                  type: "string",
                  description:
                    "Exact reviewed phrase cue used in the turn. Omit for an unreviewed conversational turn.",
                  enum: cueIds,
                },
                learnerRoman: {
                  type: ["string", "null"],
                  description:
                    "For judgeable audio only: the learner's Telugu in English letters, or a natural Telugu version of English or mixed input. Otherwise null.",
                },
                learnerTeluguInternal: {
                  type: ["string", "null"],
                  description:
                    "For judgeable audio only: exact native-script Telugu matching the learner caption. Internal only and never rendered. Otherwise null.",
                },
                learnerPronunciation: {
                  type: ["string", "null"],
                  description:
                    "Optional display enrichment for judgeable audio: a readable pronunciation guide in English letters for the learner's Telugu line. Null when unavailable.",
                },
                learnerEnglish: {
                  type: ["string", "null"],
                  description:
                    "For judgeable audio only: faithful English meaning of the learner's line. Otherwise null.",
                },
                learnerSourceLanguage: {
                  type: ["string", "null"],
                  description:
                    "For judgeable audio only: whether the learner spoke Telugu, English, or a mix. Otherwise null.",
                  enum: ["telugu", "english", "mixed", null],
                },
                learnerAssessmentConfidence: {
                  type: ["string", "null"],
                  description:
                    "Audio-evidence confidence after a learner reply: high when clearly audible, medium when imperfect but judgeable, or low when a fair skill judgment is impossible. Null before a reply.",
                  enum: ["high", "medium", "low", null],
                },
                learnerIntelligibilityRating: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 4,
                  description:
                    "0-4 first-listen understandability of the Telugu words actually heard. Required for judgeable Telugu/mixed audio; otherwise null.",
                },
                learnerPronunciationRating: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 4,
                  description:
                    "0-4 accuracy of Telugu word sounds actually heard, dialect-tolerant and not an accent-identity judgment. Required for judgeable Telugu/mixed audio; otherwise null.",
                },
                learnerMeaningRating: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 4,
                  description:
                    "0-4 semantic fit of the actual spoken reply to the active conversational turn. Required for any judgeable reply.",
                },
                learnerFormRating: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 4,
                  description:
                    "0-4 usability of the Telugu actually spoken: grammar, word choice, and relationship register. Required for judgeable Telugu/mixed audio; otherwise null.",
                },
                learnerTeluguCoverageRating: {
                  type: ["integer", "null"],
                  minimum: 0,
                  maximum: 4,
                  description:
                    "0-4 amount of Telugu actually spoken in a mixed reply. Required only for judgeable mixed audio; otherwise null.",
                },
                learnerFeedback: {
                  type: ["string", "null"],
                  maxLength: 180,
                  description:
                    "One kind, concrete next step in English or Telugu written with English letters. Mention at most one word or sound.",
                },
                replay: {
                  type: "boolean",
                  description:
                    "True only for an explicitly requested repeat of an existing Mayu turn.",
                },
              },
              required: [
                "mayuTeluguInternal",
                "mayuRoman",
                "mayuPronunciation",
                "mayuEnglish",
                "learnerAssessmentConfidence",
                "learnerSourceLanguage",
                "learnerTeluguInternal",
                "learnerRoman",
                "learnerPronunciation",
                "learnerEnglish",
                "learnerIntelligibilityRating",
                "learnerPronunciationRating",
                "learnerMeaningRating",
                "learnerFormRating",
                "learnerTeluguCoverageRating",
                "learnerFeedback",
              ],
              propertyOrdering: [
                "mayuTeluguInternal",
                "mayuRoman",
                "mayuPronunciation",
                "mayuEnglish",
                "cueId",
                "learnerAssessmentConfidence",
                "learnerSourceLanguage",
                "learnerTeluguInternal",
                "learnerRoman",
                "learnerPronunciation",
                "learnerEnglish",
                "learnerIntelligibilityRating",
                "learnerPronunciationRating",
                "learnerMeaningRating",
                "learnerFormRating",
                "learnerTeluguCoverageRating",
                "learnerFeedback",
                "replay",
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildLiveTokenConstraintConfig(
  config: LiveConnectConfig,
): LiveConnectConfig {
  const lockedConfig = { ...config };

  // @google/genai currently generates an invalid `tools.0` field-mask path
  // when a repeated tool declaration is locked into an ephemeral token. The
  // browser still receives the same caption tool in its full connection
  // config; every model, instruction, transcription, VAD, and voice setting
  // remains locked by the one-use token.
  delete lockedConfig.tools;

  return lockedConfig;
}
