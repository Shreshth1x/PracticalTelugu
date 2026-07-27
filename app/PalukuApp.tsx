"use client";

import { useEffect, useMemo, useState } from "react";
import {
  essentialsLessons,
  findLesson,
  foundationLessons,
  lockedUnits,
  type Lesson,
  type TeluguWord,
  type TrackId,
} from "./course-data";

type SavedState = {
  xp: number;
  streak: number;
  energy: number;
  dailyGoal: number;
  selectedTrack: TrackId;
  completed: string[];
};

type Step =
  | { type: "introduce"; word: TeluguWord }
  | { type: "choice"; word: TeluguWord; options: TeluguWord[] }
  | {
      type: "true-false";
      word: TeluguWord;
      shownMeaning: string;
      answer: boolean;
    }
  | { type: "matching"; words: TeluguWord[] }
  | { type: "arrange"; word: TeluguWord; tokens: string[] };

type ResultState = "idle" | "correct" | "wrong";

const STORAGE_KEY = "palukulu.progress.v1";
const ONBOARDED_KEY = "palukulu.onboarded.v1";

const defaultState: SavedState = {
  xp: 0,
  streak: 0,
  energy: 5,
  dailyGoal: 20,
  selectedTrack: "essentials",
  completed: [],
};

function buildSteps(lesson: Lesson): Step[] {
  const steps: Step[] = [];

  lesson.words.forEach((word, index) => {
    const rotated = [
      ...lesson.words.slice(index),
      ...lesson.words.slice(0, index),
    ];

    steps.push({ type: "introduce", word });

    if (index % 2 === 0 || index === lesson.words.length - 1) {
      steps.push({ type: "choice", word, options: rotated });
    } else {
      const isTrue = index % 4 === 1;
      steps.push({
        type: "true-false",
        word,
        shownMeaning: isTrue
          ? word.english
          : lesson.words[(index + 1) % lesson.words.length].english,
        answer: isTrue,
      });
    }
  });

  steps.push({ type: "matching", words: lesson.words.slice(0, 3) });

  const phrase = lesson.words.find(
    (word) => word.telugu.trim().split(/\s+/).length > 1,
  );
  if (phrase) {
    steps.push({
      type: "arrange",
      word: phrase,
      tokens: phrase.telugu.trim().split(/\s+/).reverse(),
    });
  }

  return steps;
}

function normalize(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.,!?;:'"()।]/g, "")
    .replace(/\s+/g, " ");
}

function PeacockAvatar({
  className = "",
  mood = "idle",
}: {
  className?: string;
  mood?: "idle" | "correct" | "wrong" | "complete";
}) {
  return (
    <span className={`mascot-frame mascot-${mood} ${className}`.trim()}>
      {/* The pre-sized WebP is intentionally served directly for Worker portability. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/maya-peacock.webp"
        alt="Mayu the peacock waving hello"
      />
    </span>
  );
}

function FeatherEnergy({ energy }: { energy: number }) {
  return (
    <span className="feather-energy" aria-label={`${energy} of 5 feathers`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          className={index < energy ? "feather-full" : "feather-empty"}
          key={index}
          aria-hidden="true"
        >
          ◕
        </span>
      ))}
    </span>
  );
}

function ProgressBar({
  value,
  max = 100,
  className = "",
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span
      className={`progress-track ${className}`.trim()}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
    >
      <span className="progress-fill" style={{ width: `${percentage}%` }} />
    </span>
  );
}

function AppHeader({
  state,
  onHome,
}: {
  state: SavedState;
  onHome: () => void;
}) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <button className="brand-button" onClick={onHome} aria-label="PalukuLingo home">
          <PeacockAvatar className="brand-mascot" />
          <span className="brand-word">
            Paluku<span>Lingo</span>
          </span>
        </button>
        <div className="header-stats">
          <span className="stat" aria-label={`Daily streak ${state.streak}`}>
            <span aria-hidden="true">🔥</span>
            <b>{state.streak}</b>
          </span>
          <span className="stat" aria-label={`${state.xp} total XP`}>
            <span aria-hidden="true">✦</span>
            <b>{state.xp}</b>
          </span>
          <FeatherEnergy energy={state.energy} />
        </div>
      </div>
    </header>
  );
}

function TrackChoice({
  selected,
  onSelect,
  compact = false,
}: {
  selected: TrackId;
  onSelect: (track: TrackId) => void;
  compact?: boolean;
}) {
  return (
    <div className={`track-grid ${compact ? "track-grid-compact" : ""}`}>
      <button
        className={`track-choice track-essentials ${
          selected === "essentials" ? "track-selected" : ""
        }`}
        onClick={() => onSelect("essentials")}
        aria-pressed={selected === "essentials"}
      >
        <span className="track-kicker">I need the useful stuff</span>
        <strong>Learn the essentials</strong>
        <span>Hello, thank you, names, family, food, and help.</span>
        <em>Start speaking in 10 minutes →</em>
      </button>
      <button
        className={`track-choice track-foundations ${
          selected === "foundations" ? "track-selected" : ""
        }`}
        onClick={() => onSelect("foundations")}
        aria-pressed={selected === "foundations"}
      >
        <span className="track-kicker">I want the whole language</span>
        <strong>Start from the beginning</strong>
        <span>Build real sentences, then learn Telugu script and sounds.</span>
        <em>Take the full path →</em>
      </button>
    </div>
  );
}

function UnitHeader({
  track,
  progress,
}: {
  track: TrackId;
  progress: number;
}) {
  const essentials = track === "essentials";
  return (
    <section
      className={`unit-header ${essentials ? "unit-header-coral" : "unit-header-blue"}`}
    >
      <span className="unit-icon" aria-hidden="true">
        {essentials ? "ప" : "అ"}
      </span>
      <span className="unit-copy">
        <small>{essentials ? "CRASH COURSE" : "UNIT 1 · SPOKEN FIRST"}</small>
        <strong>{essentials ? "The essentials" : "Building blocks"}</strong>
      </span>
      <b className="unit-percent">{progress}%</b>
      <ProgressBar value={progress} />
      <span className="woven-strip" aria-hidden="true" />
    </section>
  );
}

function LearningPath({
  lessons,
  completed,
  onStart,
}: {
  lessons: Lesson[];
  completed: string[];
  onStart: (lesson: Lesson) => void;
}) {
  return (
    <ol className="learning-path" aria-label="Lesson path">
      {lessons.map((lesson, index) => {
        const done = completed.includes(lesson.id);
        return (
          <li
            key={lesson.id}
            className={`lesson-node node-${index % 4} ${
              lesson.milestone ? "lesson-milestone" : ""
            } ${done ? "lesson-done" : ""}`}
          >
            {index > 0 && (
              <span
                className={`path-connector ${
                  completed.includes(lessons[index - 1].id)
                    ? "connector-complete"
                    : ""
                }`}
                aria-hidden="true"
              />
            )}
            {lesson.milestone && (
              <span className="milestone-pill">MILESTONE</span>
            )}
            <button
              className="node-button"
              onClick={() => onStart(lesson)}
              aria-label={`${done ? "Review" : "Start"} lesson ${index + 1}: ${lesson.title}`}
            >
              <span className="node-icon" aria-hidden="true">
                {lesson.icon}
              </span>
              <span className="node-number" aria-hidden="true">
                {done ? "✓" : index + 1}
              </span>
            </button>
            <span className="node-label">
              <strong>{lesson.title}</strong>
              <small>{lesson.description}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LockedUnits() {
  return (
    <div className="locked-units">
      {lockedUnits.map((unit) => (
        <section className="locked-unit" key={unit.number}>
          <div className="locked-unit-title">
            <span className="unit-icon unit-icon-locked" aria-hidden="true">
              {unit.icon}
            </span>
            <span className="unit-copy">
              <small>UNIT {unit.number}</small>
              <strong>{unit.title}</strong>
            </span>
            <span aria-label="Locked">🔒</span>
            <span className="woven-strip" aria-hidden="true" />
          </div>
          <div className="locked-unit-body">
            <p>{unit.unlockCopy}</p>
            <ProgressBar value={0} />
            <small>Keep following the path above to open this unit.</small>
          </div>
        </section>
      ))}
    </div>
  );
}

function Onboarding({
  selectedTrack,
  onTrack,
  onDone,
}: {
  selectedTrack: TrackId;
  onTrack: (track: TrackId) => void;
  onDone: () => void;
}) {
  const [page, setPage] = useState(0);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        {page === 0 ? (
          <>
            <PeacockAvatar className="onboarding-mascot" />
            <span className="telugu-eyebrow">పలుకు · speak</span>
            <h1 id="onboarding-title">Telugu can feel close to home.</h1>
            <p>
              Meet Mayu. She will help you learn the words you need now—or take
              the whole language one gentle step at a time.
            </p>
          </>
        ) : (
          <>
            <h1 id="onboarding-title">What brings you here?</h1>
            <p>There is no wrong starting point. You can switch paths anytime.</p>
            <TrackChoice
              selected={selectedTrack}
              onSelect={onTrack}
              compact
            />
          </>
        )}
        <div className="onboarding-footer">
          <button className="text-button" onClick={onDone}>
            Skip
          </button>
          <span className="step-dots" aria-label={`Step ${page + 1} of 2`}>
            <i className={page === 0 ? "dot-active" : ""} />
            <i className={page === 1 ? "dot-active" : ""} />
          </span>
          {page === 0 ? (
            <button className="primary-button button-blue" onClick={() => setPage(1)}>
              Next
            </button>
          ) : (
            <button className="primary-button button-gold" onClick={onDone}>
              Start my path
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function HomeView({
  state,
  setState,
  startLesson,
  showOnboarding,
  closeOnboarding,
}: {
  state: SavedState;
  setState: React.Dispatch<React.SetStateAction<SavedState>>;
  startLesson: (lesson: Lesson) => void;
  showOnboarding: boolean;
  closeOnboarding: () => void;
}) {
  const lessons =
    state.selectedTrack === "essentials"
      ? essentialsLessons
      : foundationLessons;
  const completedCount = lessons.filter((lesson) =>
    state.completed.includes(lesson.id),
  ).length;
  const progress = Math.round((completedCount / lessons.length) * 100);
  const firstCompleted = lessons.find((lesson) =>
    state.completed.includes(lesson.id),
  );

  const selectTrack = (selectedTrack: TrackId) =>
    setState((current) => ({ ...current, selectedTrack }));

  return (
    <>
      <AppHeader state={state} onHome={() => window.scrollTo({ top: 0 })} />
      <main className="home-main">
        <section className="hero-card">
          <PeacockAvatar className="hero-mascot" />
          <div>
            <span className="telugu-eyebrow">తెలుగు · TELUGU</span>
            <h1>Speak a little. Feel closer.</h1>
            <p>
              Practical Telugu for family, visits, and everyday life—guided by
              Mayu, a peacock who is very invested in your pronunciation.
            </p>
          </div>
        </section>

        <section className="daily-card">
          <span className={`daily-medallion ${firstCompleted ? "daily-ready" : ""}`}>
            <span aria-hidden="true">✦</span>
          </span>
          <div>
            <h2>Daily Paluku</h2>
            <p>
              {firstCompleted
                ? "A two-minute review is ready from words you’ve met."
                : "Complete one lesson to unlock your first daily review."}
            </p>
          </div>
          <button
            className="small-button"
            disabled={!firstCompleted}
            onClick={() => firstCompleted && startLesson(firstCompleted)}
          >
            {firstCompleted ? "Review →" : "🔒"}
          </button>
        </section>

        <section className="path-picker-section">
          <div className="section-heading">
            <span>
              <small>CHOOSE YOUR START</small>
              <h2>How much Telugu do you want today?</h2>
            </span>
            <button className="why-button" onClick={() => selectTrack(state.selectedTrack === "essentials" ? "foundations" : "essentials")}>
              Switch path
            </button>
          </div>
          <TrackChoice selected={state.selectedTrack} onSelect={selectTrack} />
        </section>

        <section className="goal-card">
          <div className="goal-row">
            <h2>Today’s goal</h2>
            <strong>
              {Math.min(state.xp, state.dailyGoal)} / {state.dailyGoal} XP
            </strong>
          </div>
          <ProgressBar value={Math.min(state.xp, state.dailyGoal)} max={state.dailyGoal} />
          <div className="goal-options">
            {[20, 50, 100].map((goal) => (
              <button
                key={goal}
                className={state.dailyGoal === goal ? "goal-selected" : ""}
                onClick={() =>
                  setState((current) => ({ ...current, dailyGoal: goal }))
                }
              >
                {goal === 20 ? "Relaxed" : goal === 50 ? "Regular" : "Serious"} ·{" "}
                {goal}
              </button>
            ))}
          </div>
        </section>

        <UnitHeader track={state.selectedTrack} progress={progress} />
        <LearningPath
          lessons={lessons}
          completed={state.completed}
          onStart={startLesson}
        />

        {state.selectedTrack === "foundations" && <LockedUnits />}

        <p className="language-note">
          Telugu changes between regions, families, and formal or everyday
          speech. PalukuLingo teaches a friendly spoken form first and keeps the
          Telugu script beside every pronunciation. Family-recorded audio slots
          are ready to be added.
        </p>
      </main>
      {showOnboarding && (
        <Onboarding
          selectedTrack={state.selectedTrack}
          onTrack={selectTrack}
          onDone={closeOnboarding}
        />
      )}
    </>
  );
}

function MatchingExercise({
  words,
  matched,
  setMatched,
  leftSelected,
  setLeftSelected,
  rightSelected,
  setRightSelected,
  mismatch,
  setMismatch,
}: {
  words: TeluguWord[];
  matched: Set<number>;
  setMatched: React.Dispatch<React.SetStateAction<Set<number>>>;
  leftSelected: number | null;
  setLeftSelected: (value: number | null) => void;
  rightSelected: number | null;
  setRightSelected: (value: number | null) => void;
  mismatch: string | null;
  setMismatch: (value: string | null) => void;
}) {
  const rightOrder = words.length === 3 ? [1, 2, 0] : words.map((_, index) => index).reverse();

  useEffect(() => {
    if (leftSelected === null || rightSelected === null) return;

    if (leftSelected === rightSelected) {
      setMatched((current) => new Set(current).add(leftSelected));
      setLeftSelected(null);
      setRightSelected(null);
      return;
    }

    setMismatch(`${leftSelected}-${rightSelected}`);
    const timer = window.setTimeout(() => {
      setMismatch(null);
      setLeftSelected(null);
      setRightSelected(null);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [
    leftSelected,
    rightSelected,
    setLeftSelected,
    setMatched,
    setMismatch,
    setRightSelected,
  ]);

  return (
    <div className="matching-grid">
      <div>
        {words.map((word, index) => (
          <button
            key={word.telugu}
            className={`match-card ${
              leftSelected === index ? "answer-selected" : ""
            } ${matched.has(index) ? "answer-correct" : ""} ${
              mismatch?.startsWith(`${index}-`) ? "answer-wrong" : ""
            }`}
            disabled={matched.has(index)}
            onClick={() => setLeftSelected(index)}
          >
            <span lang="te">{word.telugu}</span>
            <small>{word.roman}</small>
          </button>
        ))}
      </div>
      <div>
        {rightOrder.map((wordIndex) => (
          <button
            key={words[wordIndex].english}
            className={`match-card match-english ${
              rightSelected === wordIndex ? "answer-selected" : ""
            } ${matched.has(wordIndex) ? "answer-correct" : ""} ${
              mismatch?.endsWith(`-${wordIndex}`) ? "answer-wrong" : ""
            }`}
            disabled={matched.has(wordIndex)}
            onClick={() => setRightSelected(wordIndex)}
          >
            {words[wordIndex].english}
          </button>
        ))}
      </div>
    </div>
  );
}

function LessonView({
  lesson,
  state,
  onExit,
  onComplete,
  onLoseEnergy,
  notify,
}: {
  lesson: Lesson;
  state: SavedState;
  onExit: () => void;
  onComplete: (lesson: Lesson, correct: number, graded: number) => void;
  onLoseEnergy: () => void;
  notify: (message: string) => void;
}) {
  const steps = useMemo(() => buildSteps(lesson), [lesson]);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<ResultState>("idle");
  const [selected, setSelected] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [gradedCount, setGradedCount] = useState(0);
  const [lessonEnergy, setLessonEnergy] = useState(state.energy);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [leftSelected, setLeftSelected] = useState<number | null>(null);
  const [rightSelected, setRightSelected] = useState<number | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [arranged, setArranged] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  const resetStepState = () => {
    setResult("idle");
    setSelected(null);
    setMatched(new Set());
    setLeftSelected(null);
    setRightSelected(null);
    setMismatch(null);
    setArranged([]);
  };

  const advance = () => {
    if (isLast) {
      setFinished(true);
      onComplete(lesson, correctCount, gradedCount);
      return;
    }
    setStepIndex((current) => current + 1);
    resetStepState();
  };

  const recordResult = (correct: boolean) => {
    setGradedCount((current) => current + 1);
    if (correct) {
      setCorrectCount((current) => current + 1);
      setResult("correct");
    } else {
      setLessonEnergy((current) => Math.max(0, current - 1));
      onLoseEnergy();
      setResult("wrong");
    }
  };

  const check = () => {
    if (step.type === "choice" && selected) {
      recordResult(selected === step.word.telugu);
    }
    if (step.type === "true-false" && selected) {
      recordResult((selected === "true") === step.answer);
    }
    if (step.type === "arrange" && arranged.length) {
      const answer = arranged.map((index) => step.tokens[index]).join(" ");
      recordResult(normalize(answer) === normalize(step.word.telugu));
    }
  };

  const playAudio = (word: TeluguWord) => {
    if (word.audioSrc) {
      new Audio(word.audioSrc).play().catch(() => {
        notify("That recording could not play. Try again in a moment.");
      });
      return;
    }
    notify("Mayu is saving this spot for your family’s recording.");
  };

  if (finished) {
    const passed = gradedCount === 0 || correctCount / gradedCount >= 0.6;
    const earned = passed ? correctCount * 10 + (correctCount === gradedCount ? 15 : 0) : 0;
    return (
      <main className="completion-screen">
        <PeacockAvatar className="completion-mascot" mood="complete" />
        <span className="completion-kicker">
          {passed ? "LESSON COMPLETE" : "ONE MORE TRY"}
        </span>
        <h1>{passed ? "Chaalaa baagundi!" : "Almost there."}</h1>
        <p>
          {passed
            ? "That means “very good.” Mayu’s feathers are showing off a little."
            : "A quick replay will make these words stick."}
        </p>
        <div className="completion-stats">
          <span>
            <small>ACCURACY</small>
            <strong>
              {gradedCount ? Math.round((correctCount / gradedCount) * 100) : 100}%
            </strong>
          </span>
          <span>
            <small>XP EARNED</small>
            <strong>+{earned}</strong>
          </span>
          <span>
            <small>FEATHERS LEFT</small>
            <strong>{lessonEnergy}/5</strong>
          </span>
        </div>
        <button
          className="primary-button button-gold completion-button"
          onClick={passed ? onExit : () => {
            setStepIndex(0);
            setCorrectCount(0);
            setGradedCount(0);
            setFinished(false);
            resetStepState();
          }}
        >
          {passed ? "Back to my path" : "Try again"}
        </button>
      </main>
    );
  }

  const matchingDone =
    step.type === "matching" && matched.size === step.words.length;
  const arrangeReady =
    step.type === "arrange" && arranged.length === step.tokens.length;
  const checkDisabled =
    (step.type === "choice" || step.type === "true-false") && !selected
      ? true
      : step.type === "arrange"
        ? !arrangeReady
        : false;

  let answerText = "";
  if (step.type === "choice" || step.type === "true-false" || step.type === "arrange") {
    answerText =
      step.type === "true-false"
        ? `${step.word.english} — ${step.word.telugu}`
        : `${step.word.telugu} (${step.word.roman})`;
  }

  return (
    <div className="lesson-shell">
      <header className="lesson-header">
        <div className="lesson-header-inner">
          <button onClick={onExit} className="exit-button" aria-label="Leave lesson">
            ×
          </button>
          <ProgressBar value={stepIndex + 1} max={steps.length} className="lesson-progress" />
          <FeatherEnergy energy={lessonEnergy} />
        </div>
        <span className="woven-strip lesson-strip" aria-hidden="true" />
      </header>

      <main className="lesson-main">
        <p className="lesson-position">
          {lesson.title} · {stepIndex + 1} / {steps.length}
        </p>

        {step.type === "introduce" && (
          <section className="introduce-exercise">
            <span className="new-word-pill">✨ NEW {step.word.telugu.includes(" ") ? "PHRASE" : "WORD"}</span>
            <PeacockAvatar className="lesson-mascot" />
            <div className="word-card">
              <button
                className="audio-button"
                onClick={() => playAudio(step.word)}
                aria-label={`Hear ${step.word.telugu}`}
              >
                ♪
              </button>
              <strong lang="te">{step.word.telugu}</strong>
              <span>{step.word.roman}</span>
              <i aria-hidden="true" />
              <p>{step.word.english}</p>
            </div>
            <p className="mascot-hint">
              Mayu says: read it out loud. Your mouth learns before your memory does. 🦚
            </p>
          </section>
        )}

        {step.type === "choice" && (
          <section className="choice-exercise">
            <h1>Choose the Telugu for “{step.word.english}”</h1>
            <div className="answer-grid">
              {step.options.map((option) => {
                const isSelected = selected === option.telugu;
                const isCorrect = result !== "idle" && option.telugu === step.word.telugu;
                const isWrong = result === "wrong" && isSelected;
                return (
                  <button
                    key={option.telugu}
                    disabled={result !== "idle"}
                    className={`answer-card ${isSelected ? "answer-selected" : ""} ${
                      isCorrect ? "answer-correct" : ""
                    } ${isWrong ? "answer-wrong" : ""}`}
                    onClick={() => setSelected(option.telugu)}
                  >
                    <strong lang="te">{option.telugu}</strong>
                    <span>{option.roman}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step.type === "true-false" && (
          <section className="true-false-exercise">
            <h1>Is this right?</h1>
            <div className="statement-card">
              <strong lang="te">{step.word.telugu}</strong>
              <span>means</span>
              <b>“{step.shownMeaning}”</b>
            </div>
            <div className="true-false-grid">
              {[
                { value: "true", label: "Avunu · True" },
                { value: "false", label: "Kaadu · False" },
              ].map((option) => (
                <button
                  key={option.value}
                  disabled={result !== "idle"}
                  className={`answer-card ${
                    selected === option.value ? "answer-selected" : ""
                  } ${
                    result !== "idle" &&
                    ((option.value === "true") === step.answer)
                      ? "answer-correct"
                      : ""
                  } ${
                    result === "wrong" && selected === option.value
                      ? "answer-wrong"
                      : ""
                  }`}
                  onClick={() => setSelected(option.value)}
                >
                  <strong>{option.label}</strong>
                </button>
              ))}
            </div>
          </section>
        )}

        {step.type === "matching" && (
          <section className="matching-exercise">
            <h1>Match the pairs</h1>
            <p>Tap one Telugu word, then its meaning.</p>
            <MatchingExercise
              words={step.words}
              matched={matched}
              setMatched={setMatched}
              leftSelected={leftSelected}
              setLeftSelected={setLeftSelected}
              rightSelected={rightSelected}
              setRightSelected={setRightSelected}
              mismatch={mismatch}
              setMismatch={setMismatch}
            />
          </section>
        )}

        {step.type === "arrange" && (
          <section className="arrange-exercise">
            <h1>Build “{step.word.english}”</h1>
            <div className="answer-tray" aria-label="Your answer">
              {arranged.length ? (
                arranged.map((tokenIndex) => (
                  <button
                    key={tokenIndex}
                    onClick={() =>
                      result === "idle" &&
                      setArranged((current) =>
                        current.filter((index) => index !== tokenIndex),
                      )
                    }
                  >
                    {step.tokens[tokenIndex]}
                  </button>
                ))
              ) : (
                <span>Tap the Telugu words in order</span>
              )}
            </div>
            <div className="word-bank">
              {step.tokens.map((token, index) => (
                <button
                  key={`${token}-${index}`}
                  className={arranged.includes(index) ? "token-used" : ""}
                  disabled={arranged.includes(index) || result !== "idle"}
                  onClick={() => setArranged((current) => [...current, index])}
                >
                  {token}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer
        className={`lesson-footer ${
          result === "correct"
            ? "footer-correct"
            : result === "wrong"
              ? "footer-wrong"
              : ""
        }`}
      >
        <div className="lesson-footer-inner">
          <div className="feedback-copy" aria-live="polite">
            {result === "correct" ? (
              <>
                <PeacockAvatar className="feedback-mascot" mood="correct" />
                <span>
                  <strong>Chaalaa baagundi!</strong>
                  <small>Very good.</small>
                </span>
              </>
            ) : result === "wrong" ? (
              <>
                <PeacockAvatar className="feedback-mascot" mood="wrong" />
                <span>
                  <strong>Almost—Mayu’s listening.</strong>
                  <small>Answer: {answerText}</small>
                </span>
              </>
            ) : (
              <span>
                {step.type === "introduce"
                  ? "No quiz here—just meet the word. 👋"
                  : step.type === "matching"
                    ? matchingDone
                      ? "All three pairs found. ✨"
                      : "Match every pair to continue."
                    : "Choose an answer when you’re ready."}
              </span>
            )}
          </div>

          {step.type === "introduce" ? (
            <button className="primary-button button-gold" onClick={advance}>
              Got it!
            </button>
          ) : step.type === "matching" ? (
            <button
              className="primary-button button-blue"
              disabled={!matchingDone}
              onClick={advance}
            >
              Continue
            </button>
          ) : result === "idle" ? (
            <button
              className="primary-button button-blue"
              disabled={checkDisabled}
              onClick={check}
            >
              Check
            </button>
          ) : (
            <button
              className={`primary-button ${
                result === "correct" ? "button-gold" : "button-red"
              }`}
              onClick={advance}
            >
              {isLast ? "Finish" : "Continue"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function PalukuApp({
  initialLessonId,
}: {
  initialLessonId?: string;
}) {
  const [state, setState] = useState<SavedState>(defaultState);
  const [lessonId, setLessonId] = useState<string | null>(
    initialLessonId ?? null,
  );
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setState({ ...defaultState, ...(JSON.parse(raw) as SavedState) });
        }
        setShowOnboarding(!window.localStorage.getItem(ONBOARDED_KEY));
      } catch {
        setState(defaultState);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/lesson\/([^/]+)$/);
      setLessonId(match ? decodeURIComponent(match[1]) : null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeLesson = findLesson(lessonId);

  const startLesson = (lesson: Lesson) => {
    setState((current) => ({ ...current, selectedTrack: lesson.track }));
    window.history.pushState({}, "", `/lesson/${lesson.id}`);
    setLessonId(lesson.id);
    window.scrollTo({ top: 0 });
  };

  const goHome = () => {
    window.history.pushState({}, "", "/");
    setLessonId(null);
    window.scrollTo({ top: 0 });
  };

  const completeLesson = (
    lesson: Lesson,
    correct: number,
    graded: number,
  ) => {
    const passed = graded === 0 || correct / graded >= 0.6;
    if (!passed) return;
    const earned = correct * 10 + (correct === graded ? 15 : 0);
    setState((current) => ({
      ...current,
      xp: current.xp + earned,
      streak: Math.max(1, current.streak),
      completed: current.completed.includes(lesson.id)
        ? current.completed
        : [...current.completed, lesson.id],
    }));
  };

  const closeOnboarding = () => {
    window.localStorage.setItem(ONBOARDED_KEY, "true");
    setShowOnboarding(false);
  };

  return (
    <>
      {activeLesson ? (
        <LessonView
          key={activeLesson.id}
          lesson={activeLesson}
          state={state}
          onExit={goHome}
          onComplete={completeLesson}
          onLoseEnergy={() =>
            setState((current) => ({
              ...current,
              energy: Math.max(0, current.energy - 1),
            }))
          }
          notify={setToast}
        />
      ) : (
        <HomeView
          state={state}
          setState={setState}
          startLesson={startLesson}
          showOnboarding={showOnboarding}
          closeOnboarding={closeOnboarding}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
