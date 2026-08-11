"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LiveConnectConfig,
  LiveServerMessage,
  Session,
} from "@google/genai";
import { FunctionResponseScheduling } from "@google/genai";
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
import {
  createLiveEchoGate,
  type LiveEchoGate,
} from "./live-echo-gate";
import {
  createLiveConnectBoundary,
  nextLiveResumptionHandle,
  type LiveConnectBoundary,
} from "./live-connect-boundary";
import {
  createLiveOutputCaptureGuard,
  shouldForwardLiveMicrophoneFrame,
  type LiveOutputCaptureGuard,
} from "./live-output-capture-guard";
import {
  getLiveOpeningGreeting,
  liveScenarios,
  type LiveScenarioId,
} from "./live-scenarios";
import { applyLiveConversationPolicy } from "./live-conversation-policy";
import {
  gradeLiveSession,
  type LiveSessionGrade,
} from "./live-session-grading";
import {
  canSendClosingControlNow,
  shouldCompleteClosingPlayback,
} from "./live-closing-completion";
import { isCalibratedLiveLearnerAssessment } from "./live-assessment";
import {
  appendLiveAssessmentAudio,
  createLiveAssessmentAudioCapture,
  markLiveAssessmentActivityEnd,
  markLiveAssessmentActivityStart,
  resetLiveAssessmentAudioCapture,
  takeLiveAssessmentAudio,
} from "./live-assessment-audio";
import {
  applyLiveCaptionTurn,
  applyLiveLearnerAssessment,
  applyProvisionalLearnerTranscript,
  beginPendingLearnerTurn,
  createGroundedLiveLearnerCaption,
  createUnscoredLiveLearnerCaption,
  finalizeLiveTranscriptForEnd,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLivePresentedTurnToolCall,
  repairLivePresentedTurnToolCall,
  sanitizeLiveProvisionalTranscript,
  type ParsedLiveCaptionTurn,
  type ParsedLivePresentedTurnToolCall,
  type LiveTranscriptSource,
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
  assessmentAccessToken?: string;
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
// A watchdog frees the conversation when Gemini's audio and its accepted
// presentation ever arrive out of contract instead of stalling silently.
const PENDING_AUDIO_WATCHDOG_MS = 1_500;
const STUCK_PRESENTATION_WATCHDOG_MS = 5_000;
// A short first-chunk lead absorbs network jitter between audio chunks; the
// drain grace keeps a momentary gap from resetting playback mid-sentence.
const INITIAL_PLAYBACK_LEAD_SECONDS = 0.12;
const CHUNK_PLAYBACK_LEAD_SECONDS = 0.025;
const PLAYBACK_DRAIN_GRACE_MS = 250;
// A validated farewell normally completes as soon as its audio and acoustic
// tail drain. Keep one bounded escape hatch if Gemini omits a final boundary.
const CLOSING_PLAYBACK_GRACE_MS = 10_000;
const LIVE_RECONNECT_TIMEOUT_MS = 10_000;
// Browser track settings only confirm that AEC was requested; they do not
// prove that speaker playback is absent from the captured signal. Keep the
// production conversation fail-safe and half-duplex until real device-route
// acoustic tests justify enabling barge-in during Mayu's speech.
const LIVE_FULL_DUPLEX_ENABLED = false;
const CLOSING_CONTROL_TEXT =
  "Practice control: this is the last exchange. Give one short, natural Telugu closing in the locked relationship register. Call present_turn before speaking. This closes the session, so do not ask a question or invite a reply.";

type CompletionReason = CompletedLiveSession["completionReason"];

type PendingPresentedTurn = {
  toolCallId: string;
  parsed: ParsedLivePresentedTurnToolCall;
  cue: LivePhraseCue | null;
  learnerCaption: ParsedLiveCaptionTurn | null;
  learnerTurnId: string;
  learnerResponseLatencyMs?: number;
  hasLearnerReply: boolean;
  isControlTurn: boolean;
};

type PendingGroundedLearnerTurn = {
  epochId: number;
  learnerTurnId: string;
  learnerResponseLatencyMs?: number;
  sourceLanguage?: LiveTranscriptSource;
  pcm: Int16Array | null;
  priorMayu: Pick<LiveTranscriptTurn, "roman" | "english"> | null;
};

type LearnerAssessmentRequest = {
  turnId: string;
  pcm: Int16Array;
  priorMayu: Pick<LiveTranscriptTurn, "roman" | "english">;
  checkedCaption: Pick<
    ParsedLiveCaptionTurn,
    "roman" | "english" | "sourceLanguage"
  >;
};

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

function pcm16ArrayBufferToFloat32(value: ArrayBuffer) {
  if (!value.byteLength || value.byteLength % 2 !== 0) {
    throw new Error("Mayu's opening greeting audio is unavailable.");
  }

  const view = new DataView(value);
  const output = new Float32Array(value.byteLength / 2);

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
  // Sanitized provider ASR for the in-flight learner reply, rendered as an
  // explicitly unchecked draft so the learner sees what was heard right away.
  const [learnerDraft, setLearnerDraft] = useState("");
  // Half-duplex is the production-safe default: browser AEC settings alone do
  // not prove that Mayu's speaker output is absent from captured microphone PCM.
  const [duplexMode, setDuplexMode] = useState<"full" | "half">("half");
  const [reconnectCount, setReconnectCount] = useState(0);
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
  const outputCaptureGuardRef = useRef<LiveOutputCaptureGuard | null>(null);
  const echoGateRef = useRef<LiveEchoGate | null>(null);
  const duplexModeRef = useRef<"full" | "half">("half");
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
  const assessmentAccessTokenRef = useRef<string | null>(null);
  const assessmentRequestControllersRef = useRef(new Set<AbortController>());
  const connectionAttemptRef = useRef(0);
  const ignoreConnectionEventsRef = useRef(false);
  const mutedRef = useRef(false);
  const closingRequestedRef = useRef(false);
  const closingQueuedRef = useRef(false);
  const closingPlaybackPendingRef = useRef(false);
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
  const microphoneStreamOpenRef = useRef(false);
  const transcriptRef = useRef<LiveTranscriptTurn[]>([]);
  const activeTurnRef = useRef<LiveTranscriptTurn | null>(null);
  const toolTurnIdsRef = useRef(new Map<string, string>());
  const mayuPresentationReadyRef = useRef(false);
  const openingGreetingPendingRef = useRef(false);
  const pendingNativeAudioRef = useRef<string[]>([]);
  const pendingPresentedTurnRef = useRef<PendingPresentedTurn | null>(null);
  const pendingGroundedLearnerTurnsRef = useRef(
    new Map<number, PendingGroundedLearnerTurn>(),
  );
  const pendingAudioWatchdogRef = useRef<number | null>(null);
  const stuckPresentationWatchdogRef = useRef<number | null>(null);
  const drainGraceTimerRef = useRef<number | null>(null);
  const releaseStalledPresentationRef = useRef<() => void>(() => undefined);
  const outputTranscriptionTextRef = useRef("");
  const resumeHandleRef = useRef<string | null>(null);
  const resumeAttemptedRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const attemptResumeRef = useRef<(failureMessage: string) => boolean>(
    () => false,
  );
  const workletReadyResolvedRef = useRef(false);
  const liveConnectionRef = useRef<{
    apiToken: string;
    model: string;
    config: LiveConnectConfig;
    callbacks: {
      onopen: () => void;
      onmessage: (message: LiveServerMessage) => void;
      onerror: () => void;
      onclose: (event: CloseEvent) => void;
    };
  } | null>(null);
  const learnerAssessmentAudioRef = useRef(
    createLiveAssessmentAudioCapture(),
  );
  const usedCueIdsRef = useRef<string[]>([]);
  const mountedRef = useRef(true);

  const updatePhase = useCallback((nextPhase: LivePhase) => {
    if (phaseRef.current === nextPhase) return;
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearPendingAudioWatchdog = useCallback(() => {
    if (pendingAudioWatchdogRef.current !== null) {
      window.clearTimeout(pendingAudioWatchdogRef.current);
      pendingAudioWatchdogRef.current = null;
    }
  }, []);

  const clearStuckPresentationWatchdog = useCallback(() => {
    if (stuckPresentationWatchdogRef.current !== null) {
      window.clearTimeout(stuckPresentationWatchdogRef.current);
      stuckPresentationWatchdogRef.current = null;
    }
  }, []);

  const clearDrainGraceTimer = useCallback(() => {
    if (drainGraceTimerRef.current !== null) {
      window.clearTimeout(drainGraceTimerRef.current);
      drainGraceTimerRef.current = null;
    }
  }, []);

  const armPendingAudioWatchdog = useCallback(() => {
    if (pendingAudioWatchdogRef.current !== null) return;
    pendingAudioWatchdogRef.current = window.setTimeout(() => {
      pendingAudioWatchdogRef.current = null;
      releaseStalledPresentationRef.current();
    }, PENDING_AUDIO_WATCHDOG_MS);
  }, []);

  const armStuckPresentationWatchdog = useCallback(() => {
    clearStuckPresentationWatchdog();
    stuckPresentationWatchdogRef.current = window.setTimeout(() => {
      stuckPresentationWatchdogRef.current = null;
      releaseStalledPresentationRef.current();
    }, STUCK_PRESENTATION_WATCHDOG_MS);
  }, [clearStuckPresentationWatchdog]);

  const getOutputCaptureGuard = useCallback(() => {
    outputCaptureGuardRef.current ??= createLiveOutputCaptureGuard({
      scheduleTimeout: (callback, delayMs) =>
        window.setTimeout(callback, delayMs),
      cancelTimeout: (handle) => window.clearTimeout(handle as number),
    });

    return outputCaptureGuardRef.current;
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

  const cancelPendingAssessmentRequests = useCallback(() => {
    for (const controller of assessmentRequestControllersRef.current) {
      controller.abort();
    }
    assessmentRequestControllersRef.current.clear();
    assessmentAccessTokenRef.current = null;
    resetLiveAssessmentAudioCapture(learnerAssessmentAudioRef.current);
  }, []);

  const endMicrophoneStream = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !microphoneStreamOpenRef.current) return false;

    microphoneStreamOpenRef.current = false;
    session.sendRealtimeInput({ audioStreamEnd: true });
    return true;
  }, []);

  const stopPlayback = useCallback(() => {
    clearDrainGraceTimer();
    const hadActiveOutput = activeSourcesRef.current.size > 0;
    for (const source of activeSourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that already ended does not need any further cleanup.
      }
    }

    activeSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
    // A stop here is an interruption or teardown: release the guard right
    // away instead of re-arming an echo tail, so the learner's barge-in is
    // heard without a dead-microphone-meter gap.
    getOutputCaptureGuard().cancel();
    if (hadActiveOutput) setMicLevel(0);
    setAssistantLevel(0);
    return hadActiveOutput;
  }, [clearDrainGraceTimer, getOutputCaptureGuard]);

  const releaseHardware = useCallback(() => {
    connectionAttemptRef.current += 1;
    tokenRequestRef.current?.abort();
    tokenRequestRef.current = null;
    liveConnectionRef.current = null;
    resumeHandleRef.current = null;
    openingGreetingPendingRef.current = false;
    closingPlaybackPendingRef.current = false;
    clearPendingAudioWatchdog();
    clearStuckPresentationWatchdog();

    stopPlayback();
    getOutputCaptureGuard().cancel();
    echoGateRef.current?.reset();

    const session = sessionRef.current;
    sessionRef.current = null;
    microphoneStreamOpenRef.current = false;
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
    workletReadyResolvedRef.current = false;

    const inputContext = inputContextRef.current;
    const outputContext = outputContextRef.current;
    inputContextRef.current = null;
    outputContextRef.current = null;
    if (inputContext && inputContext.state !== "closed") void inputContext.close();
    if (outputContext && outputContext.state !== "closed") void outputContext.close();

    setMicLevel(0);
    setAssistantLevel(0);
  }, [
    clearPendingAudioWatchdog,
    clearStuckPresentationWatchdog,
    getOutputCaptureGuard,
    stopPlayback,
  ]);

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

  const attachLearnerAssessment = useCallback(
    (
      turnId: string,
      assessment: LiveTranscriptTurn["assessment"],
    ) => {
      if (!assessment) return false;
      const next = applyLiveLearnerAssessment(
        transcriptRef.current,
        turnId,
        assessment,
      );
      if (next === transcriptRef.current) return false;

      commitTranscript(next);
      setCompletedSession((current) =>
        current
          ? {
              ...current,
              grade: gradeLiveSession(next),
            }
          : current,
      );
      return true;
    },
    [commitTranscript],
  );

  const requestLearnerAssessment = useCallback(
    ({
      turnId,
      pcm,
      priorMayu,
      checkedCaption,
    }: LearnerAssessmentRequest) => {
      const accessToken = assessmentAccessTokenRef.current;
      if (!accessToken || !pcm.length) return;

      const controller = new AbortController();
      assessmentRequestControllersRef.current.add(controller);
      const requestBody = JSON.stringify({
        scenarioId: scenario.id,
        relationship: activeRelationshipRef.current,
        pcm16Base64: pcm16ToBase64(pcm),
        priorMayu: {
          roman: priorMayu.roman,
          english: priorMayu.english,
        },
        checkedCaption: {
          roman: checkedCaption.roman,
          english: checkedCaption.english,
          sourceLanguage: checkedCaption.sourceLanguage,
        },
      });

      void (async () => {
        let assessment: LiveTranscriptTurn["assessment"];
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const response = await fetch("/api/practice-live/assessment", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: requestBody,
                cache: "no-store",
                credentials: "same-origin",
                signal: controller.signal,
              });
              const payload = await response.json().catch(() => null);
              if (
                response.ok &&
                isCalibratedLiveLearnerAssessment(payload)
              ) {
                assessment = payload;
                break;
              }
              if (response.status < 500) break;
            } catch {
              if (controller.signal.aborted) throw new DOMException(
                "Assessment request aborted.",
                "AbortError",
              );
            }
          }
        } catch {
          // Aborted sessions must not update a later transcript.
        } finally {
          assessmentRequestControllersRef.current.delete(controller);
        }

        if (controller.signal.aborted) return;
        attachLearnerAssessment(
          turnId,
          assessment ??
            createUnscoredLiveLearnerCaption(
              "I could not assess this reply confidently. Try the next reply at a comfortable pace.",
              "incomplete-assessment",
            ).assessment,
        );
      })();
    },
    [attachLearnerAssessment, scenario.id],
  );

  const finalizeGroundedLearnerTurn = useCallback(
    (epochId: number, providerTranscript: unknown) => {
      const pending = pendingGroundedLearnerTurnsRef.current.get(epochId);
      if (!pending) return false;

      const groundedCaption = createGroundedLiveLearnerCaption(
        providerTranscript,
        pending.sourceLanguage,
      );
      if (!groundedCaption) return false;

      const next = applyLiveCaptionTurn(transcriptRef.current, {
        id: pending.learnerTurnId,
        speaker: "you",
        roman: groundedCaption.roman,
        english: groundedCaption.english,
        sourceLanguage: groundedCaption.sourceLanguage,
        responseLatencyMs: pending.learnerResponseLatencyMs,
      });
      commitTranscript(next);
      setLearnerDraft("");
      pendingGroundedLearnerTurnsRef.current.delete(epochId);

      if (pending.pcm && pending.priorMayu) {
        requestLearnerAssessment({
          turnId: pending.learnerTurnId,
          pcm: pending.pcm,
          priorMayu: pending.priorMayu,
          checkedCaption: groundedCaption,
        });
      }
      return true;
    },
    [commitTranscript, requestLearnerAssessment],
  );

  const prepareMayuResponse = useCallback(() => {
    closingPlaybackPendingRef.current = false;
    mayuPresentationReadyRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
    outputTranscriptionTextRef.current = "";
    clearPendingAudioWatchdog();
    clearStuckPresentationWatchdog();
  }, [clearPendingAudioWatchdog, clearStuckPresentationWatchdog]);

  const beginLearnerCaption = useCallback(() => {
    const next = beginPendingLearnerTurn(
      transcriptRef.current,
      `you-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    if (next === transcriptRef.current) return;

    transcriptRef.current = next;
    setTranscript(next);
  }, []);

  const applyLearnerTranscriptDraft = useCallback(
    (value: unknown) => {
      const next = applyProvisionalLearnerTranscript(
        transcriptRef.current,
        value,
      );
      if (next === transcriptRef.current) return;
      // Interim provider ASR is explicitly fallible and stays provisional.
      // Only a final inputTranscription event may promote its sanitized words
      // into the visible learner row; dialogue-model learner fields never do.
      transcriptRef.current = next;
      const pending = next.findLast(
        (turn) => turn.speaker === "you" && !turn.final,
      );
      setLearnerDraft(pending?.provisionalRoman ?? "");
    },
    [],
  );

  const applyLearnerTurnEvent = useCallback(
    (event: LearnerTurnEvent) => {
      const transition = advanceLearnerTurn(
        learnerTurnStateRef.current,
        event,
      );
      learnerTurnStateRef.current = transition.state;

      if (transition.effects.beginPendingCaption) {
        prepareMayuResponse();
        beginLearnerCaption();
      }
      if (transition.effects.countLearnerTurn) learnerTurnsRef.current += 1;
      if (transition.effects.startLatencyClock) {
        learnerTurnFinishedAtRef.current = performance.now();
      }

      return transition.effects;
    },
    [beginLearnerCaption, prepareMayuResponse],
  );

  const openLearnerReplyWindow = useCallback(() => {
    if (
      !learnerTurnStateRef.current.expectsLearnerResponse ||
      learnerReplyWindowOpenedAtRef.current !== null ||
      pendingLearnerResponseLatencyMsRef.current !== null
    ) {
      return;
    }

    resetLiveAssessmentAudioCapture(learnerAssessmentAudioRef.current);
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

  const sendQueuedClosingControl = useCallback(() => {
    if (!closingQueuedRef.current || !sessionRef.current) return false;

    closingQueuedRef.current = false;
    applyLearnerTurnEvent({ type: "control-turn-requested" });
    prepareMayuResponse();
    updatePhase("thinking");
    sessionRef.current.sendRealtimeInput({ text: CLOSING_CONTROL_TEXT });
    return true;
  }, [applyLearnerTurnEvent, prepareMayuResponse, updatePhase]);

  const settleAssistantPlayback = useCallback(() => {
    if (activeSourcesRef.current.size) return;

    setAssistantLevel(0);
    getOutputCaptureGuard().releaseAfterTail(() => {
      if (!mountedRef.current || activeSourcesRef.current.size) return;

      if (!mayuTurnCompleteRef.current) {
        if (phaseRef.current === "speaking") updatePhase("thinking");
        return;
      }

      if (pendingPresentedTurnRef.current) {
        // turnComplete can precede the continuation turn's first audio chunk.
        // Keep the validated presentation pending instead of erasing it; the
        // buffered-audio path or its watchdog finalizes and plays it.
        armStuckPresentationWatchdog();
        if (phaseRef.current === "speaking") updatePhase("thinking");
        return;
      }

      if (
        shouldCompleteClosingPlayback({
          closingPlaybackPending: closingPlaybackPendingRef.current,
          activeAudioSourceCount: activeSourcesRef.current.size,
          mayuTurnComplete: mayuTurnCompleteRef.current,
          hasPendingPresentation: false,
        })
      ) {
        closingPlaybackPendingRef.current = false;
        endSessionRef.current("limit");
        return;
      }

      mayuAudioEndedAtRef.current = performance.now();
      if (openingGreetingPendingRef.current) {
        openingGreetingPendingRef.current = false;
        applyLearnerTurnEvent({
          type: "mayu-turn-presented",
          expectsReply: true,
        });
      }
      prepareMayuResponse();
      openLearnerReplyWindow();
      if (sendQueuedClosingControl()) return;
      if (isSessionPhase(phaseRef.current)) {
        updatePhase(mutedRef.current ? "muted" : "listening");
      }
    });
  }, [
    applyLearnerTurnEvent,
    armStuckPresentationWatchdog,
    getOutputCaptureGuard,
    openLearnerReplyWindow,
    prepareMayuResponse,
    sendQueuedClosingControl,
    updatePhase,
  ]);

  const playSamples = useCallback(
    (samples: Float32Array) => {
      const context = outputContextRef.current;
      if (!context || context.state === "closed") return;
      if (!samples.length) return;

      // The guard sequences the reply window and keeps microphone uploads
      // closed through playback plus the short acoustic tail. Capture stays
      // alive so reopening does not incur another permission or device delay.
      clearDrainGraceTimer();
      clearStuckPresentationWatchdog();
      getOutputCaptureGuard().beginOutput();
      setMicLevel(0);

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
      buffer.copyToChannel(new Float32Array(samples), 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const lead =
        nextPlaybackTimeRef.current === 0
          ? INITIAL_PLAYBACK_LEAD_SECONDS
          : CHUNK_PLAYBACK_LEAD_SECONDS;
      const startAt = Math.max(
        context.currentTime + lead,
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
        if (activeSourcesRef.current.size) return;

        // A momentary network gap between chunks must not reset scheduling or
        // flash the phase mid-sentence; settle only after a short drain grace.
        clearDrainGraceTimer();
        drainGraceTimerRef.current = window.setTimeout(() => {
          drainGraceTimerRef.current = null;
          if (activeSourcesRef.current.size) return;
          nextPlaybackTimeRef.current = 0;
          settleAssistantPlayback();
        }, PLAYBACK_DRAIN_GRACE_MS);
      };

      void context.resume();
      source.start(startAt);
    },
    [
      clearDrainGraceTimer,
      clearStuckPresentationWatchdog,
      getOutputCaptureGuard,
      settleAssistantPlayback,
      updatePhase,
    ],
  );

  const playAudio = useCallback(
    (encodedAudio: string) => {
      playSamples(base64ToFloat32(encodedAudio));
    },
    [playSamples],
  );

  const finalizePendingPresentation = useCallback(() => {
    const pending = pendingPresentedTurnRef.current;
    if (!pending) return false;

    pendingPresentedTurnRef.current = null;
    const priorMayu = activeTurnRef.current;
    let assessmentRequest: LearnerAssessmentRequest | null = null;
    let next = transcriptRef.current;
    if (!pending.parsed.replay && pending.hasLearnerReply) {
      const learnerEffects = applyLearnerTurnEvent({
        type: "learner-caption",
      });
      if (learnerEffects.applyLearnerCaption) {
        const epoch = learnerTurnStateRef.current.currentEpoch;
        const pcm = takeLiveAssessmentAudio(learnerAssessmentAudioRef.current);
        const priorMayuContext = priorMayu?.speaker === "mayu"
          ? { roman: priorMayu.roman, english: priorMayu.english }
          : null;

        if (epoch) {
          const pendingGroundedTurn: PendingGroundedLearnerTurn = {
            epochId: epoch.id,
            learnerTurnId: pending.learnerTurnId,
            learnerResponseLatencyMs: pending.learnerResponseLatencyMs,
            sourceLanguage: pending.learnerCaption?.sourceLanguage,
            pcm,
            priorMayu: priorMayuContext,
          };
          pendingGroundedLearnerTurnsRef.current.set(
            epoch.id,
            pendingGroundedTurn,
          );

          const groundedCaption = createGroundedLiveLearnerCaption(
            epoch.finalText,
            pendingGroundedTurn.sourceLanguage,
          );
          if (groundedCaption) {
            next = applyLiveCaptionTurn(next, {
              id: pending.learnerTurnId,
              speaker: "you",
              roman: groundedCaption.roman,
              english: groundedCaption.english,
              sourceLanguage: groundedCaption.sourceLanguage,
              responseLatencyMs: pending.learnerResponseLatencyMs,
            });
            setLearnerDraft("");
            pendingGroundedLearnerTurnsRef.current.delete(epoch.id);
            if (pcm && priorMayuContext) {
              assessmentRequest = {
                turnId: pending.learnerTurnId,
                pcm,
                priorMayu: priorMayuContext,
                checkedCaption: groundedCaption,
              };
            }
          }
        }
      }
    }

    pendingLearnerResponseLatencyMsRef.current = null;
    learnerReplyWindowOpenedAtRef.current = null;
    mayuAudioEndedAtRef.current = null;
    mayuTurnCompleteRef.current = false;

    if (!pending.parsed.replay && pending.isControlTurn) {
      closingPlaybackPendingRef.current = true;
    }

    const mayuTurn: LiveTranscriptTurn = {
      id: pending.toolCallId,
      speaker: "mayu",
      roman: pending.parsed.mayu.roman,
      pronunciation: pending.parsed.mayu.pronunciation,
      english: pending.parsed.mayu.english,
      final: true,
      cueId: pending.cue?.id,
      sourceLanguage: "telugu",
    };

    if (!pending.parsed.replay) {
      next = applyLiveCaptionTurn(next, mayuTurn);
      toolTurnIdsRef.current.set(pending.toolCallId, mayuTurn.id);
      commitTranscript(next);
      applyLearnerTurnEvent({
        type: "mayu-turn-presented",
        expectsReply: !pending.isControlTurn,
      });
    }

    activateTurn(mayuTurn);
    if (pending.cue) activateCue(pending.cue);

    mayuPresentationReadyRef.current = true;
    clearPendingAudioWatchdog();
    const pendingAudio = pendingNativeAudioRef.current;
    pendingNativeAudioRef.current = [];
    for (const encodedAudio of pendingAudio) {
      playAudio(encodedAudio);
    }
    // A finalized presentation with no audio yet must not stall the session
    // if Gemini never speaks; the watchdog settles the turn with its caption.
    if (!pendingAudio.length) armStuckPresentationWatchdog();
    if (assessmentRequest) {
      window.setTimeout(
        () => requestLearnerAssessment(assessmentRequest),
        0,
      );
    }
    return true;
  }, [
    activateCue,
    activateTurn,
    applyLearnerTurnEvent,
    armStuckPresentationWatchdog,
    clearPendingAudioWatchdog,
    commitTranscript,
    playAudio,
    requestLearnerAssessment,
  ]);

  useEffect(() => {
    // Watchdog recovery shared by both stall shapes: audio buffered without an
    // accepted presentation, and an accepted presentation whose audio never
    // arrived. Either way the conversation continues instead of hanging.
    releaseStalledPresentationRef.current = () => {
      if (!mountedRef.current) return;

      if (pendingPresentedTurnRef.current) {
        finalizePendingPresentation();
        return;
      }

      const buffered = pendingNativeAudioRef.current;
      if (buffered.length && !mayuPresentationReadyRef.current) {
        // Mayu spoke without an accepted present_turn call. Release the audio
        // with a transliterated output-transcription caption fallback.
        const roman = sanitizeLiveProvisionalTranscript(
          outputTranscriptionTextRef.current,
        );
        const fallbackTurn: LiveTranscriptTurn = {
          id: `mayu-uncaptioned-${Date.now()}`,
          speaker: "mayu",
          roman: roman || "(Telugu caption unavailable)",
          english: "Live caption unavailable for this turn.",
          final: true,
          sourceLanguage: "telugu",
        };
        commitTranscript(
          applyLiveCaptionTurn(transcriptRef.current, fallbackTurn),
        );
        const isControlTurn =
          learnerTurnStateRef.current.controlTurnPending;
        if (isControlTurn) closingPlaybackPendingRef.current = true;
        applyLearnerTurnEvent({
          type: "mayu-turn-presented",
          expectsReply: !isControlTurn,
        });
        activateTurn(fallbackTurn);
        mayuPresentationReadyRef.current = true;
        pendingNativeAudioRef.current = [];
        for (const encodedAudio of buffered) playAudio(encodedAudio);
        return;
      }

      if (
        !activeSourcesRef.current.size &&
        mayuPresentationReadyRef.current
      ) {
        mayuTurnCompleteRef.current = true;
        settleAssistantPlayback();
      }
    };
  }, [
    activateTurn,
    applyLearnerTurnEvent,
    commitTranscript,
    finalizePendingPresentation,
    playAudio,
    settleAssistantPlayback,
  ]);

  const handleServerMessage = useCallback(
    (message: LiveServerMessage) => {
      if (message.usageMetadata) {
        latestUsageMetadataRef.current = message.usageMetadata;
      }

      if (message.sessionResumptionUpdate) {
        resumeHandleRef.current = nextLiveResumptionHandle(
          message.sessionResumptionUpdate,
        );
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
        markLiveAssessmentActivityStart(learnerAssessmentAudioRef.current);
        markLearnerResponseStarted();
        applyLearnerTurnEvent(activityEvent);
        if (
          !mutedRef.current &&
          !mayuPresentationReadyRef.current &&
          !getOutputCaptureGuard().isInputBlocked()
        ) {
          updatePhase("listening");
        }
      }
      if (activityEvent?.type === "activity-end") {
        markLiveAssessmentActivityEnd(learnerAssessmentAudioRef.current);
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
          const rejectToolCall = (
            error: string,
            scheduling: FunctionResponseScheduling =
              FunctionResponseScheduling.INTERRUPT,
            preservePendingPresentation = false,
          ) => {
            if (
              call.name === PRESENT_TURN_TOOL_NAME &&
              !preservePendingPresentation
            ) {
              prepareMayuResponse();
            }
            return {
              id: call.id,
              name: call.name,
              scheduling,
              response: { error },
            };
          };

          if (call.name !== PRESENT_TURN_TOOL_NAME) {
            return rejectToolCall(
              "Use present_turn for every Mayu reply.",
            );
          }

          if (
            mayuPresentationReadyRef.current &&
            learnerReplyWindowOpenedAtRef.current === null
          ) {
            // Reject the duplicate call silently but keep playing the already
            // accepted turn's audio: suppressing to the next boundary cut Mayu
            // off mid-sentence and hid the model-output turn boundary.
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

          let parsed =
            parseLivePresentedTurnToolCall(call.args) ??
            repairLivePresentedTurnToolCall(call.args);
          if (!parsed) {
            return rejectToolCall(
              "Provide every complete Mayu caption field and only present_turn fields. Use cueId, never sourceCueId or reviewedCueId, and use a lowercase learnerSourceLanguage. Include learnerTeluguInternal, learnerRoman, learnerEnglish, and learnerSourceLanguage on every call. Preserve English learner speech literally instead of translating it into Telugu, and set learnerTeluguInternal to null for entirely English speech. If learner words are unclear or this is a control turn, set all four learner fields to null. Keep Telugu script out of learner-facing fields.",
            );
          }

          const isControlTurn =
            learnerTurnStateRef.current.controlTurnPending;
          const isOpeningPresentation =
            transcriptRef.current.length === 0 &&
            !mayuPresentationReadyRef.current &&
            !learnerTurnStateRef.current.expectsLearnerResponse;
          if (isOpeningPresentation) {
            const greeting = getLiveOpeningGreeting(
              activeRelationshipRef.current,
            );
            if (
              parsed.learner ||
              parsed.mayu.cueId ||
              !matchesReviewedLiveCue(parsed.mayu, greeting)
            ) {
              return rejectToolCall(
                `No learner has spoken. The entire opening must be exactly "${greeting.telugu}" with mayuRoman "${greeting.roman}", mayuPronunciation "${greeting.pronunciation}", mayuEnglish "${greeting.english}", and no cueId or learner fields. Correct present_turn, then speak only that greeting.`,
              );
            }
          }
          const needsLearnerCaption = learnerCaptionRequired(
            learnerTurnStateRef.current,
            parsed.replay,
          );
          const learnerEpoch = learnerTurnStateRef.current.currentEpoch;
          const pendingLearnerTurn = [...transcriptRef.current]
            .reverse()
            .find((turn) => turn.speaker === "you" && !turn.final);
          if (
            needsLearnerCaption &&
            (!learnerEpoch?.observedLearnerInput || !pendingLearnerTurn)
          ) {
            return rejectToolCall(
              "No microphone evidence supports a learner reply yet. Do not infer an answer from silence, noise, or the expected conversation. Wait for real learner speech before responding.",
              FunctionResponseScheduling.INTERRUPT,
              true,
            );
          }
          if (!needsLearnerCaption && parsed.learner) {
            return rejectToolCall(
              "No learner reply exists for this turn. Remove every learner field, keep Mayu in her role, and continue from the already accepted opening.",
              FunctionResponseScheduling.INTERRUPT,
              true,
            );
          }

          const parsedLearnerCaption = parsed.learner;
          const learnerCaption =
            needsLearnerCaption &&
            parsedLearnerCaption &&
            !hasKnownLearnerMeaningMismatch(parsedLearnerCaption)
              ? parsedLearnerCaption
              : null;
          parsed = {
            ...parsed,
            learner: learnerCaption,
          };

          // Deterministic conversation branches may use only the independent
          // microphone transcript. A model-authored learner meaning can never
          // decide what the learner said or what appears in the transcript.
          parsed = applyLiveConversationPolicy({
            scenarioId: scenario.id,
            relationship: activeRelationshipRef.current,
            turn: parsed,
            groundedLearnerTranscript:
              learnerEpoch?.finalText ?? pendingLearnerTurn?.provisionalRoman,
            isControlTurn,
          });

          if (hasForbiddenAudibleEnglish(parsed.mayu)) {
            return rejectToolCall(
              "Remove every English interjection or copied-English word from the audible Telugu turn. Use a natural Telugu acknowledgment instead, then call present_turn again.",
            );
          }

          if (hasKnownMayuMeaningMismatch(parsed.mayu)) {
            return rejectToolCall(
              "Correct the known phrase mismatch. For the hungry family follow-up, use avunaa, not avunnaa. Tinnaavaa/tinnaaraa means did you eat or have you eaten, not breakfast. For a water handoff, never use deenigaa; use idigoo neellu with the locked relationship form. Correct every Mayu field and call present_turn again.",
            );
          }

          if (
            hasKnownMayuRelationshipMismatch(
              parsed.mayu,
              activeRelationshipRef.current,
            )
          ) {
            return rejectToolCall(
              "The hunger follow-up uses the wrong listener relationship. Use tintaavaa for someone close or tintaaraa for an elder or someone new, matching the locked session, then call present_turn again.",
            );
          }

          const claimedCue = parsed.mayu.cueId
            ? findLivePhraseCue(scenario.words, parsed.mayu.cueId)
            : null;
          if (parsed.mayu.cueId && !claimedCue) {
            return rejectToolCall(
              "That cueId is not reviewed for this situation. Omit cueId for a natural conversational turn.",
            );
          }

          const requiredCueAudience =
            activeRelationshipRef.current === "close"
              ? "familiar"
              : "respectful";
          if (
            claimedCue &&
            claimedCue.audience !== "anyone" &&
            claimedCue.audience !== requiredCueAudience
          ) {
            return rejectToolCall(
              "That reviewed cue conflicts with the locked relationship. Use a matching cue, or omit cueId for a natural matching turn.",
            );
          }
          // A model sometimes attaches a reviewed cue to a longer natural
          // sentence containing that phrase. The spoken/caption fields remain
          // usable, but the optional follow-along metadata is not exact, so
          // drop the claim instead of forcing an otherwise valid turn to loop.
          const cue =
            claimedCue && matchesReviewedLiveCue(parsed.mayu, claimedCue)
              ? claimedCue
              : null;

          const toolCallId =
            call.id ??
            `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const learnerResponseLatencyMs =
            pendingLearnerResponseLatencyMsRef.current ?? undefined;
          const learnerTurnId =
            pendingLearnerTurn?.id ?? `${toolCallId}-learner`;

          // Keep Mayu's validated presentation private until its first audio
          // chunk. Learner words remain separate and can be promoted only by
          // independent microphone transcription evidence.
          pendingPresentedTurnRef.current = {
            toolCallId,
            parsed,
            cue,
            learnerCaption,
            learnerTurnId,
            learnerResponseLatencyMs,
            hasLearnerReply: needsLearnerCaption,
            isControlTurn,
          };

          return {
            id: call.id,
            name: call.name,
            // present_turn is BLOCKING: this accepted response resumes the
            // same generation into its already-validated spoken audio.
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

        sessionRef.current?.sendToolResponse({ functionResponses });
        if (
          pendingNativeAudioRef.current.length &&
          pendingPresentedTurnRef.current
        ) {
          finalizePendingPresentation();
        }
      }

      const content = message.serverContent;
      if (!content) return;

      // Interruption is processed before audio parts so a message carrying
      // both an interruption and new-turn audio never drops that audio.
      if (content.interrupted) {
        prepareMayuResponse();
        markLearnerResponseStarted();
        stopPlayback();
        updatePhase(mutedRef.current ? "muted" : "listening");
      }

      const audioParts = (content.modelTurn?.parts ?? []).filter(
        (part) => Boolean(part.inlineData?.data),
      );
      const hasModelOutput = Boolean(audioParts.length);

      const outputTranscription = content.outputTranscription?.text;
      if (outputTranscription) {
        // Kept only as the caption fallback for watchdog-released audio.
        outputTranscriptionTextRef.current =
          `${outputTranscriptionTextRef.current} ${outputTranscription}`
            .trim()
            .slice(-500);
      }

      const interimInput = content.interimInputTranscription?.text;
      if (interimInput) {
        markLearnerResponseStarted();
        applyLearnerTurnEvent({ type: "interim-transcription" });
        // Final transcription arrives in accumulating segments; the interim
        // hypothesis extends what has already been finalized for this epoch.
        const finalizedBase =
          learnerTurnStateRef.current.currentEpoch?.finalText;
        applyLearnerTranscriptDraft(
          finalizedBase ? `${finalizedBase} ${interimInput}` : interimInput,
        );
        if (
          !mutedRef.current &&
          !mayuPresentationReadyRef.current &&
          !getOutputCaptureGuard().isInputBlocked()
        ) {
          updatePhase("listening");
        }
      }

      const finalInput = content.inputTranscription;
      if (finalInput?.text) {
        markLearnerResponseStarted();
        // Gemini Live can omit `finished` on the final inputTranscription
        // event. Only an explicit false is provisional;
        // interimInputTranscription remains the low-latency draft channel.
        if (finalInput.finished !== false) {
          markLiveAssessmentActivityEnd(learnerAssessmentAudioRef.current);
          applyLearnerTurnEvent({
            type: "final-transcription",
            text: finalInput.text,
          });
          // The learner-turn state accumulates final segments; render the
          // whole utterance so earlier segments are not overwritten.
          const finalEpoch = learnerTurnStateRef.current.currentEpoch;
          const groundedTranscript = finalEpoch?.finalText ?? finalInput.text;
          applyLearnerTranscriptDraft(groundedTranscript);
          if (finalEpoch) {
            finalizeGroundedLearnerTurn(
              finalEpoch.id,
              groundedTranscript,
            );
          }
          updatePhase("thinking");
        } else {
          applyLearnerTurnEvent({ type: "interim-transcription" });
          const finalizedBase =
            learnerTurnStateRef.current.currentEpoch?.finalText;
          applyLearnerTranscriptDraft(
            finalizedBase
              ? `${finalizedBase} ${finalInput.text}`
              : finalInput.text,
          );
          if (
            !mutedRef.current &&
            !mayuPresentationReadyRef.current &&
            !getOutputCaptureGuard().isInputBlocked()
          ) {
            updatePhase("listening");
          }
        }
      }

      if (hasModelOutput) applyLearnerTurnEvent({ type: "model-output" });

      if (
        audioParts.length &&
        !mayuPresentationReadyRef.current &&
        pendingPresentedTurnRef.current
      ) {
        finalizePendingPresentation();
      }

      for (const part of audioParts) {
        const encodedAudio = part.inlineData?.data;
        if (!encodedAudio) continue;
        if (mayuPresentationReadyRef.current) {
          playAudio(encodedAudio);
        } else {
          pendingNativeAudioRef.current.push(encodedAudio);
          // Audio without an accepted presentation must not buffer forever.
          armPendingAudioWatchdog();
        }
      }

      if (content.turnComplete || content.waitingForInput) {
        mayuTurnCompleteRef.current = true;
        applyLearnerTurnEvent({ type: "model-turn-complete" });
        clearStuckPresentationWatchdog();
        if (!activeSourcesRef.current.size) {
          clearDrainGraceTimer();
          nextPlaybackTimeRef.current = 0;
          settleAssistantPlayback();
        }
      }
    },
    [
      applyLearnerTurnEvent,
      applyLearnerTranscriptDraft,
      armPendingAudioWatchdog,
      clearDrainGraceTimer,
      clearStuckPresentationWatchdog,
      commitTranscript,
      finalizeGroundedLearnerTurn,
      finalizePendingPresentation,
      getOutputCaptureGuard,
      markLearnerResponseStarted,
      playAudio,
      prepareMayuResponse,
      scenario.id,
      scenario.words,
      settleAssistantPlayback,
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
      const outputCaptureGuard = getOutputCaptureGuard();
      silentGain.gain.value = 0;

      const sendPcm = (
        pcm: Int16Array,
        level: number,
        sampleRateHz = INPUT_SAMPLE_RATE,
      ) => {
        // Capture stays alive continuously, but uploads begin only after Mayu
        // has opened a learner reply window.
        if (
          !shouldForwardLiveMicrophoneFrame({
            expectsLearnerResponse:
              learnerTurnStateRef.current.expectsLearnerResponse,
            isMuted: mutedRef.current,
            sessionMatches: sessionRef.current === session,
          })
        ) {
          return;
        }

        // Production remains half-duplex while Mayu is audible because a
        // browser-reported AEC setting is not evidence that loud speaker bleed
        // is gone. The echo gate remains available behind the disabled
        // full-duplex flag for future device-route acoustic validation.
        const outputAudible =
          activeSourcesRef.current.size > 0 ||
          outputCaptureGuard.isInputBlocked();
        if (outputAudible && duplexModeRef.current === "half") {
          endMicrophoneStream();
          return;
        }
        const echoGate = (echoGateRef.current ??= createLiveEchoGate());
        const gateDecision = echoGate.decide({
          level,
          outputAudible,
          timestampMs: performance.now(),
        });
        if (!gateDecision.forward) {
          // Mark the upload paused, matching the half-duplex path, so VAD
          // reads an explicit gap instead of ambiguous silence.
          endMicrophoneStream();
          return;
        }

        if (
          !outputCaptureGuard.isInputBlocked() &&
          !mayuPresentationReadyRef.current
        ) {
          const now = performance.now();
          if (now - levelUpdatedAtRef.current > 55) {
            levelUpdatedAtRef.current = now;
            setMicLevel(level);
          }
        }

        session.sendRealtimeInput({
          audio: {
            data: pcm16ToBase64(pcm),
            mimeType: `audio/pcm;rate=${Math.round(sampleRateHz)}`,
          },
        });
        if (
          sampleRateHz === INPUT_SAMPLE_RATE &&
          learnerReplyWindowOpenedAtRef.current !== null &&
          learnerTurnStateRef.current.expectsLearnerResponse
        ) {
          appendLiveAssessmentAudio(learnerAssessmentAudioRef.current, pcm);
        }
        microphoneStreamOpenRef.current = true;
      };

      let processor: AudioNode;
      if (workletReady && typeof AudioWorkletNode !== "undefined") {
        const worklet = new AudioWorkletNode(inputContext, PCM_WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.port.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data as {
            level?: unknown;
            pcm?: unknown;
            sampleRate?: unknown;
          };
          if (!(message.pcm instanceof ArrayBuffer)) return;
          sendPcm(
            new Int16Array(message.pcm),
            typeof message.level === "number" ? message.level : 0,
            typeof message.sampleRate === "number"
              ? message.sampleRate
              : INPUT_SAMPLE_RATE,
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
            // Below the target rate the samples pass through unresampled, so
            // the upload must be labeled with the context's true rate.
            Math.min(inputContext.sampleRate, INPUT_SAMPLE_RATE),
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
    [endMicrophoneStream, getOutputCaptureGuard],
  );

  const rewireCaptureForSession = useCallback(
    (session: Session) => {
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
      inputSourceRef.current = null;
      silentGainRef.current = null;

      const stream = streamRef.current;
      if (!stream) throw new Error("Audio input is not available.");
      startCapture(stream, session, workletReadyResolvedRef.current);
    },
    [startCapture],
  );

  const createSessionCallbacks = useCallback(
    (
      attemptId: number,
      boundary: LiveConnectBoundary<LiveServerMessage>,
      isReplacement = false,
    ) => ({
      onopen: () => {
        if (
          !isReplacement &&
          attemptId === connectionAttemptRef.current &&
          !ignoreConnectionEventsRef.current &&
          mountedRef.current
        ) {
          updatePhase("connecting");
        }
      },
      onmessage: (message: LiveServerMessage) => {
        if (
          attemptId === connectionAttemptRef.current &&
          !ignoreConnectionEventsRef.current
        ) {
          boundary.push(message);
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
            const message =
              "The live connection was interrupted. Try once more.";
            if (boundary.consumeConnectFailure(new Error(message))) return;
            if (!attemptResumeRef.current(message)) failSession(message);
          }
        }
      },
      onclose: (event: CloseEvent) => {
        if (
          attemptId === connectionAttemptRef.current &&
          !ignoreConnectionEventsRef.current &&
          mountedRef.current
        ) {
          if (shouldCompleteNormally()) {
            endSessionRef.current("limit");
          } else {
            const message = describeLiveClose(event);
            if (boundary.consumeConnectFailure(new Error(message))) return;
            if (!attemptResumeRef.current(message)) failSession(message);
          }
        }
      },
    }),
    [failSession, shouldCompleteNormally, updatePhase],
  );

  const attemptResume = useCallback(
    (failureMessage: string) => {
      const connection = liveConnectionRef.current;
      const handle = resumeHandleRef.current;
      if (
        !connection ||
        !handle ||
        resumeAttemptedRef.current ||
        !streamRef.current ||
        !isSessionPhase(phaseRef.current)
      ) {
        return false;
      }

      // One guarded reconnect with the last resumption handle preserves the
      // transcript, timers, and grading refs across a transient network drop
      // instead of hard-failing the whole practice.
      resumeAttemptedRef.current = true;
      resumeInFlightRef.current = true;
      // Retiring the old attempt id unwires every callback still attached to
      // the dead socket; the resumed session gets fresh callbacks below, so a
      // late close event from the old connection cannot fail the new one.
      connectionAttemptRef.current += 1;
      const attemptId = connectionAttemptRef.current;
      sessionRef.current = null;
      microphoneStreamOpenRef.current = false;
      console.info("Practice Live: connection lost, resuming session");

      void (async () => {
        let reconnectTimeout: number | null = null;
        try {
          const { GoogleGenAI } = await loadGenAILibrary();
          if (
            attemptId !== connectionAttemptRef.current ||
            !mountedRef.current ||
            ignoreConnectionEventsRef.current
          ) {
            return;
          }

          const ai = new GoogleGenAI({
            apiKey: connection.apiToken,
            httpOptions: { apiVersion: "v1alpha" },
          });
          const boundary = createLiveConnectBoundary<LiveServerMessage>();
          const callbacks = createSessionCallbacks(
            attemptId,
            boundary,
            true,
          );
          reconnectTimeout = window.setTimeout(() => {
            boundary.consumeConnectFailure(
              new Error("The live reconnect timed out."),
            );
          }, LIVE_RECONNECT_TIMEOUT_MS);
          const connectPromise = ai.live.connect({
            model: connection.model,
            config: {
              ...connection.config,
              sessionResumption: { handle },
            },
            callbacks,
          });
          void connectPromise.then(
            (lateSession) => {
              if (
                boundary.didFail() ||
                attemptId !== connectionAttemptRef.current ||
                !mountedRef.current ||
                ignoreConnectionEventsRef.current
              ) {
                try {
                  lateSession.close();
                } catch {
                  // A failed setup socket may already be closed.
                }
              }
            },
            () => undefined,
          );
          const session = await Promise.race([
            connectPromise,
            boundary.failure,
          ]);
          if (reconnectTimeout !== null) {
            window.clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }

          if (
            attemptId !== connectionAttemptRef.current ||
            !mountedRef.current ||
            ignoreConnectionEventsRef.current
          ) {
            try {
              session.close();
            } catch {
              // The replacement connection may already be gone.
            }
            return;
          }

          liveConnectionRef.current = { ...connection, callbacks };
          sessionRef.current = session;
          boundary.install(handleServerMessage);
          rewireCaptureForSession(session);
          setReconnectCount((count) => count + 1);
          console.info("Practice Live: session resumed");
        } catch {
          if (
            attemptId === connectionAttemptRef.current &&
            mountedRef.current &&
            !ignoreConnectionEventsRef.current
          ) {
            failSession(failureMessage);
          }
        } finally {
          if (reconnectTimeout !== null) {
            window.clearTimeout(reconnectTimeout);
          }
          resumeInFlightRef.current = false;
        }
      })();

      return true;
    },
    [
      createSessionCallbacks,
      failSession,
      handleServerMessage,
      rewireCaptureForSession,
    ],
  );

  useEffect(() => {
    attemptResumeRef.current = attemptResume;
  }, [attemptResume]);

  const start = useCallback(async () => {
    if (isSessionPhase(phaseRef.current)) return;

    ignoreConnectionEventsRef.current = true;
    cancelPendingAssessmentRequests();
    releaseHardware();
    const attemptId = connectionAttemptRef.current;
    clearTimer();
    transcriptRef.current = [];
    activeTurnRef.current = null;
    toolTurnIdsRef.current.clear();
    mayuPresentationReadyRef.current = false;
    openingGreetingPendingRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
    pendingGroundedLearnerTurnsRef.current.clear();
    outputTranscriptionTextRef.current = "";
    resumeHandleRef.current = null;
    resumeAttemptedRef.current = false;
    resumeInFlightRef.current = false;
    setReconnectCount(0);
    liveConnectionRef.current = null;
    usedCueIdsRef.current = [];
    assessmentAccessTokenRef.current = null;
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setLearnerDraft("");
    setErrorMessage("");
    setElapsedSeconds(0);
    setRemainingSeconds(durationSeconds);
    setLatestTurnLatencyMs(null);
    elapsedRef.current = 0;
    learnerTurnsRef.current = 0;
    learnerTurnStateRef.current = createLearnerTurnState();
    microphoneStreamOpenRef.current = false;
    mutedRef.current = false;
    setIsMuted(false);
    closingRequestedRef.current = false;
    closingQueuedRef.current = false;
    closingPlaybackPendingRef.current = false;
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

      const openingGreeting = getLiveOpeningGreeting(relationship);
      const openingAudioPromise = fetch(openingGreeting.audioSrc, {
        cache: "force-cache",
        credentials: "same-origin",
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Mayu's opening greeting audio is unavailable.");
        }
        return pcm16ArrayBufferToFloat32(await response.arrayBuffer());
      });

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

      // AEC is a prerequisite for future barge-in, but a `true` setting merely
      // confirms the requested constraint. It does not prove effective echo
      // suppression on the current speaker/microphone route.
      const echoCancellationActive =
        stream.getAudioTracks()[0]?.getSettings?.().echoCancellation === true;
      duplexModeRef.current =
        LIVE_FULL_DUPLEX_ENABLED && echoCancellationActive ? "full" : "half";
      echoGateRef.current?.reset();
      setDuplexMode(duplexModeRef.current);

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

      const [tokenResult, { GoogleGenAI }, workletReady, openingSamples] =
        await Promise.all([
        tokenPromise,
        genAIPromise,
        inputWorkletReadyRef.current,
        openingAudioPromise,
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
        typeof tokenPayload.assessmentAccessToken !== "string" ||
        !tokenPayload.assessmentAccessToken ||
        !isLiveListenerRelationship(tokenPayload.relationship) ||
        !isLiveSessionDuration(tokenPayload.sessionLimitSeconds) ||
        tokenPayload.relationship !== relationship ||
        tokenPayload.sessionLimitSeconds !== durationSeconds ||
        !Number.isFinite(parsedTokenExpiry) ||
        parsedTokenExpiry <= Date.now()
      ) {
        throw new Error("The live session was not configured correctly.");
      }
      activeRelationshipRef.current = tokenPayload.relationship;
      assessmentAccessTokenRef.current = tokenPayload.assessmentAccessToken;
      activeSessionLimitRef.current = tokenPayload.sessionLimitSeconds;
      tokenExpiresAtRef.current = parsedTokenExpiry;
      setRemainingSeconds(tokenPayload.sessionLimitSeconds);
      updatePhase("connecting");
      ignoreConnectionEventsRef.current = false;

      // sessionResumption and outputAudioTranscription are client-side
      // additions: resumption hands out reconnect handles, and the output
      // transcription is the caption fallback for watchdog-released audio.
      const connectConfig: LiveConnectConfig = {
        ...tokenPayload.config,
        sessionResumption: {},
        outputAudioTranscription: {},
      };
      const boundary = createLiveConnectBoundary<LiveServerMessage>();
      const callbacks = createSessionCallbacks(attemptId, boundary);

      const ai = new GoogleGenAI({
        apiKey: tokenPayload.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const connectPromise = ai.live.connect({
        model: tokenPayload.model,
        config: connectConfig,
        callbacks,
      });
      void connectPromise.then(
        (lateSession) => {
          if (
            boundary.didFail() ||
            !mountedRef.current ||
            attemptId !== connectionAttemptRef.current ||
            ignoreConnectionEventsRef.current
          ) {
            try {
              lateSession.close();
            } catch {
              // A failed setup socket may already be closed.
            }
          }
        },
        () => undefined,
      );
      const session = await Promise.race([
        connectPromise,
        boundary.failure,
      ]);

      if (
        !mountedRef.current ||
        attemptId !== connectionAttemptRef.current ||
        ignoreConnectionEventsRef.current
      ) {
        ignoreConnectionEventsRef.current = true;
        session.close();
        return;
      }

      liveConnectionRef.current = {
        apiToken: tokenPayload.token,
        model: tokenPayload.model,
        config: connectConfig,
        callbacks,
      };
      sessionRef.current = session;
      workletReadyResolvedRef.current = workletReady;
      boundary.install(handleServerMessage);
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
          sessionRef.current &&
          isSessionPhase(phaseRef.current)
        ) {
          closingRequestedRef.current = true;
          const learnerEpoch = learnerTurnStateRef.current.currentEpoch;
          const hasLearnerReplyInFlight = Boolean(
            learnerEpoch?.activityActive ||
              (learnerEpoch?.observedLearnerInput &&
                !learnerEpoch.captioned),
          );
          if (
            canSendClosingControlNow({
              phase: phaseRef.current,
              hasLearnerReplyInFlight,
            })
          ) {
            applyLearnerTurnEvent({ type: "control-turn-requested" });
            prepareMayuResponse();
            updatePhase("thinking");
            sessionRef.current.sendRealtimeInput({
              text: CLOSING_CONTROL_TEXT,
            });
          } else {
            // Mid-turn: queue the closing request; it is sent at the next
            // turn boundary so the session never hard-cuts without a goodbye.
            closingQueuedRef.current = true;
          }
        }

        const closingTurnInFlight =
          closingRequestedRef.current ||
          closingPlaybackPendingRef.current ||
          Boolean(pendingPresentedTurnRef.current?.isControlTurn);
        if (
          now >= deadline &&
          (!closingTurnInFlight ||
            now >= deadline + CLOSING_PLAYBACK_GRACE_MS)
        ) {
          endSessionRef.current("limit");
        }
      };

      deadlineCheckRef.current = updateDeadline;
      timerRef.current = window.setInterval(updateDeadline, 250);
      deadlineTimerRef.current = window.setTimeout(
        () => deadlineCheckRef.current(),
        Math.max(0, sessionDeadline - Date.now()),
      );
      updateDeadline();

      prepareMayuResponse();
      const openingTurn: LiveTranscriptTurn = {
        id: `mayu-opening-${attemptId}`,
        speaker: "mayu",
        roman: openingGreeting.roman,
        pronunciation: openingGreeting.pronunciation,
        english: openingGreeting.english,
        final: true,
        sourceLanguage: "telugu",
      };
      commitTranscript(
        applyLiveCaptionTurn(transcriptRef.current, openingTurn),
      );
      activateTurn(openingTurn);
      openingGreetingPendingRef.current = true;
      mayuPresentationReadyRef.current = true;
      mayuTurnCompleteRef.current = true;
      playSamples(openingSamples);
      if (!activeSourcesRef.current.size) {
        throw new Error("Mayu's opening greeting could not play.");
      }
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
    activateTurn,
    cancelPendingAssessmentRequests,
    clearTimer,
    commitTranscript,
    createSessionCallbacks,
    durationSeconds,
    failSession,
    handleServerMessage,
    prepareMayuResponse,
    playSamples,
    relationship,
    releaseHardware,
    scenarioId,
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
      endMicrophoneStream();
      setMicLevel(0);
      if (!activeSourcesRef.current.size) updatePhase("muted");
    } else {
      const outputBlocked = getOutputCaptureGuard().isInputBlocked();
      const turnInProgress = mayuPresentationReadyRef.current;
      updatePhase(
        activeSourcesRef.current.size
          ? "speaking"
          : outputBlocked || turnInProgress
            ? "thinking"
            : "listening",
      );
    }
  }, [endMicrophoneStream, getOutputCaptureGuard, updatePhase]);

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
        mayuPresentationReadyRef.current ||
        !isSessionPhase(phaseRef.current)
      ) {
        return;
      }

      activateTurn(turn);
      stopPlayback();
      prepareMayuResponse();
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
    [activateTurn, prepareMayuResponse, stopPlayback, updatePhase],
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
    const completedTranscript = finalizeLiveTranscriptForEnd(
      transcriptRef.current,
    );
    const grade = gradeLiveSession(completedTranscript);
    commitTranscript(completedTranscript);
    setLearnerDraft("");
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
    cancelPendingAssessmentRequests();
    releaseHardware();
    clearTimer();
    mutedRef.current = false;
    setIsMuted(false);
    closingRequestedRef.current = false;
    closingQueuedRef.current = false;
    closingPlaybackPendingRef.current = false;
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
    mayuPresentationReadyRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
    pendingGroundedLearnerTurnsRef.current.clear();
    outputTranscriptionTextRef.current = "";
    resumeHandleRef.current = null;
    resumeAttemptedRef.current = false;
    resumeInFlightRef.current = false;
    setReconnectCount(0);
    liveConnectionRef.current = null;
    usedCueIdsRef.current = [];
    setElapsedSeconds(0);
    setRemainingSeconds(durationSeconds);
    setLatestTurnLatencyMs(null);
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setLearnerDraft("");
    setErrorMessage("");
    updatePhase("idle");
  }, [
    cancelPendingAssessmentRequests,
    clearTimer,
    durationSeconds,
    releaseHardware,
    updatePhase,
  ]);

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
      cancelPendingAssessmentRequests();
      releaseHardware();
      clearTimer();
    };
  }, [cancelPendingAssessmentRequests, clearTimer, releaseHardware]);

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
    duplexMode,
    reconnectCount,
    transcript,
    activeTurn,
    learnerDraft,
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
