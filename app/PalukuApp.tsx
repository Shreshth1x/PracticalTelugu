"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  allLessons,
  essentialsLessons,
  findLesson,
  foundationLessons,
  lockedUnits,
  type Lesson,
  type TeluguWord,
  type TrackId,
} from "./course-data";

export type AppScreen = "today" | "learn" | "words" | "daily" | "settings" | "lesson";

type SavedState = {
  xp: number;
  streak: number;
  energy: number;
  dailyGoal: number;
  selectedTrack: TrackId;
  completed: string[];
};

type Preferences = {
  showRomanization: boolean;
  teluguFirst: boolean;
  autoplay: boolean;
  reminder: boolean;
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
type WordTab = "today" | "all" | "saved";
type MayuPose =
  | "welcome"
  | "teach"
  | "listen"
  | "encourage"
  | "celebrate"
  | "read";

type LibraryWord = TeluguWord & {
  key: string;
  lessonTitle: string;
  track: TrackId;
};

type DailyWord = {
  word: TeluguWord;
  exampleTelugu: string;
  exampleEnglish: string;
};

const STORAGE_KEY = "palukulu.progress.v1";
const ONBOARDED_KEY = "palukulu.onboarded.v1";
const PREFERENCES_KEY = "palukulu.preferences.v1";
const SAVED_WORDS_KEY = "palukulu.saved-words.v1";

const defaultState: SavedState = {
  xp: 0,
  streak: 0,
  energy: 5,
  dailyGoal: 20,
  selectedTrack: "essentials",
  completed: [],
};

const defaultPreferences: Preferences = {
  showRomanization: true,
  teluguFirst: true,
  autoplay: false,
  reminder: false,
};

const dailyWords: DailyWord[] = [
  {
    word: essentialsLessons[0].words[0],
    exampleTelugu: "నమస్కారం, అత్తయ్య.",
    exampleEnglish: "Hello, auntie.",
  },
  {
    word: essentialsLessons[1].words[0],
    exampleTelugu: "భోజనానికి ధన్యవాదాలు.",
    exampleEnglish: "Thank you for the meal.",
  },
  {
    word: essentialsLessons[3].words[0],
    exampleTelugu: "అమ్మ ఇంట్లో ఉన్నారు.",
    exampleEnglish: "Mom is at home.",
  },
  {
    word: essentialsLessons[4].words[0],
    exampleTelugu: "నాకు నీళ్లు కావాలి.",
    exampleEnglish: "I would like some water.",
  },
  {
    word: essentialsLessons[5].words[2],
    exampleTelugu: "దయచేసి మళ్లీ చెప్పండి.",
    exampleEnglish: "Please say it again.",
  },
];

const libraryWords: LibraryWord[] = (() => {
  const seen = new Set<string>();
  const words: LibraryWord[] = [];

  allLessons.forEach((lesson) => {
    lesson.words.forEach((word) => {
      const key = `${word.telugu}::${word.english}`;
      if (seen.has(key)) return;
      seen.add(key);
      words.push({
        ...word,
        key,
        lessonTitle: lesson.title,
        track: lesson.track,
      });
    });
  });

  return words;
})();

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

function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    );
    focusables[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  return dialogRef;
}

function Icon({
  name,
  className = "",
}: {
  name:
    | "today"
    | "learn"
    | "words"
    | "settings"
    | "arrow"
    | "audio"
    | "bookmark"
    | "search"
    | "close"
    | "check";
  className?: string;
}) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };

  if (name === "today") {
    return (
      <svg {...common}>
        <path d="M4.5 9.5 12 3l7.5 6.5V20a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z" />
        <path d="M9 21v-7h6v7" />
      </svg>
    );
  }
  if (name === "learn") {
    return (
      <svg {...common}>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22Z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22Z" />
      </svg>
    );
  }
  if (name === "words") {
    return (
      <svg {...common}>
        <path d="M5 4h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4Z" />
        <path d="M7 8h10M7 12h7M7 16h5" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </svg>
    );
  }
  if (name === "arrow") {
    return (
      <svg {...common}>
        <path d="M5 12h14M14 7l5 5-5 5" />
      </svg>
    );
  }
  if (name === "audio") {
    return (
      <svg {...common}>
        <path d="M6 10v4h3l4 3V7l-4 3Z" />
        <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />
      </svg>
    );
  }
  if (name === "bookmark") {
    return (
      <svg {...common}>
        <path d="M6.5 3.5h11v17L12 17l-5.5 3.5Z" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }
  if (name === "close") {
    return (
      <svg {...common}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

function MayuImage({
  pose,
  alt,
  className = "",
}: {
  pose: MayuPose;
  alt: string;
  className?: string;
}) {
  return (
    <span className={`mayu-image ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/mayu-${pose}.webp`}
        alt={alt}
        onError={(event) => {
          const image = event.currentTarget;
          image.onerror = null;
          image.src = "/maya-peacock.webp";
        }}
      />
    </span>
  );
}

function ProgressBar({
  value,
  max = 100,
  className = "",
  label = "Progress",
}: {
  value: number;
  max?: number;
  className?: string;
  label?: string;
}) {
  const safeMax = max || 1;
  const percentage = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <span
      className={`progress-track ${className}`.trim()}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
    >
      <span className="progress-fill" style={{ width: `${percentage}%` }} />
    </span>
  );
}

const navItems: {
  screen: Extract<AppScreen, "today" | "learn" | "words">;
  href: string;
  label: string;
  icon: "today" | "learn" | "words";
}[] = [
  { screen: "today", href: "/", label: "Today", icon: "today" },
  { screen: "learn", href: "/learn", label: "Learn", icon: "learn" },
  { screen: "words", href: "/words", label: "Words", icon: "words" },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        ప
      </span>
      <span>
        Paluku<i>Lingo</i>
      </span>
    </span>
  );
}

function AppShell({
  screen,
  children,
}: {
  screen: AppScreen;
  children: React.ReactNode;
}) {
  return (
    <div className="app-frame">
      <aside className="side-nav">
        <Link href="/" className="side-brand" aria-label="PalukuLingo home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary navigation" className="side-nav-links">
          {navItems.map((item) => (
            <Link
              href={item.href}
              key={item.screen}
              className={`nav-link ${screen === item.screen ? "nav-link-active" : ""}`}
              aria-current={screen === item.screen ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <Link
          href="/settings"
          className={`nav-link settings-link ${screen === "settings" ? "nav-link-active" : ""}`}
          aria-current={screen === "settings" ? "page" : undefined}
        >
          <Icon name="settings" />
          <span>Settings</span>
        </Link>
        <p className="side-note">
          <span lang="te">తెలుగు</span>
          <small>Spoken gently, one day at a time.</small>
        </p>
      </aside>

      <header className="mobile-header">
        <Link href="/" aria-label="PalukuLingo home">
          <Wordmark />
        </Link>
        <Link
          href="/settings"
          className="icon-button"
          aria-label="Open settings"
          aria-current={screen === "settings" ? "page" : undefined}
        >
          <Icon name="settings" />
        </Link>
      </header>

      <div className="app-content">{children}</div>

      <nav aria-label="Primary navigation" className="bottom-nav">
        {navItems.map((item) => (
          <Link
            href={item.href}
            key={item.screen}
            className={`bottom-nav-link ${
              screen === item.screen ? "bottom-nav-link-active" : ""
            }`}
            aria-current={screen === item.screen ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function formatWeekday() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(new Date());
}

function subscribeToLocalClock(notify: () => void) {
  const timer = window.setInterval(notify, 60_000);
  return () => window.clearInterval(timer);
}

function getServerDateLabel() {
  return "Today";
}

function useLocalToday() {
  return useSyncExternalStore(
    subscribeToLocalClock,
    formatToday,
    getServerDateLabel,
  );
}

function useLocalWeekday() {
  return useSyncExternalStore(
    subscribeToLocalClock,
    formatWeekday,
    getServerDateLabel,
  );
}

function TodayView({
  state,
  startLesson,
}: {
  state: SavedState;
  startLesson: (lesson: Lesson) => void;
}) {
  const todayLabel = useLocalToday();
  const lessons =
    state.selectedTrack === "essentials"
      ? essentialsLessons
      : foundationLessons;
  const nextLesson =
    lessons.find((lesson) => !state.completed.includes(lesson.id)) ??
    lessons[lessons.length - 1];
  const reviewLesson = lessons.find((lesson) =>
    state.completed.includes(lesson.id),
  );
  const retainedWords = new Set(
    allLessons
      .filter((lesson) => state.completed.includes(lesson.id))
      .flatMap((lesson) => lesson.words.map((word) => word.telugu)),
  ).size;

  return (
    <AppShell screen="today">
      <main className="page page-today">
        <section className="today-intro">
          <div className="today-copy">
            <time className="overline">{todayLabel}</time>
            <h1>A little Telugu for today.</h1>
            <p>
              Five useful words, then pick up your course wherever you left it.
            </p>
          </div>
          <MayuImage
            pose="welcome"
            alt="Mayu the peacock welcoming you back"
            className="today-mayu"
          />
        </section>

        <Link href="/words/daily" className="daily-feature pressable">
          <span className="daily-feature-copy">
            <span className="overline overline-light">TODAY’S WORDS</span>
            <strong>Five words for real life</strong>
            <span>Greetings, family, and the phrases that keep a conversation going.</span>
          </span>
          <span className="daily-feature-action">
            <span className="pixel-meta">5 WORDS · 4 MIN</span>
            <span className="round-arrow" aria-hidden="true">
              <Icon name="arrow" />
            </span>
          </span>
        </Link>

        <section className="resume-card">
          <div className="card-heading-row">
            <div>
              <span className="overline">CONTINUE LEARNING</span>
              <h2>{nextLesson.title}</h2>
            </div>
            <span className="course-chip">
              {state.selectedTrack === "essentials"
                ? "Essentials"
                : "From beginning"}
            </span>
          </div>
          <p>{nextLesson.description}</p>
          <button className="text-action" onClick={() => startLesson(nextLesson)}>
            <span>{state.completed.includes(nextLesson.id) ? "Practice again" : "Resume lesson"}</span>
            <Icon name="arrow" />
          </button>
        </section>

        {reviewLesson ? (
          <section className="review-row">
            <div>
              <span className="overline">OPTIONAL REVIEW</span>
              <h2>Two quiet minutes with familiar words</h2>
              <p>Revisit {reviewLesson.title.toLowerCase()} whenever it feels useful.</p>
            </div>
            <button className="secondary-button" onClick={() => startLesson(reviewLesson)}>
              Review
            </button>
          </section>
        ) : null}

        <p className="quiet-summary">
          <span>
            <b className="tabular">{state.streak}</b> day
            {state.streak === 1 ? "" : "s"} in your current rhythm
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <b className="tabular">{retainedWords}</b> words met in completed lessons
          </span>
        </p>
      </main>
    </AppShell>
  );
}

function courseProgress(lessons: Lesson[], completed: string[]) {
  const count = lessons.filter((lesson) => completed.includes(lesson.id)).length;
  return {
    count,
    percentage: Math.round((count / lessons.length) * 100),
  };
}

function LearnView({
  state,
  setState,
  startLesson,
}: {
  state: SavedState;
  setState: React.Dispatch<React.SetStateAction<SavedState>>;
  startLesson: (lesson: Lesson) => void;
}) {
  const essentials = courseProgress(essentialsLessons, state.completed);
  const foundations = courseProgress(foundationLessons, state.completed);
  const selectedLessons =
    state.selectedTrack === "essentials"
      ? essentialsLessons
      : foundationLessons;
  const selectedProgress =
    state.selectedTrack === "essentials" ? essentials : foundations;
  const nextLesson =
    selectedLessons.find((lesson) => !state.completed.includes(lesson.id)) ??
    selectedLessons[selectedLessons.length - 1];

  const selectTrack = (selectedTrack: TrackId) =>
    setState((current) => ({ ...current, selectedTrack }));

  return (
    <AppShell screen="learn">
      <main className="page page-learn">
        <header className="page-header">
          <span className="overline">YOUR COURSES</span>
          <h1>Learn in the order that fits you.</h1>
          <p>Start with the phrases you need now or build Telugu from the beginning.</p>
        </header>

        <section className="continue-banner">
          <div>
            <span className="overline overline-light">PICK UP WHERE YOU LEFT OFF</span>
            <h2>{nextLesson.title}</h2>
            <p>{nextLesson.description}</p>
          </div>
          <button className="light-button" onClick={() => startLesson(nextLesson)}>
            Continue
            <Icon name="arrow" />
          </button>
        </section>

        <div className="course-switcher" aria-label="Choose a course">
          <button
            className={`course-card ${
              state.selectedTrack === "essentials" ? "course-card-selected" : ""
            }`}
            onClick={() => selectTrack("essentials")}
            aria-pressed={state.selectedTrack === "essentials"}
          >
            <span className="course-number">01</span>
            <span className="overline">SHORT COURSE</span>
            <strong>Telugu Essentials</strong>
            <span>Useful phrases for greetings, family, food, and getting unstuck.</span>
            <span className="course-card-progress">
              <ProgressBar
                value={essentials.count}
                max={essentialsLessons.length}
                label="Telugu Essentials progress"
              />
              <small className="pixel-meta">
                {essentials.count}/{essentialsLessons.length} TOPICS
              </small>
            </span>
          </button>

          <button
            className={`course-card ${
              state.selectedTrack === "foundations" ? "course-card-selected" : ""
            }`}
            onClick={() => selectTrack("foundations")}
            aria-pressed={state.selectedTrack === "foundations"}
          >
            <span className="course-number">02</span>
            <span className="overline">FULL COURSE</span>
            <strong>From beginning</strong>
            <span>Build vocabulary, sentences, sounds, and script step by step.</span>
            <span className="course-card-progress">
              <ProgressBar
                value={foundations.count}
                max={foundationLessons.length}
                label="From beginning progress"
              />
              <small className="pixel-meta">
                {foundations.count}/{foundationLessons.length} TOPICS
              </small>
            </span>
          </button>
        </div>

        <section className="topic-section">
          <div className="section-title-row">
            <div>
              <span className="overline">
                {state.selectedTrack === "essentials" ? "TELUGU ESSENTIALS" : "UNIT 1"}
              </span>
              <h2>
                {state.selectedTrack === "essentials"
                  ? "Seven useful moments"
                  : "Building blocks"}
              </h2>
            </div>
            <span className="pixel-meta">{selectedProgress.percentage}% COMPLETE</span>
          </div>

          <ol className="topic-list">
            {selectedLessons.map((lesson, index) => {
              const done = state.completed.includes(lesson.id);
              const isNext = lesson.id === nextLesson.id;
              return (
                <li key={lesson.id} className={isNext ? "topic-row-next" : ""}>
                  <span className={`topic-index ${done ? "topic-index-done" : ""}`}>
                    {done ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="topic-copy">
                    <strong>{lesson.title}</strong>
                    <span>{lesson.description}</span>
                  </span>
                  <button
                    className="topic-action"
                    onClick={() => startLesson(lesson)}
                    aria-label={`${done ? "Practice" : "Start"} ${lesson.title}`}
                  >
                    {done ? "Practice" : isNext ? "Start" : "Open"}
                    <Icon name="arrow" />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        {state.selectedTrack === "foundations" ? (
          <section className="upcoming-units">
            <div className="section-title-row">
              <div>
                <span className="overline">AFTER BUILDING BLOCKS</span>
                <h2>What comes next</h2>
              </div>
            </div>
            {lockedUnits.map((unit) => (
              <details key={unit.number} className="unit-disclosure">
                <summary>
                  <span className="pixel-meta">UNIT {unit.number}</span>
                  <strong>{unit.title}</strong>
                  <span>Up next</span>
                </summary>
                <p>{unit.unlockCopy.replace("unlock", "continue")}</p>
              </details>
            ))}
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}

function WordRow({
  item,
  isSaved,
  showRomanization,
  onAudio,
  onOpen,
  onSave,
}: {
  item: LibraryWord;
  isSaved: boolean;
  showRomanization: boolean;
  onAudio: (word: TeluguWord) => void;
  onOpen: (word: LibraryWord) => void;
  onSave: (word: LibraryWord) => void;
}) {
  return (
    <article className="word-row">
      <button className="word-row-main" onClick={() => onOpen(item)}>
        <span className="word-row-telugu" lang="te">
          {item.telugu}
        </span>
        <span className="word-row-meaning">
          {showRomanization ? <small>{item.roman}</small> : null}
          <strong>{item.english}</strong>
        </span>
      </button>
      <span className="word-row-actions">
        <button
          className="icon-button"
          onClick={() => onAudio(item)}
          aria-label={`Hear ${item.telugu}`}
        >
          <Icon name="audio" />
        </button>
        <button
          className={`icon-button ${isSaved ? "icon-button-saved" : ""}`}
          onClick={() => onSave(item)}
          aria-label={`${isSaved ? "Remove" : "Save"} ${item.telugu}`}
          aria-pressed={isSaved}
        >
          <Icon name="bookmark" />
        </button>
      </span>
    </article>
  );
}

function WordsView({
  preferences,
  savedWords,
  setSavedWords,
  notify,
}: {
  preferences: Preferences;
  savedWords: string[];
  setSavedWords: React.Dispatch<React.SetStateAction<string[]>>;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<WordTab>("today");
  const [query, setQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState<"all" | TrackId>("all");
  const [selectedWord, setSelectedWord] = useState<LibraryWord | null>(null);
  const weekdayLabel = useLocalWeekday();
  const closeWordSheet = useCallback(() => setSelectedWord(null), []);
  const wordSheetRef = useDialogFocus<HTMLElement>(
    Boolean(selectedWord),
    closeWordSheet,
  );

  useEffect(() => {
    if (!selectedWord) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedWord]);

  const todayKeys = useMemo(
    () =>
      new Set(
        dailyWords.map(
          ({ word }) => `${word.telugu}::${word.english}`,
        ),
      ),
    [],
  );

  const visibleWords = useMemo(() => {
    const normalizedQuery = normalize(query);
    return libraryWords.filter((word) => {
      if (tab === "today" && !todayKeys.has(word.key)) return false;
      if (tab === "saved" && !savedWords.includes(word.key)) return false;
      if (trackFilter !== "all" && word.track !== trackFilter) return false;
      if (!normalizedQuery) return true;
      return normalize(`${word.telugu} ${word.roman} ${word.english}`).includes(
        normalizedQuery,
      );
    });
  }, [query, savedWords, tab, todayKeys, trackFilter]);

  const playAudio = (word: TeluguWord) => {
    if (!word.audioSrc) {
      notify("Family recording coming soon.");
      return;
    }
    new Audio(word.audioSrc).play().catch(() => {
      notify("That recording could not play. Try again in a moment.");
    });
  };

  const toggleSaved = (word: LibraryWord) => {
    setSavedWords((current) =>
      current.includes(word.key)
        ? current.filter((key) => key !== word.key)
        : [...current, word.key],
    );
  };

  return (
    <AppShell screen="words">
      <main className="page page-words">
        <header className="page-header words-header">
          <div>
            <span className="overline">YOUR WORDS</span>
            <h1>Words worth keeping close.</h1>
            <p>Hear them, save them, and return when you need a phrase.</p>
          </div>
          <Link href="/words/daily" className="primary-button">
            Today’s five
            <Icon name="arrow" />
          </Link>
        </header>

        <div className="word-tabs" role="tablist" aria-label="Word collections">
          {(
            [
              ["today", "Today"],
              ["all", "All words"],
              ["saved", "Saved"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              id={`words-tab-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls="words-panel"
              className={tab === value ? "word-tab-active" : ""}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab !== "today" ? (
          <div className="word-tools">
            <label className="search-field">
              <Icon name="search" />
              <span className="sr-only">Search words</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Telugu or English"
              />
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by course</span>
              <select
                value={trackFilter}
                onChange={(event) =>
                  setTrackFilter(event.target.value as "all" | TrackId)
                }
              >
                <option value="all">All courses</option>
                <option value="essentials">Essentials</option>
                <option value="foundations">From beginning</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="today-word-note">
            <span className="pixel-meta">
              {weekdayLabel.toUpperCase()} SET · 5 WORDS
            </span>
            <p>Today’s small set mixes a greeting, family, and two useful requests.</p>
          </div>
        )}

        <section
          id="words-panel"
          className="word-list"
          role="tabpanel"
          aria-labelledby={`words-tab-${tab}`}
          aria-label={`${tab === "all" ? "All words" : tab === "saved" ? "Saved words" : "Today’s words"}`}
        >
          {visibleWords.length ? (
            visibleWords.map((word) => (
              <WordRow
                key={word.key}
                item={word}
                isSaved={savedWords.includes(word.key)}
                showRomanization={preferences.showRomanization}
                onAudio={playAudio}
                onOpen={setSelectedWord}
                onSave={toggleSaved}
              />
            ))
          ) : tab === "saved" && !query ? (
            <div className="saved-empty">
              <MayuImage
                pose="read"
                alt="Mayu reading beside an empty saved words list"
              />
              <div>
                <h2>Save the words you want nearby.</h2>
                <p>Use the bookmark on any word and it will wait for you here.</p>
                <button className="secondary-button" onClick={() => setTab("all")}>
                  Browse all words
                </button>
              </div>
            </div>
          ) : (
            <div className="no-results">
              <h2>No words found.</h2>
              <p>Try a different spelling or course filter.</p>
            </div>
          )}
        </section>
      </main>

      {selectedWord ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedWord(null);
          }}
        >
          <aside
            ref={wordSheetRef}
            className="word-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="word-sheet-title"
          >
            <div className="sheet-header">
              <span className="overline">{selectedWord.lessonTitle}</span>
              <button
                className="icon-button"
                onClick={closeWordSheet}
                aria-label="Close word details"
                autoFocus
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="sheet-word">
              <h2 id="word-sheet-title" lang="te">
                {selectedWord.telugu}
              </h2>
              {preferences.showRomanization ? <p>{selectedWord.roman}</p> : null}
              <strong>{selectedWord.english}</strong>
            </div>
            <button
              className="audio-wide-button"
              onClick={() => playAudio(selectedWord)}
              aria-label={`Hear ${selectedWord.telugu}`}
            >
              <Icon name="audio" />
              <span>
                <strong>Hear this word</strong>
                <small>
                  {selectedWord.audioSrc
                    ? "Play family-recorded audio"
                    : "Family recording coming soon"}
                </small>
              </span>
            </button>
            <div className="usage-note">
              <span className="overline">USE IT</span>
              <p>
                Say it once slowly, then again in the kind of moment where you
                would naturally reach for “{selectedWord.english}.”
              </p>
            </div>
            <button
              className={`secondary-button sheet-save ${
                savedWords.includes(selectedWord.key) ? "button-saved" : ""
              }`}
              onClick={() => toggleSaved(selectedWord)}
              aria-pressed={savedWords.includes(selectedWord.key)}
            >
              <Icon name="bookmark" />
              {savedWords.includes(selectedWord.key) ? "Saved" : "Save this word"}
            </button>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function DailySession({
  preferences,
  notify,
}: {
  preferences: Preferences;
  notify: (message: string) => void;
}) {
  const [wordIndex, setWordIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<("learning" | "got-it")[]>([]);
  const finished = wordIndex >= dailyWords.length;
  const current = finished ? null : dailyWords[wordIndex];

  useEffect(() => {
    if (!preferences.autoplay || !current?.word.audioSrc) return;
    const audio = new Audio(current.word.audioSrc);
    audio.play().catch(() => {
      // Autoplay can be blocked by browser policy; the manual control remains.
    });
    return () => audio.pause();
  }, [current?.word.audioSrc, preferences.autoplay]);

  const playAudio = () => {
    if (!current?.word.audioSrc) {
      notify("Family recording coming soon.");
      return;
    }
    new Audio(current.word.audioSrc).play().catch(() => {
      notify("That recording could not play. Try again in a moment.");
    });
  };

  const markWord = (result: "learning" | "got-it") => {
    setResults((currentResults) => [...currentResults, result]);
    setRevealed(false);
    setWordIndex((currentIndex) => currentIndex + 1);
  };

  if (finished) {
    const ready = results.filter((result) => result === "got-it").length;
    return (
      <main className="daily-session daily-recap">
        <header className="session-header">
          <Link href="/words" className="icon-button" aria-label="Close daily words">
            <Icon name="close" />
          </Link>
          <span className="pixel-meta">TODAY’S FIVE</span>
          <span className="session-header-spacer" aria-hidden="true" />
        </header>
        <div className="recap-content">
          <MayuImage
            pose="celebrate"
            alt="Mayu opening her tail in a gentle celebration"
            className="recap-mayu"
          />
          <span className="overline">SESSION COMPLETE</span>
          <h1>Five words, met.</h1>
          <p>
            {ready} feel familiar. {dailyWords.length - ready} can stay in your
            next gentle review.
          </p>
          <div className="recap-list">
            {dailyWords.map(({ word }, index) => (
              <span key={word.telugu}>
                <b lang="te">{word.telugu}</b>
                <small>
                  {results[index] === "got-it" ? "Got it" : "Still learning"}
                </small>
              </span>
            ))}
          </div>
          <div className="recap-actions">
            <Link href="/" className="primary-button">
              Back to Today
            </Link>
            <Link href="/words" className="secondary-button">
              See all words
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!current) return null;

  return (
    <main className="daily-session">
      <header className="session-header">
        <Link href="/words" className="icon-button" aria-label="Close daily words">
          <Icon name="close" />
        </Link>
        <ProgressBar
          value={wordIndex + 1}
          max={dailyWords.length}
          className="session-progress"
          label="Daily words progress"
        />
        <span className="pixel-meta">
          {wordIndex + 1}/{dailyWords.length}
        </span>
      </header>

      <section className="daily-word-stage" aria-labelledby="daily-word-title">
        <MayuImage
          pose={revealed ? "teach" : "listen"}
          alt={
            revealed
              ? "Mayu teaching today’s Telugu word"
              : "Mayu listening carefully"
          }
          className="daily-word-mayu"
        />
        <span className="overline">WORD {wordIndex + 1} OF 5</span>
        <h1
          id="daily-word-title"
          lang="te"
          className={preferences.teluguFirst ? "" : "telugu-secondary"}
        >
          {current.word.telugu}
        </h1>
        {preferences.showRomanization ? (
          <p className="word-roman">{current.word.roman}</p>
        ) : null}
        <button className="listen-button" onClick={playAudio}>
          <Icon name="audio" />
          Hear the word
        </button>

        {revealed ? (
          <div className="revealed-meaning">
            <span className="overline">MEANING</span>
            <h2>{current.word.english}</h2>
            <div className="example-card">
              <span className="overline">IN A REAL MOMENT</span>
              <strong lang="te">{current.exampleTelugu}</strong>
              <p>{current.exampleEnglish}</p>
            </div>
          </div>
        ) : (
          <button className="primary-button reveal-button" onClick={() => setRevealed(true)}>
            Reveal meaning
          </button>
        )}
      </section>

      {revealed ? (
        <footer className="daily-actions">
          <button className="secondary-button" onClick={() => markWord("learning")}>
            Still learning
          </button>
          <button className="primary-button" onClick={() => markWord("got-it")}>
            Got it
            <Icon name="arrow" />
          </button>
        </footer>
      ) : null}
    </main>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <button
        className={`switch ${checked ? "switch-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

function SettingsView({
  state,
  setState,
  preferences,
  setPreferences,
}: {
  state: SavedState;
  setState: React.Dispatch<React.SetStateAction<SavedState>>;
  preferences: Preferences;
  setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const closeResetDialog = useCallback(() => setConfirmReset(false), []);
  const resetDialogRef = useDialogFocus<HTMLElement>(
    confirmReset,
    closeResetDialog,
  );

  const updatePreference = (key: keyof Preferences) =>
    setPreferences((current) => ({ ...current, [key]: !current[key] }));

  return (
    <AppShell screen="settings">
      <main className="page page-settings">
        <header className="page-header">
          <span className="overline">SETTINGS</span>
          <h1>Make the words easier to meet.</h1>
          <p>Keep the learning surface quiet and choose only the support you want.</p>
        </header>

        <section className="settings-group" aria-labelledby="display-settings">
          <div className="settings-group-heading">
            <span className="overline">READING & AUDIO</span>
            <h2 id="display-settings">How lessons appear</h2>
          </div>
          <SwitchRow
            label="Show pronunciation"
            description="Keep romanized Telugu below the script."
            checked={preferences.showRomanization}
            onChange={() => updatePreference("showRomanization")}
          />
          <SwitchRow
            label="Emphasize today’s Telugu"
            description="Keep the Telugu word at the largest size in daily practice."
            checked={preferences.teluguFirst}
            onChange={() => updatePreference("teluguFirst")}
          />
          <SwitchRow
            label="Play available audio automatically"
            description="Only plays when a family recording is available."
            checked={preferences.autoplay}
            onChange={() => updatePreference("autoplay")}
          />
        </section>

        <section className="settings-group" aria-labelledby="rhythm-settings">
          <div className="settings-group-heading">
            <span className="overline">YOUR RHYTHM</span>
            <h2 id="rhythm-settings">A gentle daily pace</h2>
          </div>
          <SwitchRow
            label="Daily reminder"
            description="Remember your preference on this device."
            checked={preferences.reminder}
            onChange={() => updatePreference("reminder")}
          />
          <div className="setting-row setting-goal-row">
            <span>
              <strong>Practice goal</strong>
              <small>The existing XP goal stays behind the scenes.</small>
            </span>
            <div className="goal-buttons" aria-label="Practice goal">
              {[20, 50, 100].map((goal) => (
                <button
                  key={goal}
                  aria-pressed={state.dailyGoal === goal}
                  className={state.dailyGoal === goal ? "goal-button-active" : ""}
                  onClick={() =>
                    setState((current) => ({ ...current, dailyGoal: goal }))
                  }
                >
                  {goal === 20 ? "Light" : goal === 50 ? "Regular" : "Deep"}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-group settings-about" aria-labelledby="about-settings">
          <div className="settings-group-heading">
            <span className="overline">ABOUT THE TELUGU</span>
            <h2 id="about-settings">Friendly spoken forms first</h2>
          </div>
          <p>
            Telugu changes across regions, families, and formal settings.
            PalukuLingo keeps the script beside an approachable spoken form and
            leaves room for family-recorded audio.
          </p>
        </section>

        <section className="danger-zone">
          <div>
            <span className="overline">ON THIS DEVICE</span>
            <h2>Start over</h2>
            <p>Clear course progress, the quiet streak, and the stored practice goal.</p>
          </div>
          <button className="danger-button" onClick={() => setConfirmReset(true)}>
            Reset progress
          </button>
        </section>
      </main>

      {confirmReset ? (
        <div className="modal-backdrop" role="presentation">
          <section
            ref={resetDialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="overline">RESET LOCAL PROGRESS</span>
            <h2 id="reset-title">Start again from the first lesson?</h2>
            <p>This clears the progress stored in this browser. Saved words stay saved.</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={closeResetDialog}>
                Keep progress
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setState(defaultState);
                  setConfirmReset(false);
                }}
              >
                Reset progress
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
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
  showRomanization,
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
  showRomanization: boolean;
}) {
  const rightOrder =
    words.length === 3
      ? [1, 2, 0]
      : words.map((_, index) => index).reverse();

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
            aria-pressed={leftSelected === index}
          >
            <span lang="te">{word.telugu}</span>
            {showRomanization ? <small>{word.roman}</small> : null}
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
            aria-pressed={rightSelected === wordIndex}
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
  preferences,
}: {
  lesson: Lesson;
  state: SavedState;
  onExit: () => void;
  onComplete: (lesson: Lesson, correct: number, graded: number) => void;
  onLoseEnergy: () => void;
  notify: (message: string) => void;
  preferences: Preferences;
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

  useEffect(() => {
    if (
      !preferences.autoplay ||
      step.type !== "introduce" ||
      !step.word.audioSrc
    ) {
      return;
    }
    const audio = new Audio(step.word.audioSrc);
    audio.play().catch(() => {
      // Autoplay can be blocked by browser policy; the manual control remains.
    });
    return () => audio.pause();
  }, [preferences.autoplay, step]);

  const resetStepState = () => {
    setResult("idle");
    setSelected(null);
    setMatched(new Set());
    setLeftSelected(null);
    setRightSelected(null);
    setMismatch(null);
    setArranged([]);
  };

  const restart = () => {
    setStepIndex(0);
    setCorrectCount(0);
    setGradedCount(0);
    setFinished(false);
    resetStepState();
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
    if (!word.audioSrc) {
      notify("Family recording coming soon.");
      return;
    }
    new Audio(word.audioSrc).play().catch(() => {
      notify("That recording could not play. Try again in a moment.");
    });
  };

  if (finished) {
    const passed = gradedCount === 0 || correctCount / gradedCount >= 0.6;
    const earned =
      passed
        ? correctCount * 10 + (correctCount === gradedCount ? 15 : 0)
        : 0;
    return (
      <main className="completion-screen">
        <div className="completion-content">
          <MayuImage
            pose={passed ? "celebrate" : "encourage"}
            alt={
              passed
                ? "Mayu celebrating the completed lesson"
                : "Mayu encouraging another gentle try"
            }
            className="completion-mayu"
          />
          <span className="overline">{passed ? "LESSON COMPLETE" : "READY TO REVISIT"}</span>
          <h1>{passed ? "Those phrases are yours now." : "One more pass will help."}</h1>
          <p>
            {passed
              ? `You practiced ${lesson.words.length} useful ${
                  lesson.words.length === 1 ? "phrase" : "phrases"
                } from ${lesson.title.toLowerCase()}.`
              : "Take the lesson again slowly. The answers stay visible after each check."}
          </p>
          <div className="completion-stats">
            <span>
              <small>PHRASES MET</small>
              <strong>{lesson.words.length}</strong>
            </span>
            <span>
              <small>ACCURACY</small>
              <strong>
                {gradedCount
                  ? Math.round((correctCount / gradedCount) * 100)
                  : 100}
                %
              </strong>
            </span>
          </div>
          <div className="completion-actions">
            <button className="primary-button" onClick={passed ? onExit : restart}>
              {passed ? "Back to course" : "Practice again"}
            </button>
            {passed ? (
              <button className="secondary-button" onClick={restart}>
                Practice again
              </button>
            ) : null}
          </div>
          <span className="sr-only" aria-live="polite">
            {passed ? `${earned} XP earned.` : "No XP earned yet."}
          </span>
        </div>
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
  if (
    step.type === "choice" ||
    step.type === "true-false" ||
    step.type === "arrange"
  ) {
    answerText =
      step.type === "true-false"
        ? `${step.word.english} — ${step.word.telugu}`
        : `${step.word.telugu} (${step.word.roman})`;
  }

  return (
    <div className="lesson-shell" data-energy-remaining={lessonEnergy}>
      <header className="lesson-header">
        <button onClick={onExit} className="icon-button" aria-label="Leave lesson">
          <Icon name="close" />
        </button>
        <ProgressBar
          value={stepIndex + 1}
          max={steps.length}
          className="lesson-progress"
          label="Lesson progress"
        />
        <span className="pixel-meta">
          {stepIndex + 1}/{steps.length}
        </span>
      </header>

      <main className="lesson-main">
        <p className="lesson-position">
          <span className="overline">{lesson.title}</span>
        </p>

        {step.type === "introduce" ? (
          <section className="introduce-exercise">
            <MayuImage
              pose="teach"
              alt="Mayu introducing a Telugu word"
              className="lesson-mayu"
            />
            <span className="overline">
              NEW {step.word.telugu.trim().includes(" ") ? "PHRASE" : "WORD"}
            </span>
            <div className="lesson-word-card">
              <button
                className="audio-circle-button"
                onClick={() => playAudio(step.word)}
                aria-label={`Hear ${step.word.telugu}`}
              >
                <Icon name="audio" />
              </button>
              <h1 lang="te">{step.word.telugu}</h1>
              {preferences.showRomanization ? <p>{step.word.roman}</p> : null}
              <strong>{step.word.english}</strong>
            </div>
            <p className="lesson-guidance">
              Hear it, then say it once at your own pace.
            </p>
          </section>
        ) : null}

        {step.type === "choice" ? (
          <section className="choice-exercise">
            <span className="overline">CHOOSE ONE</span>
            <h1>Which Telugu means “{step.word.english}”?</h1>
            <div className="answer-grid">
              {step.options.map((option) => {
                const isSelected = selected === option.telugu;
                const isCorrect =
                  result !== "idle" && option.telugu === step.word.telugu;
                const isWrong = result === "wrong" && isSelected;
                return (
                  <button
                    key={option.telugu}
                    disabled={result !== "idle"}
                    className={`answer-card ${
                      isSelected ? "answer-selected" : ""
                    } ${isCorrect ? "answer-correct" : ""} ${
                      isWrong ? "answer-wrong" : ""
                    }`}
                    onClick={() => setSelected(option.telugu)}
                    aria-pressed={isSelected}
                  >
                    <strong lang="te">{option.telugu}</strong>
                    {preferences.showRomanization ? <span>{option.roman}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step.type === "true-false" ? (
          <section className="true-false-exercise">
            <span className="overline">CHECK THE MEANING</span>
            <h1>Does this pairing feel right?</h1>
            <div className="statement-card">
              <strong lang="te">{step.word.telugu}</strong>
              <span>means</span>
              <b>“{step.shownMeaning}”</b>
            </div>
            <div className="true-false-grid">
              {[
                { value: "true", label: "Avunu · Yes" },
                { value: "false", label: "Kaadu · No" },
              ].map((option) => (
                <button
                  key={option.value}
                  disabled={result !== "idle"}
                  className={`answer-card ${
                    selected === option.value ? "answer-selected" : ""
                  } ${
                    result !== "idle" &&
                    (option.value === "true") === step.answer
                      ? "answer-correct"
                      : ""
                  } ${
                    result === "wrong" && selected === option.value
                      ? "answer-wrong"
                      : ""
                  }`}
                  onClick={() => setSelected(option.value)}
                  aria-pressed={selected === option.value}
                >
                  <strong>{option.label}</strong>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step.type === "matching" ? (
          <section className="matching-exercise">
            <span className="overline">MAKE THREE PAIRS</span>
            <h1>Match each word to its meaning.</h1>
            <p>Choose one Telugu word, then the English meaning beside it.</p>
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
              showRomanization={preferences.showRomanization}
            />
          </section>
        ) : null}

        {step.type === "arrange" ? (
          <section className="arrange-exercise">
            <span className="overline">PUT IT TOGETHER</span>
            <h1>Build “{step.word.english}”.</h1>
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
                <span>Choose the Telugu words in order</span>
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
        ) : null}
      </main>

      <footer
        className={`lesson-footer ${
          result === "correct"
            ? "lesson-footer-correct"
            : result === "wrong"
              ? "lesson-footer-wrong"
              : ""
        }`}
      >
        <div className="lesson-footer-inner">
          <div className="feedback-copy" role="status" aria-live="polite">
            {result === "correct" ? (
              <span>
                <strong>That’s right.</strong>
                <small>{answerText}</small>
              </span>
            ) : result === "wrong" ? (
              <>
                <MayuImage
                  pose="encourage"
                  alt="Mayu offering gentle encouragement"
                  className="feedback-mayu"
                />
                <span>
                  <strong>Take another look.</strong>
                  <small>The answer is {answerText}.</small>
                </span>
              </>
            ) : (
              <span>
                {step.type === "introduce"
                  ? "Meet the word before moving on."
                  : step.type === "matching"
                    ? matchingDone
                      ? "All three pairs are together."
                      : "Match every pair to continue."
                    : "Choose an answer when you’re ready."}
              </span>
            )}
          </div>

          {step.type === "introduce" ? (
            <button className="primary-button" onClick={advance}>
              Continue
              <Icon name="arrow" />
            </button>
          ) : step.type === "matching" ? (
            <button
              className="primary-button"
              disabled={!matchingDone}
              onClick={advance}
            >
              Continue
              <Icon name="arrow" />
            </button>
          ) : result === "idle" ? (
            <button
              className="primary-button"
              disabled={checkDisabled}
              onClick={check}
            >
              Check answer
            </button>
          ) : (
            <button className="primary-button" onClick={advance}>
              {isLast ? "Finish lesson" : "Continue"}
              <Icon name="arrow" />
            </button>
          )}
        </div>
      </footer>
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
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);

  return (
    <main className="onboarding-screen">
      <section
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
      >
        <MayuImage
          pose="welcome"
          alt="Mayu the peacock welcoming you to PalukuLingo"
          className="onboarding-mayu"
        />
        {step === 0 ? (
          <>
            <span className="overline">పలుకు · SPEAK</span>
            <h1 id="onboarding-title">Telugu can feel close to home.</h1>
            <p>
              Meet five useful words each day, or follow a course with Mayu beside you.
            </p>
          </>
        ) : (
          <>
            <span className="overline">CHOOSE A START</span>
            <h1 id="onboarding-title">What would help first?</h1>
            <p>You can change courses anytime from Learn.</p>
            <div className="onboarding-choices">
              <button
                className={selectedTrack === "essentials" ? "choice-active" : ""}
                onClick={() => onTrack("essentials")}
                aria-pressed={selectedTrack === "essentials"}
              >
                <span className="pixel-meta">SHORT COURSE</span>
                <strong>Useful Telugu now</strong>
                <small>Greetings, family, food, and help.</small>
              </button>
              <button
                className={selectedTrack === "foundations" ? "choice-active" : ""}
                onClick={() => onTrack("foundations")}
                aria-pressed={selectedTrack === "foundations"}
              >
                <span className="pixel-meta">FULL COURSE</span>
                <strong>From beginning</strong>
                <small>Vocabulary, sentences, sounds, and script.</small>
              </button>
            </div>
          </>
        )}
        <div className="onboarding-actions">
          <button className="text-button" onClick={onDone}>
            Skip
          </button>
          <span className="step-dots" aria-label={`Step ${step + 1} of 2`}>
            <i className={step === 0 ? "dot-active" : ""} />
            <i className={step === 1 ? "dot-active" : ""} />
          </span>
          <button
            className="primary-button"
            onClick={step === 0 ? () => setStep(1) : onDone}
          >
            {step === 0 ? "Continue" : "Begin"}
            <Icon name="arrow" />
          </button>
        </div>
      </section>
    </main>
  );
}

function MissingLesson({ onExit }: { onExit: () => void }) {
  return (
    <main className="missing-lesson">
      <span className="overline">LESSON NOT FOUND</span>
      <h1>That lesson is not on this path.</h1>
      <p>Return to Learn and choose any open topic.</p>
      <button className="primary-button" onClick={onExit}>
        Back to Learn
      </button>
    </main>
  );
}

export default function PalukuApp({
  screen = "today",
  initialLessonId,
}: {
  screen?: AppScreen;
  initialLessonId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<SavedState>(defaultState);
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const [savedWords, setSavedWords] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const activeLesson = findLesson(initialLessonId);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setState({
            ...defaultState,
            ...(JSON.parse(raw) as Partial<SavedState>),
          });
        }
      } catch {
        setState(defaultState);
      }

      try {
        const rawPreferences = window.localStorage.getItem(PREFERENCES_KEY);
        if (rawPreferences) {
          setPreferences({
            ...defaultPreferences,
            ...(JSON.parse(rawPreferences) as Partial<Preferences>),
          });
        }
      } catch {
        setPreferences(defaultPreferences);
      }

      try {
        const rawSavedWords = window.localStorage.getItem(SAVED_WORDS_KEY);
        if (rawSavedWords) {
          const restored = JSON.parse(rawSavedWords);
          if (Array.isArray(restored)) setSavedWords(restored);
        }
      } catch {
        setSavedWords([]);
      }

      try {
        setShowOnboarding(!window.localStorage.getItem(ONBOARDED_KEY));
      } catch {
        setShowOnboarding(false);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [hydrated, state]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // Preferences remain available for the current session.
    }
  }, [hydrated, preferences]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(savedWords));
    } catch {
      // Saved words remain available for the current session.
    }
  }, [hydrated, savedWords]);

  useEffect(() => {
    if (
      !hydrated ||
      !activeLesson ||
      state.selectedTrack === activeLesson.track
    ) {
      return;
    }
    const trackTimer = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        selectedTrack: activeLesson.track,
      }));
    }, 0);
    return () => window.clearTimeout(trackTimer);
  }, [activeLesson, hydrated, state.selectedTrack]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const startLesson = (lesson: Lesson) => {
    const nextState = { ...state, selectedTrack: lesson.track };
    setState(nextState);
    if (hydrated) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch {
        // Navigation still works when storage is unavailable.
      }
    }
    router.push(`/lesson/${lesson.id}`);
    window.scrollTo({ top: 0 });
  };

  const goToLearn = () => {
    router.push("/learn");
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
    try {
      window.localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {
      // Closing the welcome flow should never depend on storage access.
    }
    setShowOnboarding(false);
  };

  const selectOnboardingTrack = (selectedTrack: TrackId) =>
    setState((current) => ({ ...current, selectedTrack }));

  let content: React.ReactNode;

  if (screen === "lesson") {
    content = activeLesson ? (
      <LessonView
        key={`${activeLesson.id}-${hydrated ? "restored" : "initial"}`}
        lesson={activeLesson}
        state={state}
        onExit={goToLearn}
        onComplete={completeLesson}
        onLoseEnergy={() =>
          setState((current) => ({
            ...current,
            energy: Math.max(0, current.energy - 1),
          }))
        }
        notify={setToast}
        preferences={preferences}
      />
    ) : (
      <MissingLesson onExit={goToLearn} />
    );
  } else if (screen === "daily") {
    content = <DailySession preferences={preferences} notify={setToast} />;
  } else if (screen === "learn") {
    content = (
      <LearnView
        state={state}
        setState={setState}
        startLesson={startLesson}
      />
    );
  } else if (screen === "words") {
    content = (
      <WordsView
        preferences={preferences}
        savedWords={savedWords}
        setSavedWords={setSavedWords}
        notify={setToast}
      />
    );
  } else if (screen === "settings") {
    content = (
      <SettingsView
        state={state}
        setState={setState}
        preferences={preferences}
        setPreferences={setPreferences}
      />
    );
  } else {
    content = <TodayView state={state} startLesson={startLesson} />;
  }

  return (
    <>
      {hydrated &&
      showOnboarding &&
      screen !== "lesson" &&
      screen !== "daily" ? (
        <Onboarding
          selectedTrack={state.selectedTrack}
          onTrack={selectOnboardingTrack}
          onDone={closeOnboarding}
        />
      ) : (
        content
      )}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
