"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  allLessons,
  findLesson,
  practicePacks,
  practicalLessons,
  situationGroups,
  type Lesson,
  type SituationGroup,
  type TeluguWord,
} from "./course-data";
import { phraseKey, resolvePracticePath } from "./practice-path.mjs";

export type AppScreen =
  | "today"
  | "learn"
  | "words"
  | "daily"
  | "settings"
  | "lesson";

type SavedState = {
  completed: string[];
  confidence: Record<string, "learning" | "ready">;
};

type Preferences = {
  showPronunciation: boolean;
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
type MayuVariant = "guide" | "success";

type LibraryWord = TeluguWord & {
  key: string;
  lessonTitle: string;
  group: SituationGroup;
};

const STORAGE_KEY = "palukulu.progress.v2";
const LEGACY_STORAGE_KEY = "palukulu.progress.v1";
const PREFERENCES_KEY = "palukulu.preferences.v1";
const SAVED_WORDS_KEY = "palukulu.saved-words.v1";

const defaultState: SavedState = {
  completed: [],
  confidence: {},
};

const defaultPreferences: Preferences = {
  showPronunciation: true,
  autoplay: false,
};

function normalize(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.,!?;:'"()।]/g, "")
    .replace(/\s+/g, " ");
}

function formatPronunciation(value: string) {
  return `(${value.trim()})`;
}

function SpokenGuide({
  word,
  showPronunciation = true,
}: {
  word: Pick<TeluguWord, "roman" | "pronunciation">;
  showPronunciation?: boolean;
}) {
  return (
    <span className="phrase-spoken">
      <span className="phrase-roman" lang="te-Latn">
        <span className="sr-only">Telugu in English letters: </span>
        {word.roman}
      </span>
      {showPronunciation ? (
        <span className="phrase-pronunciation" lang="en">
          <span className="sr-only">Say it like: </span>
          {formatPronunciation(word.pronunciation)}
        </span>
      ) : null}
    </span>
  );
}

const libraryWords: LibraryWord[] = (() => {
  const seen = new Set<string>();
  const words: LibraryWord[] = [];

  allLessons.forEach((lesson) => {
    lesson.words.forEach((word) => {
      const key = phraseKey(word);
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
      return;
    }

    const isTrue = index % 4 === 1;
    steps.push({
      type: "true-false",
      word,
      shownMeaning: isTrue
        ? word.english
        : lesson.words[(index + 1) % lesson.words.length].english,
      answer: isTrue,
    });
  });

  steps.push({ type: "matching", words: lesson.words.slice(0, 3) });

  const phrase = lesson.words.find(
    (word) => word.telugu.trim().split(/\s+/).length > 1,
  );

  if (phrase) {
    steps.push({
      type: "arrange",
      word: phrase,
      tokens: phrase.roman.trim().split(/\s+/).reverse(),
    });
  }

  return steps;
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
    | "arrow"
    | "audio"
    | "bookmark"
    | "search"
    | "close"
    | "check"
    | "settings";
  className?: string;
}) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };

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

  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
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
  variant,
  alt,
  className = "",
}: {
  variant: MayuVariant;
  alt: string;
  className?: string;
}) {
  return (
    <span className={`mayu-image ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/mayu-${variant}-v2.webp`} alt={alt} />
    </span>
  );
}

function ProgressBar({
  value,
  max,
  label,
  className = "",
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
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
      aria-valuenow={value}
    >
      <span className="progress-fill" style={{ width: `${percentage}%` }} />
    </span>
  );
}

function PhraseStack({
  word,
  showPronunciation = true,
  size = "row",
  headingAs = "strong",
  headingId,
  className = "",
}: {
  word: Pick<
    TeluguWord,
    "english" | "roman" | "pronunciation" | "telugu"
  >;
  showPronunciation?: boolean;
  size?: "row" | "card" | "hero" | "lesson" | "recap" | "feedback";
  headingAs?: "h1" | "h2" | "h3" | "strong";
  headingId?: string;
  className?: string;
}) {
  const Heading = headingAs;
  const english =
    word.english.charAt(0).toLocaleUpperCase() + word.english.slice(1);

  return (
    <div className={`phrase-stack phrase-${size} ${className}`.trim()}>
      <Heading id={headingId} className="phrase-english">
        {english}
      </Heading>
      <SpokenGuide
        word={word}
        showPronunciation={showPronunciation}
      />
      <span className="phrase-telugu" lang="te">
        {word.telugu}
      </span>
    </div>
  );
}

function playWordAudio(word: TeluguWord, notify: (message: string) => void) {
  if (!word.audioSrc) {
    notify("Family recording coming soon.");
    return;
  }

  new Audio(word.audioSrc).play().catch(() => {
    notify("That recording could not play. Try again in a moment.");
  });
}

function AudioButton({
  word,
  notify,
  className = "",
}: {
  word: TeluguWord;
  notify: (message: string) => void;
  className?: string;
}) {
  return (
    <button
      className={`audio-button ${className}`.trim()}
      onClick={() => playWordAudio(word, notify)}
      aria-label={
        word.audioSrc
          ? `Listen to “${word.english}” in Telugu`
          : `Recording for “${word.english}” coming soon`
      }
    >
      <Icon name="audio" />
      {word.audioSrc ? "Listen" : "Recording soon"}
    </button>
  );
}

const navItems: {
  screen: Extract<AppScreen, "today" | "learn" | "words">;
  href: string;
  label: string;
}[] = [
  { screen: "today", href: "/", label: "Today" },
  { screen: "learn", href: "/learn", label: "Situations" },
  { screen: "words", href: "/words", label: "Phrasebook" },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/practicaltelugu-peacock-mark-v3.png?v=approved-1"
          alt=""
        />
      </span>
      <span className="wordmark-name">
        practical<span>telugu</span>
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
      <header className="top-header">
        <div className="top-header-inner">
          <Link
            href="/"
            className="top-brand"
            aria-label="PracticalTelugu home"
          >
            <Wordmark />
          </Link>

          <nav aria-label="Primary navigation" className="top-nav">
            {navItems.map((item) => (
              <Link
                href={item.href}
                key={item.screen}
                className={`top-nav-link ${
                  screen === item.screen ? "top-nav-link-active" : ""
                }`}
                aria-current={screen === item.screen ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/settings"
            className={`top-settings ${
              screen === "settings" ? "top-settings-active" : ""
            }`}
            aria-label="Open settings"
            aria-current={screen === "settings" ? "page" : undefined}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </Link>
        </div>
      </header>

      <div className="app-content">{children}</div>
    </div>
  );
}

function TodayView({
  state,
  startLesson,
  notify,
}: {
  state: SavedState;
  startLesson: (lesson: Lesson) => void;
  notify: (message: string) => void;
}) {
  const featuredSituationIds = ["family-words", "food-water", "when-stuck"];
  const featuredSituations = practicalLessons.filter((lesson) =>
    featuredSituationIds.includes(lesson.id),
  );
  const path = resolvePracticePath(practicePacks, state.confidence);
  const activePack = practicePacks[path.packIndex];
  const pathPhraseCount = practicePacks.reduce(
    (total, pack) => total + pack.words.length,
    0,
  );
  const nextWord =
    activePack.words[path.phraseIndex] ?? activePack.words[0];
  const practiceLabel = path.allComplete
    ? "Review your first five"
    : path.completedInPack
      ? `Continue ${activePack.title.toLocaleLowerCase()}`
      : path.packIndex === 0
        ? "Practice your first five"
        : `Start ${activePack.title.toLocaleLowerCase()}`;
  const practiceMeta = path.allComplete
    ? `All ${pathPhraseCount} phrases covered`
    : path.completedInPack
      ? `${path.completedInPack} of ${activePack.words.length} practiced`
      : `Set ${path.packIndex + 1} of ${practicePacks.length}, about 4 minutes`;
  const guideTitle =
    path.packIndex === 0 && path.phraseIndex === 0 && !path.allComplete
      ? "Start with hello."
      : path.allComplete
        ? "Keep the essentials close."
        : path.completedInPack
          ? "Pick up where you left off."
          : `Next up: ${activePack.title}.`;

  return (
    <AppShell screen="today">
      <main className="page home-page">
        <section className="home-hero" aria-labelledby="today-heading">
          <h1 id="today-heading">Learn Telugu you’ll actually use</h1>
          <div className="home-actions">
            <Link href="/words/daily" className="primary-button">
              {practiceLabel}
            </Link>
            <span className="action-time">{practiceMeta}</span>
            <Link href="/learn" className="text-link">
              Choose a situation
              <Icon name="arrow" />
            </Link>
          </div>
        </section>

        <section className="home-guide" aria-labelledby="home-guide-title">
          <div className="home-guide-copy">
            <h2 id="home-guide-title">{guideTitle}</h2>
            <PhraseStack word={nextWord} size="card" />
            <AudioButton word={nextWord} notify={notify} />
          </div>
          <span className="mayu-intro">Meet Mayu</span>
          <MayuImage
            variant="guide"
            alt=""
            className="home-mayu"
          />
        </section>

        <section
          className="situation-preview"
          aria-labelledby="situation-preview-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="situation-preview-title">Choose a situation.</h2>
              <p>Practice only what you are likely to use next.</p>
            </div>
            <Link href="/learn" className="text-link section-link">
              See all
              <Icon name="arrow" />
            </Link>
          </div>

          <ul className="situation-list">
            {featuredSituations.map((lesson) => {
              const done = state.completed.includes(lesson.id);

              return (
                <li key={lesson.id}>
                  <button
                    className="situation-row"
                    onClick={() => startLesson(lesson)}
                    aria-label={`${done ? "Practice again" : "Practice"}: ${
                      lesson.title
                    }`}
                  >
                    <span className="situation-row-copy">
                      <strong>{lesson.title}</strong>
                      <span>{lesson.description}</span>
                    </span>
                    <span className="situation-row-end">
                      <span className="situation-row-meta">
                        <span>{lesson.minutes} min</span>
                        {done ? <span>Practiced</span> : null}
                      </span>
                      <Icon name="arrow" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
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
      <main className="page">
        <header className="page-header">
          <h1>What do you need to say?</h1>
          <p>
            Pick the moment in front of you. Every practice is short and every
            situation is open.
          </p>
        </header>

        <button
          className="next-practice"
          onClick={() => startLesson(nextSituation)}
        >
          <span>
            <strong>{nextSituation.title}</strong>
            <span>{nextSituation.outcome}</span>
          </span>
          <span className="next-practice-end">
            <span>{nextSituation.minutes} min</span>
            <Icon name="arrow" />
          </span>
        </button>

        <div className="situation-groups">
          {situationGroups.map((group) => {
            const lessons = practicalLessons.filter(
              (lesson) => lesson.group === group.id,
            );

            return (
              <section className="situation-group" key={group.id}>
                <div className="group-heading">
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>

                <ul className="lesson-list">
                  {lessons.map((lesson) => {
                    const done = state.completed.includes(lesson.id);

                    return (
                      <li key={lesson.id}>
                        <button
                          className="lesson-row"
                          onClick={() => startLesson(lesson)}
                          aria-label={`${done ? "Practice again" : "Practice"} ${
                            lesson.title
                          }`}
                        >
                          <span
                            className={`lesson-status ${
                              done ? "lesson-status-done" : ""
                            }`}
                            aria-hidden="true"
                          >
                            {done ? <Icon name="check" /> : null}
                          </span>
                          <span className="lesson-row-copy">
                            <strong>{lesson.title}</strong>
                            <span>{lesson.description}</span>
                          </span>
                          <span className="lesson-row-meta">
                            <span>{lesson.minutes} min</span>
                            <span>
                              {lesson.words.length}{" "}
                              {lesson.words.length === 1 ? "phrase" : "phrases"}
                            </span>
                          </span>
                          <Icon name="arrow" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}

function WordRow({
  item,
  isSaved,
  showPronunciation,
  onAudio,
  onOpen,
  onSave,
}: {
  item: LibraryWord;
  isSaved: boolean;
  showPronunciation: boolean;
  onAudio: (word: TeluguWord) => void;
  onOpen: (word: LibraryWord) => void;
  onSave: (word: LibraryWord) => void;
}) {
  return (
    <article className="word-row">
      <button className="word-row-main" onClick={() => onOpen(item)}>
        <PhraseStack
          word={item}
          showPronunciation={showPronunciation}
          size="row"
        />
      </button>
      <span className="word-row-actions">
        <button
          className="icon-button"
          onClick={() => onAudio(item)}
          aria-label={
            item.audioSrc
              ? `Listen to “${item.english}” in Telugu`
              : `Recording for “${item.english}” coming soon`
          }
        >
          <Icon name="audio" />
        </button>
        <button
          className={`icon-button ${isSaved ? "icon-button-saved" : ""}`}
          onClick={() => onSave(item)}
          aria-label={`${isSaved ? "Remove" : "Save"} “${item.english}”`}
          aria-pressed={isSaved}
        >
          <Icon name="bookmark" />
        </button>
      </span>
    </article>
  );
}

function PhrasebookView({
  state,
  preferences,
  savedWords,
  setSavedWords,
  notify,
}: {
  state: SavedState;
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

  const path = resolvePracticePath(practicePacks, state.confidence);
  const activePack = practicePacks[path.packIndex];
  const todayKeys = useMemo(
    () => new Set(activePack.words.map(phraseKey)),
    [activePack],
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

      return normalize(
        `${word.telugu} ${word.roman} ${word.pronunciation} ${word.english}`,
      ).includes(normalizedQuery);
    });
  }, [query, savedWords, situationFilter, tab, todayKeys]);

  const toggleSaved = (word: LibraryWord) => {
    setSavedWords((current) =>
      current.includes(word.key)
        ? current.filter((key) => key !== word.key)
        : [...current, word.key],
    );
  };

  const tabOptions: readonly [WordTab, string][] = [
    ["today", "Today"],
    ["all", "All phrases"],
    ["saved", "Saved"],
  ];

  const moveTabFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: WordTab,
  ) => {
    const currentIndex = tabOptions.findIndex(([value]) => value === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabOptions.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabOptions.length) % tabOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabOptions.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabOptions[nextIndex][0];
    setTab(nextTab);
    document.getElementById(`words-tab-${nextTab}`)?.focus();
  };

  return (
    <AppShell screen="words">
      <main className="page">
        <header className="page-header">
          <h1>Find what you need to say.</h1>
          <p>Search, hear, and save the Telugu you actually reach for.</p>
        </header>

        <div
          className="word-tabs"
          role="tablist"
          aria-label="Phrase collections"
        >
          {tabOptions.map(([value, label]) => (
            <button
              key={value}
              id={`words-tab-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls="words-panel"
              className={tab === value ? "word-tab-active" : ""}
              onClick={() => setTab(value)}
              onKeyDown={(event) => moveTabFocus(event, value)}
              tabIndex={tab === value ? 0 : -1}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "today" ? (
          <div className="phrasebook-today">
            <div>
              <h2>{activePack.title}.</h2>
              <p>{activePack.outcome}</p>
            </div>
            <Link href="/words/daily" className="secondary-button">
              {path.allComplete
                ? "Review these"
                : path.completedInPack
                  ? "Continue this set"
                  : "Practice these"}
            </Link>
          </div>
        ) : (
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
        )}

        <section
          id="words-panel"
          className="word-list"
          role="tabpanel"
          aria-labelledby={`words-tab-${tab}`}
        >
          {visibleWords.length ? (
            visibleWords.map((word) => (
              <WordRow
                key={word.key}
                item={word}
                isSaved={savedWords.includes(word.key)}
                showPronunciation={preferences.showPronunciation}
                onAudio={(item) => playWordAudio(item, notify)}
                onOpen={setSelectedWord}
                onSave={toggleSaved}
              />
            ))
          ) : tab === "saved" && !query ? (
            <div className="empty-state">
              <h2>No saved phrases yet.</h2>
              <p>Save a phrase and it will stay easy to find here.</p>
              <button
                className="secondary-button"
                onClick={() => setTab("all")}
              >
                Browse all phrases
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <h2>No phrases found.</h2>
              <p>Try a different spelling or situation.</p>
            </div>
          )}
        </section>
      </main>

      {selectedWord ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWordSheet();
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
              <span>{selectedWord.lessonTitle}</span>
              <span className="sheet-header-actions">
                <button
                  className={`icon-button ${
                    savedWords.includes(selectedWord.key)
                      ? "icon-button-saved"
                      : ""
                  }`}
                  onClick={() => toggleSaved(selectedWord)}
                  aria-label={`${
                    savedWords.includes(selectedWord.key) ? "Remove" : "Save"
                  } “${selectedWord.english}”`}
                  aria-pressed={savedWords.includes(selectedWord.key)}
                >
                  <Icon name="bookmark" />
                </button>
                <button
                  className="icon-button"
                  onClick={closeWordSheet}
                  aria-label="Close phrase details"
                  autoFocus
                >
                  <Icon name="close" />
                </button>
              </span>
            </div>

            <PhraseStack
              word={selectedWord}
              showPronunciation={preferences.showPronunciation}
              size="hero"
              headingAs="h2"
              headingId="word-sheet-title"
            />

            <AudioButton
              word={selectedWord}
              notify={notify}
              className="sheet-audio"
            />

            <div className="usage-note">
              <h3>When to use it</h3>
              <p>
                {selectedWord.note ??
                  `Use this whenever you would naturally say “${selectedWord.english}.” Start slowly, then say it again at a comfortable pace.`}
              </p>
            </div>
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
  const [position, setPosition] = useState(() => {
    const path = resolvePracticePath(practicePacks, state.confidence);
    return {
      packIndex: path.packIndex,
      wordIndex: path.phraseIndex,
      reviewing: path.allComplete,
    };
  });
  const [revealed, setRevealed] = useState(false);
  const pack = practicePacks[position.packIndex];
  const finished = position.wordIndex >= pack.words.length;
  const current = finished ? null : pack.words[position.wordIndex];

  useEffect(() => {
    if (!preferences.autoplay || !current?.audioSrc) return;

    const audio = new Audio(current.audioSrc);
    audio.play().catch(() => {
      // Manual playback remains available when the browser blocks autoplay.
    });
    return () => audio.pause();
  }, [current?.audioSrc, preferences.autoplay]);

  const markWord = (result: "learning" | "ready") => {
    if (current) {
      const key = phraseKey(current);
      setState((currentState) => ({
        completed: currentState.completed,
        confidence: {
          ...currentState.confidence,
          [key]: result,
        },
      }));
    }

    setRevealed(false);
    setPosition((currentPosition) => ({
      ...currentPosition,
      wordIndex: currentPosition.wordIndex + 1,
    }));
  };

  const continuePath = () => {
    const path = resolvePracticePath(practicePacks, state.confidence);
    const nextPackIndex = path.allComplete
      ? (position.packIndex + 1) % practicePacks.length
      : path.packIndex;

    setPosition({
      packIndex: nextPackIndex,
      wordIndex: path.allComplete ? 0 : path.phraseIndex,
      reviewing: path.allComplete,
    });
    setRevealed(false);
    window.scrollTo({ top: 0 });
  };

  if (finished) {
    const path = resolvePracticePath(practicePacks, state.confidence);
    const nextPackIndex = path.allComplete
      ? (position.packIndex + 1) % practicePacks.length
      : path.packIndex;
    const nextPack = practicePacks[nextPackIndex];
    const ready = pack.words.filter(
      (word) => state.confidence[phraseKey(word)] === "ready",
    ).length;
    const completedPathNow =
      path.allComplete &&
      !position.reviewing &&
      position.packIndex === practicePacks.length - 1;
    const recapCopy = completedPathNow
      ? "You’ve covered the complete practical path. Circle back whenever you want to keep the essentials fresh."
      : position.reviewing
        ? `Next, review ${nextPack.title.toLocaleLowerCase()}.`
        : `Next up: ${nextPack.title}. ${nextPack.outcome}`;
    const continueLabel = completedPathNow
      ? "Review your first five"
      : position.reviewing
        ? `Review ${nextPack.title.toLocaleLowerCase()}`
        : `Continue to ${nextPack.title.toLocaleLowerCase()}`;

    return (
      <main className="focus-session recap-session">
        <header className="focus-header">
          <Link
            href="/"
            className="icon-button"
            aria-label="Leave practice"
          >
            <Icon name="close" />
          </Link>
          <strong>{pack.title}</strong>
          <span className="focus-header-space" aria-hidden="true" />
        </header>

        <div className="recap-content">
          <MayuImage
            variant="success"
            alt=""
            className="recap-mayu"
          />
          <h1>{pack.title} is ready.</h1>
          <p>
            You marked {ready} of {pack.words.length} as ready to use.{" "}
            {recapCopy}
          </p>

          <div className="recap-list">
            {pack.words.map((word) => {
              const isReady = state.confidence[phraseKey(word)] === "ready";

              return (
                <div className="recap-item" key={phraseKey(word)}>
                  <PhraseStack
                    word={word}
                    showPronunciation={preferences.showPronunciation}
                    size="recap"
                  />
                  <span
                    className={`confidence-label ${
                      isReady ? "confidence-ready" : ""
                    }`}
                  >
                    {isReady ? "Ready" : "Review"}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            className="primary-button recap-primary"
            onClick={continuePath}
          >
            {continueLabel}
          </button>
          <Link href="/" className="text-button">
            Back to Today
          </Link>
        </div>
      </main>
    );
  }

  if (!current) return null;

  return (
    <main className="focus-session">
      <header className="focus-header">
        <Link
          href="/"
          className="icon-button"
          aria-label="Leave practice"
        >
          <Icon name="close" />
        </Link>
        <div className="focus-progress-wrap">
          <strong>
            Set {position.packIndex + 1}: {pack.title}
          </strong>
          <ProgressBar
            value={position.wordIndex + 1}
            max={pack.words.length}
            label={`${pack.title} progress`}
          />
        </div>
        <span className="step-count">
          {position.wordIndex + 1} of {pack.words.length}
        </span>
      </header>

      <section className="daily-stage" aria-labelledby="daily-word-title">
        <PhraseStack
          word={current}
          showPronunciation={preferences.showPronunciation}
          size="hero"
          headingAs="h1"
          headingId="daily-word-title"
        />

        <AudioButton word={current} notify={notify} />

        <div className={`example-panel ${revealed ? "example-visible" : ""}`}>
          {revealed ? (
            <>
              <h2>Use it here</h2>
              <strong>{current.note ?? pack.outcome}</strong>
            </>
          ) : (
            <p>Hear the phrase, say it once, then see where it fits.</p>
          )}
        </div>
      </section>

      <footer className="focus-actions">
        {revealed ? (
          <div className="confidence-actions">
            <button
              className="secondary-button"
              onClick={() => markWord("learning")}
            >
              Keep practicing
            </button>
            <button
              className="primary-button"
              onClick={() => markWord("ready")}
            >
              Ready to use
            </button>
          </div>
        ) : (
          <button
            className="primary-button focus-primary"
            onClick={() => setRevealed(true)}
          >
            See when to use it
          </button>
        )}
      </footer>
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
      <main className="page settings-page">
        <header className="page-header">
          <h1>Settings.</h1>
          <p>Keep only the support that helps you speak sooner.</p>
        </header>

        <section className="settings-section" aria-labelledby="phrase-settings">
          <h2 id="phrase-settings">Phrases</h2>
          <div className="settings-list">
            <SwitchRow
              label="Show the speaking guide"
              description="Keep the easy, say-it-out-loud cue in parentheses."
              checked={preferences.showPronunciation}
              onChange={() => updatePreference("showPronunciation")}
            />
            <SwitchRow
              label="Play available audio automatically"
              description="This only plays when a family recording is available."
              checked={preferences.autoplay}
              onChange={() => updatePreference("autoplay")}
            />
          </div>
        </section>

        <section className="settings-section" aria-labelledby="about-settings">
          <h2 id="about-settings">About the Telugu here</h2>
          <p className="settings-copy">
            Spoken Telugu changes by region, family, and formality.
            PracticalTelugu starts with the English meaning, shows Telugu in
            English letters, adds an approximate speaking cue in parentheses,
            and keeps Telugu script nearby for recognition.
          </p>
        </section>

        <section className="settings-reset" aria-labelledby="reset-settings">
          <div>
            <h2 id="reset-settings">Practice history</h2>
            <p>
              Clear your practical path, completed situations, and phrase
              confidence on this device.
            </p>
          </div>
          <button
            className="danger-button"
            onClick={() => setConfirmReset(true)}
          >
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
            <h2 id="reset-title">Clear your practice history?</h2>
            <p>
              This removes path progress, completed situations, and confidence
              stored in this browser. Saved phrases stay saved.
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={closeResetDialog}>
                Keep progress
              </button>
              <button
                className="danger-button danger-button-solid"
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
  showPronunciation,
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
  showPronunciation: boolean;
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
    }, 500);

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
            key={word.english}
            className={`match-card ${
              leftSelected === index ? "answer-selected" : ""
            } ${matched.has(index) ? "answer-correct" : ""} ${
              mismatch?.startsWith(`${index}-`) ? "answer-wrong" : ""
            }`}
            disabled={matched.has(index)}
            onClick={() => setLeftSelected(index)}
            aria-pressed={leftSelected === index}
          >
            {word.english}
          </button>
        ))}
      </div>

      <div>
        {rightOrder.map((wordIndex) => (
          <button
            key={words[wordIndex].telugu}
            className={`match-card ${
              rightSelected === wordIndex ? "answer-selected" : ""
            } ${matched.has(wordIndex) ? "answer-correct" : ""} ${
              mismatch?.endsWith(`-${wordIndex}`) ? "answer-wrong" : ""
            }`}
            disabled={matched.has(wordIndex)}
            onClick={() => setRightSelected(wordIndex)}
            aria-pressed={rightSelected === wordIndex}
          >
            <SpokenGuide
              word={words[wordIndex]}
              showPronunciation={showPronunciation}
            />
            <small lang="te">{words[wordIndex].telugu}</small>
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
      // Manual playback remains available when autoplay is blocked.
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
      return;
    }

    setResult("wrong");
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
      recordResult(normalize(answer) === normalize(step.word.roman));
    }
  };

  if (finished) {
    const passed = gradedCount === 0 || correctCount / gradedCount >= 0.6;
    const score = gradedCount
      ? Math.round((correctCount / gradedCount) * 100)
      : 100;

    return (
      <main className="completion-screen">
        <div className="completion-content">
          {passed ? (
            <MayuImage
              variant="success"
              alt=""
              className="completion-mayu"
            />
          ) : null}

          <h1>
            {passed
              ? "You can use these phrases now."
              : "Give these phrases one more pass."}
          </h1>
          <p>
            {passed
              ? lesson.outcome
              : "Take it slowly. The answer stays visible after every check."}
          </p>

          <div className="completion-stats">
            <span>
              <strong>{lesson.words.length}</strong>
              <small>Phrases practiced</small>
            </span>
            <span>
              <strong>{score}%</strong>
              <small>Checks right</small>
            </span>
          </div>

          <button
            className="primary-button completion-primary"
            onClick={passed ? onExit : restart}
          >
            {passed ? "Back to situations" : "Practice again"}
          </button>
          {passed ? (
            <button className="text-button" onClick={restart}>
              Practice this situation again
            </button>
          ) : null}
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
  const answerWord =
    step.type === "choice" ||
    step.type === "true-false" ||
    step.type === "arrange"
      ? step.word
      : null;

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
        <div className="lesson-header-center">
          <strong>{lesson.title}</strong>
          <ProgressBar
            value={stepIndex + 1}
            max={steps.length}
            label="Situation practice progress"
          />
        </div>
        <span className="step-count">
          {stepIndex + 1} of {steps.length}
        </span>
      </header>

      <main className="lesson-main">
        {step.type === "introduce" ? (
          <section className="introduce-exercise">
            <h1>Say this out loud.</h1>
            <div className="lesson-word-card">
              <PhraseStack
                word={step.word}
                showPronunciation={preferences.showPronunciation}
                size="lesson"
              />
              <AudioButton word={step.word} notify={notify} />
            </div>
            <p>Say it once as if you needed the phrase right now.</p>
          </section>
        ) : null}

        {step.type === "choice" ? (
          <section className="choice-exercise">
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
                    <SpokenGuide
                      word={option}
                      showPronunciation={preferences.showPronunciation}
                    />
                    <span lang="te">{option.telugu}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step.type === "true-false" ? (
          <section className="true-false-exercise">
            <h1>Does this pairing match?</h1>
            <div className="statement-card">
              <PhraseStack
                word={{
                  english: step.shownMeaning,
                  roman: step.word.roman,
                  pronunciation: step.word.pronunciation,
                  telugu: step.word.telugu,
                }}
                showPronunciation={preferences.showPronunciation}
                size="card"
              />
            </div>
            <div className="true-false-grid">
              {[
                {
                  value: "true",
                  english: "Yes",
                  roman: "avunu",
                  pronunciation: "uh-VOO-noo",
                  telugu: "అవును",
                },
                {
                  value: "false",
                  english: "No",
                  roman: "kaadu",
                  pronunciation: "KAA-doo",
                  telugu: "కాదు",
                },
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
                  <strong>{option.english}</strong>
                  <SpokenGuide
                    word={option}
                    showPronunciation={preferences.showPronunciation}
                  />
                  <small lang="te">{option.telugu}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step.type === "matching" ? (
          <section className="matching-exercise">
            <h1>Match each phrase to its meaning.</h1>
            <p>Choose an English meaning, then choose the phrase you would say.</p>
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
              showPronunciation={preferences.showPronunciation}
            />
          </section>
        ) : null}

        {step.type === "arrange" ? (
          <section className="arrange-exercise">
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
                <span>Choose the English-letter words in order</span>
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
              <div>
                <strong>
                  {
                    ["That’s right.", "You’ve got it.", "Exactly."][
                      stepIndex % 3
                    ]
                  }
                </strong>
                {answerWord ? (
                  <PhraseStack
                    word={answerWord}
                    showPronunciation={preferences.showPronunciation}
                    size="feedback"
                  />
                ) : null}
              </div>
            ) : result === "wrong" ? (
              <div>
                <strong>
                  {
                    [
                      "Take another look.",
                      "Keep this phrase close.",
                      "Here is the phrase to remember.",
                    ][stepIndex % 3]
                  }
                </strong>
                {answerWord ? (
                  <PhraseStack
                    word={answerWord}
                    showPronunciation={preferences.showPronunciation}
                    size="feedback"
                  />
                ) : null}
              </div>
            ) : (
              <span>
                {step.type === "introduce"
                  ? "Say it once before moving on."
                  : step.type === "matching"
                    ? matchingDone
                      ? "All three pairs are together."
                      : "Match every pair to continue."
                    : "Choose an answer when you are ready."}
              </span>
            )}
          </div>

          {step.type === "introduce" ? (
            <button className="primary-button" onClick={advance}>
              Continue
            </button>
          ) : step.type === "matching" ? (
            <button
              className="primary-button"
              disabled={!matchingDone}
              onClick={advance}
            >
              Continue
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
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function MissingLesson({ onExit }: { onExit: () => void }) {
  return (
    <main className="missing-lesson">
      <h1>That situation is not available.</h1>
      <p>Choose any practical moment from Situations.</p>
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
  const legacyShowRomanization = candidate.showRomanization;
  return {
    showPronunciation:
      typeof candidate.showPronunciation === "boolean"
        ? candidate.showPronunciation
        : typeof legacyShowRomanization === "boolean"
          ? legacyShowRomanization
          : defaultPreferences.showPronunciation,
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

      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The session stays usable when local storage is unavailable.
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
      // Saved phrases remain available for the current session.
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
        key={hydrated ? "daily-restored" : "daily-initial"}
        state={state}
        setState={setState}
        preferences={preferences}
        notify={setToast}
      />
    );
  } else if (screen === "learn") {
    content = <SituationsView state={state} startLesson={startLesson} />;
  } else if (screen === "words") {
    content = (
      <PhrasebookView
        state={state}
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
    content = (
      <TodayView
        state={state}
        startLesson={startLesson}
        notify={setToast}
      />
    );
  }

  return (
    <>
      {content}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
