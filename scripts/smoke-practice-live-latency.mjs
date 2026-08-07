import { performance } from "node:perf_hooks";

import {
  FunctionResponseScheduling,
  GoogleGenAI,
} from "@google/genai";

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
  parseLivePresentedTurnToolCall,
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

// `--conversation` remains accepted for existing command lines. The smoke now
// always verifies the same fast two-turn exchange and has no private Live turn.
const runMatrix = args.includes("--matrix");
const NEW_SESSION_WINDOW_SECONDS = 60;
const TOKEN_EXPIRY_HEADROOM_SECONDS = 70;

async function runSmoke(relationship, durationSeconds) {
  const startedAt = performance.now();
  let promptSentAt = 0;
  let firstToolCallAt = 0;
  let firstRawAudioAt = 0;
  let firstAudioAt = 0;
  let selectedCueId = "";
  let firstCaption = null;
  let followupSentAt = 0;
  let secondToolCallAt = 0;
  let secondRawAudioAt = 0;
  let secondAudioAt = 0;
  let secondTurnCompleteAt = 0;
  let secondCaption = null;
  let lastToolCall = null;
  let presentToolCallCount = 0;
  let acceptedPresentToolCallCount = 0;
  let rejectedPresentToolCallCount = 0;
  let finalizedPresentTurnCount = 0;
  let duplicatePresentToolCallCount = 0;
  let supersededCandidateCount = 0;
  let audibleTurnCount = 0;
  let activeTurnHasAudio = false;
  let pendingAudioPartCount = 0;
  let bufferedAudioPartCount = 0;
  let suppressedAudioPartCount = 0;
  let suppressAudioUntilBoundary = false;
  let presentationReady = false;
  let pendingCandidate = null;
  const presentCalls = [];
  let expectedClose = false;
  let session;

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function resolveWhenReady() {
    if (secondToolCallAt && secondAudioAt && secondTurnCompleteAt) {
      resolveReady();
    }
  }

  const timeout = setTimeout(() => {
    const progress = {
      firstPresent: Boolean(firstToolCallAt),
      firstRawAudio: Boolean(firstRawAudioAt),
      firstAudio: Boolean(firstAudioAt),
      learnerFollowup: Boolean(followupSentAt),
      secondPresent: Boolean(secondToolCallAt),
      secondRawAudio: Boolean(secondRawAudioAt),
      secondAudio: Boolean(secondAudioAt),
      secondTurnComplete: Boolean(secondTurnCompleteAt),
      audibleTurnCount,
      pendingAudioPartCount,
      suppressAudioUntilBoundary,
    };
    rejectReady(
      new Error(
        `Gemini did not complete the expected two-turn presentation/audio sequence in time. Progress: ${JSON.stringify(progress)}.${
          lastToolCall ? ` Last tool call: ${JSON.stringify(lastToolCall)}` : ""
        }`,
      ),
    );
  }, 30_000);

  function phaseName() {
    return followupSentAt ? "learner-followup" : "opening";
  }

  function markAudibleAudio(at = performance.now()) {
    if (!presentationReady || activeTurnHasAudio) return;

    activeTurnHasAudio = true;
    audibleTurnCount += 1;
    if (followupSentAt) secondAudioAt ||= at;
    else firstAudioAt ||= at;
  }

  function finalizePendingCandidate() {
    const candidate = pendingCandidate;
    if (!candidate) return false;

    pendingCandidate = null;
    presentationReady = true;
    finalizedPresentTurnCount += 1;
    candidate.record.recordedAs = `${candidate.phase}-final`;

    if (candidate.phase === "opening") {
      firstCaption = candidate.parsed.mayu;
      firstToolCallAt = candidate.receivedAt;
      selectedCueId = candidate.cue?.id ?? "";
    } else {
      secondCaption = candidate.parsed;
      secondToolCallAt = candidate.receivedAt;
    }

    if (pendingAudioPartCount) {
      pendingAudioPartCount = 0;
      markAudibleAudio();
    }
    return true;
  }

  function discardPendingCandidate(reason) {
    if (pendingCandidate) {
      pendingCandidate.record.recordedAs = `${pendingCandidate.phase}-${reason}`;
      pendingCandidate = null;
    }
    pendingAudioPartCount = 0;
  }

  function resetPresentationBoundary() {
    activeTurnHasAudio = false;
    pendingAudioPartCount = 0;
    pendingCandidate = null;
    presentationReady = false;
    suppressAudioUntilBoundary = false;
  }

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

              if (call.name !== PRESENT_TURN_TOOL_NAME) {
                return {
                  id: call.id,
                  name: call.name,
                  scheduling: FunctionResponseScheduling.INTERRUPT,
                  response: {
                    error: `Use ${PRESENT_TURN_TOOL_NAME} for every audible Mayu turn.`,
                  },
                };
              }

              presentToolCallCount += 1;
              const receivedAt = performance.now();
              const phase = phaseName();
              const relativeTo = followupSentAt || promptSentAt;

              if (presentationReady) {
                duplicatePresentToolCallCount += 1;
                rejectedPresentToolCallCount += 1;
                suppressAudioUntilBoundary = true;
                presentCalls.push({
                  sequence: presentCalls.length + 1,
                  phase,
                  relativeMs: Math.round(receivedAt - relativeTo),
                  accepted: false,
                  recordedAs: `${phase}-duplicate-rejected`,
                  args: call.args,
                });
                return {
                  id: call.id,
                  name: call.name,
                  scheduling: FunctionResponseScheduling.SILENT,
                  response: {
                    error:
                      "The current Mayu speech has already been presented. Do not call present_turn again until the learner replies.",
                  },
                };
              }

              const parsed = parseLivePresentedTurnToolCall(call.args);
              const learnerCaption = parsed?.learner ?? null;
              const needsLearnerCaption = Boolean(followupSentAt);
              const cueId = parsed?.mayu.cueId ?? "";
              const cue = cueId
                ? findLivePhraseCue(scenario.words, cueId)
                : null;
              const requiredAudience =
                relationship === "close" ? "familiar" : "respectful";
              const validCueClaim = Boolean(
                parsed &&
                  (!cueId ||
                    (cue &&
                      matchesReviewedLiveCue(parsed.mayu, cue) &&
                      (cue.audience === "anyone" ||
                        cue.audience === requiredAudience))),
              );
              const hasForbiddenEnglish = Boolean(
                parsed && hasForbiddenAudibleEnglish(parsed.mayu),
              );
              const hasKnownLearnerMismatch = Boolean(
                learnerCaption &&
                  hasKnownLearnerMeaningMismatch(learnerCaption),
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
              const fabricatedLearnerCaption = Boolean(
                !needsLearnerCaption && learnerCaption,
              );

              let rejection = "";
              if (!parsed) {
                rejection =
                  "Use only the present_turn schema fields. Provide all four complete Mayu fields; use cueId, never reviewedCueId; use lowercase learnerSourceLanguage when a learner caption is required. Then speak the matching Telugu immediately.";
              } else if (fabricatedLearnerCaption) {
                rejection =
                  "No learner has spoken yet. Remove every learner field, keep Mayu in her role, and continue from the accepted opening.";
              } else if (needsLearnerCaption && !learnerCaption) {
                rejection =
                  "After learner input, include learnerTeluguInternal, learnerRoman, learnerEnglish, and learnerSourceLanguage in present_turn. learnerPronunciation is optional.";
              } else if (hasForbiddenEnglish) {
                rejection =
                  "Remove every English interjection or copied-English word from the audible Telugu turn. Use a natural Telugu acknowledgment instead, then call present_turn again.";
              } else if (hasKnownLearnerMismatch) {
                rejection =
                  "For a learner meaning that says hungry, use ఆకలి / aakali, such as naaku inkaa aakaligaa undi. Never use pasi or pasigaa for hunger. Correct every learner field and call present_turn again.";
              } else if (hasKnownMayuMismatch) {
                rejection =
                  "For the hungry family follow-up, use avunaa, not avunnaa, and ask inkaa emainaa tintaavaa? (close) or inkaa emainaa tintaaraa? (respectful). Correct every Mayu field and call present_turn again.";
              } else if (hasKnownRelationshipMismatch) {
                rejection =
                  "The hunger follow-up uses the wrong listener relationship. Use tintaavaa for someone close or tintaaraa for an elder or someone new, matching the locked session.";
              } else if (!validCueClaim) {
                rejection = cue
                  ? "That cueId requires the exact reviewed phrase in the active relationship register. Correct every caption field or omit cueId."
                  : "That cueId is not reviewed for this situation. Omit cueId for a natural conversational turn.";
              }

              if (rejection) {
                rejectedPresentToolCallCount += 1;
                presentCalls.push({
                  sequence: presentCalls.length + 1,
                  phase,
                  relativeMs: Math.round(receivedAt - relativeTo),
                  accepted: false,
                  recordedAs: `${phase}-rejected`,
                  args: call.args,
                });
                if (!fabricatedLearnerCaption) {
                  discardPendingCandidate("discarded-by-rejection");
                }
                return {
                  id: call.id,
                  name: call.name,
                  scheduling: FunctionResponseScheduling.INTERRUPT,
                  response: { error: rejection },
                };
              }

              acceptedPresentToolCallCount += 1;
              if (pendingCandidate) {
                pendingCandidate.record.recordedAs =
                  `${pendingCandidate.phase}-superseded`;
                supersededCandidateCount += 1;
              }
              const record = {
                sequence: presentCalls.length + 1,
                phase,
                relativeMs: Math.round(receivedAt - relativeTo),
                accepted: true,
                recordedAs: `${phase}-candidate`,
                args: call.args,
              };
              presentCalls.push(record);
              pendingCandidate = {
                phase,
                receivedAt,
                parsed: {
                  ...parsed,
                  learner: needsLearnerCaption ? learnerCaption : null,
                },
                cue,
                record,
              };

              return {
                id: call.id,
                name: call.name,
                scheduling: FunctionResponseScheduling.WHEN_IDLE,
                response: {
                  output: {
                    accepted: true,
                    captionReady: true,
                    continueSameTurn: true,
                    spokenTelugu: parsed.mayu.teluguInternal,
                    instruction:
                      "CONTINUATION ONLY: call no tool. Speak exactly spokenTelugu now, then wait.",
                    ...(cue ? { cueId: cue.id } : {}),
                  },
                },
              };
            });

            session?.sendToolResponse({ functionResponses });
            if (pendingAudioPartCount && pendingCandidate) {
              finalizePendingCandidate();
            }
          }

          const audioParts = (
            message.serverContent?.modelTurn?.parts ?? []
          ).filter((part) => Boolean(part.inlineData?.data));
          if (audioParts.length && promptSentAt) {
            const receivedAt = performance.now();
            if (suppressAudioUntilBoundary) {
              suppressedAudioPartCount += audioParts.length;
            } else {
              if (followupSentAt) secondRawAudioAt ||= receivedAt;
              else firstRawAudioAt ||= receivedAt;

              if (!presentationReady) {
                pendingAudioPartCount += audioParts.length;
                bufferedAudioPartCount += audioParts.length;
                finalizePendingCandidate();
              }
              if (presentationReady) markAudibleAudio(receivedAt);
            }
          }

          const content = message.serverContent;
          if (content?.turnComplete || content?.waitingForInput) {
            suppressAudioUntilBoundary = false;
            if (firstCaption && firstAudioAt && !followupSentAt) {
              resetPresentationBoundary();
              followupSentAt = performance.now();
              session?.sendRealtimeInput({
                text:
                  "Smoke-test learner input: this reply was sent as text and was entirely in English: 'I ate, but I am still a little hungry.' For the next audible Mayu turn, call present_turn with these learner captions: learnerTeluguInternal 'తిన్నాను, కానీ నాకు ఇంకా ఆకలిగా ఉంది.', learnerRoman 'tinnaanu, kaanee naaku inkaa aakaligaa undi.', learnerPronunciation 'tin-NAA-noo, kaa-NEE naa-koo IN-kaa aa-kuh-lee-GAA oon-DEE.', learnerEnglish 'I ate, but I am still a little hungry.', and learnerSourceLanguage 'english'. Respond to that latest meaning and move one small step forward as Mayu; do not repeat the learner's self-report as Mayu. Call present_turn exactly once immediately before speaking, then wait.",
              });
            } else if (secondCaption && secondAudioAt) {
              secondTurnCompleteAt ||= performance.now();
              resetPresentationBoundary();
              resolveWhenReady();
            }
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

    if (firstToolCallAt > firstAudioAt || !firstRawAudioAt) {
      throw new Error(
        "The first Mayu audio could not be buffered behind present_turn.",
      );
    }
    if (secondToolCallAt > secondAudioAt || !secondRawAudioAt) {
      throw new Error(
        "The second Mayu audio could not be buffered behind present_turn.",
      );
    }
    if (finalizedPresentTurnCount !== 2) {
      throw new Error(
        `Expected two finalized latest presentation candidates, received ${finalizedPresentTurnCount}.`,
      );
    }
    if (audibleTurnCount !== 2) {
      throw new Error(
        `Expected exactly two audible turns after duplicate suppression, received ${audibleTurnCount}.`,
      );
    }
    const finalizedCalls = presentCalls.filter((entry) =>
      entry.recordedAs.endsWith("-final"),
    );
    if (
      finalizedCalls.length !== 2 ||
      finalizedCalls[0]?.phase !== "opening" ||
      finalizedCalls[1]?.phase !== "learner-followup"
    ) {
      throw new Error(
        `The latest validated candidate was not finalized once per turn: ${JSON.stringify(presentCalls)}.`,
      );
    }
    if (
      presentCalls.some(
        (entry) =>
          entry.accepted && entry.recordedAs.includes("duplicate-rejected"),
      )
    ) {
      throw new Error("A duplicate present_turn was accepted after playback began.");
    }

    if (scenario.id === "family-check-in") {
      const expectedCueId =
        relationship === "close"
          ? "have-you-eaten__primary"
          : "have-you-eaten__alt_0";
      if (selectedCueId !== expectedCueId) {
        throw new Error(
          `Expected ${expectedCueId} for ${relationship}, received ${
            selectedCueId || "no reviewed cue"
          }. Present calls: ${JSON.stringify(presentCalls)}. Last tool call: ${JSON.stringify(lastToolCall)}.`,
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
      presentTurnMs: Math.round(firstToolCallAt - promptSentAt),
      captionCardMs: Math.round(firstToolCallAt - promptSentAt),
      firstRawAudioMs: Math.round(firstRawAudioAt - promptSentAt),
      firstAudioMs: Math.round(firstAudioAt - promptSentAt),
      firstPlaybackMs: Math.round(firstAudioAt - promptSentAt),
      presentToAudioMs: Math.round(firstAudioAt - firstToolCallAt),
      audioBufferMs: Math.round(firstAudioAt - firstRawAudioAt),
      audioArrivedBeforePresent: firstRawAudioAt < firstToolCallAt,
      secondTurn: secondCaption,
      secondPresentTurnMs: Math.round(secondToolCallAt - followupSentAt),
      secondCaptionMs: Math.round(secondToolCallAt - followupSentAt),
      secondRawAudioMs: Math.round(secondRawAudioAt - followupSentAt),
      secondAudioMs: Math.round(secondAudioAt - followupSentAt),
      secondPlaybackMs: Math.round(secondAudioAt - followupSentAt),
      secondPresentToAudioMs: Math.round(secondAudioAt - secondToolCallAt),
      secondAudioBufferMs: Math.round(secondAudioAt - secondRawAudioAt),
      secondAudioArrivedBeforePresent: secondRawAudioAt < secondToolCallAt,
      secondTurnCompleteMs: Math.round(
        secondTurnCompleteAt - followupSentAt,
      ),
      presentToolCallCount,
      acceptedPresentToolCallCount,
      rejectedPresentToolCallCount,
      finalizedPresentTurnCount,
      duplicatePresentToolCallCount,
      supersededCandidateCount,
      bufferedAudioPartCount,
      suppressedAudioPartCount,
      audibleTurnCount,
      presentCalls,
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
