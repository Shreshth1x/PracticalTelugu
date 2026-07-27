export type Confidence = "learning" | "ready";

export type SavedState = {
  completed: string[];
  confidence: Record<string, Confidence>;
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

export function parseCurrentProgress(value: unknown): SavedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  return {
    completed: uniqueStrings(candidate.completed),
    confidence: confidenceFrom(candidate.confidence),
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
    },
    preferences: { ...local.preferences },
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
): LearningSnapshot {
  if (hasLearningData(baseline) && !hasLearningData(current)) {
    return {
      state: {
        completed: [],
        confidence: {},
      },
      preferences: { ...current.preferences },
      savedWords: [],
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
  };
}
