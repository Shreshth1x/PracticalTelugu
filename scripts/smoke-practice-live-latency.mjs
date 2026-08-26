import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { FunctionResponseScheduling, GoogleGenAI } from "@google/genai";

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
import { applyLiveConversationPolicy } from "../app/practice-live/live-conversation-policy.ts";
import { isLiveServerGenerationFinished } from "../app/practice-live/live-closing-completion.ts";
import {
  applyOutputTranscriptionUpdate,
  isOutputTranscriptionReady,
} from "./live-output-transcription.mjs";
import { canAcceptLiveSmokeCompletion } from "./live-smoke-response-order.mjs";
import {
  getLiveFamilyAteFollowup,
  getLiveOpeningGreeting,
  getLiveScenario,
} from "../app/practice-live/live-scenarios.ts";
import {
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesPresentedTeluguAudio,
  matchesReviewedLiveCue,
  parseLivePresentedTurnToolCall,
  repairLivePresentedTurnToolCall,
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

const runMatrix = args.includes("--matrix");
const NEW_SESSION_WINDOW_SECONDS = 60;
const TOKEN_EXPIRY_HEADROOM_SECONDS = 70;
const PRE_LEARNER_SILENCE_WINDOW_MS = 1_200;
const POST_TURN_STABILITY_WINDOW_MS = 300;
const RESPONSE_TIMEOUT_MS = 20_000;
const OUTPUT_TRANSCRIPTION_SETTLE_MS = 1_000;
const STALLED_RESPONSE_GRACE_MS = 5_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function inspectOpeningAudio(greeting) {
  const filePath = path.join(process.cwd(), "public", greeting.audioSrc);
  const bytes = await readFile(filePath);
  if (!bytes.length || bytes.length % 2 !== 0) {
    throw new Error(`Invalid opening PCM asset: ${greeting.audioSrc}`);
  }

  const durationSeconds = bytes.length / 2 / 24_000;
  if (durationSeconds < 1 || durationSeconds > 3) {
    throw new Error(
      `Opening PCM duration is outside the expected range: ${durationSeconds.toFixed(2)}s.`,
    );
  }

  return {
    src: greeting.audioSrc,
    bytes: bytes.length,
    durationMs: Math.round(durationSeconds * 1_000),
  };
}

function validateGeneratedTurn(parsed, relationship, turnNumber, rawArgs) {
  if (!parsed) {
    return "The generated turn did not satisfy the presentation contract.";
  }
  const expectedLearnerWords = turnNumber === 1 ? "i am well" : "i ate";
  const normalizeLearnerWords = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const learnerRoman = rawArgs?.learnerRoman;
  const learnerEnglish = rawArgs?.learnerEnglish;
  const hasLearnerContext =
    normalizeLearnerWords(learnerRoman) ||
    normalizeLearnerWords(learnerEnglish);
  if (hasLearnerContext) {
    if (rawArgs?.learnerSourceLanguage !== "english") {
      return "The learner source language was not preserved as English.";
    }
    if (
      normalizeLearnerWords(learnerRoman) !== expectedLearnerWords ||
      normalizeLearnerWords(learnerEnglish) !== expectedLearnerWords
    ) {
      return `The model changed the learner's literal English words instead of preserving "${expectedLearnerWords}."`;
    }
  }
  if (hasForbiddenAudibleEnglish(parsed.mayu)) {
    return "Mayu's generated turn contains audible English.";
  }
  if (parsed.learner && hasKnownLearnerMeaningMismatch(parsed.learner)) {
    return "The learner caption has a known meaning mismatch.";
  }
  if (hasKnownMayuMeaningMismatch(parsed.mayu)) {
    return "Mayu's generated turn has a known meaning mismatch.";
  }
  if (hasKnownMayuRelationshipMismatch(parsed.mayu, relationship)) {
    return "Mayu's generated turn uses the wrong relationship register.";
  }

  const expectedTurn =
    turnNumber === 1
      ? findLivePhraseCue(
          scenario.words,
          relationship === "close"
            ? "have-you-eaten__primary"
            : "have-you-eaten__alt_0",
        )
      : getLiveFamilyAteFollowup(relationship);
  if (!expectedTurn || !matchesReviewedLiveCue(parsed.mayu, expectedTurn)) {
    return turnNumber === 1
      ? "After the learner says they are well, ask exactly whether they have eaten in the locked relationship."
      : `After the learner says they ate, ask exactly "${getLiveFamilyAteFollowup(relationship).telugu}" with matching Roman, pronunciation, and English fields.`;
  }

  if (parsed.mayu.cueId) {
    const cue = findLivePhraseCue(scenario.words, parsed.mayu.cueId);
    const requiredAudience =
      relationship === "close" ? "familiar" : "respectful";
    if (
      !cue ||
      (cue.audience !== "anyone" && cue.audience !== requiredAudience)
    ) {
      return "Mayu claimed a reviewed cue that does not match the active relationship.";
    }
  }

  return "";
}

function inspectInlinePcm(part) {
  const inlineData = part.inlineData;
  if (
    !inlineData?.data ||
    !inlineData.mimeType?.toLowerCase().startsWith("audio/pcm")
  ) {
    return null;
  }

  const bytes = Buffer.from(inlineData.data, "base64");
  const sampleBytes = bytes.length - (bytes.length % 2);
  let peak = 0;
  for (let offset = 0; offset < sampleBytes; offset += 2) {
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
  }

  return {
    bytes: bytes.length,
    peak,
  };
}

async function runSmoke(relationship, durationSeconds) {
  const greeting = getLiveOpeningGreeting(relationship);
  const openingAudio = await inspectOpeningAudio(greeting);
  const startedAt = performance.now();
  let session;
  let expectedClose = false;
  let activeTurnNumber = 1;
  let learnerSentAt = 0;
  let secondLearnerSentAt = 0;
  let firstGeneratedTurnAt = 0;
  let secondGeneratedTurnAt = 0;
  let toolResponseSentAt = 0;
  let secondToolResponseSentAt = 0;
  let firstAudiblePcmAt = 0;
  let secondAudiblePcmAt = 0;
  let firstOutputTranscriptionAt = 0;
  let secondOutputTranscriptionAt = 0;
  let firstOutputTranscriptionFinished = false;
  let secondOutputTranscriptionFinished = false;
  let firstOutputTranscriptionSettled = false;
  let secondOutputTranscriptionSettled = false;
  let firstOutputTranscriptionTimer;
  let secondOutputTranscriptionTimer;
  let firstStalledResponseTimer;
  let secondStalledResponseTimer;
  let serverTurnCompleteAt = 0;
  let secondServerTurnCompleteAt = 0;
  let firstResponseCompleteAt = 0;
  let secondResponseCompleteAt = 0;
  let firstGenerationCompleteAt = 0;
  let secondGenerationCompleteAt = 0;
  let firstWaitingForInputAt = 0;
  let secondWaitingForInputAt = 0;
  let firstResponseRecovered = false;
  let secondResponseRecovered = false;
  let acceptedTurn = null;
  let secondAcceptedTurn = null;
  let acceptedToolCallId = null;
  let secondAcceptedToolCallId = null;
  let audiblePcmBytes = 0;
  let secondAudiblePcmBytes = 0;
  let audiblePcmParts = 0;
  let secondAudiblePcmParts = 0;
  let audiblePcmPeak = 0;
  let secondAudiblePcmPeak = 0;
  let outputTranscription = "";
  let secondOutputTranscription = "";
  const rejectedToolCalls = [];

  let resolveFirstTurn;
  let rejectFirstTurn;
  const firstTurn = new Promise((resolve, reject) => {
    resolveFirstTurn = resolve;
    rejectFirstTurn = reject;
  });
  void firstTurn.catch(() => undefined);
  let resolveSecondTurn;
  let rejectSecondTurn;
  const secondTurn = new Promise((resolve, reject) => {
    resolveSecondTurn = resolve;
    rejectSecondTurn = reject;
  });
  void secondTurn.catch(() => undefined);

  const rejectSmoke = (error) => {
    rejectFirstTurn(error);
    rejectSecondTurn(error);
  };
  const timeout = setTimeout(() => {
    rejectSmoke(
      new Error(
        `Gemini did not finish two audible presented turns without closing. Progress: ${JSON.stringify(
          {
            acceptedToolCallId,
            secondAcceptedToolCallId,
            firstGeneratedTurn: Boolean(firstGeneratedTurnAt),
            secondGeneratedTurn: Boolean(secondGeneratedTurnAt),
            audiblePcmBytes,
            secondAudiblePcmBytes,
            audiblePcmParts,
            secondAudiblePcmParts,
            audiblePcmPeak,
            secondAudiblePcmPeak,
            serverTurnComplete: Boolean(serverTurnCompleteAt),
            secondServerTurnComplete: Boolean(secondServerTurnCompleteAt),
            firstGenerationComplete: Boolean(firstGenerationCompleteAt),
            secondGenerationComplete: Boolean(secondGenerationCompleteAt),
            firstWaitingForInput: Boolean(firstWaitingForInputAt),
            secondWaitingForInput: Boolean(secondWaitingForInputAt),
            firstOutputTranscriptionFinished,
            secondOutputTranscriptionFinished,
            firstOutputTranscriptionReceived: Boolean(outputTranscription),
            secondOutputTranscriptionReceived: Boolean(
              secondOutputTranscription,
            ),
            firstOutputTranscriptionSettled,
            secondOutputTranscriptionSettled,
            firstResponseRecovered,
            secondResponseRecovered,
          },
        )}`,
      ),
    );
  }, RESPONSE_TIMEOUT_MS);

  const resolveCompletedTurn = () => {
    if (activeTurnNumber === 1) {
      const transcriptionReady = isOutputTranscriptionReady(
        {
          text: outputTranscription,
          finished: firstOutputTranscriptionFinished,
        },
        {
          responseComplete: Boolean(firstResponseCompleteAt),
          settleElapsed: firstOutputTranscriptionSettled,
        },
      );
      if (
        acceptedTurn &&
        transcriptionReady &&
        !matchesPresentedTeluguAudio(acceptedTurn.mayu, outputTranscription)
      ) {
        rejectSmoke(
          new Error(
            `First-turn audio transcript did not match the accepted Telugu: ${JSON.stringify({
              accepted: acceptedTurn.mayu.teluguInternal,
              spoken: outputTranscription,
            })}`,
          ),
        );
        return;
      }
      if (
        acceptedTurn &&
        audiblePcmBytes > 0 &&
        audiblePcmPeak > 0 &&
        transcriptionReady
      ) {
        resolveFirstTurn(acceptedTurn);
      }
      return;
    }

    const transcriptionReady = isOutputTranscriptionReady(
      {
        text: secondOutputTranscription,
        finished: secondOutputTranscriptionFinished,
      },
      {
        responseComplete: Boolean(secondResponseCompleteAt),
        settleElapsed: secondOutputTranscriptionSettled,
      },
    );
    if (
      secondAcceptedTurn &&
      transcriptionReady &&
      !matchesPresentedTeluguAudio(
        secondAcceptedTurn.mayu,
        secondOutputTranscription,
      )
    ) {
      rejectSmoke(
        new Error(
          `Second-turn audio transcript did not match the accepted Telugu: ${JSON.stringify({
            accepted: secondAcceptedTurn.mayu.teluguInternal,
            spoken: secondOutputTranscription,
          })}`,
        ),
      );
      return;
    }

    if (
      secondAcceptedTurn &&
      secondAudiblePcmBytes > 0 &&
      secondAudiblePcmPeak > 0 &&
      transcriptionReady
    ) {
      resolveSecondTurn(secondAcceptedTurn);
    }
  };

  const armOutputTranscriptionSettle = () => {
    const isFirstTurn = activeTurnNumber === 1;
    const text = isFirstTurn
      ? outputTranscription
      : secondOutputTranscription;
    const finished = isFirstTurn
      ? firstOutputTranscriptionFinished
      : secondOutputTranscriptionFinished;
    const responseComplete = isFirstTurn
      ? Boolean(firstResponseCompleteAt)
      : Boolean(secondResponseCompleteAt);
    if (!text || !responseComplete) return;

    const currentTimer = isFirstTurn
      ? firstOutputTranscriptionTimer
      : secondOutputTranscriptionTimer;
    clearTimeout(currentTimer);

    if (finished) {
      if (isFirstTurn) {
        firstOutputTranscriptionSettled = true;
      } else {
        secondOutputTranscriptionSettled = true;
      }
      resolveCompletedTurn();
      return;
    }

    const timer = setTimeout(() => {
      if (isFirstTurn) {
        firstOutputTranscriptionSettled = true;
      } else {
        secondOutputTranscriptionSettled = true;
      }
      resolveCompletedTurn();
    }, OUTPUT_TRANSCRIPTION_SETTLE_MS);
    if (isFirstTurn) {
      firstOutputTranscriptionTimer = timer;
    } else {
      secondOutputTranscriptionTimer = timer;
    }
  };

  const armStalledResponseRecovery = () => {
    const isFirstTurn = activeTurnNumber === 1;
    const currentTimer = isFirstTurn
      ? firstStalledResponseTimer
      : secondStalledResponseTimer;
    clearTimeout(currentTimer);

    const timer = setTimeout(() => {
      const accepted = isFirstTurn ? acceptedTurn : secondAcceptedTurn;
      const audibleBytes = isFirstTurn
        ? audiblePcmBytes
        : secondAudiblePcmBytes;
      const audiblePeak = isFirstTurn ? audiblePcmPeak : secondAudiblePcmPeak;
      const responseComplete = isFirstTurn
        ? firstResponseCompleteAt
        : secondResponseCompleteAt;
      if (!accepted || !audibleBytes || !audiblePeak || responseComplete) return;

      if (isFirstTurn) {
        firstResponseCompleteAt = performance.now();
        firstResponseRecovered = true;
      } else {
        secondResponseCompleteAt = performance.now();
        secondResponseRecovered = true;
      }
      armOutputTranscriptionSettle();
      resolveCompletedTurn();
    }, STALLED_RESPONSE_GRACE_MS);

    if (isFirstTurn) {
      firstStalledResponseTimer = timer;
    } else {
      secondStalledResponseTimer = timer;
    }
  };

  try {
    const options = { relationship, durationSeconds };
    const config = {
      ...buildLiveConnectConfig(scenario, options),
      sessionResumption: {},
      outputAudioTranscription: {},
    };
    const tokenIssuedAt = Date.now();
    const tokenExpiresAt = new Date(
      tokenIssuedAt +
        (durationSeconds + TOKEN_EXPIRY_HEADROOM_SECONDS) * 1_000,
    ).toISOString();
    const newSessionExpiresAt = new Date(
      tokenIssuedAt + NEW_SESSION_WINDOW_SECONDS * 1_000,
    ).toISOString();
    const serverAi = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    const tokenStartedAt = performance.now();
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
        onmessage(message) {
          const functionCalls = message.toolCall?.functionCalls ?? [];
          const content = message.serverContent;
          const modelParts = content?.modelTurn?.parts ?? [];
          const outputTranscriptionUpdate = content?.outputTranscription;
          const spokenTranscription = outputTranscriptionUpdate?.text;
          let acceptedPresentationThisMessage = false;
          const hasPrematureModelTurn = Boolean(
            modelParts.length ||
              content?.outputTranscription?.text ||
              functionCalls.length ||
              modelParts.some((part) => Boolean(part.inlineData?.data)),
          );

          if (!learnerSentAt && hasPrematureModelTurn) {
            rejectSmoke(
              new Error(
                "Gemini generated an opening instead of waiting for the app-presented greeting reply.",
              ),
            );
            return;
          }

          const activeLearnerSentAt =
            activeTurnNumber === 1 ? learnerSentAt : secondLearnerSentAt;
          const activeAcceptedTurn =
            activeTurnNumber === 1 ? acceptedTurn : secondAcceptedTurn;

          if (activeLearnerSentAt && functionCalls.length) {
            if (activeAcceptedTurn) {
              rejectSmoke(
                new Error(
                  `Gemini called a second tool before new learner input: ${JSON.stringify({
                    acceptedToolCallId:
                      activeTurnNumber === 1
                        ? acceptedToolCallId
                        : secondAcceptedToolCallId,
                    unexpected: functionCalls.map((call) => ({
                      id: call.id,
                      name: call.name,
                      args: call.args,
                    })),
                  })}`,
                ),
              );
              return;
            }
            if (functionCalls.length > 1) {
              rejectSmoke(
                new Error(
                  `Gemini called multiple tools before new learner input: ${JSON.stringify(
                    functionCalls.map((call) => ({
                      id: call.id,
                      name: call.name,
                    })),
                  )}`,
                ),
              );
              return;
            }

            const call = functionCalls[0];
            if (call.name !== PRESENT_TURN_TOOL_NAME) {
              rejectSmoke(
                new Error(`Gemini called an unexpected tool: ${call.name}`),
              );
              return;
            }

            let parsed =
              parseLivePresentedTurnToolCall(call.args) ??
              repairLivePresentedTurnToolCall(call.args);
            if (parsed) {
              parsed = applyLiveConversationPolicy({
                scenarioId: scenario.id,
                relationship,
                turn: parsed,
              });
            }
            const validationError = validateGeneratedTurn(
              parsed,
              relationship,
              activeTurnNumber,
              call.args,
            );
            if (validationError) {
              rejectedToolCalls.push({
                error: validationError,
                args: call.args,
              });
              if (rejectedToolCalls.length >= 4) {
                rejectSmoke(
                  new Error(
                    `${validationError} Calls: ${JSON.stringify(rejectedToolCalls)}`,
                  ),
                );
                return;
              }
              session?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name: call.name,
                    scheduling: FunctionResponseScheduling.INTERRUPT,
                    response: {
                      error:
                        `${validationError} This turn follows learner input. Learner context is optional; either leave every learner field null or preserve the learner's exact English words without translating, completing, or inferring them. Use only Latin letters in every Roman, pronunciation, and English field, and native Telugu script only in mayuTeluguInternal. Tinnaavaa or tinnaaraa means did you eat or have you eaten, not breakfast. Then call present_turn again before speaking.`,
                    },
                  },
                ],
              });
              return;
            }
            if (matchesReviewedLiveCue(parsed.mayu, greeting)) {
              const error =
                "Gemini repeated the opening greeting after the learner replied.";
              rejectedToolCalls.push({ error, args: call.args });
              session?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name: call.name,
                    scheduling: FunctionResponseScheduling.INTERRUPT,
                    response: {
                      error:
                        "The app already presented the greeting. Respond to the learner and begin the selected situation instead.",
                    },
                  },
                ],
              });
              return;
            }

            const cue = parsed.mayu.cueId
              ? findLivePhraseCue(scenario.words, parsed.mayu.cueId)
              : null;
            if (activeTurnNumber === 1) {
              firstGeneratedTurnAt ||= performance.now();
              acceptedTurn = parsed;
              acceptedToolCallId = call.id ?? null;
              toolResponseSentAt = performance.now();
            } else {
              secondGeneratedTurnAt ||= performance.now();
              secondAcceptedTurn = parsed;
              secondAcceptedToolCallId = call.id ?? null;
              secondToolResponseSentAt = performance.now();
            }
            acceptedPresentationThisMessage = true;
            session?.sendToolResponse({
              functionResponses: [
                {
                  id: call.id,
                  name: call.name,
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
                },
              ],
            });
          }

          if (
            (activeTurnNumber === 1 && !acceptedTurn) ||
            (activeTurnNumber === 2 && !secondAcceptedTurn)
          ) {
            return;
          }

          // The blocking tool-call message belongs to the pre-continuation
          // generation. Any response boundary on that same message cannot
          // prove that the accepted spoken continuation completed.
          if (acceptedPresentationThisMessage && content) return;

          if (outputTranscriptionUpdate) {
            if (activeTurnNumber === 1) {
              if (spokenTranscription) {
                firstOutputTranscriptionAt ||= performance.now();
              }
              const updated = applyOutputTranscriptionUpdate(
                {
                  text: outputTranscription,
                  finished: firstOutputTranscriptionFinished,
                },
                outputTranscriptionUpdate,
              );
              outputTranscription = updated.text;
              firstOutputTranscriptionFinished = updated.finished;
              firstOutputTranscriptionSettled = false;
            } else {
              if (spokenTranscription) {
                secondOutputTranscriptionAt ||= performance.now();
              }
              const updated = applyOutputTranscriptionUpdate(
                {
                  text: secondOutputTranscription,
                  finished: secondOutputTranscriptionFinished,
                },
                outputTranscriptionUpdate,
              );
              secondOutputTranscription = updated.text;
              secondOutputTranscriptionFinished = updated.finished;
              secondOutputTranscriptionSettled = false;
            }
          }

          for (const part of modelParts) {
            const pcm = inspectInlinePcm(part);
            if (!pcm || pcm.peak === 0) continue;
            if (activeTurnNumber === 1) {
              firstAudiblePcmAt ||= performance.now();
              audiblePcmBytes += pcm.bytes;
              audiblePcmParts += 1;
              audiblePcmPeak = Math.max(audiblePcmPeak, pcm.peak);
            } else {
              secondAudiblePcmAt ||= performance.now();
              secondAudiblePcmBytes += pcm.bytes;
              secondAudiblePcmParts += 1;
              secondAudiblePcmPeak = Math.max(
                secondAudiblePcmPeak,
                pcm.peak,
              );
            }
            armStalledResponseRecovery();
          }

          const canAcceptCompletion = canAcceptLiveSmokeCompletion({
            hasAcceptedTurn:
              activeTurnNumber === 1
                ? Boolean(acceptedTurn)
                : Boolean(secondAcceptedTurn),
            audiblePcmBytes:
              activeTurnNumber === 1
                ? audiblePcmBytes
                : secondAudiblePcmBytes,
            audiblePcmPeak:
              activeTurnNumber === 1
                ? audiblePcmPeak
                : secondAudiblePcmPeak,
          });

          if (content?.turnComplete && canAcceptCompletion) {
            if (activeTurnNumber === 1) {
              serverTurnCompleteAt ||= performance.now();
            } else {
              secondServerTurnCompleteAt ||= performance.now();
            }
          }
          if (content?.generationComplete && canAcceptCompletion) {
            if (activeTurnNumber === 1) {
              firstGenerationCompleteAt ||= performance.now();
            } else {
              secondGenerationCompleteAt ||= performance.now();
            }
          }
          if (content?.waitingForInput && canAcceptCompletion) {
            if (activeTurnNumber === 1) {
              firstWaitingForInputAt ||= performance.now();
            } else {
              secondWaitingForInputAt ||= performance.now();
            }
          }
          if (
            content &&
            canAcceptCompletion &&
            isLiveServerGenerationFinished(content)
          ) {
            if (activeTurnNumber === 1) {
              firstResponseCompleteAt ||= performance.now();
              clearTimeout(firstStalledResponseTimer);
            } else {
              secondResponseCompleteAt ||= performance.now();
              clearTimeout(secondStalledResponseTimer);
            }
          }
          if (
            outputTranscriptionUpdate ||
            (content &&
              canAcceptCompletion &&
              isLiveServerGenerationFinished(content))
          ) {
            armOutputTranscriptionSettle();
          }
          resolveCompletedTurn();
        },
        onerror(error) {
          rejectSmoke(
            error instanceof Error
              ? error
              : new Error("Gemini Live reported a connection error."),
          );
        },
        onclose(event) {
          if (!expectedClose) {
            rejectSmoke(
              new Error(
                `Gemini closed early (${event.code}: ${event.reason || "no reason"}). Progress: ${JSON.stringify(
                  {
                    learnerSent: Boolean(learnerSentAt),
                    secondLearnerSent: Boolean(secondLearnerSentAt),
                    acceptedToolCallId,
                    secondAcceptedToolCallId,
                    firstGeneratedTurn: Boolean(firstGeneratedTurnAt),
                    secondGeneratedTurn: Boolean(secondGeneratedTurnAt),
                    audiblePcmBytes,
                    secondAudiblePcmBytes,
                    serverTurnComplete: Boolean(serverTurnCompleteAt),
                    secondServerTurnComplete: Boolean(
                      secondServerTurnCompleteAt,
                    ),
                    firstGenerationComplete: Boolean(firstGenerationCompleteAt),
                    secondGenerationComplete: Boolean(secondGenerationCompleteAt),
                    firstWaitingForInput: Boolean(firstWaitingForInputAt),
                    secondWaitingForInput: Boolean(secondWaitingForInputAt),
                    rejectedToolCalls: rejectedToolCalls.length,
                  },
                )}`,
              ),
            );
          }
        },
      },
    });
    const connectedAt = performance.now();

    await delay(PRE_LEARNER_SILENCE_WINDOW_MS);

    learnerSentAt = performance.now();
    session.sendRealtimeInput({
      text: "Practice smoke input: the learner spoke entirely in English and said, 'I am well.'",
    });
    const parsed = await firstTurn;
    await delay(POST_TURN_STABILITY_WINDOW_MS);

    activeTurnNumber = 2;
    secondLearnerSentAt = performance.now();
    session.sendRealtimeInput({
      text: "Practice smoke input: the learner spoke entirely in English and said, 'I ate.'",
    });
    const secondParsed = await secondTurn;

    return {
      scenario: scenario.id,
      relationship,
      durationSeconds,
      model: LIVE_MODEL,
      greeting: {
        telugu: greeting.telugu,
        roman: greeting.roman,
        english: greeting.english,
      },
      openingAudio,
      preLearnerStayedSilentMs: PRE_LEARNER_SILENCE_WINDOW_MS,
      stayedOpenAfterFirstTurnMs: POST_TURN_STABILITY_WINDOW_MS,
      tokenTtlSeconds: Math.round(
        (Date.parse(tokenExpiresAt) - tokenIssuedAt) / 1_000,
      ),
      newSessionTtlSeconds: Math.round(
        (Date.parse(newSessionExpiresAt) - tokenIssuedAt) / 1_000,
      ),
      tokenMs: Math.round(tokenCreatedAt - tokenStartedAt),
      connectMs: Math.round(connectedAt - startedAt),
      firstGeneratedTurnMs: Math.round(firstGeneratedTurnAt - learnerSentAt),
      firstAudiblePcmMs: Math.round(firstAudiblePcmAt - learnerSentAt),
      firstOutputTranscriptionMs: Math.round(
        firstOutputTranscriptionAt - learnerSentAt,
      ),
      serverTurnCompleteMs: serverTurnCompleteAt
        ? Math.round(serverTurnCompleteAt - learnerSentAt)
        : null,
      firstResponseCompleteMs: Math.round(
        firstResponseCompleteAt - learnerSentAt,
      ),
      continuationMs: Math.round(firstResponseCompleteAt - toolResponseSentAt),
      acceptedToolCallId,
      secondGeneratedTurnMs: Math.round(
        secondGeneratedTurnAt - secondLearnerSentAt,
      ),
      secondAudiblePcmMs: Math.round(
        secondAudiblePcmAt - secondLearnerSentAt,
      ),
      secondOutputTranscriptionMs: Math.round(
        secondOutputTranscriptionAt - secondLearnerSentAt,
      ),
      secondServerTurnCompleteMs: secondServerTurnCompleteAt
        ? Math.round(secondServerTurnCompleteAt - secondLearnerSentAt)
        : null,
      secondResponseCompleteMs: Math.round(
        secondResponseCompleteAt - secondLearnerSentAt,
      ),
      secondContinuationMs: Math.round(
        secondResponseCompleteAt - secondToolResponseSentAt,
      ),
      secondAcceptedToolCallId,
      presentationBehavior: "BLOCKING",
      audiblePcm: {
        bytes: audiblePcmBytes,
        parts: audiblePcmParts,
        peak: audiblePcmPeak,
      },
      secondAudiblePcm: {
        bytes: secondAudiblePcmBytes,
        parts: secondAudiblePcmParts,
        peak: secondAudiblePcmPeak,
      },
      firstGeneratedTurn: parsed,
      outputTranscription,
      firstOutputTranscriptionFinished,
      firstOutputTranscriptionSettled,
      firstGenerationComplete: Boolean(firstGenerationCompleteAt),
      firstWaitingForInput: Boolean(firstWaitingForInputAt),
      firstResponseRecovered,
      secondGeneratedTurn: secondParsed,
      secondOutputTranscription,
      secondOutputTranscriptionFinished,
      secondOutputTranscriptionSettled,
      secondGenerationComplete: Boolean(secondGenerationCompleteAt),
      secondWaitingForInput: Boolean(secondWaitingForInputAt),
      secondResponseRecovered,
      rejectedToolCalls,
    };
  } finally {
    clearTimeout(timeout);
    clearTimeout(firstOutputTranscriptionTimer);
    clearTimeout(secondOutputTranscriptionTimer);
    clearTimeout(firstStalledResponseTimer);
    clearTimeout(secondStalledResponseTimer);
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
  let result;
  let attempts = 0;
  while (!result && attempts < 2) {
    attempts += 1;
    try {
      result = await runSmoke(
        combination.relationship,
        combination.durationSeconds,
      );
    } catch (error) {
      const transient =
        error instanceof Error &&
        /(?:1011|temporarily unavailable|internal error|did not finish two audible presented turns without closing)/iu.test(
          error.message,
        );
      if (!transient || attempts >= 2) throw error;
    }
  }
  results.push({ ...result, attempts });
}

console.log(JSON.stringify(runMatrix ? results : results[0], null, 2));
