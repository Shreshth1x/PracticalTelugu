export type Confidence = "learning" | "ready";

export type SavedState = {
  completed: string[];
  confidence: Record<string, Confidence>;
  reviewDays?: Record<string, { score: number; total: 10 }>;
};

export type Preferences = {
  showPronunciation: boolean;
  autoplay: boolean;
};

export type LearningSnapshot = {
  state: SavedState;
  preferences: Preferences;
  savedWords: string[];
};

export const STORAGE_KEY = "palukulu.progress.v2";
export const LEGACY_STORAGE_KEY = "palukulu.progress.v1";
export const PREFERENCES_KEY = "palukulu.preferences.v1";
export const SAVED_WORDS_KEY = "palukulu.saved-words.v1";
export const ANONYMOUS_CLAIM_KEY = "palukulu.claimed-anonymous.v1";

export const defaultState: SavedState = {
  completed: [],
  confidence: {},
};

export const defaultPreferences: Preferences = {
  showPronunciation: true,
  autoplay: false,
};

export const defaultSnapshot: LearningSnapshot = {
  state: defaultState,
  preferences: defaultPreferences,
  savedWords: [],
};

const APP_PATH_ORIGIN = "https://practicaltelugu.invalid";

const LEGACY_PHRASE_KEY_ALIASES: Readonly<Record<string, string>> = {
  "మీరు ఎలా ఉన్నారు?::how are you?":
    "మీరు ఎలా ఉన్నారు?::how are you? (respectful)",
  "మళ్లీ కలుద్దాం::let’s meet again": "మళ్లీ కలుద్దాం::see you again",
};

export function canonicalPhraseKey(value: string): string {
  return LEGACY_PHRASE_KEY_ALIASES[value] ?? value;
}

export function safeAppPath(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }

  try {
    const resolved = new URL(value, APP_PATH_ORIGIN);
    if (resolved.origin !== APP_PATH_ORIGIN) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string")),
  );
}

function confidenceFrom(value: unknown): Record<string, Confidence> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const confidence: Record<string, Confidence> = {};

  Object.entries(value).forEach(([rawKey, rawConfidence]) => {
    if (rawConfidence !== "learning" && rawConfidence !== "ready") return;

    const key = canonicalPhraseKey(rawKey);
    if (rawConfidence === "ready" || !confidence[key]) {
      confidence[key] = rawConfidence;
    }
  });

  return confidence;
}

function reviewDaysFrom(value: unknown): NonNullable<SavedState["reviewDays"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const days: NonNullable<SavedState["reviewDays"]> = {};
  for (const [day, result] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const date = new Date(`${day}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) continue;
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const candidate = result as Record<string, unknown>;
    if (candidate.total !== 10 || typeof candidate.score !== "number" || !Number.isInteger(candidate.score) || candidate.score < 0 || candidate.score > 10) continue;
    days[day] = { score: candidate.score, total: 10 };
  }
  return days;
}

function reviewFields(value: unknown): Pick<SavedState, "reviewDays"> {
  const reviewDays = reviewDaysFrom(value);
  return Object.keys(reviewDays).length ? { reviewDays } : {};
}

function mergedReviewFields(a: SavedState, b: SavedState): Pick<SavedState, "reviewDays"> {
  const days = reviewDaysFrom(a.reviewDays);
  for (const [day, result] of Object.entries(reviewDaysFrom(b.reviewDays))) {
    // Concurrent devices keep one completion per day with deterministic merging.
    if (!days[day] || result.score > days[day].score) days[day] = result;
  }
  return reviewFields(days);
}

export function parseCurrentProgress(value: unknown): SavedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  return {
    completed: uniqueStrings(candidate.completed),
    confidence: confidenceFrom(candidate.confidence),
    ...reviewFields(candidate.reviewDays),
  };
}

export function parseLegacyProgress(value: unknown): SavedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  return {
    completed: uniqueStrings(candidate.completed),
    confidence: {},
  };
}

export function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultPreferences };
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

export function parseSavedWords(value: unknown): string[] {
  return Array.from(new Set(uniqueStrings(value).map(canonicalPhraseKey)));
}

export function normalizeLearningSnapshot(
  snapshot: LearningSnapshot,
): LearningSnapshot {
  return {
    state: {
      completed: uniqueStrings(snapshot.state.completed),
      confidence: confidenceFrom(snapshot.state.confidence),
      ...reviewFields(snapshot.state.reviewDays),
    },
    preferences: parsePreferences(snapshot.preferences),
    savedWords: parseSavedWords(snapshot.savedWords),
  };
}

export function parseLearningSnapshot(value: unknown): LearningSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const state = parseCurrentProgress(candidate.state);
  if (
    !state ||
    !candidate.preferences ||
    typeof candidate.preferences !== "object" ||
    Array.isArray(candidate.preferences) ||
    !Array.isArray(candidate.savedWords)
  ) {
    return null;
  }

  return {
    state,
    preferences: parsePreferences(candidate.preferences),
    savedWords: parseSavedWords(candidate.savedWords),
  };
}

export function parseCloudSnapshot(value: unknown): LearningSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (
    !candidate.progress ||
    typeof candidate.progress !== "object" ||
    Array.isArray(candidate.progress)
  ) {
    return null;
  }

  const cloudProgress = candidate.progress as Record<string, unknown>;
  if (
    !Array.isArray(cloudProgress.completed) ||
    !cloudProgress.confidence ||
    typeof cloudProgress.confidence !== "object" ||
    Array.isArray(cloudProgress.confidence)
  ) {
    return null;
  }

  const state = parseCurrentProgress(candidate.progress);
  if (!state) return null;

  if (
    !candidate.preferences ||
    typeof candidate.preferences !== "object" ||
    Array.isArray(candidate.preferences)
  ) {
    return null;
  }

  if (!Array.isArray(candidate.saved_words)) return null;

  return {
    state,
    preferences: parsePreferences(candidate.preferences),
    savedWords: parseSavedWords(candidate.saved_words),
  };
}

export function mergeSnapshots(
  local: LearningSnapshot,
  cloud: LearningSnapshot,
  options?: { preferences?: "local" | "cloud" },
): LearningSnapshot {
  const confidenceKeys = new Set([
    ...Object.keys(cloud.state.confidence),
    ...Object.keys(local.state.confidence),
  ]);
  const confidence: Record<string, Confidence> = {};

  confidenceKeys.forEach((key) => {
    const localValue = local.state.confidence[key];
    const cloudValue = cloud.state.confidence[key];

    if (localValue === "ready" || cloudValue === "ready") {
      confidence[key] = "ready";
    } else if (localValue === "learning" || cloudValue === "learning") {
      confidence[key] = "learning";
    }
  });

  return {
    state: {
      completed: uniqueStrings([
        ...cloud.state.completed,
        ...local.state.completed,
      ]),
      confidence,
      ...mergedReviewFields(local.state, cloud.state),
    },
    preferences:
      options?.preferences === "cloud"
        ? { ...cloud.preferences }
        : { ...local.preferences },
    savedWords: uniqueStrings([...cloud.savedWords, ...local.savedWords]),
  };
}

export function snapshotAdditionsSince(
  current: LearningSnapshot,
  baseline: LearningSnapshot,
): LearningSnapshot {
  const baselineCompleted = new Set(baseline.state.completed);
  const baselineSavedWords = new Set(baseline.savedWords);

  return {
    state: {
      completed: current.state.completed.filter(
        (lessonId) => !baselineCompleted.has(lessonId),
      ),
      confidence: Object.fromEntries(
        Object.entries(current.state.confidence).filter(
          ([phraseId, confidence]) =>
            baseline.state.confidence[phraseId] !== confidence,
        ),
      ),
      ...reviewFields(Object.fromEntries(Object.entries(reviewDaysFrom(current.state.reviewDays)).filter(([day, result]) => baseline.state.reviewDays?.[day]?.score !== result.score))),
    },
    preferences: { ...current.preferences },
    savedWords: current.savedWords.filter(
      (wordId) => !baselineSavedWords.has(wordId),
    ),
  };
}

function applyListChanges(
  baseline: string[],
  current: string[],
  target: string[],
): string[] {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  const removed = new Set(
    baseline.filter((item) => !currentSet.has(item)),
  );
  const additions = current.filter((item) => !baselineSet.has(item));

  return uniqueStrings([
    ...target.filter((item) => !removed.has(item)),
    ...additions,
  ]);
}

export function applySnapshotChanges(
  baseline: LearningSnapshot,
  current: LearningSnapshot,
  target: LearningSnapshot,
  options?: { explicitReset?: boolean },
): LearningSnapshot {
  if (options?.explicitReset) {
    // The current state already reflects the confirmed reset. Retain any
    // practice earned afterward while replacing the old cloud learning path.
    return {
      state: {
        completed: uniqueStrings(current.state.completed),
        confidence: confidenceFrom(current.state.confidence),
        ...reviewFields(current.state.reviewDays),
      },
      preferences: { ...current.preferences },
      savedWords: applyListChanges(
        baseline.savedWords,
        current.savedWords,
        target.savedWords,
      ),
    };
  }

  if (hasLearningData(baseline) && !hasLearningData(current)) {
    // Losing every learning item without a confirmed reset means the local
    // snapshot is missing or damaged, so the target must not be wiped.
    return {
      state: {
        completed: [...target.state.completed],
        confidence: { ...target.state.confidence },
        ...reviewFields(target.state.reviewDays),
      },
      preferences: { ...target.preferences },
      savedWords: [...target.savedWords],
    };
  }

  const confidence = { ...target.state.confidence };
  const editedConfidenceKeys = new Set([
    ...Object.keys(baseline.state.confidence),
    ...Object.keys(current.state.confidence),
  ]);

  editedConfidenceKeys.forEach((phraseId) => {
    const before = baseline.state.confidence[phraseId];
    const after = current.state.confidence[phraseId];
    if (before === after) return;
    if (after) {
      confidence[phraseId] = after;
    } else {
      delete confidence[phraseId];
    }
  });

  return {
    state: {
      completed: applyListChanges(
        baseline.state.completed,
        current.state.completed,
        target.state.completed,
      ),
      confidence,
      ...mergedReviewFields(current.state, target.state),
    },
    preferences: { ...current.preferences },
    savedWords: applyListChanges(
      baseline.savedWords,
      current.savedWords,
      target.savedWords,
    ),
  };
}

export function hasLearningData(snapshot: LearningSnapshot): boolean {
  return (
    snapshot.state.completed.length > 0 ||
    Object.keys(snapshot.state.confidence).length > 0 ||
    Object.keys(snapshot.state.reviewDays ?? {}).length > 0 ||
    snapshot.savedWords.length > 0
  );
}

export function userStorageKeys(userId: string) {
  const prefix = `palukulu.user.${userId}`;

  return {
    progress: `${prefix}.progress.v2`,
    preferences: `${prefix}.preferences.v1`,
    savedWords: `${prefix}.saved-words.v1`,
    dirty: `${prefix}.dirty.v1`,
    cloudBaseline: `${prefix}.cloud-baseline.v1`,
    anonymousBaseline: `${prefix}.anonymous-baseline.v1`,
    resetPending: `${prefix}.reset-pending.v1`,
  };
}
