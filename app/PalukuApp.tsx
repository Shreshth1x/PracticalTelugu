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
  findLesson,
  practicalLessons,
  situationGroups,
  type Lesson,
  type SituationGroup,
  type TeluguWord,
} from "./course-data";

export type AppScreen = "today" | "learn" | "words" | "daily" | "settings" | "lesson";

type SavedState = {
  completed: string[];
  confidence: Record<string, "learning" | "ready">;
};

type Preferences = {
  showRomanization: boolean;
  teluguFirst: boolean;
  autoplay: boolean;
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
  group: SituationGroup;
};

type DailyWord = {
  word: TeluguWord;
  exampleTelugu: string;
  exampleEnglish: string;
};

const STORAGE_KEY = "palukulu.progress.v2";
const LEGACY_STORAGE_KEY = "palukulu.progress.v1";
const ONBOARDED_KEY = "palukulu.onboarded.v1";
const PREFERENCES_KEY = "palukulu.preferences.v1";
const SAVED_WORDS_KEY = "palukulu.saved-words.v1";

const defaultState: SavedState = {
  completed: [],
  confidence: {},
};

const defaultPreferences: Preferences = {
  showRomanization: true,
  teluguFirst: true,
  autoplay: false,
};

function findDailyWord(lessonId: string, english: string) {
  const lesson = findLesson(lessonId);
  const word = lesson?.words.find(
    (candidate) => normalize(candidate.english) === normalize(english),
  );
  if (!word) {
    throw new Error(`Missing daily phrase: ${lessonId}/${english}`);
  }
  return word;
}

const dailyWords: DailyWord[] = [
  {
    word: findDailyWord("hello-goodbye", "hello / respectful greeting"),
    exampleTelugu: "నమస్కారం, అత్తయ్య.",
    exampleEnglish: "Hello, auntie.",
  },
  {
    word: findDailyWord("please-thank-you", "thank you"),
    exampleTelugu: "భోజనానికి ధన్యవాదాలు.",
    exampleEnglish: "Thank you for the meal.",
  },
  {
    word: findDailyWord("names-introductions", "what is your name?"),
    exampleTelugu: "మీ పేరు ఏంటి?",
    exampleEnglish: "What is your name?",
  },
  {
    word: findDailyWord("food-water", "I would like water"),
    exampleTelugu: "నాకు నీళ్లు కావాలి.",
    exampleEnglish: "I would like some water.",
  },
  {
    word: findDailyWord("when-stuck", "please say it again"),
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
        group: lesson.group,
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
  { screen: "learn", href: "/learn", label: "Situations", icon: "learn" },
  { screen: "words", href: "/words", label: "Phrasebook", icon: "words" },
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
          <small>The Telugu you can use today.</small>
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
  const nextSituation =
    practicalLessons.find((lesson) => !state.completed.includes(lesson.id)) ??
    practicalLessons[0];
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
            <h1>Useful Telugu in four minutes.</h1>
            <p>
              Practice the five phrases you are most likely to need, then try
              one real-life situation.
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
            <span className="overline overline-light">QUICK FIVE</span>
            <strong>Start speaking sooner</strong>
            <span>Hello, thank you, your name, water, and how to ask someone to repeat.</span>
          </span>
          <span className="daily-feature-action">
            <span className="pixel-meta">5 PHRASES · 4 MIN</span>
            <span className="round-arrow" aria-hidden="true">
              <Icon name="arrow" />
            </span>
          </span>
        </Link>

        <section className="resume-card">
          <div className="card-heading-row">
            <div>
              <span className="overline">NEXT SITUATION</span>
              <h2>{nextSituation.title}</h2>
            </div>
            <span className="course-chip">{nextSituation.minutes} min</span>
          </div>
          <p>{nextSituation.description}</p>
          <button
            className="text-action"
            onClick={() => startLesson(nextSituation)}
          >
            <span>
              {state.completed.includes(nextSituation.id)
                ? "Run it again"
                : "Practice this situation"}
            </span>
            <Icon name="arrow" />
          </button>
        </section>

        <p className="quiet-summary">
          <span>
            <b className="tabular">{state.completed.length}</b> situations practiced
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <b className="tabular">{retainedWords}</b> useful phrases met
          </span>
        </p>
      </main>
    </AppShell>
  );
}

function SituationsView({
  state,
  startLesson,
}: {
  state: SavedState;
  startLesson: (lesson: Lesson) => void;
}) {
  const nextSituation =
    practicalLessons.find((lesson) => !state.completed.includes(lesson.id)) ??
    practicalLessons[0];

  return (
    <AppShell screen="learn">
      <main className="page page-learn">
        <header className="page-header">
          <span className="overline">REAL-LIFE TELUGU</span>
          <h1>What do you need to say?</h1>
          <p>
            Choose the moment in front of you. Every situation is open, short,
            and built around phrases you can use right away.
          </p>
        </header>

        <section className="continue-banner">
          <div>
            <span className="overline overline-light">A GOOD NEXT STEP</span>
            <h2>{nextSituation.title}</h2>
            <p>{nextSituation.outcome}</p>
          </div>
          <button
            className="light-button"
            onClick={() => startLesson(nextSituation)}
          >
            Practice now
            <Icon name="arrow" />
          </button>
        </section>

        {situationGroups.map((group) => {
          const lessons = practicalLessons.filter(
            (lesson) => lesson.group === group.id,
          );
          return (
            <section className="topic-section" key={group.id}>
              <div className="section-title-row">
                <div>
                  <span className="overline">{group.eyebrow}</span>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
              </div>

              <ol className="topic-list">
                {lessons.map((lesson, index) => {
                  const done = state.completed.includes(lesson.id);
                  return (
                    <li key={lesson.id}>
                      <span
                        className={`topic-index ${
                          done ? "topic-index-done" : ""
                        }`}
                      >
                        {done ? (
                          <Icon name="check" />
                        ) : (
                          String(index + 1).padStart(2, "0")
                        )}
                      </span>
                      <span className="topic-copy">
                        <strong>{lesson.title}</strong>
                        <span>{lesson.description}</span>
                        <small className="pixel-meta">
                          {lesson.minutes} MIN · {lesson.words.length} PHRASES
                        </small>
                      </span>
                      <button
                        className="topic-action"
                        onClick={() => startLesson(lesson)}
                        aria-label={`${done ? "Run again" : "Open"} ${lesson.title}`}
                      >
                        {done ? "Run again" : "Open"}
                        <Icon name="arrow" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
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

function PhrasebookView({
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
  const [situationFilter, setSituationFilter] = useState<
    "all" | SituationGroup
  >("all");
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
      if (situationFilter !== "all" && word.group !== situationFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return normalize(`${word.telugu} ${word.roman} ${word.english}`).includes(
        normalizedQuery,
      );
    });
  }, [query, savedWords, situationFilter, tab, todayKeys]);

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
            <span className="overline">QUICK PHRASEBOOK</span>
            <h1>Find what you need to say.</h1>
            <p>
              Search, hear, and save Telugu for the moments you actually face.
            </p>
          </div>
          <Link href="/words/daily" className="primary-button">
            Quick five
            <Icon name="arrow" />
          </Link>
        </header>

        <div className="word-tabs" role="tablist" aria-label="Phrase collections">
          {(
            [
              ["today", "Quick five"],
              ["all", "All phrases"],
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
              <span className="sr-only">Search phrases</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Telugu or English"
              />
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by situation</span>
              <select
                value={situationFilter}
                onChange={(event) =>
                  setSituationFilter(
                    event.target.value as "all" | SituationGroup,
                  )
                }
              >
                <option value="all">All situations</option>
                {situationGroups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {group.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="today-word-note">
            <span className="pixel-meta">
              {weekdayLabel.toUpperCase()} SET · 5 PHRASES
            </span>
            <p>
              Hello, thank you, your name, water, and a phrase for getting unstuck.
            </p>
          </div>
        )}

        <section
          id="words-panel"
          className="word-list"
          role="tabpanel"
          aria-labelledby={`words-tab-${tab}`}
          aria-label={`${tab === "all" ? "All phrases" : tab === "saved" ? "Saved phrases" : "Quick five phrases"}`}
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
                alt="Mayu reading beside an empty saved phrase list"
              />
              <div>
                <h2>Save the phrases you want nearby.</h2>
                <p>Use the bookmark on any phrase and it will wait for you here.</p>
                <button className="secondary-button" onClick={() => setTab("all")}>
                  Browse all phrases
                </button>
              </div>
            </div>
          ) : (
            <div className="no-results">
              <h2>No phrases found.</h2>
              <p>Try a different spelling or situation filter.</p>
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
                aria-label="Close phrase details"
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
                <strong>Hear this phrase</strong>
                <small>
                  {selectedWord.audioSrc
                    ? "Play family-recorded audio"
                    : "Family recording coming soon"}
                </small>
              </span>
            </button>
            <div className="usage-note">
              <span className="overline">WHEN TO USE IT</span>
              <p>
                {selectedWord.note ??
                  `Say it once slowly, then again in the kind of moment where you would naturally reach for “${selectedWord.english}.”`}
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
              {savedWords.includes(selectedWord.key)
                ? "Saved"
                : "Save for later"}
            </button>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function DailySession({
  state,
  setState,
  preferences,
  notify,
}: {
  state: SavedState;
  setState: React.Dispatch<React.SetStateAction<SavedState>>;
  preferences: Preferences;
  notify: (message: string) => void;
}) {
  const [wordIndex, setWordIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<("learning" | "ready")[]>([]);
  const finished = wordIndex >= dailyWords.length;
  const current = finished ? null : dailyWords[wordIndex];
  const currentConfidence = current
    ? state.confidence[`${current.word.telugu}::${current.word.english}`]
    : undefined;

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

  const markWord = (result: "learning" | "ready") => {
    if (current) {
      const key = `${current.word.telugu}::${current.word.english}`;
      setState((currentState) => ({
        completed: currentState.completed,
        confidence: {
          ...currentState.confidence,
          [key]: result,
        },
      }));
    }
    setResults((currentResults) => [...currentResults, result]);
    setRevealed(false);
    setWordIndex((currentIndex) => currentIndex + 1);
  };

  if (finished) {
    const ready = results.filter((result) => result === "ready").length;
    return (
      <main className="daily-session daily-recap">
        <header className="session-header">
          <Link href="/words" className="icon-button" aria-label="Close quick five">
            <Icon name="close" />
          </Link>
          <span className="pixel-meta">QUICK FIVE</span>
          <span className="session-header-spacer" aria-hidden="true" />
        </header>
        <div className="recap-content">
          <MayuImage
            pose="celebrate"
            alt="Mayu opening her tail in a gentle celebration"
            className="recap-mayu"
          />
          <span className="overline">QUICK PRACTICE DONE</span>
          <h1>You’re ready to use these today.</h1>
          <p>
            {ready} are ready to use. {dailyWords.length - ready} will stay
            marked for another quick review.
          </p>
          <div className="recap-list">
            {dailyWords.map(({ word }, index) => (
              <span key={word.telugu}>
                <b lang="te">{word.telugu}</b>
                <small>
                  {results[index] === "ready"
                    ? "Ready to use"
                    : "Review once more"}
                </small>
              </span>
            ))}
          </div>
          <div className="recap-actions">
            <Link href="/" className="primary-button">
              Back to Today
            </Link>
            <Link href="/words" className="secondary-button">
              Open phrasebook
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
        <Link href="/words" className="icon-button" aria-label="Close quick five">
          <Icon name="close" />
        </Link>
        <ProgressBar
          value={wordIndex + 1}
          max={dailyWords.length}
          className="session-progress"
          label="Quick five progress"
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
              ? "Mayu teaching today’s Telugu phrase"
              : "Mayu listening carefully"
          }
          className="daily-word-mayu"
        />
        <span className="overline">
          {currentConfidence === "ready"
            ? "QUICK REFRESH"
            : `PHRASE ${wordIndex + 1} OF 5`}
        </span>
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
          Hear the phrase
        </button>

        {revealed ? (
          <div className="revealed-meaning">
            <span className="overline">MEANING</span>
            <h2>{current.word.english}</h2>
            <div className="example-card">
              <span className="overline">SAY IT LIKE THIS</span>
              <strong lang="te">{current.exampleTelugu}</strong>
              <p>{current.exampleEnglish}</p>
            </div>
          </div>
        ) : (
          <button className="primary-button reveal-button" onClick={() => setRevealed(true)}>
            See meaning
          </button>
        )}
      </section>

      {revealed ? (
        <footer className="daily-actions">
          <button
            className="secondary-button"
            onClick={() => markWord("learning")}
          >
            Review once more
          </button>
          <button className="primary-button" onClick={() => markWord("ready")}>
            Ready to use
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
  setState,
  preferences,
  setPreferences,
}: {
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
          <h1>Set up Telugu your way.</h1>
          <p>
            Choose only the support that helps you speak sooner.
          </p>
        </header>

        <section className="settings-group" aria-labelledby="display-settings">
          <div className="settings-group-heading">
            <span className="overline">READING & AUDIO</span>
            <h2 id="display-settings">How phrases appear</h2>
          </div>
          <SwitchRow
            label="Show pronunciation"
            description="Show an easy-to-read pronunciation below each phrase."
            checked={preferences.showRomanization}
            onChange={() => updatePreference("showRomanization")}
          />
          <SwitchRow
            label="Show Telugu larger"
            description="Give the Telugu phrase the most space during quick practice."
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

        <section className="settings-group settings-about" aria-labelledby="about-settings">
          <div className="settings-group-heading">
            <span className="overline">SPOKEN TELUGU FIRST</span>
            <h2 id="about-settings">
              Designed for conversations, not textbook drills.
            </h2>
          </div>
          <p>
            Telugu changes by region, family, and formality. PalukuLingo starts
            with approachable spoken phrases, keeps Telugu and pronunciation
            together, and leaves room for your family’s own recordings.
          </p>
        </section>

        <section className="danger-zone">
          <div>
            <span className="overline">ON THIS DEVICE</span>
            <h2>Clear practice history</h2>
            <p>Clear practiced situations and quick-five confidence on this device.</p>
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
            <h2 id="reset-title">Clear your practice history?</h2>
            <p>
              This clears practiced situations and confidence stored in this
              browser. Saved phrases stay saved.
            </p>
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
  onExit,
  onComplete,
  notify,
  preferences,
}: {
  lesson: Lesson;
  onExit: () => void;
  onComplete: (lesson: Lesson, correct: number, graded: number) => void;
  notify: (message: string) => void;
  preferences: Preferences;
}) {
  const steps = useMemo(() => buildSteps(lesson), [lesson]);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<ResultState>("idle");
  const [selected, setSelected] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [gradedCount, setGradedCount] = useState(0);
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
    return (
      <main className="completion-screen">
        <div className="completion-content">
          <MayuImage
            pose={passed ? "celebrate" : "encourage"}
            alt={
              passed
                ? "Mayu celebrating the completed situation practice"
                : "Mayu encouraging another gentle try"
            }
            className="completion-mayu"
          />
          <span className="overline">
            {passed ? "READY TO USE" : "ONE QUICK REPLAY"}
          </span>
          <h1>
            {passed
              ? "You can use these phrases now."
              : "Run these phrases once more."}
          </h1>
          <p>
            {passed
              ? `${lesson.outcome} You practiced ${lesson.words.length} useful ${
                  lesson.words.length === 1 ? "phrase" : "phrases"
                }.`
              : "Run through the situation again slowly. The answers stay visible after each check."}
          </p>
          <div className="completion-stats">
            <span>
              <small>PHRASES PRACTICED</small>
              <strong>{lesson.words.length}</strong>
            </span>
            <span>
              <small>CHECKS RIGHT</small>
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
              {passed ? "Back to situations" : "Run it again"}
            </button>
            {passed ? (
              <button className="secondary-button" onClick={restart}>
                Run it again
              </button>
            ) : null}
          </div>
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
    <div className="lesson-shell">
      <header className="lesson-header">
        <button
          onClick={onExit}
          className="icon-button"
          aria-label="Leave practice"
        >
          <Icon name="close" />
        </button>
        <ProgressBar
          value={stepIndex + 1}
          max={steps.length}
          className="lesson-progress"
          label="Situation practice progress"
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
              alt="Mayu introducing a Telugu phrase"
              className="lesson-mayu"
            />
            <span className="overline">USEFUL PHRASE</span>
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
              Hear it, then say it once as if you needed it right now.
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
            <h1>Match each phrase to its meaning.</h1>
            <p>Choose one Telugu phrase, then the English meaning beside it.</p>
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
                  ? "Say it once before moving on."
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
              {isLast ? "Finish practice" : "Continue"}
              <Icon name="arrow" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Onboarding({
  onSkip,
  onStart,
}: {
  onSkip: () => void;
  onStart: () => void;
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
            <span className="overline">PRACTICAL TELUGU, FAST</span>
            <h1 id="onboarding-title">Say something useful today.</h1>
            <p>
              Practice the Telugu you’ll use with family, at the table, while
              visiting, and when you need help.
            </p>
          </>
        ) : (
          <>
            <span className="overline">YOUR QUICK START</span>
            <h1 id="onboarding-title">Your first five phrases are ready.</h1>
            <p>
              Hear each phrase, read the pronunciation, and mark what already
              feels familiar.
            </p>
          </>
        )}
        <div className="onboarding-actions">
          <button className="text-button" onClick={onSkip}>
            Explore first
          </button>
          <span className="step-dots" aria-label={`Step ${step + 1} of 2`}>
            <i className={step === 0 ? "dot-active" : ""} />
            <i className={step === 1 ? "dot-active" : ""} />
          </span>
          <button
            className="primary-button"
            onClick={step === 0 ? () => setStep(1) : onStart}
          >
            {step === 0 ? "See the quick start" : "Start quick practice"}
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
      <span className="overline">PRACTICE NOT FOUND</span>
      <h1>That situation is not available.</h1>
      <p>Return to Situations and choose any practical moment.</p>
      <button className="primary-button" onClick={onExit}>
        Back to situations
      </button>
    </main>
  );
}

function completedFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string")),
  );
}

function confidenceFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, "learning" | "ready"] =>
        entry[1] === "learning" || entry[1] === "ready",
    ),
  );
}

function parseCurrentProgress(value: unknown): SavedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return {
    completed: completedFrom(candidate.completed),
    confidence: confidenceFrom(candidate.confidence),
  };
}

function parseLegacyProgress(value: unknown): SavedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return {
    completed: completedFrom(candidate.completed),
    confidence: {},
  };
}

function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPreferences;
  }
  const candidate = value as Record<string, unknown>;
  return {
    showRomanization:
      typeof candidate.showRomanization === "boolean"
        ? candidate.showRomanization
        : defaultPreferences.showRomanization,
    teluguFirst:
      typeof candidate.teluguFirst === "boolean"
        ? candidate.teluguFirst
        : defaultPreferences.teluguFirst,
    autoplay:
      typeof candidate.autoplay === "boolean"
        ? candidate.autoplay
        : defaultPreferences.autoplay,
  };
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
      let restoredProgress: SavedState | null = null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          restoredProgress = parseCurrentProgress(JSON.parse(raw));
        }
      } catch {
        restoredProgress = null;
      }

      if (!restoredProgress) {
        try {
          const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyRaw) {
            restoredProgress = parseLegacyProgress(JSON.parse(legacyRaw));
          }
        } catch {
          restoredProgress = null;
        }
      }
      setState(restoredProgress ?? defaultState);

      try {
        const rawPreferences = window.localStorage.getItem(PREFERENCES_KEY);
        if (rawPreferences) {
          setPreferences(parsePreferences(JSON.parse(rawPreferences)));
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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const startLesson = (lesson: Lesson) => {
    router.push(`/lesson/${lesson.id}`);
    window.scrollTo({ top: 0 });
  };

  const goToSituations = () => {
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
    setState((current) => ({
      completed: current.completed.includes(lesson.id)
        ? current.completed
        : [...current.completed, lesson.id],
      confidence: current.confidence,
    }));
  };

  const markOnboarded = () => {
    try {
      window.localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {
      // Closing the welcome flow should never depend on storage access.
    }
    setShowOnboarding(false);
  };

  const startQuickFive = () => {
    markOnboarded();
    router.push("/words/daily");
    window.scrollTo({ top: 0 });
  };

  let content: React.ReactNode;

  if (screen === "lesson") {
    content = activeLesson ? (
      <LessonView
        key={`${activeLesson.id}-${hydrated ? "restored" : "initial"}`}
        lesson={activeLesson}
        onExit={goToSituations}
        onComplete={completeLesson}
        notify={setToast}
        preferences={preferences}
      />
    ) : (
      <MissingLesson onExit={goToSituations} />
    );
  } else if (screen === "daily") {
    content = (
      <DailySession
        state={state}
        setState={setState}
        preferences={preferences}
        notify={setToast}
      />
    );
  } else if (screen === "learn") {
    content = (
      <SituationsView
        state={state}
        startLesson={startLesson}
      />
    );
  } else if (screen === "words") {
    content = (
      <PhrasebookView
        preferences={preferences}
        savedWords={savedWords}
        setSavedWords={setSavedWords}
        notify={setToast}
      />
    );
  } else if (screen === "settings") {
    content = (
      <SettingsView
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
          onSkip={markOnboarded}
          onStart={startQuickFive}
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
