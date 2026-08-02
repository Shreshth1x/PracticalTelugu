"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LiveConnectConfig,
  LiveServerMessage,
  Session,
} from "@google/genai";
import {
  findLivePhraseCue,
  type LivePhraseCue,
} from "./live-follow-along";
import {
  DEFAULT_LIVE_LISTENER_RELATIONSHIP,
  DEFAULT_LIVE_SESSION_DURATION,
  isLiveListenerRelationship,
  isLiveSessionDuration,
  PRESENT_TURN_TOOL_NAME,
  type LiveListenerRelationship,
  type LiveSessionDurationSeconds,
} from "./live-config";
import {
  advanceLearnerTurn,
  createLearnerTurnState,
  learnerActivityEventFromSignal,
  learnerCaptionRequired,
  type LearnerTurnEvent,
} from "./live-learner-turn";
import { liveScenarios, type LiveScenarioId } from "./live-scenarios";
import {
  gradeLiveSession,
  type LiveSessionGrade,
} from "./live-session-grading";
import {
  applyLiveCaptionTurn,
  beginPendingLearnerTurn,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLiveTurnToolCall,
  removePendingLiveTurns,
  type LiveTranscriptTurn,
} from "./live-transcript";

export type { LiveTranscriptTurn } from "./live-transcript";

export type LivePhase =
  | "idle"
  | "requesting"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "ended"
  | "setup"
  | "error";

export type CompletedLiveSession = {
  id: string;
  scenarioId: LiveScenarioId;
  relationship: LiveListenerRelationship;
  sessionLimitSeconds: LiveSessionDurationSeconds;
  completionReason: "manual" | "limit";
  durationSeconds: number;
  learnerTurns: number;
  completedAt: string;
  cueIds?: string[];
  grade?: LiveSessionGrade;
};

type TokenResponse = {
  token?: string;
  model?: string;
  config?: LiveConnectConfig;
  openingCue?: string;
  relationship?: LiveListenerRelationship;
  sessionLimitSeconds?: LiveSessionDurationSeconds;
  tokenExpiresAt?: string;
  code?: string;
  message?: string;
};

type AudioContextConstructor = new (
  contextOptions?: AudioContextOptions,
) => AudioContext;

const INPUT_SAMPLE_RATE = 16_000;
const INPUT_CONTEXT_SAMPLE_RATE = 48_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const PCM_WORKLET_NAME = "practicaltelugu-live-pcm";
const PCM_WORKLET_URL = "/live-pcm-worklet.js";
const LAST_EXCHANGE_SECONDS = 15;

type CompletionReason = CompletedLiveSession["completionReason"];

let genAILibraryPromise: Promise<typeof import("@google/genai")> | null = null;

function loadGenAILibrary() {
  genAILibraryPromise ??= import("@google/genai");
  return genAILibraryPromise;
}

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };

  return window.AudioContext ?? audioWindow.webkitAudioContext;
}

function downsampleToPcm16(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate <= INPUT_SAMPLE_RATE) {
    const output = new Int16Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return output;
  }

  const ratio = inputSampleRate / INPUT_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.floor((outputIndex + 1) * ratio));
    let total = 0;
    let count = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      total += input[inputIndex];
      count += 1;
    }

    const sample = Math.max(-1, Math.min(1, count ? total / count : 0));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

function pcm16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }

  return window.btoa(binary);
}

function base64ToFloat32(value: string) {
  const binary = window.atob(value);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);

  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const view = new DataView(bytes.buffer);
  const output = new Float32Array(byteLength / 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return output;
}

function rmsLevel(samples: Float32Array) {
  if (!samples.length) return 0;

  let sum = 0;
  for (const sample of samples) sum += sample * sample;

  return Math.min(1, Math.sqrt(sum / samples.length) * 4.2);
}

function isSessionPhase(phase: LivePhase) {
  return [
    "requesting",
    "connecting",
    "listening",
    "thinking",
    "speaking",
    "muted",
  ].includes(phase);
}

function describeLiveClose(event: CloseEvent) {
  const reason = event.reason.trim().toLowerCase();

  if (reason.includes("project has been denied access")) {
    return "Live practice is unavailable because Google denied API access for this Gemini project. The site owner needs to review the project in Google AI Studio or replace its API key.";
  }

  if (reason.includes("api key was reported as leaked")) {
    return "Live practice is unavailable because Google blocked its API key. The site owner needs to replace the key in Google AI Studio.";
  }

  if (event.code === 1008) {
    return "Gemini refused this live session. The site owner needs to check the project’s API access and billing status.";
  }

  if (event.code === 1011 || event.code === 1013) {
    return "Gemini Live is temporarily unavailable. Try again in a moment.";
  }

  return "The live conversation ended unexpectedly. Try once more.";
}

function protobufDurationMs(value: string | undefined) {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.max(0, Number(match[1]) * 1_000) : null;
}

export function useGeminiLive(
  scenarioId: LiveScenarioId,
  relationship: LiveListenerRelationship =
    DEFAULT_LIVE_LISTENER_RELATIONSHIP,
  durationSeconds: LiveSessionDurationSeconds = DEFAULT_LIVE_SESSION_DURATION,
) {
  const scenario =
    liveScenarios.find((candidate) => candidate.id === scenarioId) ??
    liveScenarios[0];
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    durationSeconds,
  );
  const [isMuted, setIsMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [transcript, setTranscript] = useState<LiveTranscriptTurn[]>([]);
  const [activeTurn, setActiveTurn] = useState<LiveTranscriptTurn | null>(null);
  const [completedSession, setCompletedSession] =
    useState<CompletedLiveSession | null>(null);
  const [latestTurnLatencyMs, setLatestTurnLatencyMs] = useState<number | null>(
    null,
  );

  const phaseRef = useRef<LivePhase>("idle");
  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<AudioNode | null>(null);
  const inputWorkletReadyRef = useRef<Promise<boolean> | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlaybackTimeRef = useRef(0);
  const levelUpdatedAtRef = useRef(0);
  const assistantLevelUpdatedAtRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const deadlineTimerRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const tokenExpiresAtRef = useRef<number | null>(null);
  const deadlineCheckRef = useRef<() => void>(() => undefined);
  const endSessionRef = useRef<(reason?: CompletionReason) => void>(
    () => undefined,
  );
  const tokenRequestRef = useRef<AbortController | null>(null);
  const connectionAttemptRef = useRef(0);
  const ignoreConnectionEventsRef = useRef(false);
  const mutedRef = useRef(false);
  const closingRequestedRef = useRef(false);
  const goAwayReceivedRef = useRef(false);
  const activeRelationshipRef = useRef<LiveListenerRelationship>(relationship);
  const activeSessionLimitRef = useRef<LiveSessionDurationSeconds>(
    durationSeconds,
  );
  const latestUsageMetadataRef =
    useRef<LiveServerMessage["usageMetadata"]>(undefined);
  const learnerTurnFinishedAtRef = useRef<number | null>(null);
  const mayuTurnCompleteRef = useRef(false);
  const mayuAudioEndedAtRef = useRef<number | null>(null);
  const learnerReplyWindowOpenedAtRef = useRef<number | null>(null);
  const pendingLearnerResponseLatencyMsRef = useRef<number | null>(null);
  const learnerTurnsRef = useRef(0);
  const learnerTurnStateRef = useRef(createLearnerTurnState());
  const transcriptRef = useRef<LiveTranscriptTurn[]>([]);
  const activeTurnRef = useRef<LiveTranscriptTurn | null>(null);
  const toolTurnIdsRef = useRef(new Map<string, string>());
  const usedCueIdsRef = useRef<string[]>([]);
  const mountedRef = useRef(true);

  const updatePhase = useCallback((nextPhase: LivePhase) => {
    if (phaseRef.current === nextPhase) return;
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const shouldCompleteNormally = useCallback(() => {
    const now = Date.now();
    return (
      goAwayReceivedRef.current ||
      (deadlineRef.current !== null && now >= deadlineRef.current - 2_000) ||
      (tokenExpiresAtRef.current !== null &&
        now >= tokenExpiresAtRef.current - 2_000)
    );
  }, []);

  const prepare = useCallback(() => {
    void loadGenAILibrary();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (deadlineTimerRef.current !== null) {
      window.clearTimeout(deadlineTimerRef.current);
      deadlineTimerRef.current = null;
    }
    deadlineRef.current = null;
    tokenExpiresAtRef.current = null;
    deadlineCheckRef.current = () => undefined;
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source that already ended does not need any further cleanup.
      }
    }

    activeSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
    setAssistantLevel(0);
  }, []);

  const releaseHardware = useCallback(() => {
    connectionAttemptRef.current += 1;
    tokenRequestRef.current?.abort();
    tokenRequestRef.current = null;

    stopPlayback();

    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        session.close();
      } catch {
        // The connection may already have closed itself.
      }
    }

    const inputProcessor = inputProcessorRef.current;
    if (inputProcessor && "port" in inputProcessor) {
      (inputProcessor as AudioWorkletNode).port.onmessage = null;
    }
    if (inputProcessor && "onaudioprocess" in inputProcessor) {
      (inputProcessor as ScriptProcessorNode).onaudioprocess = null;
    }
    inputProcessor?.disconnect();
    inputSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    inputProcessorRef.current = null;
    inputWorkletReadyRef.current = null;
    inputSourceRef.current = null;
    silentGainRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const inputContext = inputContextRef.current;
    const outputContext = outputContextRef.current;
    inputContextRef.current = null;
    outputContextRef.current = null;
    if (inputContext && inputContext.state !== "closed") void inputContext.close();
    if (outputContext && outputContext.state !== "closed") void outputContext.close();

    setMicLevel(0);
    setAssistantLevel(0);
  }, [stopPlayback]);

  const failSession = useCallback(
    (message: string) => {
      ignoreConnectionEventsRef.current = true;
      releaseHardware();
      clearTimer();
      mutedRef.current = false;
      setIsMuted(false);
      setErrorMessage(message);
      updatePhase("error");
    },
    [clearTimer, releaseHardware, updatePhase],
  );

  const activateCue = useCallback((cue: LivePhraseCue) => {
    if (!usedCueIdsRef.current.includes(cue.id)) {
      usedCueIdsRef.current = [...usedCueIdsRef.current, cue.id];
    }
  }, []);

  const commitTranscript = useCallback((next: LiveTranscriptTurn[]) => {
    transcriptRef.current = next;
    setTranscript(next);
  }, []);

  const beginLearnerCaption = useCallback(() => {
    const next = beginPendingLearnerTurn(
      transcriptRef.current,
      `you-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    if (next === transcriptRef.current) return;

    transcriptRef.current = next;
    setTranscript(next);
  }, []);

  const applyLearnerTurnEvent = useCallback(
    (event: LearnerTurnEvent) => {
      const transition = advanceLearnerTurn(
        learnerTurnStateRef.current,
        event,
      );
      learnerTurnStateRef.current = transition.state;

      if (transition.effects.beginPendingCaption) beginLearnerCaption();
      if (transition.effects.countLearnerTurn) learnerTurnsRef.current += 1;
      if (transition.effects.startLatencyClock) {
        learnerTurnFinishedAtRef.current = performance.now();
      }

      return transition.effects;
    },
    [beginLearnerCaption],
  );

  const openLearnerReplyWindow = useCallback(() => {
    if (
      !learnerTurnStateRef.current.expectsLearnerResponse ||
      learnerReplyWindowOpenedAtRef.current !== null ||
      pendingLearnerResponseLatencyMsRef.current !== null
    ) {
      return;
    }

    learnerReplyWindowOpenedAtRef.current =
      mayuAudioEndedAtRef.current ?? performance.now();
  }, []);

  const markLearnerResponseStarted = useCallback(() => {
    if (
      !learnerTurnStateRef.current.expectsLearnerResponse ||
      pendingLearnerResponseLatencyMsRef.current !== null
    ) {
      return;
    }

    const responseWindow =
      learnerReplyWindowOpenedAtRef.current ?? mayuAudioEndedAtRef.current;
    if (responseWindow !== null) {
      pendingLearnerResponseLatencyMsRef.current = Math.max(
        0,
        Math.round(performance.now() - responseWindow),
      );
      return;
    }

    // Speaking over the final part of Mayu's turn is still an immediate reply.
    if (activeSourcesRef.current.size) {
      pendingLearnerResponseLatencyMsRef.current = 0;
    }
  }, []);

  const activateTurn = useCallback((turn: LiveTranscriptTurn) => {
    activeTurnRef.current = turn;
    setActiveTurn(turn);
  }, []);

  const playAudio = useCallback(
    (encodedAudio: string) => {
      const context = outputContextRef.current;
      if (!context || context.state === "closed") return;

      const samples = base64ToFloat32(encodedAudio);
      if (!samples.length) return;

      if (learnerTurnFinishedAtRef.current !== null) {
        setLatestTurnLatencyMs(
          Math.max(
            0,
            Math.round(performance.now() - learnerTurnFinishedAtRef.current),
          ),
        );
        learnerTurnFinishedAtRef.current = null;
      }

      const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const startAt = Math.max(
        context.currentTime + 0.025,
        nextPlaybackTimeRef.current,
      );
      nextPlaybackTimeRef.current = startAt + buffer.duration;
      activeSourcesRef.current.add(source);
      const now = performance.now();
      if (now - assistantLevelUpdatedAtRef.current > 55) {
        assistantLevelUpdatedAtRef.current = now;
        setAssistantLevel(Math.max(0.24, rmsLevel(samples)));
      }
      updatePhase("speaking");

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (!activeSourcesRef.current.size) {
          nextPlaybackTimeRef.current = 0;
          mayuAudioEndedAtRef.current = performance.now();
          if (mayuTurnCompleteRef.current) openLearnerReplyWindow();
          if (mountedRef.current) {
            setAssistantLevel(0);
            if (isSessionPhase(phaseRef.current)) {
              updatePhase(mutedRef.current ? "muted" : "listening");
            }
          }
        }
      };

      void context.resume();
      source.start(startAt);
    },
    [openLearnerReplyWindow, updatePhase],
  );

  const handleServerMessage = useCallback(
    (message: LiveServerMessage) => {
      if (message.usageMetadata) {
        latestUsageMetadataRef.current = message.usageMetadata;
      }

      if (message.goAway) {
        goAwayReceivedRef.current = true;
        const timeLeftMs = protobufDurationMs(message.goAway.timeLeft);
        if (timeLeftMs !== null) {
          const goAwayAt = Date.now() + timeLeftMs;
          tokenExpiresAtRef.current = Math.min(
            tokenExpiresAtRef.current ?? goAwayAt,
            goAwayAt,
          );
        }
      }

      const voiceActivityType = message.voiceActivity?.voiceActivityType;
      const vadSignalType =
        message.voiceActivityDetectionSignal?.vadSignalType;
      const activityEvent = learnerActivityEventFromSignal(
        voiceActivityType,
        vadSignalType,
      );

      if (activityEvent?.type === "activity-start") {
        markLearnerResponseStarted();
        applyLearnerTurnEvent(activityEvent);
        if (!mutedRef.current) updatePhase("listening");
      }
      if (activityEvent?.type === "activity-end") {
        applyLearnerTurnEvent(activityEvent);
        updatePhase("thinking");
      }

      const cancelledToolIds = message.toolCallCancellation?.ids ?? [];
      if (cancelledToolIds.length) {
        const cancelledTurnIds = new Set(
          cancelledToolIds
            .map((id) => toolTurnIdsRef.current.get(id))
            .filter((id): id is string => Boolean(id)),
        );

        if (cancelledTurnIds.size) {
          const next = transcriptRef.current.filter(
            (turn) => !cancelledTurnIds.has(turn.id),
          );
          commitTranscript(next);

          if (
            activeTurnRef.current &&
            cancelledTurnIds.has(activeTurnRef.current.id)
          ) {
            const latestMayuTurn = [...next]
              .reverse()
              .find((turn) => turn.speaker === "mayu") ?? null;
            activeTurnRef.current = latestMayuTurn;
            setActiveTurn(latestMayuTurn);
          }
        }

        for (const id of cancelledToolIds) toolTurnIdsRef.current.delete(id);
      }

      const functionCalls = message.toolCall?.functionCalls ?? [];
      if (functionCalls.length) {
        const functionResponses = functionCalls.map((call) => {
          if (call.name !== PRESENT_TURN_TOOL_NAME) {
            return {
              id: call.id,
              name: call.name,
              response: { error: "Use the present_turn caption tool." },
            };
          }

          const parsed = parseLiveTurnToolCall(call.args);
          if (!parsed) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "Provide the internal Telugu cross-check plus complete Telugu written in English letters, pronunciation, and English fields. If any learner field is included, include all learner fields, the accuracy rating, the pronunciation rating when Telugu was spoken, one short coaching tip, and an explicit telugu, english, or mixed source language. Keep Telugu script out of learner-facing fields.",
              },
            };
          }

          if (hasForbiddenAudibleEnglish(parsed.mayu)) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "Remove every English interjection or copied-English word from the audible Telugu turn. Use a natural Telugu acknowledgment instead, then call present_turn again.",
              },
            };
          }

          if (hasKnownMayuMeaningMismatch(parsed.mayu)) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "For the hungry family follow-up, use avunaa, not avunnaa, and ask inkaa emainaa tintaavaa? (close) or inkaa emainaa tintaaraa? (respectful). Correct every Mayu field and call present_turn again.",
              },
            };
          }

          if (
            hasKnownMayuRelationshipMismatch(
              parsed.mayu,
              activeRelationshipRef.current,
            )
          ) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "The hunger follow-up uses the wrong listener relationship. Use tintaavaa for someone close or tintaaraa for an elder or someone new, matching the locked session, then call present_turn again.",
              },
            };
          }

          if (
            parsed.learner &&
            hasKnownLearnerMeaningMismatch(parsed.learner)
          ) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "For a learner meaning that says hungry, use ఆకలి / aakali, such as naaku inkaa aakaligaa undi. Never use pasi or pasigaa for hunger. Correct every learner field and call present_turn again.",
              },
            };
          }

          const cue = parsed.mayu.cueId
            ? findLivePhraseCue(scenario.words, parsed.mayu.cueId)
            : null;
          if (parsed.mayu.cueId && !cue) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "That cueId is not reviewed for this situation. Omit cueId for a natural conversational turn.",
              },
            };
          }

          if (cue && !matchesReviewedLiveCue(parsed.mayu, cue)) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "That cueId requires the exact reviewed native Telugu, romanization, pronunciation, and English meaning. Correct all four fields, or omit cueId for a natural conversational turn.",
              },
            };
          }

          const requiredCueAudience =
            activeRelationshipRef.current === "close"
              ? "familiar"
              : "respectful";
          if (
            cue &&
            cue.audience !== "anyone" &&
            cue.audience !== requiredCueAudience
          ) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "That reviewed cue conflicts with the locked relationship. Use a matching cue, or omit cueId for a natural matching turn.",
              },
            };
          }

          if (
            learnerCaptionRequired(
              learnerTurnStateRef.current,
              parsed.replay,
            ) &&
            !parsed.learner
          ) {
            return {
              id: call.id,
              name: call.name,
              response: {
                error:
                  "Include the learner caption fields from the reply you just heard, then try present_turn again.",
              },
            };
          }

          const toolCallId =
            call.id ??
            `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const isControlTurn = learnerTurnStateRef.current.controlTurnPending;
          const learnerResponseLatencyMs =
            pendingLearnerResponseLatencyMsRef.current ?? undefined;
          let next = transcriptRef.current;

          if (!parsed.replay && parsed.learner) {
            const learnerEffects = applyLearnerTurnEvent({
              type: "learner-caption",
            });
            if (learnerEffects.applyLearnerCaption) {
              next = applyLiveCaptionTurn(next, {
                id: `${toolCallId}-learner`,
                speaker: "you",
                roman: parsed.learner.roman,
                pronunciation: parsed.learner.pronunciation,
                english: parsed.learner.english,
                sourceLanguage: parsed.learner.sourceLanguage,
                responseLatencyMs: learnerResponseLatencyMs,
                assessment: parsed.learner.assessment,
              });
            }
          }

          pendingLearnerResponseLatencyMsRef.current = null;
          learnerReplyWindowOpenedAtRef.current = null;
          mayuAudioEndedAtRef.current = null;
          mayuTurnCompleteRef.current = false;

          const mayuTurn: LiveTranscriptTurn = {
            id: toolCallId,
            speaker: "mayu",
            roman: parsed.mayu.roman,
            pronunciation: parsed.mayu.pronunciation,
            english: parsed.mayu.english,
            final: true,
            cueId: cue?.id,
            sourceLanguage: "telugu",
          };

          if (!parsed.replay) {
            next = applyLiveCaptionTurn(next, mayuTurn);
            toolTurnIdsRef.current.set(toolCallId, mayuTurn.id);
            commitTranscript(next);
            applyLearnerTurnEvent({
              type: "mayu-turn-presented",
              expectsReply: !isControlTurn,
            });
          }

          activateTurn(mayuTurn);
          if (cue) activateCue(cue);

          return {
            id: call.id,
            name: call.name,
            response: {
              output: {
                accepted: true,
                captionReady: true,
                ...(cue ? { cueId: cue.id } : {}),
              },
            },
          };
        });

        sessionRef.current?.sendToolResponse({ functionResponses });
      }

      const content = message.serverContent;
      if (!content) return;

      const audioParts = (content.modelTurn?.parts ?? []).filter(
        (part) => Boolean(part.inlineData?.data),
      );
      const hasModelOutput = Boolean(audioParts.length);

      if (content.interrupted) {
        stopPlayback();
        updatePhase(mutedRef.current ? "muted" : "listening");
      }

      const interimInput = content.interimInputTranscription?.text;
      if (interimInput) {
        markLearnerResponseStarted();
        applyLearnerTurnEvent({ type: "interim-transcription" });
        if (!mutedRef.current) updatePhase("listening");
      }

      const finalInput = content.inputTranscription;
      if (finalInput?.text) {
        markLearnerResponseStarted();
        if (finalInput.finished === true) {
          applyLearnerTurnEvent({
            type: "final-transcription",
            text: finalInput.text,
          });
          updatePhase("thinking");
        } else {
          applyLearnerTurnEvent({ type: "interim-transcription" });
          if (!mutedRef.current) updatePhase("listening");
        }
      }

      if (hasModelOutput) applyLearnerTurnEvent({ type: "model-output" });

      for (const part of audioParts) {
        if (part.inlineData?.data) playAudio(part.inlineData.data);
      }

      if (content.turnComplete || content.waitingForInput) {
        mayuTurnCompleteRef.current = true;
        applyLearnerTurnEvent({ type: "model-turn-complete" });
        if (!activeSourcesRef.current.size) openLearnerReplyWindow();
      }

      if (
        (content.turnComplete || content.waitingForInput) &&
        !activeSourcesRef.current.size
      ) {
        updatePhase(mutedRef.current ? "muted" : "listening");
      }
    },
    [
      activateCue,
      activateTurn,
      applyLearnerTurnEvent,
      commitTranscript,
      markLearnerResponseStarted,
      openLearnerReplyWindow,
      playAudio,
      scenario.words,
      stopPlayback,
      updatePhase,
    ],
  );

  const startCapture = useCallback(
    (stream: MediaStream, session: Session, workletReady: boolean) => {
      const inputContext = inputContextRef.current;
      if (!inputContext) throw new Error("Audio input is not available.");

      const source = inputContext.createMediaStreamSource(stream);
      const silentGain = inputContext.createGain();
      silentGain.gain.value = 0;

      const sendPcm = (pcm: Int16Array, level: number) => {
        if (mutedRef.current || sessionRef.current !== session) return;

        const now = performance.now();
        if (now - levelUpdatedAtRef.current > 55) {
          levelUpdatedAtRef.current = now;
          setMicLevel(level);
        }

        session.sendRealtimeInput({
          audio: {
            data: pcm16ToBase64(pcm),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });
      };

      let processor: AudioNode;
      if (workletReady && typeof AudioWorkletNode !== "undefined") {
        const worklet = new AudioWorkletNode(inputContext, PCM_WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.port.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data as { level?: unknown; pcm?: unknown };
          if (!(message.pcm instanceof ArrayBuffer)) return;
          sendPcm(
            new Int16Array(message.pcm),
            typeof message.level === "number" ? message.level : 0,
          );
        };
        processor = worklet;
      } else {
        const scriptProcessor = inputContext.createScriptProcessor(1024, 1, 1);
        scriptProcessor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          sendPcm(
            downsampleToPcm16(input, inputContext.sampleRate),
            rmsLevel(input),
          );
        };
        processor = scriptProcessor;
      }

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(inputContext.destination);

      inputSourceRef.current = source;
      inputProcessorRef.current = processor;
      silentGainRef.current = silentGain;
      void inputContext.resume();
    },
    [],
  );

  const start = useCallback(async () => {
    if (isSessionPhase(phaseRef.current)) return;

    ignoreConnectionEventsRef.current = true;
    releaseHardware();
    const attemptId = connectionAttemptRef.current;
    clearTimer();
    transcriptRef.current = [];
    activeTurnRef.current = null;
    toolTurnIdsRef.current.clear();
    usedCueIdsRef.current = [];
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setErrorMessage("");
    setElapsedSeconds(0);
    setRemainingSeconds(durationSeconds);
    setLatestTurnLatencyMs(null);
    elapsedRef.current = 0;
    learnerTurnsRef.current = 0;
    learnerTurnStateRef.current = createLearnerTurnState();
    mutedRef.current = false;
    setIsMuted(false);
    closingRequestedRef.current = false;
    goAwayReceivedRef.current = false;
    latestUsageMetadataRef.current = undefined;
    learnerTurnFinishedAtRef.current = null;
    mayuTurnCompleteRef.current = false;
    mayuAudioEndedAtRef.current = null;
    learnerReplyWindowOpenedAtRef.current = null;
    pendingLearnerResponseLatencyMsRef.current = null;
    startedAtRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(
        "This browser cannot open a microphone here. Try the latest Chrome, Safari, or Edge.",
      );
      updatePhase("error");
      return;
    }

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) {
      setErrorMessage(
        "This browser cannot play a live voice session. Try the latest Chrome, Safari, or Edge.",
      );
      updatePhase("error");
      return;
    }

    try {
      inputContextRef.current = new AudioContextClass({
        latencyHint: "interactive",
        // 1024 frames at 48 kHz produces ~21 ms capture chunks before
        // downsampling, keeping the realtime path inside the 20–40 ms target.
        sampleRate: INPUT_CONTEXT_SAMPLE_RATE,
      });
      outputContextRef.current = new AudioContextClass({
        latencyHint: "interactive",
        sampleRate: OUTPUT_SAMPLE_RATE,
      });
      void inputContextRef.current.resume();
      void outputContextRef.current.resume();

      updatePhase("requesting");
      const genAIPromise = loadGenAILibrary();
      const inputContext = inputContextRef.current;
      inputWorkletReadyRef.current =
        inputContext.audioWorklet && typeof AudioWorkletNode !== "undefined"
          ? inputContext.audioWorklet
              .addModule(PCM_WORKLET_URL)
              .then(() => true)
              .catch(() => false)
          : Promise.resolve(false);

      let stream: MediaStream;
      try {
        // Ask for the microphone before minting a one-use credential so a
        // dismissed permission prompt never consumes a Live session token.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          throw new Error(
            "Microphone access is off. Allow it in your browser, then try again.",
          );
        }
        throw error;
      }

      if (attemptId !== connectionAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const requestController = new AbortController();
      tokenRequestRef.current = requestController;
      const tokenPromise = fetch("/api/practice-live/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId,
          relationship,
          durationSeconds,
        }),
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      }).then(async (response) => ({
        response,
        payload: (await response.json()) as TokenResponse,
      }));

      const [tokenResult, { GoogleGenAI }, workletReady] = await Promise.all([
        tokenPromise,
        genAIPromise,
        inputWorkletReadyRef.current,
      ]);
      tokenRequestRef.current = null;
      if (attemptId !== connectionAttemptRef.current) return;

      const { response: tokenResponse, payload: tokenPayload } = tokenResult;

      if (!tokenResponse.ok) {
        ignoreConnectionEventsRef.current = true;
        releaseHardware();
        setErrorMessage(
          tokenPayload.message ??
            "Practice Live could not start. Try again in a moment.",
        );
        updatePhase(tokenPayload.code === "missing_api_key" ? "setup" : "error");
        return;
      }

      const parsedTokenExpiry = Date.parse(tokenPayload.tokenExpiresAt ?? "");
      if (
        !tokenPayload.token ||
        !tokenPayload.model ||
        !tokenPayload.config ||
        !isLiveListenerRelationship(tokenPayload.relationship) ||
        !isLiveSessionDuration(tokenPayload.sessionLimitSeconds) ||
        !Number.isFinite(parsedTokenExpiry) ||
        parsedTokenExpiry <= Date.now()
      ) {
        throw new Error("The live session was not configured correctly.");
      }
      activeRelationshipRef.current = tokenPayload.relationship;
      activeSessionLimitRef.current = tokenPayload.sessionLimitSeconds;
      tokenExpiresAtRef.current = parsedTokenExpiry;
      setRemainingSeconds(tokenPayload.sessionLimitSeconds);
      updatePhase("connecting");
      ignoreConnectionEventsRef.current = false;

      const ai = new GoogleGenAI({
        apiKey: tokenPayload.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const session = await ai.live.connect({
        model: tokenPayload.model,
        config: tokenPayload.config,
        callbacks: {
          onopen: () => {
            if (
              attemptId === connectionAttemptRef.current &&
              !ignoreConnectionEventsRef.current &&
              mountedRef.current
            ) {
              updatePhase("connecting");
            }
          },
          onmessage: (message) => {
            if (
              attemptId === connectionAttemptRef.current &&
              !ignoreConnectionEventsRef.current
            ) {
              handleServerMessage(message);
            }
          },
          onerror: () => {
            if (
              attemptId === connectionAttemptRef.current &&
              !ignoreConnectionEventsRef.current &&
              mountedRef.current
            ) {
              if (shouldCompleteNormally()) {
                endSessionRef.current("limit");
              } else {
                failSession(
                  "The live connection was interrupted. Try once more.",
                );
              }
            }
          },
          onclose: (event) => {
            if (
              attemptId === connectionAttemptRef.current &&
              !ignoreConnectionEventsRef.current &&
              mountedRef.current
            ) {
              if (shouldCompleteNormally()) {
                endSessionRef.current("limit");
              } else {
                failSession(describeLiveClose(event));
              }
            }
          },
        },
      });

      if (
        !mountedRef.current ||
        attemptId !== connectionAttemptRef.current ||
        ignoreConnectionEventsRef.current
      ) {
        ignoreConnectionEventsRef.current = true;
        session.close();
        return;
      }

      sessionRef.current = session;
      startCapture(stream, session, workletReady);
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      const sessionDeadline = Math.min(
        startedAt + tokenPayload.sessionLimitSeconds * 1_000,
        parsedTokenExpiry,
      );
      deadlineRef.current = sessionDeadline;

      const updateDeadline = () => {
        const deadline = deadlineRef.current;
        const sessionStartedAt = startedAtRef.current;
        if (!deadline || !sessionStartedAt) return;

        const now = Date.now();
        const elapsed = Math.max(
          0,
          Math.min(
            activeSessionLimitRef.current,
            Math.floor((now - sessionStartedAt) / 1_000),
          ),
        );
        const remaining = Math.max(0, Math.ceil((deadline - now) / 1_000));
        elapsedRef.current = elapsed;
        setElapsedSeconds(elapsed);
        setRemainingSeconds(remaining);

        if (
          remaining > 0 &&
          remaining <= LAST_EXCHANGE_SECONDS &&
          !closingRequestedRef.current &&
          phaseRef.current === "listening" &&
          sessionRef.current
        ) {
          closingRequestedRef.current = true;
          applyLearnerTurnEvent({ type: "control-turn-requested" });
          updatePhase("thinking");
          sessionRef.current.sendRealtimeInput({
            text:
              "Practice control: this is the last exchange. Give one short, natural Telugu closing in the locked relationship register. Call present_turn before speaking, then wait.",
          });
        }

        if (now >= deadline) endSessionRef.current("limit");
      };

      deadlineCheckRef.current = updateDeadline;
      timerRef.current = window.setInterval(updateDeadline, 250);
      deadlineTimerRef.current = window.setTimeout(
        () => endSessionRef.current("limit"),
        Math.max(0, sessionDeadline - Date.now()),
      );
      updateDeadline();

      updatePhase("thinking");
      session.sendRealtimeInput({
        text:
          tokenPayload.openingCue ??
          "Set the scene in one sentence and begin our practice now.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      failSession(
        error instanceof Error
          ? error.message
          : "Practice Live could not start. Try again in a moment.",
      );
    }
  }, [
    applyLearnerTurnEvent,
    clearTimer,
    failSession,
    handleServerMessage,
    durationSeconds,
    relationship,
    releaseHardware,
    scenarioId,
    shouldCompleteNormally,
    startCapture,
    updatePhase,
  ]);

  const toggleMute = useCallback(() => {
    if (!sessionRef.current || !streamRef.current) return;

    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    if (nextMuted) {
      sessionRef.current.sendRealtimeInput({ audioStreamEnd: true });
      setMicLevel(0);
      if (!activeSourcesRef.current.size) updatePhase("muted");
    } else {
      updatePhase(activeSourcesRef.current.size ? "speaking" : "listening");
    }
  }, [updatePhase]);

  const repeatTurn = useCallback(
    (turnId: string, options: { slow?: boolean } = {}) => {
      const session = sessionRef.current;
      const turn = transcriptRef.current.find(
        (candidate) => candidate.id === turnId && candidate.speaker === "mayu",
      ) ?? (activeTurnRef.current?.id === turnId ? activeTurnRef.current : null);
      if (
        !session ||
        !turn ||
        mutedRef.current ||
        !isSessionPhase(phaseRef.current)
      ) {
        return;
      }

      activateTurn(turn);
      stopPlayback();
      updatePhase("thinking");
      session.sendRealtimeInput({
        text:
          "Practice control: repeat the existing Mayu turn. " +
          `Call present_turn with replay true and these exact caption values: ${JSON.stringify(
            {
              mayuRoman: turn.roman,
              mayuPronunciation: turn.pronunciation ?? turn.roman,
              mayuEnglish: turn.english,
              ...(turn.cueId ? { cueId: turn.cueId } : {}),
            },
          )}. Then say only that same Telugu turn once${
            options.slow ? ", about twenty percent more slowly" : ""
          }. Wait for me to reply.`,
      });
    },
    [activateTurn, stopPlayback, updatePhase],
  );

  const end = useCallback((completionReason: CompletionReason = "manual") => {
    if (!isSessionPhase(phaseRef.current)) return;

    const actualDurationSeconds = startedAtRef.current
      ? Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000))
      : elapsedRef.current;

    ignoreConnectionEventsRef.current = true;
    releaseHardware();
    clearTimer();
    mutedRef.current = false;
    setIsMuted(false);
    const completedTranscript = removePendingLiveTurns(transcriptRef.current);
    const grade = gradeLiveSession(completedTranscript);
    commitTranscript(completedTranscript);
    elapsedRef.current = actualDurationSeconds;
    setElapsedSeconds(actualDurationSeconds);
    if (completionReason === "limit") setRemainingSeconds(0);
    updatePhase("ended");
    setCompletedSession({
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `live-${Date.now()}`,
      scenarioId,
      relationship: activeRelationshipRef.current,
      sessionLimitSeconds: activeSessionLimitRef.current,
      completionReason,
      durationSeconds: actualDurationSeconds,
      learnerTurns: learnerTurnsRef.current,
      completedAt: new Date().toISOString(),
      cueIds: [...usedCueIdsRef.current],
      grade,
    });
  }, [clearTimer, commitTranscript, releaseHardware, scenarioId, updatePhase]);

  const reset = useCallback(() => {
    ignoreConnectionEventsRef.current = true;
    releaseHardware();
    clearTimer();
    mutedRef.current = false;
    setIsMuted(false);
    closingRequestedRef.current = false;
    goAwayReceivedRef.current = false;
    latestUsageMetadataRef.current = undefined;
    learnerTurnFinishedAtRef.current = null;
    mayuTurnCompleteRef.current = false;
    mayuAudioEndedAtRef.current = null;
    learnerReplyWindowOpenedAtRef.current = null;
    pendingLearnerResponseLatencyMsRef.current = null;
    learnerTurnsRef.current = 0;
    learnerTurnStateRef.current = createLearnerTurnState();
    startedAtRef.current = null;
    elapsedRef.current = 0;
    transcriptRef.current = [];
    activeTurnRef.current = null;
    toolTurnIdsRef.current.clear();
    usedCueIdsRef.current = [];
    setElapsedSeconds(0);
    setRemainingSeconds(durationSeconds);
    setLatestTurnLatencyMs(null);
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setErrorMessage("");
    updatePhase("idle");
  }, [clearTimer, durationSeconds, releaseHardware, updatePhase]);

  useEffect(() => {
    endSessionRef.current = end;
  }, [end]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!isSessionPhase(phaseRef.current)) {
      setRemainingSeconds(durationSeconds);
    }
  }, [durationSeconds]);

  useEffect(() => {
    const recheckDeadline = () => deadlineCheckRef.current();

    document.addEventListener("visibilitychange", recheckDeadline);
    window.addEventListener("pageshow", recheckDeadline);
    window.addEventListener("focus", recheckDeadline);

    return () => {
      document.removeEventListener("visibilitychange", recheckDeadline);
      window.removeEventListener("pageshow", recheckDeadline);
      window.removeEventListener("focus", recheckDeadline);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      ignoreConnectionEventsRef.current = true;
      releaseHardware();
      clearTimer();
    };
  }, [clearTimer, releaseHardware]);

  return {
    phase,
    errorMessage,
    elapsedSeconds,
    remainingSeconds,
    isLastExchange:
      isSessionPhase(phase) &&
      remainingSeconds > 0 &&
      remainingSeconds <= LAST_EXCHANGE_SECONDS,
    isMuted,
    micLevel,
    assistantLevel,
    latestTurnLatencyMs,
    transcript,
    activeTurn,
    completedSession,
    canRepeatTurn:
      !isMuted &&
      (phase === "listening" ||
        phase === "thinking" ||
        phase === "speaking"),
    prepare,
    start,
    repeatTurn,
    toggleMute,
    end,
    reset,
  };
}
