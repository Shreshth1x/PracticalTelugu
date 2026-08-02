"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  liveScenarios,
  type LiveScenarioId,
} from "./live-scenarios";
import {
  useGeminiLive,
  type CompletedLiveSession,
  type LivePhase,
  type LiveTranscriptTurn,
} from "./useGeminiLive";

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
    detail: "Checking the live session before opening your microphone.",
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
    detail: "A few useful minutes out loud goes a long way.",
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
        (session.cueIds === undefined ||
          (Array.isArray(session.cueIds) &&
            session.cueIds.every((cueId) => typeof cueId === "string")))
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
  const canStart = ["idle", "ended", "setup", "error"].includes(phase);
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
        <span className="live-orb-color live-orb-color-saffron" />
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
        aria-label={phase === "ended" ? "Practice again" : "Start live practice"}
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
  const [history, setHistory] = useState<CompletedLiveSession[]>([]);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const live = useGeminiLive(scenarioId);
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

  const chooseScenario = (nextScenarioId: LiveScenarioId) => {
    if (isBusy) return;
    live.reset();
    setScenarioId(nextScenarioId);
  };

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
          Have a real Telugu conversation with Mayu. Follow every turn written
          in English letters, with the English meaning directly underneath.
        </p>
      </header>

      <div
        className="live-scenario-picker"
        aria-label="Choose a live situation"
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

      <section
        className={`live-stage${hasSessionLayout ? " is-session-active" : ""}`}
        data-phase={live.phase}
      >
        <div className="live-scene-copy">
          <span>{scenario.eyebrow}</span>
          <strong>{scenario.title}</strong>
          <p>{scenario.description}</p>
        </div>

        <div className="live-session-core">
          <Orb
            phase={live.phase}
            micLevel={live.micLevel}
            assistantLevel={live.assistantLevel}
            onStart={live.start}
            onPrepare={live.prepare}
          />

          <div className="live-status">
            <div>
              <span className="live-status-dot" aria-hidden="true" />
              <strong>{statusCopy[live.phase].title}</strong>
              {isBusy ? (
                <time dateTime={`PT${live.elapsedSeconds}S`}>
                  {formatDuration(live.elapsedSeconds)}
                </time>
              ) : null}
            </div>
            <p>{live.errorMessage || statusCopy[live.phase].detail}</p>
          </div>
        </div>

        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusCopy[live.phase].title}.{" "}
          {live.errorMessage || statusCopy[live.phase].detail}
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
                aria-pressed={live.phase === "muted"}
              >
                <MicrophoneIcon off={live.phase === "muted"} />
                {live.phase === "muted" ? "Turn mic on" : "Mute"}
              </button>
            ) : null}
            <button
              type="button"
              className="live-control live-control-end"
              onClick={
                live.phase === "requesting" || live.phase === "connecting"
                  ? live.reset
                  : live.end
              }
            >
              <StopIcon />
              {live.phase === "requesting" || live.phase === "connecting"
                ? "Cancel"
                : "End practice"}
            </button>
          </div>
        ) : null}

        {isBusy || live.phase === "ended" ? (
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
                  {live.transcript.length
                    ? `${live.transcript.length} recent ${
                        live.transcript.length === 1 ? "turn" : "turns"
                      }`
                    : "Waiting for the first turn"}
                </span>
              </div>

              {live.transcript.length ? (
                <ol
                  ref={transcriptRef}
                  className="live-transcript"
                  aria-label="Live transcript"
                >
                  {live.transcript.map((turn) => {
                    return (
                      <li
                        key={turn.id}
                        data-speaker={turn.speaker}
                        data-state={turn.final ? "final" : "interim"}
                      >
                        <div className="live-transcript-speaker">
                          <span>
                            {turn.speaker === "mayu" ? "Mayu" : "You"}
                          </span>
                          <small>
                            {turn.final
                              ? turn.speaker === "you" &&
                                turn.sourceLanguage !== "telugu"
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
                        {turn.final && turn.speaker === "mayu" ? (
                          <button
                            type="button"
                            className="live-transcript-review"
                            onClick={() => live.repeatTurn(turn.id, { slow: true })}
                            disabled={!live.canRepeatTurn}
                          >
                            Hear slowly
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="live-transcript-empty">
                  Your full conversation will stay here as you practice. Telugu
                  appears in English letters, never Telugu script.
                </p>
              )}
            </section>
          </>
        ) : null}

        {live.phase === "ended" ? (
          <div className="live-recap">
            <div className="live-recap-heading">
              <span>SESSION COMPLETE</span>
              <h2>You kept the conversation going.</h2>
              <p>
                {formatDuration(live.elapsedSeconds)} out loud
                {live.completedSession?.learnerTurns
                  ? `, with ${live.completedSession.learnerTurns} spoken ${
                      live.completedSession.learnerTurns === 1
                        ? "reply"
                        : "replies"
                    }`
                  : ""}
                .
              </p>
              <small>
                Your complete conversation and every English meaning are saved
                in the transcript above until you leave this page.
              </small>
            </div>
            <button type="button" className="live-restart" onClick={live.start}>
              Start another conversation
            </button>
          </div>
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
