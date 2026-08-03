"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  liveScenarios,
  type LiveScenarioId,
} from "./live-scenarios";
import {
  DEFAULT_LIVE_FAMILY_VOICE,
  DEFAULT_LIVE_LISTENER_RELATIONSHIP,
  DEFAULT_LIVE_SESSION_DURATION,
  getLiveFamilyVoiceLabel,
  getLiveSessionVoiceLabel,
  isLiveFamilyVoice,
  isLiveListenerRelationship,
  isLiveSessionDuration,
  type LiveFamilyVoice,
  type LiveListenerRelationship,
  type LiveSessionDurationSeconds,
} from "./live-config";
import {
  useGeminiLive,
  type CompletedLiveSession,
  type LivePhase,
  type LiveTranscriptTurn,
} from "./useGeminiLive";
import {
  isLiveSessionGrade,
  type LiveScoreMetric,
  type LiveSessionGrade,
} from "./live-session-grading";

const LIVE_HISTORY_KEY = "practicaltelugu.live-sessions.v1";

const statusCopy: Record<
  LivePhase,
  { title: string; detail: string }
> = {
  idle: {
    title: "Tap to start",
    detail: "Mayu will start a real Telugu conversation, then listen for you.",
  },
  requesting: {
    title: "Getting things ready",
    detail: "Allow your microphone, then Mayu will open the live session.",
  },
  connecting: {
    title: "Connecting to Mayu",
    detail: "This usually takes only a moment.",
  },
  listening: {
    title: "I’m listening",
    detail: "Answer in Telugu and keep the conversation moving.",
  },
  thinking: {
    title: "Mayu is thinking",
    detail: "Turning your reply into clear, everyday Telugu.",
  },
  speaking: {
    title: "Mayu is speaking",
    detail: "Follow the Telugu written in English letters and its meaning below.",
  },
  muted: {
    title: "Microphone is off",
    detail: "Turn it back on when you’re ready to continue.",
  },
  ended: {
    title: "Nice work",
    detail: "A focused conversation out loud goes a long way.",
  },
  setup: {
    title: "Connect Gemini Live",
    detail: "One local API key unlocks the live conversation.",
  },
  error: {
    title: "Couldn’t start the conversation",
    detail: "Nothing was saved or sent after the connection stopped.",
  },
};

function readHistory() {
  try {
    const raw = window.localStorage.getItem(LIVE_HISTORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((value): value is CompletedLiveSession => {
      if (!value || typeof value !== "object") return false;
      const session = value as Partial<CompletedLiveSession>;
      return (
        typeof session.id === "string" &&
        liveScenarios.some((scenario) => scenario.id === session.scenarioId) &&
        typeof session.durationSeconds === "number" &&
        typeof session.learnerTurns === "number" &&
        typeof session.completedAt === "string" &&
        (session.familyVoice === undefined ||
          isLiveFamilyVoice(session.familyVoice)) &&
        (session.voiceMode === undefined ||
          session.voiceMode === "gemini" ||
          session.voiceMode === "fish") &&
        (session.usedVoiceFallback === undefined ||
          typeof session.usedVoiceFallback === "boolean") &&
        (session.relationship === undefined ||
          isLiveListenerRelationship(session.relationship)) &&
        (session.sessionLimitSeconds === undefined ||
          isLiveSessionDuration(session.sessionLimitSeconds)) &&
        (session.completionReason === undefined ||
          session.completionReason === "manual" ||
          session.completionReason === "limit") &&
        (session.cueIds === undefined ||
          (Array.isArray(session.cueIds) &&
            session.cueIds.every((cueId) => typeof cueId === "string"))) &&
        (session.grade === undefined || isLiveSessionGrade(session.grade))
      );
    });
  } catch {
    return [];
  }
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatResponseTime(milliseconds: number) {
  const seconds = milliseconds / 1_000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} sec`;
}

function scoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Steady";
  if (score >= 55) return "Building";
  return "Starting point";
}

function metricNote(metric: LiveScoreMetric, score: number | null) {
  if (score === null) {
    if (metric === "pronunciation") return "Not enough spoken Telugu to estimate.";
    if (metric === "accuracy") return "No complete reply was available to assess.";
    return "No clean response timing was captured.";
  }

  if (metric === "pronunciation") {
    if (score >= 90) return "Your Telugu was immediately easy to understand.";
    if (score >= 75) return "Your Telugu was clear, with only a small rough edge.";
    if (score >= 55) return "The meaning came through; one sound needs another rep.";
    return "Slow the phrase down and make each word distinct.";
  }

  if (metric === "accuracy") {
    if (score >= 90) return "Your replies fit the question and kept the meaning intact.";
    if (score >= 75) return "Your meaning landed with one small correction to make.";
    if (score >= 55) return "Mayu could follow you, but the reply needs a cleaner form.";
    return "Use one short Telugu answer before adding more detail.";
  }

  if (score >= 90) return "You answered without a long pause.";
  if (score >= 75) return "Your response rhythm stayed conversational.";
  if (score >= 55) return "A little phrase recall will shorten the pause.";
  return "Rehearse one ready-to-use reply before the next practice.";
}

const unavailableGrade: LiveSessionGrade = {
  averageResponseMs: null,
  assessedTurns: 0,
  overallScore: null,
  pronunciationScore: null,
  accuracyScore: null,
  responseScore: null,
  strongestMetric: null,
  summary: "There was not enough spoken Telugu to score this session.",
  nextStep: "Give Mayu one complete Telugu reply in your next practice.",
};

function SessionResults({
  session,
  previousSession,
  scenarioTitle,
  familyVoiceLabel,
  relationshipLabel,
  resultsRef,
  onRestart,
  onChangeSetup,
}: {
  session: CompletedLiveSession;
  previousSession: CompletedLiveSession | null;
  scenarioTitle: string;
  familyVoiceLabel: string;
  relationshipLabel: string;
  resultsRef: RefObject<HTMLElement | null>;
  onRestart: () => void;
  onChangeSetup: () => void;
}) {
  const grade = session.grade ?? unavailableGrade;
  const previousScore = previousSession?.grade?.overallScore ?? null;
  const scoreDelta =
    grade.overallScore === null || previousScore === null
      ? null
      : grade.overallScore - previousScore;
  const progressCopy =
    scoreDelta === null
      ? "Baseline saved. Your next practice with this same setup will compare here."
      : scoreDelta > 0
        ? `Up ${scoreDelta} ${scoreDelta === 1 ? "point" : "points"} from your last matching practice.`
        : scoreDelta < 0
          ? `Today: ${grade.overallScore}. Last matching practice: ${previousScore}.`
          : "You matched your last score with this setup.";
  const metrics: Array<{
    id: LiveScoreMetric;
    label: string;
    score: number | null;
    value: string;
  }> = [
    {
      id: "pronunciation",
      label: "Pronunciation",
      score: grade.pronunciationScore,
      value:
        grade.pronunciationScore === null
          ? "Not scored"
          : String(grade.pronunciationScore),
    },
    {
      id: "accuracy",
      label: "Accuracy",
      score: grade.accuracyScore,
      value:
        grade.accuracyScore === null ? "Not scored" : String(grade.accuracyScore),
    },
    {
      id: "response",
      label: "Response time",
      score: grade.responseScore,
      value:
        grade.averageResponseMs === null
          ? "Not timed"
          : formatResponseTime(grade.averageResponseMs),
    },
  ];
  const scoreStyle = {
    "--live-score": grade.overallScore ?? 0,
  } as CSSProperties;

  return (
    <section
      ref={resultsRef}
      className="live-results"
      aria-labelledby="live-results-title"
      tabIndex={-1}
    >
      <div className="live-results-hero">
        <div className="live-results-heading">
          <span>Session complete · {scenarioTitle}</span>
          <h2 id="live-results-title">
            {session.completionReason === "limit"
              ? "You completed the practice."
              : "You kept the conversation going."}
          </h2>
          <p>{grade.summary}</p>
          <dl className="live-results-facts">
            <div>
              <dt>Spoken</dt>
              <dd>{formatDuration(session.durationSeconds)}</dd>
            </div>
            <div>
              <dt>Replies</dt>
              <dd>{session.learnerTurns}</dd>
            </div>
            <div>
              <dt>Register</dt>
              <dd>{relationshipLabel}</dd>
            </div>
            <div>
              <dt>Voice</dt>
              <dd>{familyVoiceLabel}</dd>
            </div>
          </dl>
        </div>

        <div
          className="live-results-score"
          data-empty={grade.overallScore === null ? "true" : undefined}
          style={scoreStyle}
          role="img"
          aria-label={
            grade.overallScore === null
              ? "Not enough speech for an overall score"
              : `Overall practice score ${grade.overallScore} out of 100, ${scoreLabel(
                  grade.overallScore,
                )}`
          }
        >
          <div>
            <strong>{grade.overallScore ?? "—"}</strong>
            <span>{grade.overallScore === null ? "not scored" : "/ 100"}</span>
            {grade.overallScore === null ? null : (
              <small>{scoreLabel(grade.overallScore)}</small>
            )}
          </div>
        </div>
      </div>

      <div className="live-results-progress" aria-label="Practice progress">
        <span>Progress</span>
        <strong>{progressCopy}</strong>
      </div>

      <section className="live-results-next" aria-labelledby="live-next-step-title">
        <span id="live-next-step-title">Your next rep</span>
        <p>{grade.nextStep}</p>
      </section>

      <section
        className="live-results-breakdown"
        aria-labelledby="live-breakdown-title"
      >
        <div className="live-results-section-heading">
          <h3 id="live-breakdown-title">How this practice went</h3>
          <p>Simple coaching estimates from this conversation.</p>
        </div>
        <div className="live-results-metrics">
          {metrics.map((metric) => (
            <article key={metric.id} data-empty={metric.score === null ? "true" : undefined}>
              <div className="live-results-metric-heading">
                <span>{metric.label}</span>
                <strong>
                  {metric.value}
                  {metric.id !== "response" && metric.score !== null ? (
                    <small>/100</small>
                  ) : metric.id === "response" && metric.score !== null ? (
                    <small>{metric.score}/100</small>
                  ) : null}
                </strong>
              </div>
              <span className="live-results-meter" aria-hidden="true">
                <i
                  style={
                    { "--metric-score": `${metric.score ?? 0}%` } as CSSProperties
                  }
                />
              </span>
              <p>{metricNote(metric.id, metric.score)}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="live-results-method">
        Pronunciation is an AI estimate of how understandable the Telugu sounded,
        not a phoneme-by-phoneme accent grade. Response time is measured from when
        Mayu finishes to when you begin.
      </p>

      <div className="live-results-actions">
        <button type="button" className="live-restart" onClick={onRestart}>
          Practice same setup
        </button>
        <button type="button" className="live-change-setup" onClick={onChangeSetup}>
          Change setup
        </button>
        <Link href="/">Back to Today</Link>
      </div>
    </section>
  );
}

function MicrophoneIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.4a3.4 3.4 0 0 0-3.4 3.4v5.1a3.4 3.4 0 0 0 5.9 2.3" />
      <path d="M15.4 11.6V6.8A3.4 3.4 0 0 0 12 3.4" />
      <path d="M5.6 11.4v.6A6.4 6.4 0 0 0 16 17" />
      <path d="M18.4 11.4v.6a6.4 6.4 0 0 1-.4 2.2M12 18.4v2.4M8.8 20.8h6.4" />
      {off ? <path d="M4.2 4.2 19.8 19.8" /> : null}
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 10v4h3l4 3.2V6.8L8 10H5Z" />
      <path d="M15.2 9.1a4.1 4.1 0 0 1 0 5.8M17.7 6.8a7.2 7.2 0 0 1 0 10.4" />
    </svg>
  );
}

function turnDisplayLabel(
  phase: LivePhase,
  hasLearnerTurn: boolean,
) {
  if (phase === "speaking") return "Mayu is saying";
  if (phase === "listening") return "Your turn to reply";
  if (phase === "thinking") {
    return hasLearnerTurn ? "Mayu heard you" : "Starting the conversation";
  }
  if (phase === "ended") return "Last Telugu turn";
  return "Telugu on screen";
}

function CurrentTurnCard({
  turn,
  phase,
  hasLearnerTurn,
  canRepeatTurn,
  onRepeatTurn,
}: {
  turn: LiveTranscriptTurn | null;
  phase: LivePhase;
  hasLearnerTurn: boolean;
  canRepeatTurn: boolean;
  onRepeatTurn: (turnId: string, options?: { slow?: boolean }) => void;
}) {
  const label = turnDisplayLabel(phase, hasLearnerTurn);

  return (
    <section
      className={`live-follow-card${turn ? "" : " is-loading"}`}
      aria-labelledby="live-follow-title"
    >
      <div className="live-follow-heading">
        <div>
          <span className="live-follow-pulse" aria-hidden="true" />
          <span id="live-follow-title">{label}</span>
        </div>
        {turn ? (
          <span className="live-follow-context">Telugu · English letters</span>
        ) : (
          <span className="live-follow-context">Preparing the first turn</span>
        )}
      </div>

      {turn ? (
        <>
          <div className="live-follow-phrase">
            <div className="live-follow-spoken">
              <strong className="live-follow-roman" lang="te-Latn">
                {turn.roman}
              </strong>
              {turn.pronunciation ? (
                <span className="live-follow-pronunciation" lang="en">
                  ({turn.pronunciation})
                </span>
              ) : null}
            </div>
            <div className="live-follow-english" lang="en">
              <span>English</span>
              <p>{turn.english}</p>
            </div>
          </div>

          <div className="live-follow-actions">
            <button
              type="button"
              onClick={() => onRepeatTurn(turn.id, { slow: true })}
              disabled={!canRepeatTurn}
            >
              <SpeakerIcon />
              Hear this turn slowly
            </button>
          </div>
        </>
      ) : (
        <div className="live-follow-placeholder" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  );
}

function ConversationTranscript({
  turns,
  transcriptRef,
  canRepeatTurn,
  showRepeatActions = true,
  onRepeatTurn,
}: {
  turns: LiveTranscriptTurn[];
  transcriptRef: RefObject<HTMLOListElement | null>;
  canRepeatTurn: boolean;
  showRepeatActions?: boolean;
  onRepeatTurn: (turnId: string, options?: { slow?: boolean }) => void;
}) {
  return (
    <section
      className="live-conversation"
      aria-labelledby="live-conversation-title"
    >
      <div className="live-conversation-heading">
        <div>
          <h2 id="live-conversation-title">Conversation transcript</h2>
          <p>Spoken Telugu in English letters, with English underneath.</p>
        </div>
        <span>
          {turns.length
            ? `${turns.length} recent ${turns.length === 1 ? "turn" : "turns"}`
            : "Waiting for the first turn"}
        </span>
      </div>

      {turns.length ? (
        <ol
          ref={transcriptRef}
          className="live-transcript"
          aria-label="Live transcript"
        >
          {turns.map((turn) => (
            <li
              key={turn.id}
              data-speaker={turn.speaker}
              data-state={turn.final ? "final" : "interim"}
            >
              <div className="live-transcript-speaker">
                <span>{turn.speaker === "mayu" ? "Mayu" : "You"}</span>
                <small>
                  {turn.final
                    ? turn.speaker === "you" && turn.sourceLanguage !== "telugu"
                      ? "Telugu version"
                      : ""
                    : turn.speaker === "you"
                      ? "Translating…"
                      : "Preparing…"}
                </small>
              </div>
              {turn.final ? (
                <div className="live-transcript-copy">
                  <div className="live-transcript-spoken">
                    <p className="live-transcript-roman" lang="te-Latn">
                      {turn.roman}
                    </p>
                    {turn.pronunciation ? (
                      <small className="live-transcript-pronunciation">
                        ({turn.pronunciation})
                      </small>
                    ) : null}
                  </div>
                  <p className="live-transcript-english" lang="en">
                    {turn.english}
                  </p>
                </div>
              ) : (
                <div className="live-transcript-pending">
                  <span aria-hidden="true" />
                  <p>Turning your reply into readable Telugu…</p>
                </div>
              )}
              {showRepeatActions && turn.final && turn.speaker === "mayu" ? (
                <button
                  type="button"
                  className="live-transcript-review"
                  onClick={() => onRepeatTurn(turn.id, { slow: true })}
                  disabled={!canRepeatTurn}
                >
                  Hear slowly
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="live-transcript-empty">
          Your full conversation will stay here as you practice. Telugu appears
          in English letters, never Telugu script.
        </p>
      )}
    </section>
  );
}

function Orb({
  phase,
  micLevel,
  assistantLevel,
  onStart,
  onPrepare,
}: {
  phase: LivePhase;
  micLevel: number;
  assistantLevel: number;
  onStart: () => void;
  onPrepare: () => void;
}) {
  const canStart = ["idle", "setup", "error"].includes(phase);
  const level = phase === "speaking" ? assistantLevel : micLevel;
  const style = {
    "--live-level": level.toFixed(3),
  } as CSSProperties;
  const contents = (
    <>
      <span className="live-orb-aura" />
        <span className="live-orb-shell">
          <span className="live-orb-color live-orb-color-blue" />
          <span className="live-orb-color live-orb-color-green" />
          <span className="live-orb-gloss" />
        <span className="live-orb-depth" />
      </span>
      <span className="live-orb-shadow" />
    </>
  );

  if (canStart) {
    return (
      <button
        type="button"
        className="live-orb live-orb-action"
        data-phase={phase}
        style={style}
        onClick={onStart}
        onPointerEnter={onPrepare}
        onFocus={onPrepare}
        onTouchStart={onPrepare}
        aria-label="Start live practice"
      >
        {contents}
      </button>
    );
  }

  return (
    <div
      className="live-orb"
      data-phase={phase}
      style={style}
      role="img"
      aria-label={statusCopy[phase].title}
    >
      {contents}
    </div>
  );
}

export default function PracticeLive() {
  const [scenarioId, setScenarioId] =
    useState<LiveScenarioId>("family-check-in");
  const [relationship, setRelationship] =
    useState<LiveListenerRelationship>(DEFAULT_LIVE_LISTENER_RELATIONSHIP);
  const [familyVoice, setFamilyVoice] = useState<LiveFamilyVoice>(
    DEFAULT_LIVE_FAMILY_VOICE,
  );
  const [sessionDuration, setSessionDuration] =
    useState<LiveSessionDurationSeconds>(DEFAULT_LIVE_SESSION_DURATION);
  const [isPracticeSettingsOpen, setIsPracticeSettingsOpen] = useState(false);
  const [history, setHistory] = useState<CompletedLiveSession[]>([]);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const live = useGeminiLive(
    scenarioId,
    relationship,
    sessionDuration,
    familyVoice,
  );
  const scenario =
    liveScenarios.find((candidate) => candidate.id === scenarioId) ??
    liveScenarios[0];
  const isBusy = [
    "requesting",
    "connecting",
    "listening",
    "thinking",
    "speaking",
    "muted",
  ].includes(live.phase);
  const hasSessionLayout = isBusy || live.phase === "ended";
  const canMute = ["listening", "thinking", "speaking", "muted"].includes(
    live.phase,
  );
  const historySummary = useMemo(() => {
    const seconds = history.reduce(
      (total, session) => total + session.durationSeconds,
      0,
    );
    return {
      sessions: history.length,
      minutes: Math.max(history.length ? 1 : 0, Math.round(seconds / 60)),
    };
  }, [history]);
  const previousComparableSession = useMemo(() => {
    const completedSession = live.completedSession;
    if (!completedSession) return null;

    return (
      history.find(
        (session) =>
          session.id !== completedSession.id &&
          session.scenarioId === completedSession.scenarioId &&
          session.familyVoice === completedSession.familyVoice &&
          (session.voiceMode ?? "gemini") ===
            (completedSession.voiceMode ?? "gemini") &&
          session.relationship === completedSession.relationship &&
          session.grade?.overallScore !== null &&
          session.grade?.overallScore !== undefined,
      ) ?? null
    );
  }, [history, live.completedSession]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHistory(readHistory()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!live.completedSession) return;

    const completedSession = live.completedSession;
    const frame = window.requestAnimationFrame(() => {
      setHistory((current) => {
        if (current.some((session) => session.id === completedSession.id)) {
          return current;
        }

        const next = [completedSession, ...current].slice(0, 12);
        window.localStorage.setItem(LIVE_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [live.completedSession]);

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element || !live.transcript.length) return;

    element.scrollTop = element.scrollHeight;
  }, [live.transcript]);

  useEffect(() => {
    if (live.phase !== "ended" || !live.completedSession) return;

    const frame = window.requestAnimationFrame(() => resultsRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [live.completedSession, live.phase]);

  const chooseScenario = (nextScenarioId: LiveScenarioId) => {
    if (isBusy) return;
    live.reset();
    setScenarioId(nextScenarioId);
  };

  const chooseRelationship = (nextRelationship: LiveListenerRelationship) => {
    if (isBusy || nextRelationship === relationship) return;
    live.reset();
    setRelationship(nextRelationship);
  };

  const chooseFamilyVoice = (nextFamilyVoice: LiveFamilyVoice) => {
    if (isBusy || nextFamilyVoice === familyVoice) return;
    live.reset();
    setFamilyVoice(nextFamilyVoice);
  };

  const chooseDuration = (nextDuration: LiveSessionDurationSeconds) => {
    if (isBusy || nextDuration === sessionDuration) return;
    live.reset();
    setSessionDuration(nextDuration);
  };

  const startPractice = () => {
    setIsPracticeSettingsOpen(false);
    live.start();
  };

  const changePracticeSetup = () => {
    live.reset();
    setIsPracticeSettingsOpen(true);
  };

  const currentStatus = live.isLastExchange
    ? {
        title: "Last exchange",
        detail: "Finish this short turn before the practice wraps up.",
      }
    : statusCopy[live.phase];
  const relationshipLabel =
    relationship === "close" ? "Someone close" : "Elder or someone new";
  const familyVoiceLabel = getLiveFamilyVoiceLabel(familyVoice);
  const activeVoiceLabel = live.activeVoiceMode
    ? getLiveSessionVoiceLabel({
        familyVoice,
        voiceMode: live.activeVoiceMode,
        usedVoiceFallback: live.usedVoiceFallback,
      })
    : familyVoiceLabel;
  const completedSessionVoiceLabel = live.completedSession
    ? getLiveSessionVoiceLabel({
        familyVoice:
          live.completedSession.familyVoice ?? DEFAULT_LIVE_FAMILY_VOICE,
        voiceMode: live.completedSession.voiceMode,
        usedVoiceFallback: live.completedSession.usedVoiceFallback,
      })
    : familyVoiceLabel;
  const durationMinutes = sessionDuration / 60;
  const startActionLabel = ["setup", "error"].includes(live.phase)
    ? "Try again"
    : `Start ${durationMinutes}-minute practice`;

  return (
    <main
      className={`live-page${hasSessionLayout ? " is-session-active" : ""}`}
    >
      <header className="live-intro">
        <span className="live-eyebrow">
          <span aria-hidden="true" />
          Practice Live
        </span>
        <h1>Practice Telugu out loud.</h1>
        <p>
          Choose a private family voice when your account is authorized, or use
          Mayu&apos;s backup voice. Telugu stays in English letters, with the meaning
          directly underneath.
        </p>
      </header>

      <section
        className={`live-stage${hasSessionLayout ? " is-session-active" : ""}`}
        data-phase={live.phase}
        data-response-ms={live.latestTurnLatencyMs ?? undefined}
      >
        <div className="live-scene-copy">
          <span>{scenario.eyebrow}</span>
          <strong>{scenario.title}</strong>
          <p>{scenario.description}</p>
          {isBusy ? (
            <small className="live-session-lock">
              {activeVoiceLabel}
              {` · ${relationshipLabel}`}
              {` · ${formatDuration(sessionDuration)} practice`}
            </small>
          ) : null}
        </div>

        {!hasSessionLayout ? (
          <section className="live-practice-details" aria-label="Practice setup">
            <button
              type="button"
              className="live-practice-details-summary"
              aria-expanded={isPracticeSettingsOpen}
              aria-controls="live-practice-settings"
              onClick={() => setIsPracticeSettingsOpen((current) => !current)}
            >
              <span>
                <small>Practice setup</small>
                <strong>
                  {familyVoiceLabel} · {relationshipLabel} · {durationMinutes} min
                </strong>
              </span>
              <span className="live-practice-details-action">
                {isPracticeSettingsOpen ? "Done" : "Change"}
              </span>
            </button>

            <div
              id="live-practice-settings"
              className="live-practice-details-panel"
              hidden={!isPracticeSettingsOpen}
            >
              <div className="live-practice-situation">
                <span id="live-situation-label">Situation</span>
                <div
                  className="live-scenario-picker"
                  role="group"
                  aria-labelledby="live-situation-label"
                >
                  {liveScenarios.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.id}
                      className={candidate.id === scenarioId ? "is-selected" : ""}
                      onClick={() => chooseScenario(candidate.id)}
                      aria-pressed={candidate.id === scenarioId}
                      disabled={isBusy}
                    >
                      {candidate.pickerLabel}
                    </button>
                  ))}
                </div>
              </div>

              <section
                className="live-session-settings"
                aria-label="Live practice settings"
              >
                <fieldset className="live-family-voice-setting" disabled={isBusy}>
                  <legend>Practice voice</legend>
                  <div className="live-setting-options">
                    <label
                      className={familyVoice === "grandma" ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-family-voice"
                        value="grandma"
                        checked={familyVoice === "grandma"}
                        onChange={() => chooseFamilyVoice("grandma")}
                      />
                      <span>
                        <strong>Grandma</strong>
                        <small>Private clone for authorized accounts</small>
                      </span>
                    </label>
                    <label
                      className={familyVoice === "grandpa" ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-family-voice"
                        value="grandpa"
                        checked={familyVoice === "grandpa"}
                        onChange={() => chooseFamilyVoice("grandpa")}
                      />
                      <span>
                        <strong>Grandpa</strong>
                        <small>Private clone for authorized accounts</small>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <fieldset disabled={isBusy}>
                  <legend>Who are you speaking with?</legend>
                  <div className="live-setting-options">
                    <label
                      className={relationship === "close" ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-relationship"
                        value="close"
                        checked={relationship === "close"}
                        onChange={() => chooseRelationship("close")}
                      />
                      <span>
                        <strong>Someone close</strong>
                        <small>Close friends or family you speak to familiarly</small>
                      </span>
                    </label>
                    <label
                      className={relationship === "respectful" ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-relationship"
                        value="respectful"
                        checked={relationship === "respectful"}
                        onChange={() => chooseRelationship("respectful")}
                      />
                      <span>
                        <strong>Elder or someone new</strong>
                        <small>Safest even when someone new is your age</small>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <fieldset disabled={isBusy}>
                  <legend>How long?</legend>
                  <div className="live-setting-options">
                    <label
                      className={sessionDuration === 60 ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-duration"
                        value="60"
                        checked={sessionDuration === 60}
                        onChange={() => chooseDuration(60)}
                      />
                      <span>
                        <strong>Quick practice</strong>
                        <small>1:00</small>
                      </span>
                    </label>
                    <label
                      className={sessionDuration === 120 ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="live-duration"
                        value="120"
                        checked={sessionDuration === 120}
                        onChange={() => chooseDuration(120)}
                      />
                      <span>
                        <strong>Full practice</strong>
                        <small>2:00</small>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </section>
            </div>
          </section>
        ) : null}

        <div className="live-session-core">
          <Orb
            phase={live.phase}
            micLevel={live.micLevel}
            assistantLevel={live.assistantLevel}
            onStart={startPractice}
            onPrepare={live.prepare}
          />

          {hasSessionLayout ? (
            <div className="live-status">
              <div>
                <span className="live-status-dot" aria-hidden="true" />
                <strong>{currentStatus.title}</strong>
                {isBusy ? (
                  <time dateTime={`PT${live.remainingSeconds}S`}>
                    {formatDuration(live.remainingSeconds)} left
                  </time>
                ) : null}
              </div>
              <p>{live.errorMessage || currentStatus.detail}</p>
            </div>
          ) : null}
        </div>

        {!hasSessionLayout ? (
          <div className="live-preflight-actions">
            <button
              type="button"
              className="live-start-action"
              onClick={startPractice}
              onPointerEnter={live.prepare}
              onFocus={live.prepare}
              onTouchStart={live.prepare}
            >
              {startActionLabel}
              <span aria-hidden="true">→</span>
            </button>
            <p className="live-preflight-note">
              {live.errorMessage || "Mayu speaks first, then listens for your reply."}
            </p>
            <p className="live-privacy-note">
              Your microphone audio is sent to Google Gemini. When your account
              can use a private family voice, Mayu&apos;s Telugu response text is sent
              to Fish Audio; otherwise Gemini&apos;s backup voice is used.
              PracticalTelugu does not save your audio.
            </p>
          </div>
        ) : null}

        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentStatus.title}. {live.errorMessage || currentStatus.detail}
        </p>

        {live.phase === "setup" ? (
          <div className="live-setup" role="alert">
            <div>
              <span>1</span>
              <p>
                Create a key in{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google AI Studio
                </a>
                .
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                Add this line to the local <code>.env.local</code> file:
              </p>
            </div>
            <pre>
              <code>GEMINI_API_KEY=your_key_here</code>
            </pre>
            <div>
              <span>3</span>
              <p>
                Restart <code>npm run dev</code>, then tap the orb again.
              </p>
            </div>
            <small>
              The permanent key stays on the server. The browser receives a
              one-use temporary token.
            </small>
          </div>
        ) : null}

        {isBusy ? (
          <div className="live-controls" aria-label="Live practice controls">
            {canMute ? (
              <button
                type="button"
                className="live-control"
                onClick={live.toggleMute}
                aria-pressed={live.isMuted}
              >
                <MicrophoneIcon off={live.isMuted} />
                {live.isMuted ? "Turn mic on" : "Mute"}
              </button>
            ) : null}
            <button
              type="button"
              className="live-control live-control-end"
              onClick={
                live.phase === "requesting" || live.phase === "connecting"
                  ? live.reset
                  : () => live.end()
              }
            >
              <StopIcon />
              {live.phase === "requesting" || live.phase === "connecting"
                ? "Cancel"
                : "End practice"}
            </button>
          </div>
        ) : null}

        {isBusy ? (
          <>
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {live.activeTurn
                ? `Mayu says: ${live.activeTurn.roman}. English meaning: ${live.activeTurn.english}.`
                : ""}
            </p>

            <CurrentTurnCard
              turn={live.activeTurn}
              phase={live.phase}
              hasLearnerTurn={live.transcript.some(
                (turn) => turn.speaker === "you",
              )}
              canRepeatTurn={live.canRepeatTurn}
              onRepeatTurn={live.repeatTurn}
            />
            <ConversationTranscript
              turns={live.transcript}
              transcriptRef={transcriptRef}
              canRepeatTurn={live.canRepeatTurn}
              onRepeatTurn={live.repeatTurn}
            />
          </>
        ) : null}

        {live.phase === "ended" && live.completedSession ? (
          <>
            <SessionResults
              session={live.completedSession}
              previousSession={previousComparableSession}
              scenarioTitle={scenario.title}
              familyVoiceLabel={completedSessionVoiceLabel}
              relationshipLabel={relationshipLabel}
              resultsRef={resultsRef}
              onRestart={startPractice}
              onChangeSetup={changePracticeSetup}
            />

            <details className="live-review">
              <summary>
                <span>Review your conversation</span>
                <small>
                  {live.transcript.length} {live.transcript.length === 1 ? "turn" : "turns"}
                </small>
              </summary>
              <ConversationTranscript
                turns={live.transcript}
                transcriptRef={transcriptRef}
                canRepeatTurn={false}
                showRepeatActions={false}
                onRepeatTurn={live.repeatTurn}
              />
            </details>
          </>
        ) : null}
      </section>

      <footer className="live-local-progress">
        <span>Saved on this device</span>
        {historySummary.sessions ? (
          <strong>
            {historySummary.sessions} {historySummary.sessions === 1 ? "session" : "sessions"}
            {`, ${historySummary.minutes} min spoken`}
          </strong>
        ) : (
          <strong>Your live practice will appear here.</strong>
        )}
      </footer>
    </main>
  );
}
