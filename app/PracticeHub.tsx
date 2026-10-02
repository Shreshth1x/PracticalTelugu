"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLearning } from "./LearningProvider";
import { resolveTeluguFormUsage, type TeluguWord } from "./course-data";
import {
  buildDailyQuiz,
  localDay,
  normalizeAnswer,
  recordQuizDay,
  sentenceEntries,
  sentenceMatches,
  shuffledTokens,
  streakForDays,
  vocabularyEntries,
  vocabularyTopics,
  validateQuizQuestions,
  type QuizQuestion,
  type VocabularyEntry,
} from "./review-data";

type HubTab = "bank" | "sentences" | "quiz";
type Direction = "to-telugu" | "to-english";
type QuizAnswer = { optionId: string; correct: boolean };
type QuizDraft = {
  version: 1;
  day: string;
  questions: QuizQuestion[];
  answers: Record<string, QuizAnswer>;
  position: number;
};
type SentenceDraft = {
  key: string;
  direction: Direction;
  mode: "arrange" | "type";
  arranged: number[];
  typed: string;
  checked: boolean;
};

const tabs: { id: HubTab; title: string }[] = [
  { id: "bank", title: "Vocabulary bank" },
  { id: "sentences", title: "Build sentences" },
  { id: "quiz", title: "Daily quiz" },
];
const entryMap = new Map(vocabularyEntries.map((word) => [word.key, word]));
const topicMap = new Map(
  vocabularyTopics.map((topic) => [topic.id, topic.title]),
);
const tabRoutes: Record<HubTab, string> = {
  bank: "/practice",
  sentences: "/practice/sentences",
  quiz: "/practice/quiz",
};
const emptySentence = (): SentenceDraft => ({
  key: sentenceEntries[0]?.key ?? "",
  direction: "to-telugu",
  mode: "arrange",
  arranged: [],
  typed: "",
  checked: false,
});

function plainSearch(value: string) {
  return value.normalize("NFC").toLocaleLowerCase().trim();
}

function parseQuizDraft(value: unknown, day: string): QuizDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<QuizDraft>;
  if (draft.version !== 1 || draft.day !== day) return null;
  const questions = validateQuizQuestions(day, draft.questions);
  if (!questions) return null;
  const answers: Record<string, QuizAnswer> = {};
  if (draft.answers && typeof draft.answers === "object") {
    for (const question of questions) {
      const answer = draft.answers[question.id];
      if (
        answer &&
        typeof answer.optionId === "string" &&
        question.options.some((option) => option.id === answer.optionId)
      ) {
        answers[question.id] = {
          optionId: answer.optionId,
          correct: answer.optionId === question.answerId,
        };
      }
    }
  }
  return {
    version: 1,
    day,
    questions,
    answers,
    position: Number.isInteger(draft.position)
      ? Math.max(0, Math.min(9, draft.position!))
      : 0,
  };
}

function parseSentenceDraft(value: unknown): SentenceDraft {
  const fallback = emptySentence();
  if (!value || typeof value !== "object") return fallback;
  const draft = value as Partial<SentenceDraft>;
  const word = sentenceEntries.find((entry) => entry.key === draft.key);
  if (!word) return fallback;
  const direction =
    draft.direction === "to-english" ? "to-english" : "to-telugu";
  const count = (direction === "to-english" ? word.english : word.roman)
    .trim()
    .split(/\s+/).length;
  const arranged = Array.isArray(draft.arranged)
    ? [
        ...new Set(
          draft.arranged.filter(
            (index): index is number =>
              Number.isInteger(index) && index >= 0 && index < count,
          ),
        ),
      ]
    : [];
  return {
    key: word.key,
    direction,
    mode: draft.mode === "type" ? "type" : "arrange",
    arranged,
    typed: typeof draft.typed === "string" ? draft.typed.slice(0, 500) : "",
    checked: draft.checked === true,
  };
}

function readStorage(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function quizAnswerWord(
  question: QuizQuestion,
  word: VocabularyEntry,
): TeluguWord {
  if (question.kind !== "usage" || word.roman === question.answerId)
    return word;
  const alternative = word.alternatives?.find(
    (form) => form.roman === question.answerId,
  );
  return alternative ? { ...word, ...alternative, note: undefined } : word;
}

function SoundIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M11 4 5 9H2v6h3l6 5V4Z" strokeLinejoin="round" />
      <path
        d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PhraseCopy({
  word,
  pronunciation = true,
}: {
  word: TeluguWord;
  pronunciation?: boolean;
}) {
  return (
    <div className="hub-phrase-copy">
      <span lang="te" className="hub-telugu">
        {word.telugu}
      </span>
      <strong lang="te-Latn">{word.roman}</strong>
      {pronunciation ? <small>Say it like: {word.pronunciation}</small> : null}
    </div>
  );
}

function PhraseContext({ word }: { word: TeluguWord }) {
  const usage = resolveTeluguFormUsage(word.usage);
  return (
    <div className="hub-phrase-context">
      {word.note ? <p>{word.note}</p> : null}
      <p className="hub-listener-note">
        <strong>{usage.label}.</strong> {usage.guidance}
      </p>
    </div>
  );
}

function TopicSelect({
  value,
  onChange,
  id,
  options = vocabularyTopics,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  options?: { id: string; title: string }[];
}) {
  return (
    <label className="hub-field" htmlFor={id}>
      <span>Topic</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">All topics</option>
        {options.map((topic) => (
          <option key={topic.id} value={topic.id}>
            {topic.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PracticeHub({
  notify,
  initialTab = "bank",
}: {
  notify: (message: string) => void;
  initialTab?: HubTab;
}) {
  const {
    state,
    setState,
    preferences,
    savedWords,
    setSavedWords,
    hydrated,
    user,
    authReady,
    cloudReady,
  } = useLearning();
  const router = useRouter();
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("all");
  const [bankFilter, setBankFilter] = useState<"all" | "practiced" | "saved">(
    "all",
  );
  const [sentenceTopic, setSentenceTopic] = useState("all");
  const [sentence, setSentence] = useState<SentenceDraft>(emptySentence);
  const [bankOpen, setBankOpen] = useState(false);
  const [day, setDay] = useState("");
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [draftScope, setDraftScope] = useState("");
  const [quizActive, setQuizActive] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const priorCompletedDay = useRef<string | null>(null);
  const scope = authReady && day ? `${user?.id ?? "anonymous"}:${day}` : "";
  const ready = hydrated && authReady && Boolean(scope) && draftScope === scope;
  const quizReady = ready && (!user || cloudReady);

  useEffect(() => {
    // Route navigation can retain this component while selecting another tool.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(initialTab);
  }, [initialTab]);

  const openTab = (nextTab: HubTab) => {
    audioRef.current?.pause();
    setTab(nextTab);
    router.replace(tabRoutes[nextTab], { scroll: false });
  };

  useEffect(() => {
    const updateDay = () => setDay(localDay());
    updateDay();
    const interval = window.setInterval(updateDay, 30_000);
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateDay);
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!scope || !hydrated) return;
    let restoredQuiz: QuizDraft | null = null;
    let restoredSentence = emptySentence();
    let failed = false;
    try {
      restoredQuiz = parseQuizDraft(
        readStorage(`palukulu.quiz-draft.v1:${scope}`),
        day,
      );
      restoredSentence = parseSentenceDraft(
        readStorage(`palukulu.sentence-draft.v1:${user?.id ?? "anonymous"}`),
      );
    } catch {
      failed = true;
    }
    // These drafts are external browser state, scoped after auth has resolved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(restoredQuiz);
    setSentence(restoredSentence);
    setQuizActive(false);
    setSelectedOption(null);
    setReviewOnly(false);
    setStorageError(failed);
    setDraftScope(scope);
    priorCompletedDay.current = null;
  }, [day, hydrated, scope, user?.id]);

  useEffect(() => {
    if (!ready) return;
    try {
      const key = `palukulu.quiz-draft.v1:${scope}`;
      if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
      else window.localStorage.removeItem(key);
      window.localStorage.setItem(
        `palukulu.sentence-draft.v1:${user?.id ?? "anonymous"}`,
        JSON.stringify(sentence),
      );
    } catch {
      // Practice remains available when the browser cannot retain a draft.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageError(true);
    }
  }, [draft, ready, scope, sentence, user?.id]);

  const dayResult = day ? state.reviewDays?.[day] : undefined;
  useEffect(() => {
    if (!ready) return;
    if (priorCompletedDay.current === day && !dayResult) {
      // A progress reset must also remove this day's completed local exercise.
      setDraft(null);
      setQuizActive(false);
      setSelectedOption(null);
      setReviewOnly(false);
      setSentence(emptySentence());
    }
    priorCompletedDay.current = dayResult ? day : null;
  }, [day, dayResult, ready]);

  const played = async (word: Pick<TeluguWord, "audioSrc">) => {
    if (!word.audioSrc) {
      notify("A recording is not available for this phrase yet.");
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(word.audioSrc);
    audioRef.current = audio;
    try {
      await audio.play();
    } catch {
      notify("The recording could not play. Please try again.");
    }
  };

  const audioButton = (
    word: Pick<TeluguWord, "audioSrc">,
    label = "Listen",
  ) => (
    <button
      type="button"
      className="audio-button hub-audio"
      onClick={() => void played(word)}
      disabled={!word.audioSrc}
    >
      <SoundIcon /> {label}
    </button>
  );

  const saveWord = (word: VocabularyEntry) => {
    const saved = savedWords.includes(word.key);
    setSavedWords((current) =>
      current.includes(word.key)
        ? current.filter((key) => key !== word.key)
        : [...current, word.key],
    );
    notify(
      saved
        ? "Phrase removed from your saved bank."
        : "Phrase saved to your bank.",
    );
  };

  const isPracticed = (word: VocabularyEntry) =>
    Boolean(state.confidence[word.key]) ||
    word.lessonIds.some((id) => state.completed.includes(id));
  const savedSet = new Set(savedWords);
  const visibleWords = vocabularyEntries.filter((word) => {
    if (topic !== "all" && !word.lessonIds.includes(topic)) return false;
    if (bankFilter === "saved" && !savedSet.has(word.key)) return false;
    if (bankFilter === "practiced" && !isPracticed(word)) return false;
    const search = plainSearch(query);
    const searchable = [
      word.english,
      word.roman,
      word.telugu,
      word.pronunciation,
      word.note,
      ...word.lessonIds.map((id) => topicMap.get(id)),
      ...(word.alternatives ?? []).flatMap((form) => [
        form.roman,
        form.telugu,
        form.pronunciation,
        form.label,
      ]),
    ].join(" ");
    return !search || plainSearch(searchable).includes(search);
  });
  const groupedWords =
    topic === "all"
      ? vocabularyTopics
          .map((group) => ({
            ...group,
            words: visibleWords.filter((word) => word.topicId === group.id),
          }))
          .filter((group) => group.words.length > 0)
      : [
          {
            id: topic,
            title: topicMap.get(topic) ?? "Selected topic",
            words: visibleWords,
          },
        ].filter((group) => group.words.length > 0);
  const practicedCount = vocabularyEntries.filter(isPracticed).length;
  const sentencePool = sentenceEntries.filter(
    (word) => sentenceTopic === "all" || word.lessonIds.includes(sentenceTopic),
  );
  const sentenceWord =
    sentenceEntries.find((word) => word.key === sentence.key) ??
    sentencePool[0];
  const sentencePosition = sentenceWord
    ? sentencePool.findIndex((word) => word.key === sentenceWord.key)
    : -1;
  const target = sentenceWord
    ? sentence.direction === "to-telugu"
      ? sentenceWord.roman
      : sentenceWord.english
    : "";
  const tokens = shuffledTokens(
    target,
    `${sentence.key}:${sentence.direction}`,
  );
  const sentenceAnswer =
    sentence.mode === "type"
      ? sentence.typed
      : sentence.arranged.map((index) => tokens[index]).join(" ");
  const sentenceCorrect = sentenceWord
    ? sentenceMatches(sentenceWord, sentenceAnswer, sentence.direction)
    : false;
  const matchedAlternative =
    sentenceCorrect && sentence.direction === "to-telugu"
      ? sentenceWord?.alternatives?.find((form) =>
          [form.roman, form.telugu].some(
            (value) =>
              normalizeAnswer(value) === normalizeAnswer(sentenceAnswer),
          ),
        )
      : undefined;
  const sentenceFeedbackWord =
    sentenceWord && matchedAlternative
      ? { ...sentenceWord, ...matchedAlternative, note: undefined }
      : sentenceWord;
  const sentenceHasAnswer =
    sentence.mode === "type"
      ? sentence.typed.trim().length > 0
      : sentence.arranged.length === tokens.length;
  const changeSentence = (
    word: VocabularyEntry,
    direction = sentence.direction,
  ) => {
    audioRef.current?.pause();
    setSentence({
      key: word.key,
      direction,
      mode: sentence.mode,
      arranged: [],
      typed: "",
      checked: false,
    });
  };
  const filterSentences = (nextTopic: string) => {
    setSentenceTopic(nextTopic);
    const next = sentenceEntries.find(
      (word) => nextTopic === "all" || word.lessonIds.includes(nextTopic),
    );
    if (next) changeSentence(next);
  };

  const checkSentence = () => {
    if (!sentenceWord || !sentenceHasAnswer) return;
    setSentence((current) => ({ ...current, checked: true }));
    setState((current) =>
      current.confidence[sentenceWord.key]
        ? current
        : {
            ...current,
            confidence: {
              ...current.confidence,
              [sentenceWord.key]: "learning",
            },
          },
    );
  };

  const quizComplete = Boolean(
    draft && draft.questions.every((question) => draft.answers[question.id]),
  );
  const quizScore = draft
    ? Object.values(draft.answers).filter((answer) => answer.correct).length
    : 0;
  const answeredCount = draft ? Object.keys(draft.answers).length : 0;
  const wrongQuestions =
    draft?.questions.filter(
      (question) => draft.answers[question.id]?.correct === false,
    ) ?? [];
  const currentQuestion = draft?.questions[draft.position];
  const currentAnswer = currentQuestion
    ? draft?.answers[currentQuestion.id]
    : undefined;
  const currentWord = currentQuestion
    ? entryMap.get(currentQuestion.wordKey)
    : undefined;
  const feedbackWord =
    currentQuestion && currentWord
      ? quizAnswerWord(currentQuestion, currentWord)
      : undefined;
  const nextUnansweredPosition =
    draft?.questions.findIndex(
      (question) =>
        !draft.answers[question.id] && question.id !== currentQuestion?.id,
    ) ?? -1;
  const beginQuiz = () => {
    if (!quizReady) return;
    if (!draft) {
      setDraft({
        version: 1,
        day,
        questions: buildDailyQuiz(day, state, savedWords),
        answers: {},
        position: 0,
      });
    }
    setQuizActive(true);
    setReviewOnly(false);
    setSelectedOption(null);
  };
  const checkQuiz = () => {
    if (
      !quizReady ||
      !draft ||
      !currentQuestion ||
      !selectedOption ||
      currentAnswer
    )
      return;
    const correct = selectedOption === currentQuestion.answerId;
    const next: QuizDraft = {
      ...draft,
      answers: {
        ...draft.answers,
        [currentQuestion.id]: { optionId: selectedOption, correct },
      },
    };
    setDraft(next);
    setState((current) => {
      const withPractice = current.confidence[currentQuestion.wordKey]
        ? current
        : {
            ...current,
            confidence: {
              ...current.confidence,
              [currentQuestion.wordKey]: "learning" as const,
            },
          };
      if (!next.questions.every((question) => next.answers[question.id]))
        return withPractice;
      const score = Object.values(next.answers).filter(
        (answer) => answer.correct,
      ).length;
      return recordQuizDay(withPractice, day, score);
    });
  };
  const moveQuiz = (position: number) => {
    audioRef.current?.pause();
    setDraft((current) => (current ? { ...current, position } : current));
    setSelectedOption(null);
  };
  const tabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    openTab(tabs[next].id);
    document.getElementById(`hub-tab-${tabs[next].id}`)?.focus();
  };
  const streak = day ? streakForDays(state.reviewDays, day) : 0;

  return (
    <main className="page practice-hub">
      <header className="page-header hub-header">
        <div>
          <h1>Put your Telugu to use.</h1>
          <p>
            Find a phrase, build a sentence, and come back for a little practice
            each day.
          </p>
        </div>
        <div
          className="hub-streak"
          aria-label={`${streak} day quiz streak. ${dayResult ? "Today's quiz complete" : "Today's quiz ready"}`}
        >
          <span aria-hidden="true" className="hub-streak-mark">
            ✦
          </span>
          <strong>
            {streak} <span>day{streak === 1 ? "" : "s"}</span>
          </strong>
          <small>
            {dayResult ? "Today’s quiz complete" : "Your daily quiz streak"}
          </small>
        </div>
      </header>

      <div className="hub-tabs" role="tablist" aria-label="Practice tools">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`hub-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`hub-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={(event) => tabKeyDown(event, index)}
            onClick={() => openTab(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {storageError ? (
        <p className="hub-storage-notice" role="status">
          You can keep practicing. This browser could not save your unfinished
          work, so keep this page open to retain it.
        </p>
      ) : null}
      {!ready ? (
        <p className="hub-loading" role="status">
          Bringing back your practice…
        </p>
      ) : (
        <>
          {tab === "bank" ? (
            <section
              id="hub-panel-bank"
              role="tabpanel"
              aria-labelledby="hub-tab-bank"
              className="hub-panel"
            >
              <div className="hub-section-heading">
                <div>
                  <h2>Your words, all in one place.</h2>
                  <p>
                    Keep the phrases you’re learning close by. Open one to see
                    where it fits.
                  </p>
                </div>
                <span className="hub-small-count">
                  {practicedCount} of {vocabularyEntries.length} practiced
                </span>
              </div>
              <div className="hub-bank-controls">
                <label
                  className="hub-field hub-search"
                  htmlFor="hub-vocabulary-search"
                >
                  <span>Find a word or phrase</span>
                  <input
                    id="hub-vocabulary-search"
                    type="search"
                    value={query}
                    placeholder="English, Telugu, or English letters"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <TopicSelect
                  id="hub-bank-topic"
                  value={topic}
                  onChange={setTopic}
                />
              </div>
              <div className="hub-bank-meta">
                <div
                  className="hub-filter-pills"
                  aria-label="Vocabulary filters"
                >
                  {(["all", "practiced", "saved"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={bankFilter === filter}
                      onClick={() => setBankFilter(filter)}
                    >
                      {filter === "all"
                        ? "All phrases"
                        : filter === "practiced"
                          ? "Practiced"
                          : "Saved"}
                      {filter === "saved" ? ` · ${savedWords.length}` : ""}
                    </button>
                  ))}
                </div>
                <span aria-live="polite">
                  {visibleWords.length} phrase
                  {visibleWords.length === 1 ? "" : "s"}
                </span>
              </div>
              {groupedWords.length ? (
                groupedWords.map((group) => (
                  <section
                    key={group.id}
                    className="hub-word-group"
                    aria-labelledby={`hub-group-${group.id}`}
                  >
                    <div className="hub-group-heading">
                      <h3 id={`hub-group-${group.id}`}>{group.title}</h3>
                      <span>{group.words.length}</span>
                    </div>
                    <div className="hub-word-grid">
                      {group.words.map((word) => (
                        <article key={word.key} className="hub-word-card">
                          <details>
                            <summary>
                              <span className="hub-card-english">
                                {word.english}
                              </span>
                              <span lang="te-Latn" className="hub-card-roman">
                                {word.roman}
                              </span>
                              <span lang="te" className="hub-card-telugu">
                                {word.telugu}
                              </span>
                              <span className="hub-card-expand">
                                When to use it{" "}
                                <span aria-hidden="true">↗</span>
                              </span>
                            </summary>
                            <div className="hub-card-details">
                              {preferences.showPronunciation ? (
                                <p className="hub-pronunciation">
                                  Say it like: {word.pronunciation}
                                </p>
                              ) : null}
                              <PhraseContext word={word} />
                              {word.alternatives?.length ? (
                                <div className="hub-alternatives">
                                  <h4>Another way to say it</h4>
                                  {word.alternatives.map((alternative) => (
                                    <div key={alternative.telugu}>
                                      <span className="hub-alternative-label">
                                        {alternative.label}
                                      </span>
                                      <PhraseCopy
                                        word={{ ...word, ...alternative }}
                                        pronunciation={
                                          preferences.showPronunciation
                                        }
                                      />
                                      <PhraseContext
                                        word={{
                                          ...word,
                                          ...alternative,
                                          note: undefined,
                                        }}
                                      />
                                      {audioButton(
                                        alternative,
                                        "Hear this version",
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <Link
                                href={`/lesson/${word.lessonIds[0]}`}
                                className="text-link"
                              >
                                Open this lesson{" "}
                                <span aria-hidden="true">→</span>
                              </Link>
                            </div>
                          </details>
                          <div className="hub-card-actions">
                            {audioButton(word)}
                            <button
                              type="button"
                              className={`hub-save ${savedSet.has(word.key) ? "hub-save-active" : ""}`}
                              aria-pressed={savedSet.has(word.key)}
                              aria-label={`${savedSet.has(word.key) ? "Unsave" : "Save"} ${word.english}`}
                              onClick={() => saveWord(word)}
                            >
                              <span aria-hidden="true">
                                {savedSet.has(word.key) ? "★" : "☆"}
                              </span>
                              {savedSet.has(word.key) ? "Saved" : "Save"}
                            </button>
                            {isPracticed(word) ? (
                              <span className="hub-practiced-mark">
                                Practiced
                              </span>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="hub-empty">
                  <h3>
                    {bankFilter === "saved"
                      ? "Your saved bank starts here."
                      : bankFilter === "practiced"
                        ? "A place for what you’ve practiced."
                        : "No matching phrases yet."}
                  </h3>
                  <p>
                    {bankFilter === "saved"
                      ? "Choose All phrases and save the ones you want to keep close."
                      : bankFilter === "practiced"
                        ? "Phrases from lessons you complete and words you practice will appear here."
                        : "Try a different spelling or choose All topics."}
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setQuery("");
                      setTopic("all");
                      setBankFilter("all");
                    }}
                  >
                    Show all phrases
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {tab === "sentences" ? (
            <section
              id="hub-panel-sentences"
              role="tabpanel"
              aria-labelledby="hub-tab-sentences"
              className="hub-panel"
            >
              <div className="hub-section-heading">
                <div>
                  <h2>Let the words fall into place.</h2>
                  <p>
                    Practice useful sentences from your bank, one thought at a
                    time.
                  </p>
                </div>
              </div>
              <div className="hub-sentence-controls">
                <TopicSelect
                  id="hub-sentence-topic"
                  value={sentenceTopic}
                  onChange={filterSentences}
                  options={vocabularyTopics.filter((item) =>
                    sentenceEntries.some((word) =>
                      word.lessonIds.includes(item.id),
                    ),
                  )}
                />
                <label className="hub-field" htmlFor="hub-sentence-choice">
                  <span>Sentence to practice</span>
                  <select
                    id="hub-sentence-choice"
                    value={sentenceWord?.key ?? ""}
                    onChange={(event) => {
                      const word = sentencePool.find(
                        (entry) => entry.key === event.target.value,
                      );
                      if (word) changeSentence(word);
                    }}
                  >
                    {sentencePool.map((word, index) => (
                      <option key={word.key} value={word.key}>
                        {index + 1}. {word.english}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {sentenceWord ? (
                <div className="hub-exercise">
                  <div className="hub-exercise-top">
                    <span className="hub-eyebrow">
                      {sentenceTopic === "all"
                        ? sentenceWord.topicTitle
                        : topicMap.get(sentenceTopic)}
                    </span>
                    <span>
                      {sentencePosition + 1} / {sentencePool.length}
                    </span>
                  </div>
                  <div
                    className="hub-direction"
                    aria-label="Translation direction"
                  >
                    {(["to-telugu", "to-english"] as const).map((direction) => (
                      <button
                        key={direction}
                        aria-pressed={sentence.direction === direction}
                        onClick={() => changeSentence(sentenceWord, direction)}
                      >
                        {direction === "to-telugu"
                          ? "English → Telugu"
                          : "Telugu → English"}
                      </button>
                    ))}
                  </div>
                  <h3
                    className={`hub-sentence-prompt ${sentence.direction === "to-english" ? "hub-telugu" : ""}`}
                    lang={sentence.direction === "to-english" ? "te" : "en"}
                  >
                    {sentence.direction === "to-telugu"
                      ? sentenceWord.english
                      : sentenceWord.telugu}
                  </h3>
                  {sentence.direction === "to-english" ? (
                    <p className="hub-prompt-roman" lang="te-Latn">
                      {sentenceWord.roman}
                    </p>
                  ) : null}
                  <div className="hub-answer-mode" aria-label="Answer style">
                    <button
                      aria-pressed={sentence.mode === "arrange"}
                      onClick={() =>
                        setSentence((current) => ({
                          ...current,
                          mode: "arrange",
                          checked: false,
                        }))
                      }
                    >
                      Arrange words
                    </button>
                    <button
                      aria-pressed={sentence.mode === "type"}
                      onClick={() =>
                        setSentence((current) => ({
                          ...current,
                          mode: "type",
                          checked: false,
                        }))
                      }
                    >
                      Type it yourself
                    </button>
                  </div>
                  <p className="hub-answer-hint">
                    {sentence.mode === "arrange"
                      ? `Choose the words in order to build the ${sentence.direction === "to-telugu" ? "Telugu sentence in English letters" : "English sentence"}.`
                      : sentence.direction === "to-telugu"
                        ? "Write in Telugu script or English letters."
                        : "Write the meaning in English."}
                  </p>
                  {sentence.mode === "arrange" ? (
                    <>
                      <div
                        className="hub-answer-tray"
                        aria-label="Your sentence"
                      >
                        <span className="sr-only">
                          Choose a word again to remove it.
                        </span>
                        {sentence.arranged.length ? (
                          sentence.arranged.map((index, position) => (
                            <button
                              key={index}
                              className="hub-token"
                              aria-label={`Remove ${tokens[index]} from position ${position + 1}`}
                              onClick={() =>
                                setSentence((current) => ({
                                  ...current,
                                  arranged: current.arranged.filter(
                                    (item) => item !== index,
                                  ),
                                  checked: false,
                                }))
                              }
                            >
                              {tokens[index]}
                            </button>
                          ))
                        ) : (
                          <span className="hub-tray-placeholder">
                            Your sentence goes here
                          </span>
                        )}
                      </div>
                      <div
                        className="hub-token-bank"
                        aria-label="Available words"
                      >
                        {tokens.map((token, index) => (
                          <button
                            key={index}
                            className="hub-token"
                            disabled={sentence.arranged.includes(index)}
                            onClick={() =>
                              setSentence((current) => ({
                                ...current,
                                arranged: [...current.arranged, index],
                                checked: false,
                              }))
                            }
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <label
                      className="hub-typed-answer"
                      htmlFor="hub-written-sentence"
                    >
                      <span className="sr-only">Your translation</span>
                      <textarea
                        id="hub-written-sentence"
                        value={sentence.typed}
                        maxLength={500}
                        rows={3}
                        placeholder={
                          sentence.direction === "to-telugu"
                            ? "Mee… / మీ…"
                            : "Your English translation…"
                        }
                        onChange={(event) =>
                          setSentence((current) => ({
                            ...current,
                            typed: event.target.value,
                            checked: false,
                          }))
                        }
                      />
                    </label>
                  )}
                  <div className="hub-check-actions">
                    <button
                      className="primary-button"
                      disabled={!sentenceHasAnswer || sentence.checked}
                      onClick={checkSentence}
                    >
                      Check sentence
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        setSentence((current) => ({
                          ...current,
                          arranged: [],
                          typed: "",
                          checked: false,
                        }))
                      }
                    >
                      Start again
                    </button>
                    <button
                      className="text-button hub-reference-toggle"
                      aria-expanded={bankOpen}
                      aria-controls="hub-sentence-reference"
                      onClick={() => setBankOpen((current) => !current)}
                    >
                      {bankOpen ? "Close bank" : "Look at my bank"}
                    </button>
                  </div>
                  {sentence.checked ? (
                    <div
                      className={`hub-feedback ${sentenceCorrect ? "hub-feedback-correct" : "hub-feedback-review"}`}
                      role="status"
                    >
                      <strong>
                        {sentenceCorrect
                          ? "That sentence fits."
                          : sentence.mode === "type"
                            ? "Here’s the phrase we’re practicing."
                            : "Let’s try that order again."}
                      </strong>
                      {!sentenceCorrect && sentence.mode === "type" ? (
                        <p>
                          Other translations may also work. This exercise checks
                          the phrases in your bank.
                        </p>
                      ) : null}
                      <p className="hub-correct-meaning">
                        {sentenceWord.english}
                      </p>
                      <PhraseCopy
                        word={sentenceFeedbackWord!}
                        pronunciation={preferences.showPronunciation}
                      />
                      <PhraseContext word={sentenceFeedbackWord!} />
                      {audioButton(sentenceFeedbackWord!, "Hear the sentence")}
                    </div>
                  ) : null}
                  {bankOpen ? (
                    <aside
                      id="hub-sentence-reference"
                      className="hub-sentence-reference"
                      aria-label="Vocabulary bank reference"
                    >
                      <h4>A little help from your bank</h4>
                      <p>
                        Use these complete phrases as a reference. The wording
                        and endings depend on who you’re speaking to.
                      </p>
                      {sentencePool
                        .filter((word) =>
                          word.lessonIds.includes(
                            sentenceTopic === "all"
                              ? sentenceWord.topicId
                              : sentenceTopic,
                          ),
                        )
                        .map((word) => (
                          <div key={word.key}>
                            <span>{word.english}</span>
                            <strong lang="te-Latn">{word.roman}</strong>
                            <span lang="te" className="hub-telugu">
                              {word.telugu}
                            </span>
                          </div>
                        ))}
                    </aside>
                  ) : null}
                  <footer className="hub-exercise-footer">
                    <button
                      className="secondary-button"
                      disabled={sentencePosition <= 0}
                      onClick={() =>
                        changeSentence(sentencePool[sentencePosition - 1])
                      }
                    >
                      ← Back
                    </button>
                    <span>Move at your own pace.</span>
                    <button
                      className="secondary-button"
                      disabled={sentencePosition >= sentencePool.length - 1}
                      onClick={() =>
                        changeSentence(sentencePool[sentencePosition + 1])
                      }
                    >
                      Next →
                    </button>
                  </footer>
                </div>
              ) : (
                <p>No complete sentences are available in this topic yet.</p>
              )}
            </section>
          ) : null}

          {tab === "quiz" ? (
            <section
              id="hub-panel-quiz"
              role="tabpanel"
              aria-labelledby="hub-tab-quiz"
              className="hub-panel"
            >
              {!quizActive || !draft ? (
                <div className="hub-quiz-intro">
                  <div className="hub-quiz-intro-copy">
                    <span className="hub-eyebrow">A LITTLE EVERY DAY</span>
                    <h2>
                      Ten questions.
                      <br />A little more familiar.
                    </h2>
                    <p>
                      Mix meanings, translations, listening, and when to use a
                      phrase. Finish today’s quiz to add a day to your streak.
                    </p>
                    <div className="hub-quiz-facts">
                      <span>10 questions</span>
                      <span>About 3 minutes</span>
                      <span>Pause any time</span>
                    </div>
                    {dayResult ? (
                      <p className="hub-completed-note">
                        Today is already counted. Your saved result is{" "}
                        {dayResult.score} / 10.
                      </p>
                    ) : draft ? (
                      <p className="hub-completed-note">
                        Your place is saved: {answeredCount} of 10 answered.
                      </p>
                    ) : null}
                    <button
                      className="primary-button"
                      disabled={!quizReady}
                      onClick={beginQuiz}
                    >
                      {!quizReady
                        ? "Restoring your quiz progress…"
                        : draft
                          ? quizComplete
                            ? "See quiz results"
                            : "Resume today’s quiz"
                          : dayResult
                            ? "Practice today’s quiz again"
                            : "Start today’s quiz"}
                    </button>
                    <p className="hub-quiz-footnote">
                      A completed quiz counts once per calendar day on your
                      device.
                    </p>
                  </div>
                  <div className="hub-quiz-art" aria-hidden="true">
                    <span>మాట</span>
                    <div>మళ్లీ</div>
                    <span>చెప్పండి</span>
                    <small>one day at a time</small>
                  </div>
                </div>
              ) : quizComplete ? (
                <div className="hub-quiz-complete">
                  <span className="hub-eyebrow">TODAY, PRACTICED</span>
                  <h2>
                    {quizScore === 10
                      ? "Ten little wins."
                      : "That’s a little more Telugu."}
                  </h2>
                  <p className="hub-score">
                    <strong>{quizScore}</strong>
                    <span>/ 10</span>
                  </p>
                  <p>
                    You finished today’s quiz.{" "}
                    {dayResult
                      ? "Your day is counted in your streak."
                      : "This practice is finished on this device. Finish a fresh run to count today."}{" "}
                    Come back tomorrow for a fresh set.
                  </p>
                  <div className="hub-completion-actions">
                    {!dayResult ? (
                      <button
                        className="secondary-button"
                        disabled={!quizReady}
                        onClick={() => {
                          setDraft({ ...draft, answers: {}, position: 0 });
                          setSelectedOption(null);
                          setReviewOnly(false);
                        }}
                      >
                        Start a fresh run
                      </button>
                    ) : null}
                    {wrongQuestions.length ? (
                      <button
                        className="secondary-button"
                        aria-expanded={reviewOnly}
                        onClick={() => setReviewOnly((current) => !current)}
                      >
                        {reviewOnly
                          ? "Close review"
                          : `Review ${wrongQuestions.length} to revisit`}
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      onClick={() => openTab("sentences")}
                    >
                      Build a sentence
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuizActive(false);
                        setReviewOnly(false);
                      }}
                    >
                      Back to quiz overview
                    </button>
                  </div>
                  {reviewOnly ? (
                    <div className="hub-quiz-review">
                      {wrongQuestions.map((question, index) => {
                        const word = quizAnswerWord(
                          question,
                          entryMap.get(question.wordKey)!,
                        );
                        const answer = draft.answers[question.id];
                        return (
                          <article key={question.id}>
                            <span className="hub-eyebrow">
                              REVISIT {index + 1}
                            </span>
                            <h3>{question.prompt}</h3>
                            <p>
                              You chose:{" "}
                              {
                                question.options.find(
                                  (option) => option.id === answer.optionId,
                                )?.label
                              }
                            </p>
                            <p>
                              <strong>
                                Answer:{" "}
                                {
                                  question.options.find(
                                    (option) => option.id === question.answerId,
                                  )?.label
                                }
                              </strong>
                            </p>
                            <PhraseCopy
                              word={word}
                              pronunciation={preferences.showPronunciation}
                            />
                            <p>{question.explanation}</p>
                            {audioButton(word)}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : currentQuestion && currentWord ? (
                <div className="hub-exercise hub-quiz-exercise">
                  <div className="hub-exercise-top">
                    <span className="hub-eyebrow">
                      {currentQuestion.kind === "usage"
                        ? "WHEN TO USE IT"
                        : currentQuestion.kind === "listening"
                          ? "LISTENING"
                          : currentQuestion.kind === "translation"
                            ? "TRANSLATION"
                            : "MEANING"}
                    </span>
                    <span>Question {draft.position + 1} of 10</span>
                  </div>
                  <progress
                    className="hub-quiz-progress"
                    value={answeredCount}
                    max={10}
                    aria-label={`${answeredCount} of 10 questions answered`}
                  />
                  <h2 className="hub-quiz-prompt">{currentQuestion.prompt}</h2>
                  {currentQuestion.kind === "listening" ? (
                    <div className="hub-listening-prompt">
                      {audioButton(
                        { audioSrc: currentQuestion.audioSrc },
                        "Play the phrase",
                      )}
                      <p>Listen as many times as you need.</p>
                    </div>
                  ) : null}
                  <div
                    className="hub-quiz-options"
                    role="radiogroup"
                    aria-label="Choose an answer"
                  >
                    {currentQuestion.options.map((option, index) => (
                      <label
                        key={option.id}
                        className={`hub-quiz-option ${selectedOption === option.id || currentAnswer?.optionId === option.id ? "hub-option-selected" : ""} ${currentAnswer && option.id === currentQuestion.answerId ? "hub-option-correct" : ""} ${currentAnswer && !currentAnswer.correct && option.id === currentAnswer.optionId ? "hub-option-review" : ""}`}
                      >
                        <input
                          type="radio"
                          name={currentQuestion.id}
                          value={option.id}
                          checked={
                            currentAnswer
                              ? currentAnswer.optionId === option.id
                              : selectedOption === option.id
                          }
                          disabled={Boolean(currentAnswer)}
                          onChange={() => setSelectedOption(option.id)}
                        />
                        <span className="hub-option-letter" aria-hidden="true">
                          {String.fromCharCode(65 + index)}
                        </span>
                        <span>{option.label}</span>
                        {currentAnswer &&
                        option.id === currentQuestion.answerId ? (
                          <span className="sr-only">Correct answer</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  {currentAnswer ? (
                    <div
                      className={`hub-feedback ${currentAnswer.correct ? "hub-feedback-correct" : "hub-feedback-review"}`}
                      role="status"
                    >
                      <strong>
                        {currentAnswer.correct
                          ? "You’ve got it."
                          : "Keep this one close."}
                      </strong>
                      <p>{currentQuestion.explanation}</p>
                      <PhraseCopy
                        word={feedbackWord!}
                        pronunciation={preferences.showPronunciation}
                      />
                      <p className="hub-correct-meaning">
                        {currentWord.english}
                      </p>
                      {audioButton(feedbackWord!, "Hear it again")}
                    </div>
                  ) : (
                    <div className="hub-check-actions">
                      <button
                        className="primary-button"
                        disabled={!selectedOption || !quizReady}
                        onClick={checkQuiz}
                      >
                        Check answer
                      </button>
                    </div>
                  )}
                  <footer className="hub-exercise-footer">
                    <button
                      className="secondary-button"
                      disabled={draft.position === 0}
                      onClick={() => moveQuiz(draft.position - 1)}
                    >
                      ← Back
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuizActive(false);
                        audioRef.current?.pause();
                      }}
                    >
                      Pause quiz
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        draft.position === 9 && nextUnansweredPosition < 0
                      }
                      onClick={() =>
                        moveQuiz(
                          draft.position === 9
                            ? nextUnansweredPosition
                            : draft.position + 1,
                        )
                      }
                    >
                      {draft.position === 9 ? "Next unanswered →" : "Next →"}
                    </button>
                  </footer>
                  <p className="hub-quiz-footnote">
                    You can move between questions without answering. Finish all
                    ten to count today.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <aside className="hub-conversation">
        <div className="hub-conversation-mark" aria-hidden="true">
          మాట
        </div>
        <div>
          <span className="hub-eyebrow">MAKE IT A CONVERSATION</span>
          <h2>Try a phrase out loud.</h2>
          <p>
            Take what you’ve practiced into a live conversation. Or return to a
            lesson whenever you need a little help.
          </p>
          <div className="hub-conversation-links">
            <Link href="/practice-live" className="primary-button">
              Practice a conversation <span aria-hidden="true">→</span>
            </Link>
            <Link href="/learn" className="text-link">
              Browse lessons
            </Link>
          </div>
        </div>
      </aside>
    </main>
  );
}
