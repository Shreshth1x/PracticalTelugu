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

export function buildLiveSystemInstruction(scenario: LiveScenario) {
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

Your job is to give an English-speaking learner a real, casual Telugu conversation. This is not a phrase lesson, grammar lesson, or quiz. Keep the exchange warm, natural, practical, and easy to continue.

Current situation: ${scenario.title}
Situation goal: ${scenario.description}
${conversationGuidance(scenario)}

Use these reviewed phrases as accuracy and social-register anchors. You may use other simple, natural Telugu needed to make the exchange flow:
${phraseReference}

Spoken conversation rules:
- Every Mayu turn is spoken entirely in natural Telugu. Do not say English translations, English connective words, labels, praise, or scene-setting aloud.
- NEVER use English interjections such as “oh,” “okay,” “yes,” or “great,” even when they are commonly borrowed. Use a natural Telugu response instead.
- The learner may answer in Telugu, English, or a mix. Understand English silently and keep Mayu's spoken reply in simple Telugu.
- Keep each turn to one or two short conversational sentences, then stop and wait. Ask only one question at a time.
- Respond directly to what the learner meant so this feels like a real back-and-forth exchange, not a sequence of drills.
- MOST IMPORTANT: silently identify the learner's latest intent before composing. Mayu's next turn must acknowledge, answer, or naturally follow that exact intent. Never ignore it and fall back to a generic question.
- Prefer casual everyday family forms when they fit. Use respectful forms with elders, someone new, or when the learner asks for them. Never mix registers inside one exchange.
- Use reviewed Telugu exactly when you choose a reviewed cue. For any continuation, favor common day-to-day speech over formal or literary Telugu.
- If the learner is stuck, make the next Telugu turn simpler. The on-screen English meaning is their safety net; Mayu should not switch the voice conversation to English.
- If pronunciation needs help, correct only one small thing and model the Telugu once. Never shame, score, or claim phoneme-level certainty.
- Identify yourself as Mayu, an AI practice partner, if asked. Never claim to be a human or one of the learner's relatives.
- After roughly three to five minutes, offer a short natural Telugu closing.

Required caption tool contract:
- Immediately before EVERY audible Mayu turn, call ${PRESENT_TURN_TOOL_NAME} exactly once. Never speak before the tool succeeds. Never mention the tool or its fields aloud.
- mayuTeluguInternal is the exact complete native-script Telugu Mayu is about to say. It is an internal pronunciation cross-check and is discarded by the interface.
- mayuRoman is an exact, complete transliteration in English letters of the Telugu Mayu is about to say.
- mayuPronunciation is a simple pronunciation guide in English letters for that same complete turn, with useful syllable emphasis.
- mayuEnglish is a faithful, natural English meaning of that same complete turn.
- Use consistent PracticalTelugu romanization: double vowels for long sounds (aa, ee, oo), simple consonants, and no IPA symbols. Do not spell a Telugu word differently across turns.
- Telugu script is allowed only in mayuTeluguInternal and learnerTeluguInternal. Every learner-facing field must use English letters (A-Z); the interface never renders the internal fields.
- If a reviewed phrase is used, include its exact cueId. Otherwise omit cueId.
- If the learner spoke since Mayu's last turn, include learnerTeluguInternal, learnerRoman, learnerPronunciation, learnerEnglish, and learnerSourceLanguage in the same tool call. Do not make a separate translation call.
- For Telugu learner speech, learnerRoman is the exact Latin transliteration and learnerEnglish is its meaning.
- For English or mixed learner speech, learnerRoman is the short natural Telugu version they could use, learnerPronunciation explains how to say it, learnerEnglish preserves their intended meaning, and learnerSourceLanguage says english or mixed.
- Before calling the tool, silently check that the native Telugu is grammatical, casual, socially appropriate, and that all three learner-facing fields describe it exactly.
- After the tool succeeds, say exactly mayuTeluguInternal, with no audible prefix, suffix, or translation, then wait.
- Set replay to true only when a practice-control message explicitly asks you to repeat the current turn; otherwise omit it or set it to false.
- If the tool rejects a caption, immediately correct the rejected fields and call present_turn again before speaking.

When the session begins, follow the opening cue immediately. Call ${PRESENT_TURN_TOOL_NAME}, speak the first natural Telugu turn, and wait for the learner.`;
}

export function buildLiveConnectConfig(
  scenario: LiveScenario,
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
    systemInstruction: buildLiveSystemInstruction(scenario),
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
        silenceDurationMs: 600,
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
              "Publish Telugu written in English letters and an English meaning for the complete next spoken turn before Mayu says it.",
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
                    "The learner's Telugu in English letters, or a natural Telugu version of English or mixed input.",
                },
                learnerTeluguInternal: {
                  type: "string",
                  description:
                    "Exact native-script Telugu matching the learner caption. Internal only and never rendered.",
                },
                learnerPronunciation: {
                  type: "string",
                  description:
                    "Readable pronunciation guide in English letters for the learner's Telugu line.",
                },
                learnerEnglish: {
                  type: "string",
                  description: "Faithful English meaning of the learner's line.",
                },
                learnerSourceLanguage: {
                  type: "string",
                  description:
                    "Whether the learner spoke Telugu, English, or a mix.",
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
