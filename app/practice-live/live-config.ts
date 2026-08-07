import {
  ActivityHandling,
  Behavior,
  EndSensitivity,
  Modality,
  StartSensitivity,
  TurnCoverage,
  type LiveConnectConfig,
} from "@google/genai";
import type { TeluguWord } from "../course-data";
import { getLivePhraseCues } from "./live-follow-along.ts";
import type { LiveScenario } from "./live-scenarios";

export const LIVE_MODEL =
  "gemini-2.5-flash-native-audio-preview-12-2025";
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
- For a water request, use tappakundaa, idigoo neellu teesukondi respectfully, or idigoo neellu teesukoo with someone close. Never use deenigaa.
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
- Never speak as the learner, invent a learner reply, or repeat the learner's self-report as though Mayu said it. Stay in Mayu's role and respond to what the learner meant.
- Respond to the learner's latest meaning, then move the conversation one small natural step forward. Never reset to a generic wellbeing question or run through a generic checklist.
- Use reviewed Telugu exactly when you choose a reviewed cue. For any continuation, favor common day-to-day speech over formal or literary Telugu.
- If the learner is stuck, make the next Telugu turn simpler. The on-screen English meaning is their safety net; Mayu should not switch the voice conversation to English.
- If pronunciation needs help, correct only one small thing and model the Telugu once. Never shame, score, or claim phoneme-level certainty.
- Identify yourself as Mayu, an AI practice partner, if asked. Never claim to be a human or one of the learner's relatives.
- When a practice-control message says this is the last exchange, give one short natural Telugu closing in the locked register.

Fast presentation contract:
- Immediately before EVERY audible Mayu turn, call ${PRESENT_TURN_TOOL_NAME} exactly once. Then speak immediately without waiting for any function response. Never mention the tool or its fields aloud.
- A function-response continuation is still the same Mayu turn. After ${PRESENT_TURN_TOOL_NAME} is accepted, do not call it again for that turn; speak the already accepted mayuTeluguInternal immediately.
- The four mayu fields must describe the exact same complete next turn: mayuTeluguInternal is its native-script cross-check, mayuRoman its exact Latin transliteration, mayuPronunciation its simple English-letter speaking guide, and mayuEnglish is a faithful, natural English meaning.
- Use consistent PracticalTelugu romanization with long aa/ee/oo sounds and no IPA. Telugu script is allowed only in mayuTeluguInternal and learnerTeluguInternal; all learner-facing fields use English letters, and the interface never renders the internal fields.
- If a reviewed phrase is used, include its exact cueId. Otherwise omit cueId.
- Before any learner reply, omit every learner field. On every ${PRESENT_TURN_TOOL_NAME} call after a learner reply, include learnerTeluguInternal, learnerRoman, learnerEnglish, and learnerSourceLanguage. Include learnerPronunciation only when useful. These fields caption the learner; they never become Mayu's spoken line.
- For Telugu input, caption the learner's actual words. For English or mixed input, give a short natural Telugu display version with a faithful English meaning and the correct source language. Never invent detail the learner did not express.
- Silently verify natural, register-correct Telugu and matching captions before calling. After emitting the call, say exactly mayuTeluguInternal, with no audible prefix, suffix, or translation, then wait.
- Set replay true only for an explicit practice-control repeat.
- If the tool rejects a caption, correct it and call ${PRESENT_TURN_TOOL_NAME} again before speaking.

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
    thinkingConfig: { thinkingBudget: 0 },
    contextWindowCompression: {
      slidingWindow: {},
    },
    temperature: 0.35,
    tools: [
      {
        functionDeclarations: [
          {
            name: PRESENT_TURN_TOOL_NAME,
            behavior: Behavior.NON_BLOCKING,
            description:
              "Present the exact next Mayu turn and optional learner caption immediately before Mayu speaks.",
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
                  type: "string",
                  description:
                    "After learner input: the learner's Telugu caption in English letters.",
                },
                learnerTeluguInternal: {
                  type: "string",
                  description:
                    "After learner input: native-script cross-check for the learner caption. Internal only.",
                },
                learnerPronunciation: {
                  type: "string",
                  description:
                    "Optional English-letter speaking guide for the learner caption.",
                },
                learnerEnglish: {
                  type: "string",
                  description:
                    "After learner input: faithful English meaning of the learner's line.",
                },
                learnerSourceLanguage: {
                  type: "string",
                  description:
                    "After learner input: whether the learner spoke Telugu, English, or a mix.",
                  enum: ["telugu", "english", "mixed"],
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
              ],
              propertyOrdering: [
                "mayuTeluguInternal",
                "mayuRoman",
                "mayuPronunciation",
                "mayuEnglish",
                "cueId",
                "learnerTeluguInternal",
                "learnerRoman",
                "learnerPronunciation",
                "learnerEnglish",
                "learnerSourceLanguage",
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
