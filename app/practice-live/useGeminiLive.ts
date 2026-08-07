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
  resolveLivePhraseCue,
  type LivePhraseCue,
} from "./live-follow-along";
import {
  DEFAULT_LIVE_FAMILY_VOICE,
  DEFAULT_LIVE_LISTENER_RELATIONSHIP,
  DEFAULT_LIVE_SESSION_DURATION,
  isLiveFamilyVoice,
  isLiveListenerRelationship,
  isLiveSessionDuration,
  PRESENT_TURN_TOOL_NAME,
  type LiveFamilyVoice,
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
  createFishSpeechController,
  FISH_SPEECH_CLIENT_TIMEOUT_MS,
  type FishSpeechController,
} from "./live-fish-speech";
import {
  createLiveOutputCaptureGuard,
  shouldForwardLiveMicrophoneFrame,
  type LiveOutputCaptureGuard,
} from "./live-output-capture-guard";
import { liveScenarios, type LiveScenarioId } from "./live-scenarios";
import {
  gradeLiveSession,
  type LiveSessionGrade,
} from "./live-session-grading";
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
  createUnscoredLiveLearnerCaption,
  finalizeLiveTranscriptForEnd,
  hasForbiddenAudibleEnglish,
  hasKnownLearnerMeaningMismatch,
  hasKnownMayuMeaningMismatch,
  hasKnownMayuRelationshipMismatch,
  matchesReviewedLiveCue,
  parseLivePresentedTurnToolCall,
  type ParsedLiveCaptionTurn,
  type ParsedLivePresentedTurnToolCall,
  type LiveTranscriptTurn,
} from "./live-transcript";
import {
  getLiveVoiceFallbackNotice,
  getLiveVoiceModeNotice,
  isLiveVoiceModeReason,
  type LiveVoiceModeReason,
} from "./live-voice-status";
import { getSupabaseBrowserClient } from "../supabase-client";

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

export type LiveVoiceMode = "gemini" | "fish";

export type CompletedLiveSession = {
  id: string;
  scenarioId: LiveScenarioId;
  familyVoice?: LiveFamilyVoice;
  voiceMode?: LiveVoiceMode;
  usedVoiceFallback?: boolean;
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
  voiceMode?: LiveVoiceMode;
  voiceModeReason?: LiveVoiceModeReason;
  voiceAccessToken?: string;
  assessmentAccessToken?: string;
  familyVoice?: LiveFamilyVoice;
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
const ACCOUNT_SESSION_TIMEOUT_MS = 1_500;
const ACCOUNT_SESSION_RETRY_TIMEOUT_MS = 3_000;

type CompletionReason = CompletedLiveSession["completionReason"];

type PendingPresentedTurn = {
  toolCallId: string;
  parsed: ParsedLivePresentedTurnToolCall;
  cue: LivePhraseCue | null;
  learnerCaption: ParsedLiveCaptionTurn | null;
  learnerTurnId: string;
  learnerResponseLatencyMs?: number;
  isControlTurn: boolean;
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

type AccountAccessTokenResult =
  | { status: "authenticated"; accessToken: string }
  | { status: "signed_out" | "unavailable" | "timed_out" };

async function loadAccountAccessToken(
  timeoutMs = ACCOUNT_SESSION_TIMEOUT_MS,
): Promise<AccountAccessTokenResult> {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      getSupabaseBrowserClient()
        .auth.getSession()
        .then(({ data }) => {
          const accessToken = data.session?.access_token?.trim() ?? "";
          return accessToken
            ? ({ status: "authenticated", accessToken } as const)
            : ({ status: "signed_out" } as const);
        })
        .catch(() => ({ status: "unavailable" }) as const),
      new Promise<AccountAccessTokenResult>((resolve) => {
        timeoutId = window.setTimeout(
          () => resolve({ status: "timed_out" }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
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

function pcmBytesToFloat32(bytes: Uint8Array) {
  const byteLength = bytes.byteLength - (bytes.byteLength % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, byteLength);
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
  familyVoice: LiveFamilyVoice = DEFAULT_LIVE_FAMILY_VOICE,
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
  const [activeVoiceMode, setActiveVoiceMode] =
    useState<LiveVoiceMode | null>(null);
  const [usedVoiceFallback, setUsedVoiceFallback] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
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
  const voiceModeRef = useRef<LiveVoiceMode>("gemini");
  const voiceAccessTokenRef = useRef<string | null>(null);
  const usedVoiceFallbackRef = useRef(false);
  const fishSpeechControllerRef = useRef<
    FishSpeechController<Float32Array, string> | null
  >(null);
  const connectionAttemptRef = useRef(0);
  const ignoreConnectionEventsRef = useRef(false);
  const mutedRef = useRef(false);
  const closingRequestedRef = useRef(false);
  const goAwayReceivedRef = useRef(false);
  const activeRelationshipRef = useRef<LiveListenerRelationship>(relationship);
  const activeFamilyVoiceRef = useRef<LiveFamilyVoice>(familyVoice);
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
  const suppressNativeAudioUntilBoundaryRef = useRef(false);
  const pendingNativeAudioRef = useRef<string[]>([]);
  const pendingPresentedTurnRef = useRef<PendingPresentedTurn | null>(null);
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
    fishSpeechControllerRef.current?.cancel();
    fishSpeechControllerRef.current = null;

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
    const outputCaptureGuard = getOutputCaptureGuard();
    if (hadActiveOutput) {
      outputCaptureGuard.beginOutput();
      outputCaptureGuard.releaseAfterTail();
      setMicLevel(0);
    } else if (outputCaptureGuard.isInputBlocked()) {
      outputCaptureGuard.discardReleaseCallback();
    }
    setAssistantLevel(0);
    return hadActiveOutput || outputCaptureGuard.isInputBlocked();
  }, [getOutputCaptureGuard]);

  const releaseHardware = useCallback(() => {
    connectionAttemptRef.current += 1;
    tokenRequestRef.current?.abort();
    tokenRequestRef.current = null;
    voiceAccessTokenRef.current = null;

    stopPlayback();
    getOutputCaptureGuard().cancel();

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

    const inputContext = inputContextRef.current;
    const outputContext = outputContextRef.current;
    inputContextRef.current = null;
    outputContextRef.current = null;
    if (inputContext && inputContext.state !== "closed") void inputContext.close();
    if (outputContext && outputContext.state !== "closed") void outputContext.close();

    setMicLevel(0);
    setAssistantLevel(0);
  }, [getOutputCaptureGuard, stopPlayback]);

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

  const prepareMayuResponse = useCallback(() => {
    mayuPresentationReadyRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
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

  const applyLearnerTranscriptDraft = useCallback(
    (value: unknown) => {
      const next = applyProvisionalLearnerTranscript(
        transcriptRef.current,
        value,
      );
      if (next === transcriptRef.current) return;
      // Provider ASR has no stability/finality guarantee. Keep it privately as
      // an end-of-session fallback, but do not flash an unverified guess in the
      // learner-facing transcript before the checked caption arrives.
      transcriptRef.current = next;
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

  const settleAssistantPlayback = useCallback(() => {
    if (activeSourcesRef.current.size) return;

    setAssistantLevel(0);
    getOutputCaptureGuard().releaseAfterTail(() => {
      if (!mountedRef.current || activeSourcesRef.current.size) return;

      if (!mayuTurnCompleteRef.current) {
        if (phaseRef.current === "speaking") updatePhase("thinking");
        return;
      }

      mayuAudioEndedAtRef.current = performance.now();
      prepareMayuResponse();
      openLearnerReplyWindow();
      if (isSessionPhase(phaseRef.current)) {
        updatePhase(mutedRef.current ? "muted" : "listening");
      }
    });
  }, [
    getOutputCaptureGuard,
    openLearnerReplyWindow,
    prepareMayuResponse,
    updatePhase,
  ]);

  const playSamples = useCallback(
    (samples: Float32Array) => {
      const context = outputContextRef.current;
      if (!context || context.state === "closed") return;
      if (!samples.length) return;

      // Playback pauses microphone uploads for longer than a second. Close the
      // current Live audio stream before that gap so Gemini flushes any cached
      // input; a later PCM frame starts a fresh stream automatically.
      endMicrophoneStream();
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
          settleAssistantPlayback();
        }
      };

      void context.resume();
      source.start(startAt);
    },
    [
      endMicrophoneStream,
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

  const requestFishSpeech = useCallback(
    (text: string) => {
      if (voiceModeRef.current !== "fish") return;
      let fallbackCode: unknown;

      const controller =
        fishSpeechControllerRef.current ??
        createFishSpeechController<Float32Array, string>(
          {
            scheduleTimeout: (callback, delayMs) =>
              window.setTimeout(callback, delayMs),
            cancelTimeout: (handle) => window.clearTimeout(handle as number),
            createAbortController: () => new AbortController(),
          },
          FISH_SPEECH_CLIENT_TIMEOUT_MS,
        );
      fishSpeechControllerRef.current = controller;

      controller.start({
        request: async (signal) => {
          const response = await fetch("/api/practice-live/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              familyVoice: activeFamilyVoiceRef.current,
              voiceAccessToken: voiceAccessTokenRef.current,
            }),
            cache: "no-store",
            credentials: "same-origin",
            signal,
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as {
              code?: unknown;
            } | null;
            fallbackCode = payload?.code;
            throw new Error("Fish Audio rejected the turn.");
          }

          const samples = pcmBytesToFloat32(
            new Uint8Array(await response.arrayBuffer()),
          );
          if (!samples.length) throw new Error("Fish Audio returned empty audio.");
          return samples;
        },
        playFish: playSamples,
        playFallback: playAudio,
        onFallback: () => {
          usedVoiceFallbackRef.current = true;
          if (mountedRef.current) {
            setUsedVoiceFallback(true);
            setVoiceNotice(
              getLiveVoiceFallbackNotice(
                activeFamilyVoiceRef.current,
                fallbackCode,
              ),
            );
          }
        },
        onFallbackReleased: () => {
          if (
            !activeSourcesRef.current.size &&
            mayuTurnCompleteRef.current
          ) {
            settleAssistantPlayback();
          }
        },
      });
    },
    [playAudio, playSamples, settleAssistantPlayback],
  );

  const playPresentedNativeAudio = useCallback(
    (encodedAudio: string) => {
      const fishSpeechController =
        voiceModeRef.current === "fish"
          ? fishSpeechControllerRef.current
          : null;
      if (!fishSpeechController?.bufferFallback(encodedAudio)) {
        playAudio(encodedAudio);
      }
    },
    [playAudio],
  );

  const finalizePendingPresentation = useCallback(() => {
    const pending = pendingPresentedTurnRef.current;
    if (!pending) return false;

    pendingPresentedTurnRef.current = null;
    const priorMayu = activeTurnRef.current;
    let assessmentRequest: LearnerAssessmentRequest | null = null;
    let next = transcriptRef.current;
    if (!pending.parsed.replay && pending.learnerCaption) {
      const learnerEffects = applyLearnerTurnEvent({
        type: "learner-caption",
      });
      if (learnerEffects.applyLearnerCaption) {
        next = applyLiveCaptionTurn(next, {
          id: pending.learnerTurnId,
          speaker: "you",
          roman: pending.learnerCaption.roman,
          pronunciation: pending.learnerCaption.pronunciation,
          english: pending.learnerCaption.english,
          sourceLanguage: pending.learnerCaption.sourceLanguage,
          responseLatencyMs: pending.learnerResponseLatencyMs,
        });
        const pcm = takeLiveAssessmentAudio(learnerAssessmentAudioRef.current);
        if (pcm && priorMayu?.speaker === "mayu") {
          assessmentRequest = {
            turnId: pending.learnerTurnId,
            pcm,
            priorMayu,
            checkedCaption: pending.learnerCaption,
          };
        }
      }
    }

    pendingLearnerResponseLatencyMsRef.current = null;
    learnerReplyWindowOpenedAtRef.current = null;
    mayuAudioEndedAtRef.current = null;
    mayuTurnCompleteRef.current = false;

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
    requestFishSpeech(pending.parsed.mayu.teluguInternal);

    mayuPresentationReadyRef.current = true;
    const pendingAudio = pendingNativeAudioRef.current;
    pendingNativeAudioRef.current = [];
    for (const encodedAudio of pendingAudio) {
      playPresentedNativeAudio(encodedAudio);
    }
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
    commitTranscript,
    playPresentedNativeAudio,
    requestFishSpeech,
    requestLearnerAssessment,
  ]);

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
            suppressNativeAudioUntilBoundaryRef.current = true;
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
          if (!parsed) {
            return rejectToolCall(
              "Provide every complete Mayu caption field and only present_turn fields. Omit learner fields before any learner reply; afterward include the complete safe learner caption and source fields. Keep Telugu script out of learner-facing fields.",
            );
          }
          const needsLearnerCaption = learnerCaptionRequired(
            learnerTurnStateRef.current,
            parsed.replay,
          );
          if (!needsLearnerCaption && parsed.learner) {
            return rejectToolCall(
              "No learner reply exists for this turn. Remove every learner field, keep Mayu in her role, and continue from the already accepted opening.",
              FunctionResponseScheduling.INTERRUPT,
              true,
            );
          }

          if (hasForbiddenAudibleEnglish(parsed.mayu)) {
            return rejectToolCall(
              "Remove every English interjection or copied-English word from the audible Telugu turn. Use a natural Telugu acknowledgment instead, then call present_turn again.",
            );
          }

          if (hasKnownMayuMeaningMismatch(parsed.mayu)) {
            return rejectToolCall(
              "Correct the known phrase mismatch. For the hungry family follow-up, use avunaa, not avunnaa. For a water handoff, never use deenigaa; use idigoo neellu with the locked relationship form. Correct every Mayu field and call present_turn again.",
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

          const cue = parsed.mayu.cueId
            ? findLivePhraseCue(scenario.words, parsed.mayu.cueId)
            : null;
          if (parsed.mayu.cueId && !cue) {
            return rejectToolCall(
              "That cueId is not reviewed for this situation. Omit cueId for a natural conversational turn.",
            );
          }

          if (cue && !matchesReviewedLiveCue(parsed.mayu, cue)) {
            return rejectToolCall(
              "That cueId requires the exact reviewed native Telugu, romanization, pronunciation, and English meaning. Correct all four fields, or omit cueId for a natural conversational turn.",
            );
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
            return rejectToolCall(
              "That reviewed cue conflicts with the locked relationship. Use a matching cue, or omit cueId for a natural matching turn.",
            );
          }

          const parsedLearnerCaption = parsed.learner;
          const reviewedLearnerCue = parsedLearnerCaption
            ? resolveLivePhraseCue(
                parsedLearnerCaption.teluguInternal ||
                  parsedLearnerCaption.roman,
                scenario.words,
              )
            : null;
          const validLearnerCaption =
            parsedLearnerCaption &&
            !hasKnownLearnerMeaningMismatch(parsedLearnerCaption)
              ? {
                  ...parsedLearnerCaption,
                  pronunciation:
                    parsedLearnerCaption.pronunciation ??
                    reviewedLearnerCue?.pronunciation,
                }
              : null;
          if (needsLearnerCaption && !validLearnerCaption) {
            return rejectToolCall(
              "This turn follows a learner reply. Include the complete safe learner caption and source fields, matching only what the learner actually said, then call present_turn again before speaking.",
            );
          }
          const learnerCaption = needsLearnerCaption
            ? validLearnerCaption
            : null;

          const toolCallId =
            call.id ??
            `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const isControlTurn = learnerTurnStateRef.current.controlTurnPending;
          const learnerResponseLatencyMs =
            pendingLearnerResponseLatencyMsRef.current ?? undefined;
          const learnerTurnId = [...transcriptRef.current]
            .reverse()
            .find((turn) => turn.speaker === "you" && !turn.final)?.id ??
            `${toolCallId}-learner`;

          // Gemini 2.5 can revise a valid non-blocking presentation before its
          // first audio chunk. Keep only the newest validated candidate, then
          // atomically expose its caption and release audio so the UI never
          // flashes an earlier draft or pairs speech with stale text.
          pendingPresentedTurnRef.current = {
            toolCallId,
            parsed,
            cue,
            learnerCaption,
            learnerTurnId,
            learnerResponseLatencyMs,
            isControlTurn,
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

      const receivedAudioParts = (content.modelTurn?.parts ?? []).filter(
        (part) => Boolean(part.inlineData?.data),
      );
      const audioParts =
        suppressNativeAudioUntilBoundaryRef.current
        ? []
        : receivedAudioParts;
      const hasModelOutput = Boolean(audioParts.length);

      if (content.interrupted) {
        suppressNativeAudioUntilBoundaryRef.current = false;
        prepareMayuResponse();
        markLearnerResponseStarted();
        const captureReleasePending = stopPlayback();
        if (captureReleasePending) {
          updatePhase(mutedRef.current ? "muted" : "thinking");
          getOutputCaptureGuard().releaseAfterTail(() => {
            if (
              mountedRef.current &&
              isSessionPhase(phaseRef.current)
            ) {
              updatePhase(mutedRef.current ? "muted" : "listening");
            }
          });
        } else {
          updatePhase(mutedRef.current ? "muted" : "listening");
        }
      }

      const interimInput = content.interimInputTranscription?.text;
      if (interimInput) {
        markLearnerResponseStarted();
        applyLearnerTurnEvent({ type: "interim-transcription" });
        applyLearnerTranscriptDraft(interimInput);
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
          applyLearnerTranscriptDraft(finalInput.text);
          updatePhase("thinking");
        } else {
          applyLearnerTurnEvent({ type: "interim-transcription" });
          applyLearnerTranscriptDraft(finalInput.text);
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
          playPresentedNativeAudio(encodedAudio);
        } else {
          pendingNativeAudioRef.current = [
            ...pendingNativeAudioRef.current,
            encodedAudio,
          ];
        }
      }

      if (content.turnComplete || content.waitingForInput) {
        suppressNativeAudioUntilBoundaryRef.current = false;
        mayuTurnCompleteRef.current = true;
        applyLearnerTurnEvent({ type: "model-turn-complete" });
        const fishSpeechPending =
          fishSpeechControllerRef.current?.isPending() === true;
        if (
          !activeSourcesRef.current.size &&
          !fishSpeechPending
        ) {
          settleAssistantPlayback();
        }
      }
    },
    [
      applyLearnerTurnEvent,
      applyLearnerTranscriptDraft,
      commitTranscript,
      finalizePendingPresentation,
      getOutputCaptureGuard,
      markLearnerResponseStarted,
      playPresentedNativeAudio,
      prepareMayuResponse,
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

      const sendPcm = (pcm: Int16Array, level: number) => {
        if (
          mayuPresentationReadyRef.current ||
          !shouldForwardLiveMicrophoneFrame({
            isMuted: mutedRef.current,
            sessionMatches: sessionRef.current === session,
            outputBlocked: outputCaptureGuard.isInputBlocked(),
          })
        ) {
          return;
        }

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
        if (
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
    [getOutputCaptureGuard],
  );

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
    suppressNativeAudioUntilBoundaryRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
    usedCueIdsRef.current = [];
    voiceModeRef.current = "gemini";
    voiceAccessTokenRef.current = null;
    assessmentAccessTokenRef.current = null;
    usedVoiceFallbackRef.current = false;
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setActiveVoiceMode(null);
    setUsedVoiceFallback(false);
    setVoiceNotice("");
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
      const accountAccessTokenPromise = loadAccountAccessToken();
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

      let accountSession = await accountAccessTokenPromise;
      if (accountSession.status !== "authenticated") {
        // Permission prompts and an expired session refresh can outlast the
        // first bounded lookup. Recheck once after microphone access so the
        // authorized owner is not silently routed to the public backup voice.
        accountSession = await loadAccountAccessToken(
          ACCOUNT_SESSION_RETRY_TIMEOUT_MS,
        );
      }
      const accountAccessToken =
        accountSession.status === "authenticated"
          ? accountSession.accessToken
          : "";
      if (attemptId !== connectionAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const requestController = new AbortController();
      tokenRequestRef.current = requestController;
      const tokenPromise = fetch("/api/practice-live/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountAccessToken
            ? { Authorization: `Bearer ${accountAccessToken}` }
            : {}),
        },
        body: JSON.stringify({
          scenarioId,
          familyVoice,
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
        (tokenPayload.voiceMode !== "gemini" &&
          tokenPayload.voiceMode !== "fish") ||
        !isLiveVoiceModeReason(tokenPayload.voiceModeReason) ||
        ((tokenPayload.voiceMode === "fish") !==
          (tokenPayload.voiceModeReason === "authorized")) ||
        (tokenPayload.voiceMode === "fish" &&
          (typeof tokenPayload.voiceAccessToken !== "string" ||
            !tokenPayload.voiceAccessToken)) ||
        typeof tokenPayload.assessmentAccessToken !== "string" ||
        !tokenPayload.assessmentAccessToken ||
        !isLiveFamilyVoice(tokenPayload.familyVoice) ||
        tokenPayload.familyVoice !== familyVoice ||
        !isLiveListenerRelationship(tokenPayload.relationship) ||
        !isLiveSessionDuration(tokenPayload.sessionLimitSeconds) ||
        !Number.isFinite(parsedTokenExpiry) ||
        parsedTokenExpiry <= Date.now()
      ) {
        throw new Error("The live session was not configured correctly.");
      }
      activeRelationshipRef.current = tokenPayload.relationship;
      activeFamilyVoiceRef.current = tokenPayload.familyVoice;
      voiceModeRef.current = tokenPayload.voiceMode;
      voiceAccessTokenRef.current =
        tokenPayload.voiceMode === "fish"
          ? tokenPayload.voiceAccessToken ?? null
          : null;
      assessmentAccessTokenRef.current = tokenPayload.assessmentAccessToken;
      setActiveVoiceMode(tokenPayload.voiceMode);
      setVoiceNotice(
        getLiveVoiceModeNotice({
          familyVoice: tokenPayload.familyVoice,
          voiceMode: tokenPayload.voiceMode,
          reason: tokenPayload.voiceModeReason,
        }),
      );
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
          prepareMayuResponse();
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

      prepareMayuResponse();
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
    cancelPendingAssessmentRequests,
    clearTimer,
    failSession,
    handleServerMessage,
    durationSeconds,
    familyVoice,
    prepareMayuResponse,
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
      familyVoice: activeFamilyVoiceRef.current,
      voiceMode: voiceModeRef.current,
      usedVoiceFallback: usedVoiceFallbackRef.current,
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
    suppressNativeAudioUntilBoundaryRef.current = false;
    pendingNativeAudioRef.current = [];
    pendingPresentedTurnRef.current = null;
    usedCueIdsRef.current = [];
    voiceModeRef.current = "gemini";
    voiceAccessTokenRef.current = null;
    usedVoiceFallbackRef.current = false;
    setElapsedSeconds(0);
    setRemainingSeconds(durationSeconds);
    setLatestTurnLatencyMs(null);
    setTranscript([]);
    setActiveTurn(null);
    setCompletedSession(null);
    setActiveVoiceMode(null);
    setUsedVoiceFallback(false);
    setVoiceNotice("");
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
    transcript,
    activeTurn,
    completedSession,
    activeVoiceMode,
    usedVoiceFallback,
    voiceNotice,
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
