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
  resolveTeluguFormUsage,
  situationGroups,
  teluguRelationshipGuidance,
  type Lesson,
  type SituationGroup,
  type TeluguAlternative,
  type TeluguFormUsage,
  type TeluguWord,
} from "./course-data";
import {
  phraseKey,
  resolvePracticePath,
  resolvePracticeRoadmap,
} from "./practice-path.mjs";
import {
  type Preferences,
  type SavedState,
} from "./learning-state";
import { useLearning } from "./LearningProvider";
import PracticeLive from "./practice-live/PracticeLive";
import PracticeHub from "./PracticeHub";
import { localDay, streakForDays } from "./review-data";
import { Wordmark } from "./Wordmark";

export type AppScreen =
  | "today"
  | "learn"
  | "words"
  | "practice-live"
  | "practice"
  | "daily"
  | "settings"
  | "lesson";

type Step =
  | { type: "introduce"; word: TeluguWord }
  | { type: "choice"; word: TeluguWord; options: TeluguWord[] }
  | {
      type: "true-false";
      word: TeluguWord;
      shownMeaning: string;
      answer: boolean;
    }
  | { type: "matching"; words: TeluguWord[]; rightOrder: number[] }
  | { type: "arrange"; word: TeluguWord; tokens: string[] };

type ResultState = "idle" | "correct" | "wrong";
type LessonStepState = {
  result: ResultState;
  selected: string | null;
  matched: Set<number>;
  arranged: number[];
};
type WordTab = "today" | "all" | "saved";
type MayuVariant = "guide" | "success";

const phraseAudioCache = new Map<string, HTMLAudioElement>();
const PHRASE_AUDIO_CACHE_LIMIT = 40;
let activePhraseAudio: HTMLAudioElement | null = null;

function preparePhraseAudio(audioSrc: string) {
  if (typeof Audio === "undefined") return null;

  const cachedAudio = phraseAudioCache.get(audioSrc);
  if (cachedAudio) {
    // Re-insert so the map keeps least-recently-used entries first.
    phraseAudioCache.delete(audioSrc);
    phraseAudioCache.set(audioSrc, cachedAudio);
    return cachedAudio;
  }

  const audio = new Audio(audioSrc);
  audio.preload = "auto";
  audio.load();
  phraseAudioCache.set(audioSrc, audio);

  if (phraseAudioCache.size > PHRASE_AUDIO_CACHE_LIMIT) {
    for (const [cachedSrc, cached] of phraseAudioCache) {
      if (phraseAudioCache.size <= PHRASE_AUDIO_CACHE_LIMIT) break;
      if (cached === activePhraseAudio || cached === audio) continue;
      cached.pause();
      cached.removeAttribute("src");
      cached.load();
      phraseAudioCache.delete(cachedSrc);
    }
  }

  return audio;
}

function pauseActivePhraseAudio() {
  activePhraseAudio?.pause();
}

function startPhraseAudio(audioSrc: string) {
  const audio = preparePhraseAudio(audioSrc);
  if (!audio) return null;

  if (activePhraseAudio && activePhraseAudio !== audio) {
    activePhraseAudio.pause();
  }

  if (audio.readyState > 0) audio.currentTime = 0;
  activePhraseAudio = audio;
  return {
    audio,
    playback: audio.play(),
  };
}

function usePhraseAudioPreload(audioSrc: string | undefined) {
  useEffect(() => {
    if (audioSrc) preparePhraseAudio(audioSrc);
  }, [audioSrc]);
}

type LibraryWord = TeluguWord & {
  key: string;
  lessonTitle: string;
  group: SituationGroup;
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

function FormUsageContext({
  usage,
  label,
}: {
  usage?: TeluguFormUsage;
  label?: string;
}) {
  const resolved = resolveTeluguFormUsage(usage);

  if (!resolved.showContext) return null;

  return (
    <span
      className={`register-label register-context-${resolved.kind}`}
      title={resolved.guidance}
      aria-label={`${label ?? resolved.label}. ${resolved.guidance}`}
      data-audience={resolved.audience}
    >
      {label ?? resolved.label}
    </span>
  );
}

function RegisterAlternatives({
  alternatives,
  notify,
  showPronunciation = true,
  className = "",
}: {
  alternatives: TeluguAlternative[] | undefined;
  notify: (message: string) => void;
  showPronunciation?: boolean;
  className?: string;
}) {
  useEffect(() => {
    alternatives?.forEach((alternative) => {
      if (alternative.audioSrc) preparePhraseAudio(alternative.audioSrc);
    });
  }, [alternatives]);

  if (!alternatives?.length) return null;

  const hasListenerChoice = alternatives.some(
    (alternative) => alternative.usage?.kind === "relationship",
  );

  return (
    <section
      className={`register-alternatives ${className}`.trim()}
      aria-label={
        hasListenerChoice
          ? "Forms for different listener relationships"
          : "Other useful ways to say this"
      }
    >
      <span className="register-label">
        {hasListenerChoice
          ? "Choose for the person you’re speaking to"
          : "Another useful form"}
      </span>
      {hasListenerChoice ? (
        <p className="register-relationship-guidance">
          {teluguRelationshipGuidance}
        </p>
      ) : null}
      {alternatives.map((alternative) => (
        <div
          className="register-alternative"
          key={`${alternative.label}:${alternative.telugu}`}
        >
          <div className="register-alternative-copy">
            {resolveTeluguFormUsage(alternative.usage).showContext ? (
              <FormUsageContext
                usage={alternative.usage}
                label={
                  alternative.usage?.kind === "relationship"
                    ? undefined
                    : alternative.label
                }
              />
            ) : (
              <span className="register-label">{alternative.label}</span>
            )}
            <SpokenGuide
              word={alternative}
              showPronunciation={showPronunciation}
            />
            <span className="phrase-telugu" lang="te">
              {alternative.telugu}
            </span>
          </div>
          {alternative.audioSrc ? (
            <button
              type="button"
              className="register-audio-button"
              onClick={() =>
                playAudioSource(
                  alternative.audioSrc,
                  notify,
                  "That recording could not play. Try again in a moment.",
                )
              }
              aria-label={`Listen to “${alternative.telugu}” (${alternative.label})`}
            >
              <Icon name="audio" />
            </button>
          ) : null}
        </div>
      ))}
    </section>
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

function hashStringToSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seedText: string) {
  let state = hashStringToSeed(seedText) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = shuffled[index];
    shuffled[index] = shuffled[swap];
    shuffled[swap] = held;
  }
  return shuffled;
}

function seededOrder(length: number, random: () => number): number[] {
  const order = seededShuffle(
    Array.from({ length }, (_, index) => index),
    random,
  );
  if (length > 1 && order.every((value, index) => value === index)) {
    const first = order.shift();
    if (first !== undefined) order.push(first);
  }
  return order;
}

function buildSteps(lesson: Lesson): Step[] {
  const steps: Step[] = [];
  // Seeded per lesson: answer positions vary between exercises, but a
  // re-render or retake keeps the same layout instead of reshuffling.
  const random = createSeededRandom(`lesson-steps:${lesson.id}`);

  lesson.words.forEach((word, index) => {
    steps.push({ type: "introduce", word });

    if (index % 2 === 0 || index === lesson.words.length - 1) {
      steps.push({
        type: "choice",
        word,
        options: seededShuffle(lesson.words, random),
      });
      return;
    }

    const otherWords = lesson.words.filter(
      (candidate) => candidate.english !== word.english,
    );
    const isTrue = otherWords.length === 0 || random() < 0.5;
    const wrongWord = otherWords.length
      ? otherWords[Math.floor(random() * otherWords.length)]
      : word;
    steps.push({
      type: "true-false",
      word,
      shownMeaning: isTrue ? word.english : wrongWord.english,
      answer: isTrue,
    });
  });

  const matchingWords = lesson.words.slice(0, 3);
  steps.push({
    type: "matching",
    words: matchingWords,
    rightOrder: seededOrder(matchingWords.length, random),
  });

  const phrase = lesson.words.find(
    (word) => word.telugu.trim().split(/\s+/).length > 1,
  );

  if (phrase) {
    const romanTokens = phrase.roman.trim().split(/\s+/);
    let tokens = seededShuffle(romanTokens, random);
    if (
      romanTokens.length > 1 &&
      tokens.join(" ") === romanTokens.join(" ")
    ) {
      tokens = [...tokens.slice(1), tokens[0]];
    }
    steps.push({ type: "arrange", word: phrase, tokens });
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
  showUsageContext,
  spokenAction,
  size = "row",
  headingAs = "strong",
  headingId,
  className = "",
}: {
  word: Pick<
    TeluguWord,
    "english" | "roman" | "pronunciation" | "telugu" | "usage"
  >;
  showPronunciation?: boolean;
  showUsageContext?: boolean;
  spokenAction?: React.ReactNode;
  size?: "row" | "card" | "hero" | "lesson" | "recap" | "feedback";
  headingAs?: "h1" | "h2" | "h3" | "strong";
  headingId?: string;
  className?: string;
}) {
  const Heading = headingAs;
  const english =
    word.english.charAt(0).toLocaleUpperCase() + word.english.slice(1);
  const shouldShowUsageContext =
    showUsageContext ?? resolveTeluguFormUsage(word.usage).showContext;

  return (
    <div className={`phrase-stack phrase-${size} ${className}`.trim()}>
      <Heading id={headingId} className="phrase-english">
        {english}
      </Heading>
      {shouldShowUsageContext ? (
        <FormUsageContext usage={word.usage} />
      ) : null}
      {spokenAction ? (
        <div className="phrase-spoken-with-action">
          <SpokenGuide
            word={word}
            showPronunciation={showPronunciation}
          />
          {spokenAction}
        </div>
      ) : (
        <SpokenGuide
          word={word}
          showPronunciation={showPronunciation}
        />
      )}
      <span className="phrase-telugu" lang="te">
        {word.telugu}
      </span>
    </div>
  );
}

function playAudioSource(
  audioSrc: string | undefined,
  notify: (message: string) => void,
  unavailableMessage = "Family recording coming soon.",
) {
  if (!audioSrc) {
    notify(unavailableMessage);
    return;
  }

  startPhraseAudio(audioSrc)?.playback.catch(() => {
    notify("That recording could not play. Try again in a moment.");
  });
}

function playWordAudio(word: TeluguWord, notify: (message: string) => void) {
  playAudioSource(word.audioSrc, notify);
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
  usePhraseAudioPreload(word.audioSrc);

  return (
    <button
      type="button"
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
  screen: Extract<
    AppScreen,
    "today" | "practice" | "practice-live" | "learn" | "words"
  >;
  href: string;
  label: string;
}[] = [
  { screen: "today", href: "/", label: "Today" },
  { screen: "practice", href: "/practice", label: "Practice" },
  { screen: "practice-live", href: "/practice-live", label: "Practice Live" },
  { screen: "learn", href: "/learn", label: "Situations" },
  { screen: "words", href: "/words", label: "Phrasebook" },
];

function AppShell({
  screen,
  children,
}: {
  screen: AppScreen;
  children: React.ReactNode;
}) {
  const { user } = useLearning();
  const returnPath =
    screen === "learn"
      ? "/learn"
      : screen === "practice"
        ? "/practice"
        : screen === "practice-live"
        ? "/practice-live"
        : screen === "words"
          ? "/words"
          : screen === "settings"
            ? "/settings"
            : "/";

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

          <div className="top-actions">
            <Link
              href={
                user
                  ? "/account"
                  : `/account?mode=signin&returnTo=${encodeURIComponent(returnPath)}`
              }
              className="top-account"
            >
              {user ? "Account" : "Sign in"}
            </Link>
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
        </div>
      </header>

      <div className="app-content">{children}</div>
    </div>
  );
}

function TodayView({
  state,
  notify,
  showPronunciation,
}: {
  state: SavedState;
  notify: (message: string) => void;
  showPronunciation: boolean;
}) {
  const path = resolvePracticePath(practicePacks, state.confidence);
  const [reviewDay, setReviewDay] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setReviewDay(localDay());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const reviewDone = Boolean(reviewDay && state.reviewDays?.[reviewDay]);
  const streak = reviewDay ? streakForDays(state.reviewDays, reviewDay) : 0;
  const activePack = practicePacks[path.packIndex];
  const pathPhraseCount = practicePacks.reduce(
    (total, pack) => total + pack.words.length,
    0,
  );
  const roadmapProgress = resolvePracticeRoadmap(
    practicePacks,
    state.confidence,
  );
  const roadmapSteps = practicePacks.map((pack, index) => {
    return {
      ...pack,
      index,
      ...roadmapProgress[index],
    };
  });
  const completedRoadmapSteps = roadmapSteps.filter(
    (step) => step.status === "completed",
  ).length;
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
  const hasPracticeProgress =
    path.completedPacks > 0 || path.completedInPack > 0;
  const guideActionLabel = path.allComplete
    ? "Review your first five"
    : hasPracticeProgress
      ? "Continue"
      : "Start practicing";
  const guideActionAccessibleLabel = path.allComplete
    ? "Review your first five phrases"
    : hasPracticeProgress
      ? `Continue ${activePack.title.toLocaleLowerCase()} practice`
      : "Start practicing your first five phrases";

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
            <PhraseStack
              word={nextWord}
              showPronunciation={showPronunciation}
              size="card"
            />
            <div className="home-guide-actions">
              <Link
                href="/words/daily"
                className="primary-button home-guide-continue"
                aria-label={guideActionAccessibleLabel}
              >
                {guideActionLabel}
                <Icon name="arrow" />
              </Link>
              <AudioButton word={nextWord} notify={notify} />
            </div>
          </div>
          <div className="home-mayu-stage">
            <span className="mayu-intro">Meet Mayu</span>
            <MayuImage
              variant="guide"
              alt=""
              className="home-mayu"
            />
          </div>
        </section>

        <section className="home-review" aria-labelledby="home-review-title">
          <div>
            <h2 id="home-review-title">Make it stick.</h2>
            <p>{reviewDone ? "Today’s quiz is complete. Keep using your phrases." : "Ten questions a day. Revisit your words, then put them into sentences."}</p>
            {streak > 0 ? <span className="home-review-streak">{streak} day{streak === 1 ? "" : "s"} in a row</span> : null}
          </div>
          <div className="home-review-actions">
            <Link href="/practice/quiz" className="primary-button">{reviewDone ? "Review today’s quiz" : "Take today’s quiz"}</Link>
            <Link href="/practice" className="text-link">Open your practice space</Link>
            <Link href="/practice/sentences" className="text-link">Build a sentence</Link>
          </div>
        </section>

        <section className="home-roadmap" aria-labelledby="home-roadmap-title">
          <div className="roadmap-heading">
            <div>
              <h2 id="home-roadmap-title">Your practical path.</h2>
              <p>
                {practicePacks.length} short sets, {pathPhraseCount} practical
                phrases. From first hello to asking for help.
              </p>
            </div>
            <p className="roadmap-summary" aria-live="polite">
              {path.allComplete
                ? `All ${practicePacks.length} sets practiced`
                : `${completedRoadmapSteps} of ${practicePacks.length} sets practiced`}
            </p>
          </div>

          <ol className="roadmap-grid">
            {roadmapSteps.map((step) => {
              const statusLabel = step.status === "completed"
                ? "Practiced"
                : step.status === "current"
                  ? step.practiced
                    ? `${step.practiced} of ${step.total}`
                    : "Start here"
                  : `${step.total} phrases`;
              const stepContent = (
                <>
                  <span className="roadmap-step-top">
                    <span className="roadmap-step-number">
                      {String(step.index + 1).padStart(2, "0")}
                    </span>
                    <span className="roadmap-step-status">
                      {step.status === "completed" ? (
                        <Icon name="check" />
                      ) : null}
                      {statusLabel}
                    </span>
                  </span>
                  <span className="roadmap-step-title">
                    <strong>{step.title}</strong>
                    {step.status === "current" ? (
                      <Icon name="arrow" />
                    ) : null}
                  </span>
                </>
              );
              const accessibleStatus = step.status === "completed"
                ? "practiced"
                : step.status === "current"
                  ? `current, ${step.practiced} of ${step.total} phrases practiced`
                  : `coming up, ${step.total} phrases`;

              return (
                <li
                  key={step.id}
                  className={`roadmap-step roadmap-step-${step.status}`}
                  aria-current={
                    step.status === "current" ? "step" : undefined
                  }
                >
                    <Link
                      href={`/words/daily?pack=${step.id}`}
                      aria-label={`Set ${step.index + 1}, ${step.title}, ${accessibleStatus}`}
                    >
                      {stepContent}
                    </Link>
                </li>
              );
            })}
          </ol>
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
  // Rows only fetch audio once the learner shows intent; mounting every
  // library row must not fire hundreds of media requests.
  const preloadRowAudio = () => {
    if (item.audioSrc) preparePhraseAudio(item.audioSrc);
  };

  return (
    <article
      className="word-row"
      onPointerEnter={preloadRowAudio}
      onFocusCapture={preloadRowAudio}
    >
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

      const alternatives =
        word.alternatives
          ?.map(
            (alternative) =>
              `${alternative.telugu} ${alternative.roman} ${alternative.pronunciation} ${alternative.label}`,
          )
          .join(" ") ?? "";

      return normalize(
        `${word.telugu} ${word.roman} ${word.pronunciation} ${word.english} ${alternatives}`,
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
          <Link href="/practice" className="text-link">Use your vocabulary bank to build sentences and review</Link>
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
            <RegisterAlternatives
              alternatives={selectedWord.alternatives}
              notify={notify}
              showPronunciation={preferences.showPronunciation}
              className="sheet-register-alternatives"
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

function PracticeBackButton({
  onClick,
  disabled = false,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      className="text-button practice-back"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <Icon name="arrow" />
      Back
    </button>
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
  const { cloudReady } = useLearning();
  const [position, setPosition] = useState(() => {
    const path = resolvePracticePath(practicePacks, state.confidence);
    return {
      packIndex: path.packIndex,
      wordIndex: path.phraseIndex,
      reviewing: path.allComplete,
    };
  });
  const [revealed, setRevealed] = useState(false);
  const revealedPhrasesRef = useRef(new Set<string>());
  const interactedRef = useRef(false);
  const confidenceRef = useRef(state.confidence);
  const pack = practicePacks[position.packIndex];
  const finished = position.wordIndex >= pack.words.length;
  const current = finished ? null : pack.words[position.wordIndex];

  useEffect(() => {
    // Every set stays open for review, even if an earlier set is unfinished.
    const selectedPackId = new URLSearchParams(window.location.search).get("pack");
    const selectedPackIndex = practicePacks.findIndex(
      (candidate) => candidate.id === selectedPackId,
    );
    if (selectedPackIndex < 0) return;

    interactedRef.current = true;
    // Read the browser URL after hydration so server and client markup agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition({ packIndex: selectedPackIndex, wordIndex: 0, reviewing: true });
    setRevealed(false);
  }, []);

  useEffect(() => {
    confidenceRef.current = state.confidence;
  }, [state.confidence]);

  useEffect(() => {
    if (!cloudReady || interactedRef.current) return;

    // Cloud progress restored after mount can move the practical path past
    // phrases already practiced on another device; jump before practice starts.
    const path = resolvePracticePath(practicePacks, confidenceRef.current);
    setPosition({
      packIndex: path.packIndex,
      wordIndex: path.phraseIndex,
      reviewing: path.allComplete,
    });
    setRevealed(false);
  }, [cloudReady]);

  useEffect(() => {
    if (!preferences.autoplay || !current?.audioSrc) return;

    const playback = startPhraseAudio(current.audioSrc);
    playback?.playback.catch(() => {
      // Manual playback remains available when the browser blocks autoplay.
    });
    return () => playback?.audio.pause();
  }, [current?.audioSrc, preferences.autoplay]);

  const markWord = (result: "learning" | "ready") => {
    interactedRef.current = true;
    pauseActivePhraseAudio();
    if (current) {
      const key = phraseKey(current);
      setState((currentState) => ({
        ...currentState,
        completed: currentState.completed,
        confidence: {
          ...currentState.confidence,
          [key]: result,
        },
      }));
    }

    if (current && revealed) revealedPhrasesRef.current.add(phraseKey(current));
    const nextWord = pack.words[position.wordIndex + 1];
    setRevealed(Boolean(nextWord && revealedPhrasesRef.current.has(phraseKey(nextWord))));
    setPosition((currentPosition) => ({
      ...currentPosition,
      wordIndex: currentPosition.wordIndex + 1,
    }));
  };

  const goBack = () => {
    if (position.wordIndex === 0 && position.packIndex === 0) return;

    interactedRef.current = true;
    pauseActivePhraseAudio();
    if (current && revealed) revealedPhrasesRef.current.add(phraseKey(current));
    const previousPackIndex = position.wordIndex > 0
      ? position.packIndex
      : position.packIndex - 1;
    const previousWordIndex = position.wordIndex > 0
      ? position.wordIndex - 1
      : practicePacks[previousPackIndex].words.length - 1;
    const previousWord = practicePacks[previousPackIndex].words[previousWordIndex];
    setPosition({
      ...position,
      packIndex: previousPackIndex,
      wordIndex: previousWordIndex,
    });
    setRevealed(revealedPhrasesRef.current.has(phraseKey(previousWord)));
    window.scrollTo({ top: 0 });
  };

  const continuePath = () => {
    interactedRef.current = true;
    pauseActivePhraseAudio();
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
        <header className="focus-header practice-header-with-exit">
          <Link
            href="/words"
            className="text-button practice-exit"
            aria-label="Leave practice"
            title="Your marked phrases are saved. You can leave at any time."
            onClick={pauseActivePhraseAudio}
          >
            <Icon name="arrow" />
            <span>Back to phrasebook</span>
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

          <PracticeBackButton onClick={goBack} label="Back to previous phrase" />
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
      <header className="focus-header practice-header-with-exit">
        <Link
          href="/words"
          className="text-button practice-exit"
          aria-label="Leave practice"
          title="Your marked phrases are saved. You can leave at any time."
          onClick={pauseActivePhraseAudio}
        >
          <Icon name="arrow" />
          <span>Back to phrasebook</span>
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
              <RegisterAlternatives
                alternatives={current.alternatives}
                notify={notify}
                showPronunciation={preferences.showPronunciation}
                className="daily-register-alternatives"
              />
            </>
          ) : (
            <p>Hear the phrase, say it once, then see where it fits.</p>
          )}
        </div>
      </section>

      <footer className="focus-actions">
        <PracticeBackButton
          onClick={goBack}
          disabled={position.wordIndex === 0 && position.packIndex === 0}
          label="Back to previous phrase"
        />
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
            onClick={() => {
              interactedRef.current = true;
              revealedPhrasesRef.current.add(phraseKey(current));
              setRevealed(true);
            }}
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
  preferences,
  setPreferences,
}: {
  preferences: Preferences;
  setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
}) {
  const {
    user,
    authReady,
    syncStatus,
    syncMessage,
    retrySync,
    signOut,
    resetProgress,
  } = useLearning();
  const [confirmReset, setConfirmReset] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
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

        <section className="settings-section" aria-labelledby="progress-settings">
          <h2 id="progress-settings">Progress</h2>
          <div className="settings-account-panel">
            <div>
              <strong>
                {user
                  ? syncStatus === "error"
                    ? "Saved on this device"
                    : "Progress backed up"
                  : "Saved on this device"}
              </strong>
              <p>
                {!authReady
                  ? "Checking your account…"
                  : user
                    ? syncMessage
                    : "Sign in if you want your practiced and saved phrases on every device."}
              </p>
              {user?.email ? (
                <small>Signed in as {user.email}</small>
              ) : null}
              {accountMessage ? (
                <small role="status">{accountMessage}</small>
              ) : null}
            </div>
            <div className="settings-account-actions">
              {user ? (
                <>
                  {syncStatus === "error" ? (
                    <button className="text-button" onClick={retrySync}>
                      Try again
                    </button>
                  ) : null}
                  <Link href="/account" className="secondary-button">
                    Account
                  </Link>
                  <button
                    className="text-button"
                    onClick={async () => {
                      const result = await signOut();
                      setAccountMessage(
                        result.error
                          ? "Couldn’t sign out. Try again."
                          : "Signed out. Your progress is still on this device.",
                      );
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/account?mode=signup&returnTo=%2Fsettings"
                  className="primary-button"
                >
                  Save progress
                </Link>
              )}
            </div>
          </div>
        </section>

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
              Clear your practical path, completed situations, phrase
              confidence, daily quizzes, and streak {user ? "on this device and in your backup." : "on this device."}
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
              This removes path progress, completed situations, confidence, daily quizzes, and your streak
              {user
                ? " from this device and your account. Saved phrases stay saved."
                : " stored in this browser. Saved phrases stay saved."}
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={closeResetDialog}>
                Keep progress
              </button>
              <button
                className="danger-button danger-button-solid"
                onClick={() => {
                  resetProgress();
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
  rightOrder,
}: {
  words: TeluguWord[];
  rightOrder: number[];
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

type LessonSession = {
  stepIndex: number;
  completionRecorded: boolean;
  history: Map<number, LessonStepState>;
};

function readLessonSession(storageKey: string, steps: Step[]): LessonSession | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      saved.signature !== JSON.stringify(steps) ||
      !Number.isInteger(saved.stepIndex) ||
      saved.stepIndex < 0 ||
      saved.stepIndex >= steps.length ||
      !Array.isArray(saved.history)
    ) return null;

    const history = new Map<number, LessonStepState>();
    for (const entry of saved.history) {
      const step = steps[entry.index];
      if (
        !step ||
        !Number.isInteger(entry.index) ||
        !["idle", "correct", "wrong"].includes(entry.result) ||
        !(entry.selected === null || typeof entry.selected === "string") ||
        !Array.isArray(entry.arranged) ||
        !Array.isArray(entry.matched)
      ) return null;
      const tokenCount = step.type === "arrange" ? step.tokens.length : 0;
      const pairCount = step.type === "matching" ? step.words.length : 0;
      if (
        entry.arranged.some((index: unknown) =>
          !Number.isInteger(index) || (index as number) < 0 || (index as number) >= tokenCount,
        ) ||
        new Set(entry.arranged).size !== entry.arranged.length ||
        entry.matched.some((index: unknown) =>
          !Number.isInteger(index) || (index as number) < 0 || (index as number) >= pairCount,
        ) ||
        new Set(entry.matched).size !== entry.matched.length
      ) return null;
      history.set(entry.index, {
        result: entry.result,
        selected: entry.selected,
        matched: new Set<number>(entry.matched),
        arranged: entry.arranged,
      });
    }
    return {
      stepIndex: saved.stepIndex,
      completionRecorded: saved.completionRecorded === true,
      history,
    };
  } catch {
    // Practice remains usable when session storage is unavailable or stale.
    return null;
  }
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
  const { user, authReady } = useLearning();
  const steps = useMemo(() => buildSteps(lesson), [lesson]);
  const sessionKey = `palukulu.lesson-session.v1.${user?.id ?? "anonymous"}.${lesson.id}`;
  const [restoredSessionKey, setRestoredSessionKey] = useState<string | null>(null);
  const completionRecordedRef = useRef(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<ResultState>("idle");
  const [selected, setSelected] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<number, boolean>>({});
  const stepHistoryRef = useRef(new Map<number, LessonStepState>());
  const correctCount = Object.values(stepResults).filter(Boolean).length;
  const gradedCount = Object.keys(stepResults).length;
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [leftSelected, setLeftSelected] = useState<number | null>(null);
  const [rightSelected, setRightSelected] = useState<number | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [arranged, setArranged] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  useEffect(() => {
    if (!authReady) return;
    const saved = readLessonSession(sessionKey, steps);
    const alreadyStarted = stepIndex > 0 || result !== "idle" || selected !== null ||
      arranged.length > 0 || matched.size > 0 || finished;
    // Starting before authentication settles takes precedence over an older draft.
    if (saved && !(restoredSessionKey === null && alreadyStarted)) {
      stepHistoryRef.current = saved.history;
      completionRecordedRef.current = saved.completionRecorded;
      const active = saved.history.get(saved.stepIndex);
      const results: Record<number, boolean> = {};
      saved.history.forEach((snapshot, index) => {
        if (snapshot.result !== "idle") results[index] = snapshot.result === "correct";
      });
      // Browser storage is reconciled after the learner's account is known.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepResults(results);
      setStepIndex(saved.stepIndex);
      setResult(active?.result ?? "idle");
      setSelected(active?.selected ?? null);
      setMatched(new Set(active?.matched));
      setArranged(active?.arranged ?? []);
      setLeftSelected(null);
      setRightSelected(null);
      setMismatch(null);
      setFinished(false);
    } else if (restoredSessionKey !== null && restoredSessionKey !== sessionKey) {
      // Switching accounts cannot carry another learner's unfinished answers over.
      stepHistoryRef.current.clear();
      completionRecordedRef.current = false;
      setStepResults({});
      setStepIndex(0);
      setResult("idle");
      setSelected(null);
      setMatched(new Set());
      setArranged([]);
      setLeftSelected(null);
      setRightSelected(null);
      setMismatch(null);
      setFinished(false);
    }
    setRestoredSessionKey(sessionKey);
    // A session restores once per account/lesson; later answer changes save it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, sessionKey, steps]);

  useEffect(() => {
    if (restoredSessionKey !== sessionKey) return;
    try {
      if (finished) {
        window.sessionStorage.removeItem(sessionKey);
        return;
      }
      const history = new Map(stepHistoryRef.current);
      history.set(stepIndex, { result, selected, matched, arranged });
      window.sessionStorage.setItem(sessionKey, JSON.stringify({
        signature: JSON.stringify(steps),
        stepIndex,
        completionRecorded: completionRecordedRef.current,
        history: [...history].map(([index, snapshot]) => ({
          index,
          ...snapshot,
          matched: [...snapshot.matched],
        })),
      }));
    } catch {
      // In-session Back still works if the browser disables session storage.
    }
  }, [restoredSessionKey, sessionKey, steps, stepIndex, result, selected, matched, arranged, finished]);

  useEffect(() => {
    if (
      !preferences.autoplay ||
      step.type !== "introduce" ||
      !step.word.audioSrc
    ) {
      return;
    }

    const playback = startPhraseAudio(step.word.audioSrc);
    playback?.playback.catch(() => {
      // Manual playback remains available when autoplay is blocked.
    });

    return () => playback?.audio.pause();
  }, [preferences.autoplay, step]);

  const resetStepState = (saved?: LessonStepState) => {
    setResult(saved?.result ?? "idle");
    setSelected(saved?.selected ?? null);
    setMatched(new Set(saved?.matched));
    setLeftSelected(null);
    setRightSelected(null);
    setMismatch(null);
    setArranged(saved?.arranged ?? []);
  };

  const saveStepState = () => {
    stepHistoryRef.current.set(stepIndex, {
      result,
      selected,
      matched: new Set(matched),
      arranged: [...arranged],
    });
  };

  const goBack = () => {
    if (!finished && stepIndex === 0) return;

    pauseActivePhraseAudio();
    if (!finished) saveStepState();
    const previousIndex = finished ? stepIndex : stepIndex - 1;
    setFinished(false);
    setStepIndex(previousIndex);
    resetStepState(stepHistoryRef.current.get(previousIndex));
    window.scrollTo({ top: 0 });
  };

  const restart = () => {
    pauseActivePhraseAudio();
    setStepIndex(0);
    setStepResults({});
    completionRecordedRef.current = false;
    stepHistoryRef.current.clear();
    setFinished(false);
    resetStepState();
  };

  const advance = () => {
    pauseActivePhraseAudio();
    saveStepState();
    if (isLast) {
      setFinished(true);
      if (!completionRecordedRef.current) {
        completionRecordedRef.current = true;
        onComplete(lesson, correctCount, gradedCount);
      }
      return;
    }

    setStepIndex((current) => current + 1);
    resetStepState(stepHistoryRef.current.get(stepIndex + 1));
    window.scrollTo({ top: 0 });
  };

  const recordResult = (correct: boolean) => {
    if (result !== "idle") return;
    setStepResults((current) => ({ ...current, [stepIndex]: correct }));
    setResult(correct ? "correct" : "wrong");
  };

  const leavePractice = () => {
    pauseActivePhraseAudio();
    saveStepState();
    onExit();
  };

  const check = () => {
    if (result !== "idle") return;
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

          <PracticeBackButton onClick={goBack} label="Back to last exercise" />
          <button
            className="primary-button completion-primary"
            onClick={passed ? leavePractice : restart}
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
      <header className="lesson-header practice-header-with-exit">
        <button
          type="button"
          onClick={leavePractice}
          className="text-button practice-exit"
          aria-label="Leave practice"
          title="Your place is saved for this browser session"
        >
          <Icon name="arrow" />
          <span>Back to situations</span>
          <span className="sr-only">. Your place is saved for this browser session.</span>
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
              <div className="lesson-word-copy">
                <PhraseStack
                  word={step.word}
                  showPronunciation={preferences.showPronunciation}
                  size="lesson"
                  spokenAction={
                    <AudioButton
                      word={step.word}
                      notify={notify}
                      className="lesson-primary-audio"
                    />
                  }
                />
                <RegisterAlternatives
                  alternatives={step.word.alternatives}
                  notify={notify}
                  showPronunciation={preferences.showPronunciation}
                  className="lesson-register-alternatives"
                />
              </div>
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
                  usage: step.word.usage,
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
              rightOrder={step.rightOrder}
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

          <div className="lesson-footer-actions">
            <PracticeBackButton
              onClick={goBack}
              disabled={stepIndex === 0}
              label="Back to previous exercise"
            />
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

export default function PalukuApp({
  screen = "today",
  initialLessonId,
  initialPracticeTab,
}: {
  screen?: AppScreen;
  initialLessonId?: string;
  initialPracticeTab?: "bank" | "sentences" | "quiz";
}) {
  const router = useRouter();
  const {
    state,
    setState,
    preferences,
    setPreferences,
    savedWords,
    setSavedWords,
    hydrated,
  } = useLearning();
  const [toast, setToast] = useState<{ message: string; id: number } | null>(
    null,
  );
  const activeLesson = findLesson(initialLessonId);

  // Each notification gets a fresh id so repeating the same message still
  // re-triggers (and re-times) the toast.
  const notify = useCallback((message: string) => {
    setToast({ message, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => {
      pauseActivePhraseAudio();
    };
  }, [screen]);

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
      ...current,
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
        key={activeLesson.id}
        lesson={activeLesson}
        onExit={goToSituations}
        onComplete={completeLesson}
        notify={notify}
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
        notify={notify}
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
        notify={notify}
      />
    );
  } else if (screen === "practice") {
    content = <AppShell screen="practice"><PracticeHub notify={notify} initialTab={initialPracticeTab} /></AppShell>;
  } else if (screen === "practice-live") {
    content = (
      <AppShell screen="practice-live">
        <PracticeLive />
      </AppShell>
    );
  } else if (screen === "settings") {
    content = (
      <SettingsView
        preferences={preferences}
        setPreferences={setPreferences}
      />
    );
  } else {
    content = (
      <TodayView
        state={state}
        notify={notify}
        showPronunciation={preferences.showPronunciation}
      />
    );
  }

  return (
    <>
      {content}
      {toast ? (
        <div className="toast" role="status" key={toast.id}>
          {toast.message}
        </div>
      ) : null}
    </>
  );
}
