import { performance } from "node:perf_hooks";

import { GoogleGenAI } from "@google/genai";

import {
  DEFAULT_LIVE_LISTENER_RELATIONSHIP,
  DEFAULT_LIVE_SESSION_DURATION,
  LIVE_LISTENER_RELATIONSHIPS,
  LIVE_MODEL,
  LIVE_SESSION_DURATIONS,
  PRESENT_TURN_TOOL_NAME,
  buildLiveConnectConfig,
  buildLiveTokenConstraintConfig,
  isLiveListenerRelationship,
  isLiveSessionDuration,
} from "../app/practice-live/live-config.ts";
import { findLivePhraseCue } from "../app/practice-live/live-follow-along.ts";
import {
  getLiveOpeningCue,
  getLiveScenario,
} from "../app/practice-live/live-scenarios.ts";
import {
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveTurnToolCall,
} from "../app/practice-live/live-transcript.ts";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required for the Practice Live smoke test.");
}

const args = process.argv.slice(2);
let positionalScenario;
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--relationship" || value === "--duration") {
    index += 1;
    continue;
  }
  if (!value.startsWith("--")) {
    positionalScenario = value;
    break;
  }
}
const scenario = getLiveScenario(positionalScenario ?? "family-check-in");
if (!scenario) {
  throw new Error("Choose family-check-in, at-the-table, or when-stuck.");
}

function option(name) {
  const exactIndex = args.indexOf(`--${name}`);
  if (exactIndex >= 0) return args[exactIndex + 1];

  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const requestedRelationship =
  option("relationship") ?? DEFAULT_LIVE_LISTENER_RELATIONSHIP;
if (!isLiveListenerRelationship(requestedRelationship)) {
  throw new Error("--relationship must be close or respectful.");
}

const requestedDuration = Number(
  option("duration") ?? DEFAULT_LIVE_SESSION_DURATION,
);
if (!isLiveSessionDuration(requestedDuration)) {
  throw new Error("--duration must be 60 or 120.");
}

const verifyConversation = args.includes("--conversation");
const runMatrix = args.includes("--matrix");
const NEW_SESSION_WINDOW_SECONDS = 60;
const TOKEN_EXPIRY_HEADROOM_SECONDS = 70;

async function runSmoke(relationship, durationSeconds) {
  const startedAt = performance.now();
  let promptSentAt = 0;
  let firstToolCallAt = 0;
  let firstAudioAt = 0;
  let selectedCueId = "";
  let firstCaption = null;
  let followupSentAt = 0;
  let secondToolCallAt = 0;
  let secondAudioAt = 0;
  let secondCaption = null;
  let lastToolCall = null;
  let expectedClose = false;
  let session;

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function resolveWhenReady() {
    if (verifyConversation) {
      if (secondToolCallAt && secondAudioAt) resolveReady();
      return;
    }

    if (firstToolCallAt && firstAudioAt) resolveReady();
  }

  const timeout = setTimeout(() => {
    rejectReady(
      new Error(
        `Gemini did not publish a valid caption and return audio in time.${
          lastToolCall ? ` Last tool call: ${JSON.stringify(lastToolCall)}` : ""
        }`,
      ),
    );
  }, verifyConversation ? 30_000 : 20_000);

  try {
    const serverAi = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    const options = { relationship, durationSeconds };
    const config = buildLiveConnectConfig(scenario, options);
    const tokenStartedAt = performance.now();
    const tokenIssuedAt = Date.now();
    const tokenExpiresAt = new Date(
      tokenIssuedAt +
        (durationSeconds + TOKEN_EXPIRY_HEADROOM_SECONDS) * 1_000,
    ).toISOString();
    const newSessionExpiresAt = new Date(
      tokenIssuedAt + NEW_SESSION_WINDOW_SECONDS * 1_000,
    ).toISOString();
    const token = await serverAi.authTokens.create({
      config: {
        uses: 1,
        expireTime: tokenExpiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: buildLiveTokenConstraintConfig(config),
        },
        lockAdditionalFields: [],
      },
    });
    const tokenCreatedAt = performance.now();
    if (!token.name) throw new Error("Gemini returned an empty ephemeral token.");

    const ai = new GoogleGenAI({
      apiKey: token.name,
      httpOptions: { apiVersion: "v1alpha" },
    });

    session = await ai.live.connect({
      model: LIVE_MODEL,
      config,
      callbacks: {
        onmessage: (message) => {
          const functionCalls = message.toolCall?.functionCalls ?? [];
          if (functionCalls.length) {
            const functionResponses = functionCalls.map((call) => {
              lastToolCall = { name: call.name, args: call.args };
              const parsed =
                call.name === PRESENT_TURN_TOOL_NAME
                  ? parseLiveTurnToolCall(call.args)
                  : null;
              const cueId = parsed?.mayu.cueId ?? "";
              const cue = cueId
                ? findLivePhraseCue(scenario.words, cueId)
                : null;
              const requiredAudience =
                relationship === "close" ? "familiar" : "respectful";
              const validCueClaim =
                !cueId ||
                (cue &&
                  matchesReviewedLiveCue(parsed.mayu, cue) &&
                  (cue.audience === "anyone" ||
                    cue.audience === requiredAudience));
              const hasForbiddenEnglish = Boolean(
                parsed && hasForbiddenAudibleEnglish(parsed.mayu),
              );
              const hasKnownLearnerMismatch = Boolean(
                parsed?.learner &&
                  hasKnownLearnerMeaningMismatch(parsed.learner),
              );
              const hasKnownMayuMismatch = Boolean(
                parsed && hasKnownMayuMeaningMismatch(parsed.mayu),
              );
              const hasKnownRelationshipMismatch = Boolean(
                parsed &&
                  hasKnownMayuRelationshipMismatch(
                    parsed.mayu,
                    relationship,
                  ),
              );
              const accepted = Boolean(
                parsed &&
                  !hasForbiddenEnglish &&
                  !hasKnownLearnerMismatch &&
                  !hasKnownMayuMismatch &&
                  !hasKnownRelationshipMismatch &&
                  validCueClaim,
              );
              const rejection = !parsed
                ? "Provide every complete Mayu caption field. For judgeable learner input, include every learner caption/source field, confidence, one short coaching tip, and exactly the ratings required by the source: meaning only for English, four quality ratings for Telugu, or those four plus Telugu coverage for mixed. For low confidence, include only confidence low and feedback; omit learner captions, source, and every rating. Rate only the actual input and keep Telugu script out of learner-facing fields."
                : hasForbiddenEnglish
                  ? "Remove every English interjection or copied-English word from the audible Telugu turn. Use a natural Telugu acknowledgment instead, then call present_turn again."
                  : hasKnownLearnerMismatch
                    ? "For a learner meaning that says hungry, use ఆకలి / aakali, such as naaku inkaa aakaligaa undi. Never use pasi or pasigaa for hunger. Correct every learner field and call present_turn again."
                  : hasKnownMayuMismatch
                    ? "For the hungry family follow-up, use avunaa, not avunnaa, and ask inkaa emainaa tintaavaa? (close) or inkaa emainaa tintaaraa? (respectful). Correct every Mayu field and call present_turn again."
                  : hasKnownRelationshipMismatch
                    ? "The hunger follow-up uses the wrong listener relationship. Use tintaavaa for someone close or tintaaraa for an elder or someone new, matching the locked session."
                : !cue
                  ? "That cueId is not reviewed for this situation. Omit cueId for a natural conversational turn."
                  : "That cueId requires the exact reviewed phrase in the active relationship register. Correct every caption field or omit cueId.";

              if (accepted && cue) selectedCueId = cue.id;
              if (accepted && !firstCaption) {
                firstCaption = parsed.mayu;
                firstToolCallAt = performance.now();
              } else if (accepted && followupSentAt && !secondCaption) {
                secondCaption = parsed;
                secondToolCallAt = performance.now();
              }

              return {
                id: call.id,
                name: call.name,
                response: accepted
                  ? {
                      output: {
                        accepted: true,
                        captionReady: true,
                        ...(cue ? { cueId: cue.id } : {}),
                      },
                    }
                  : {
                      error: rejection,
                    },
              };
            });

            session?.sendToolResponse({ functionResponses });
            resolveWhenReady();
          }

          const audio = (message.serverContent?.modelTurn?.parts ?? []).find(
            (part) => Boolean(part.inlineData?.data),
          );
          if (audio && promptSentAt) {
            if (followupSentAt) {
              secondAudioAt ||= performance.now();
            } else {
              firstAudioAt ||= performance.now();
            }
            resolveWhenReady();
          }

          if (
            verifyConversation &&
            message.serverContent?.turnComplete &&
            firstCaption &&
            firstAudioAt &&
            !followupSentAt
          ) {
            followupSentAt = performance.now();
            session?.sendRealtimeInput({
              text:
                "Smoke-test learner input: this reply was sent as text and was entirely in English: 'I ate, but I am still a little hungry.' In present_turn, set learnerSourceLanguage to english, learnerAssessmentConfidence to high, and learnerMeaningRating to 4. Omit learnerIntelligibilityRating, learnerPronunciationRating, learnerFormRating, and learnerTeluguCoverageRating because no Telugu audio was heard. Use these exact learner captions: learnerTeluguInternal 'తిన్నాను, కానీ నాకు ఇంకా ఆకలిగా ఉంది.', learnerRoman 'tinnaanu, kaanee naaku inkaa aakaligaa undi.', learnerPronunciation 'tin-NAA-noo, kaa-NEE naa-koo IN-kaa aa-kuh-lee-GAA oon-DEE.', and learnerEnglish 'I ate, but I am still a little hungry.' Continue naturally in Telugu without changing the locked relationship register.",
            });
          }
        },
        onerror: (error) => {
          rejectReady(
            error instanceof Error
              ? error
              : new Error("Gemini Live reported a connection error."),
          );
        },
        onclose: (event) => {
          if (!expectedClose) {
            rejectReady(
              new Error(
                `Gemini closed before returning audio (${event.code}: ${
                  event.reason || "no reason"
                }).`,
              ),
            );
          }
        },
      },
    });

    const connectedAt = performance.now();
    promptSentAt = performance.now();
    session.sendRealtimeInput({
      text: getLiveOpeningCue(scenario, relationship),
    });

    await ready;

    if (scenario.id === "family-check-in") {
      const expectedCueId =
        relationship === "close"
          ? "have-you-eaten__primary"
          : "have-you-eaten__alt_0";
      if (selectedCueId !== expectedCueId) {
        throw new Error(
          `Expected ${expectedCueId} for ${relationship}, received ${
            selectedCueId || "no reviewed cue"
          }.`,
        );
      }
    }

    return {
      scenario: scenario.id,
      relationship,
      durationSeconds,
      model: LIVE_MODEL,
      selectedCueId,
      caption: firstCaption,
      tokenTtlSeconds: Math.round(
        (Date.parse(tokenExpiresAt) - tokenIssuedAt) / 1_000,
      ),
      newSessionTtlSeconds: Math.round(
        (Date.parse(newSessionExpiresAt) - tokenIssuedAt) / 1_000,
      ),
      tokenMs: Math.round(tokenCreatedAt - tokenStartedAt),
      connectMs: Math.round(connectedAt - startedAt),
      captionCardMs: firstToolCallAt
        ? Math.round(firstToolCallAt - promptSentAt)
        : null,
      firstAudioMs: Math.round(firstAudioAt - promptSentAt),
      ...(verifyConversation
        ? {
            secondTurn: secondCaption,
            secondCaptionMs: Math.round(secondToolCallAt - followupSentAt),
            secondAudioMs: Math.round(secondAudioAt - followupSentAt),
          }
        : {}),
    };
  } finally {
    clearTimeout(timeout);
    expectedClose = true;
    session?.close();
  }
}

const combinations = runMatrix
  ? LIVE_LISTENER_RELATIONSHIPS.flatMap((relationship) =>
      LIVE_SESSION_DURATIONS.map((durationSeconds) => ({
        relationship,
        durationSeconds,
      })),
    )
  : [
      {
        relationship: requestedRelationship,
        durationSeconds: requestedDuration,
      },
    ];

const results = [];
for (const combination of combinations) {
  results.push(
    await runSmoke(combination.relationship, combination.durationSeconds),
  );
}

console.log(JSON.stringify(runMatrix ? results : results[0], null, 2));
