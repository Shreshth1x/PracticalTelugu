"use client";

import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ANONYMOUS_CLAIM_KEY,
  LEGACY_STORAGE_KEY,
  PREFERENCES_KEY,
  SAVED_WORDS_KEY,
  STORAGE_KEY,
  applySnapshotChanges,
  defaultPreferences,
  defaultSnapshot,
  defaultState,
  mergeSnapshots,
  normalizeLearningSnapshot,
  parseCloudSnapshot,
  parseCurrentProgress,
  parseLegacyProgress,
  parseLearningSnapshot,
  parsePreferences,
  parseSavedWords,
  snapshotAdditionsSince,
  type Confidence,
  type LearningSnapshot,
  type Preferences,
  type SavedState,
  userStorageKeys,
} from "./learning-state";
import { signInWithGoogleIdToken } from "./google-id-token-auth";
import { getSupabaseBrowserClient } from "./supabase-client";

export type SyncStatus =
  | "local"
  | "loading"
  | "saving"
  | "synced"
  | "error";

type AuthResult = {
  error: string | null;
  needsEmailConfirmation?: boolean;
};

type CloudBaseline = {
  snapshot: LearningSnapshot;
  revision: number | null;
};

type LearningContextValue = {
  state: SavedState;
  setState: React.Dispatch<React.SetStateAction<SavedState>>;
  preferences: Preferences;
  setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
  savedWords: string[];
  setSavedWords: React.Dispatch<React.SetStateAction<string[]>>;
  hydrated: boolean;
  user: User | null;
  authReady: boolean;
  cloudReady: boolean;
  syncStatus: SyncStatus;
  syncMessage: string;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: (idToken: string, rawNonce: string) => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  retrySync: () => void;
  resetProgress: () => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);

function registeredLearningUser(user: User | null | undefined) {
  return user?.is_anonymous ? null : (user ?? null);
}

function cloneSnapshot(snapshot: LearningSnapshot): LearningSnapshot {
  return {
    state: {
      completed: [...snapshot.state.completed],
      confidence: { ...snapshot.state.confidence },
      ...(snapshot.state.reviewDays
        ? { reviewDays: Object.fromEntries(Object.entries(snapshot.state.reviewDays).map(([day, result]) => [day, { ...result }])) }
        : {}),
    },
    preferences: { ...snapshot.preferences },
    savedWords: [...snapshot.savedWords],
  };
}

function readJson(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function readAnonymousSnapshot(): LearningSnapshot {
  let state: SavedState | null = null;

  try {
    state = parseCurrentProgress(readJson(STORAGE_KEY));
  } catch {
    state = null;
  }

  if (!state) {
    try {
      state = parseLegacyProgress(readJson(LEGACY_STORAGE_KEY));
    } catch {
      state = null;
    }
  }

  let preferences = { ...defaultPreferences };
  try {
    const value = readJson(PREFERENCES_KEY);
    if (value) preferences = parsePreferences(value);
  } catch {
    preferences = { ...defaultPreferences };
  }

  let savedWords: string[] = [];
  try {
    savedWords = parseSavedWords(readJson(SAVED_WORDS_KEY));
  } catch {
    savedWords = [];
  }

  return {
    state: state ?? { ...defaultState, confidence: {} },
    preferences,
    savedWords,
  };
}

function readUserSnapshot(userId: string): LearningSnapshot {
  const keys = userStorageKeys(userId);

  // Each key is parsed independently so one damaged entry cannot collapse the
  // whole snapshot to defaults and later read as an intentional wipe.
  let state: SavedState | null = null;
  try {
    state = parseCurrentProgress(readJson(keys.progress));
  } catch {
    state = null;
  }

  let preferences = { ...defaultPreferences };
  try {
    preferences = parsePreferences(readJson(keys.preferences));
  } catch {
    preferences = { ...defaultPreferences };
  }

  let savedWords: string[] = [];
  try {
    savedWords = parseSavedWords(readJson(keys.savedWords));
  } catch {
    savedWords = [];
  }

  return {
    state: state ?? { completed: [], confidence: {} },
    preferences,
    savedWords,
  };
}

function writeSnapshot(snapshot: LearningSnapshot, userId?: string) {
  const normalized = normalizeLearningSnapshot(snapshot);
  const keys = userId
    ? userStorageKeys(userId)
    : {
        progress: STORAGE_KEY,
        preferences: PREFERENCES_KEY,
        savedWords: SAVED_WORDS_KEY,
      };

  window.localStorage.setItem(keys.progress, JSON.stringify(normalized.state));
  window.localStorage.setItem(
    keys.preferences,
    JSON.stringify(normalized.preferences),
  );
  window.localStorage.setItem(
    keys.savedWords,
    JSON.stringify(normalized.savedWords),
  );
}

function serializeSnapshot(snapshot: LearningSnapshot) {
  const normalized = normalizeLearningSnapshot(snapshot);
  // Confidence keys are sorted so snapshots built in different orders compare
  // equal instead of triggering spurious sync cycles.
  const confidence: Record<string, Confidence> = {};
  Object.keys(normalized.state.confidence)
    .sort()
    .forEach((key) => {
      confidence[key] = normalized.state.confidence[key];
    });

  return JSON.stringify({
    ...normalized,
    state: {
      ...normalized.state,
      confidence,
      ...(normalized.state.reviewDays
        ? { reviewDays: Object.fromEntries(Object.entries(normalized.state.reviewDays).sort(([a], [b]) => a.localeCompare(b))) }
        : {}),
    },
  });
}

export function LearningProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SavedState>(() => ({
    ...defaultState,
    confidence: {},
  }));
  const [preferences, setPreferences] = useState<Preferences>(() => ({
    ...defaultPreferences,
  }));
  const [savedWords, setSavedWords] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [syncMessage, setSyncMessage] = useState(
    "Progress is saved on this device.",
  );
  const [reconcileRetry, setReconcileRetry] = useState(0);

  const anonymousSnapshotRef = useRef<LearningSnapshot>(
    cloneSnapshot(defaultSnapshot),
  );
  const lastSerializedRef = useRef("");
  const currentSnapshotRef = useRef<LearningSnapshot>(
    cloneSnapshot(defaultSnapshot),
  );
  const syncTimerRef = useRef<number | null>(null);
  const syncVersionRef = useRef(0);
  const reconciliationRef = useRef(0);
  const reconciliationFailedRef = useRef(false);
  const pendingReconcileSnapshotRef = useRef<LearningSnapshot | null>(null);
  const cloudBaselinesRef = useRef(new Map<string, CloudBaseline>());
  const syncQueueRef = useRef(Promise.resolve());
  const resetPendingRef = useRef(false);
  const reconcileAttemptsRef = useRef(0);
  const reconcileRetryTimerRef = useRef<number | null>(null);

  const snapshot = useMemo<LearningSnapshot>(
    () => ({ state, preferences, savedWords }),
    [preferences, savedWords, state],
  );

  useEffect(() => {
    currentSnapshotRef.current = snapshot;
  }, [snapshot]);

  const applySnapshot = useCallback((next: LearningSnapshot) => {
    const normalized = normalizeLearningSnapshot(next);
    lastSerializedRef.current = serializeSnapshot(normalized);
    currentSnapshotRef.current = normalized;
    setState(normalized.state);
    setPreferences(normalized.preferences);
    setSavedWords(normalized.savedWords);
  }, []);

  useEffect(() => {
    const restored = readAnonymousSnapshot();
    anonymousSnapshotRef.current = restored;
    // Browser storage is an external source and must be reconciled after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applySnapshot(restored);
    setHydrated(true);
  }, [applySnapshot]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    const authTimer = window.setTimeout(() => {
      if (!active) return;
      setAuthReady(true);
    }, 8_000);

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        window.clearTimeout(authTimer);
        setUser(registeredLearningUser(data.session?.user));
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        window.clearTimeout(authTimer);
        setUser(null);
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      window.clearTimeout(authTimer);
      const nextUser = registeredLearningUser(session?.user);
      setUser((currentUser) =>
        currentUser?.id === nextUser?.id ? currentUser : nextUser,
      );
      setAuthReady(true);
    });

    return () => {
      active = false;
      window.clearTimeout(authTimer);
      subscription.unsubscribe();
    };
  }, []);

  const syncSnapshot = useCallback(
    (
      next: LearningSnapshot,
      targetUser: User,
      version: number,
    ) => {
      const normalizedNext = normalizeLearningSnapshot(next);
      const keys = userStorageKeys(targetUser.id);
      setSyncStatus("saving");
      setSyncMessage("Backing up your progress…");

      syncQueueRef.current = syncQueueRef.current.then(async () => {
        // A newer snapshot is already queued behind this task, so this write
        // would only be overwritten again; let the newest version sync alone.
        if (version !== syncVersionRef.current) return;

        const fail = () => {
          if (version === syncVersionRef.current) {
            setSyncStatus("error");
            setSyncMessage(
              "Your progress is still on this device. Try backing it up again.",
            );
          }
        };
        const baseline = cloudBaselinesRef.current.get(targetUser.id) ?? {
          snapshot: cloneSnapshot(defaultSnapshot),
          revision: null,
        };
        let explicitReset = resetPendingRef.current;
        try {
          explicitReset =
            explicitReset ||
            window.localStorage.getItem(keys.resetPending) === "true";
        } catch {
          // The in-memory flag still records a reset from this session.
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
          const { data: latestRow, error: readError } =
            await getSupabaseBrowserClient()
              .from("user_learning_state")
              .select("revision, progress, preferences, saved_words")
              .eq("user_id", targetUser.id)
              .maybeSingle();

          if (readError) {
            fail();
            return;
          }

          const latestSnapshot = latestRow
            ? parseCloudSnapshot(latestRow)
            : cloneSnapshot(defaultSnapshot);
          const latestRevision = latestRow?.revision;
          if (
            !latestSnapshot ||
            (latestRow &&
              (!Number.isSafeInteger(latestRevision) || latestRevision < 0))
          ) {
            fail();
            return;
          }

          const merged = applySnapshotChanges(
            baseline.snapshot,
            normalizedNext,
            latestSnapshot,
            { explicitReset },
          );
          const normalizedMerged = normalizeLearningSnapshot(merged);
          const nextRevision =
            typeof latestRevision === "number" ? latestRevision + 1 : 1;
          const payload = {
            user_id: targetUser.id,
            schema_version: 1,
            revision: nextRevision,
            progress: normalizedMerged.state,
            preferences: normalizedMerged.preferences,
            saved_words: normalizedMerged.savedWords,
          };

          if (latestRow) {
            const { data: updatedRows, error: updateError } =
              await getSupabaseBrowserClient()
                .from("user_learning_state")
                .update(payload)
                .eq("user_id", targetUser.id)
                .eq("revision", latestRevision)
                .select("revision");

            if (updateError) {
              fail();
              return;
            }
            if (!updatedRows?.length) continue;
          } else {
            const { error: insertError } = await getSupabaseBrowserClient()
              .from("user_learning_state")
              .insert(payload);

            if (insertError?.code === "23505") continue;
            if (insertError) {
              fail();
              return;
            }
          }

          // When the cloud held newer progress from another device, the merged
          // result is what actually synced; adopt it locally so the other
          // device's additions appear without waiting for a reload.
          const localUpToDate = version === syncVersionRef.current;
          const mergedDiffers =
            serializeSnapshot(normalizedMerged) !==
            serializeSnapshot(normalizedNext);
          const baselineSnapshot =
            localUpToDate && mergedDiffers ? normalizedMerged : normalizedNext;

          cloudBaselinesRef.current.set(targetUser.id, {
            snapshot: cloneSnapshot(baselineSnapshot),
            revision: nextRevision,
          });
          try {
            window.localStorage.setItem(
              keys.cloudBaseline,
              serializeSnapshot(baselineSnapshot),
            );
          } catch {
            // Cloud remains authoritative when browser storage is unavailable.
          }

          resetPendingRef.current = false;
          try {
            window.localStorage.removeItem(keys.resetPending);
          } catch {
            // The reset already reached the cloud; the flag is only a retry aid.
          }

          if (localUpToDate && mergedDiffers) {
            applySnapshot(normalizedMerged);
            try {
              writeSnapshot(normalizedMerged, targetUser.id);
            } catch {
              // The merged snapshot still lives in memory and in the cloud.
            }
          }

          if (version === syncVersionRef.current) {
            try {
              window.localStorage.setItem(keys.dirty, "false");
            } catch {
              // Cloud sync remains valid when local storage is unavailable.
            }
            setSyncStatus("synced");
            setSyncMessage("Progress backed up.");
          }
          return;
        }

        fail();
      });
    },
    [applySnapshot],
  );

  useEffect(() => {
    if (!hydrated || !authReady) return;

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncVersionRef.current += 1;
    const reconciliationId = ++reconciliationRef.current;
    pendingReconcileSnapshotRef.current = null;

    if (!user) {
      reconciliationFailedRef.current = false;
      const anonymous = readAnonymousSnapshot();
      anonymousSnapshotRef.current = anonymous;
      // Auth changed the active external storage namespace.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      applySnapshot(anonymous);
      setCloudReady(false);
      setSyncStatus("local");
      setSyncMessage("Progress is saved on this device.");
      return;
    }

    const reconcile = async () => {
      setCloudReady(false);
      setSyncStatus("loading");
      setSyncMessage("Bringing back your progress…");

      const keys = userStorageKeys(user.id);
      const userSnapshot = readUserSnapshot(user.id);
      const reconciliationBaseline = cloneSnapshot(
        currentSnapshotRef.current,
      );
      const anonymousClaimSnapshot = cloneSnapshot(
        anonymousSnapshotRef.current,
      );
      let userCacheIsDirty = false;
      let userCacheBaseline: LearningSnapshot | null = null;
      let claimedBy: string | null = null;
      let claimedBaseline: LearningSnapshot | null = null;
      let resetPending = resetPendingRef.current;

      try {
        userCacheIsDirty =
          window.localStorage.getItem(keys.dirty) === "true";
      } catch {
        userCacheIsDirty = false;
      }
      try {
        resetPending =
          resetPending ||
          window.localStorage.getItem(keys.resetPending) === "true";
      } catch {
        // The in-memory flag still records a reset from this session.
      }
      try {
        userCacheBaseline = parseLearningSnapshot(
          readJson(keys.cloudBaseline),
        );
      } catch {
        userCacheBaseline = null;
      }
      try {
        claimedBy = window.localStorage.getItem(ANONYMOUS_CLAIM_KEY);
      } catch {
        claimedBy = null;
      }
      try {
        if (claimedBy === user.id) {
          claimedBaseline = parseLearningSnapshot(
            readJson(keys.anonymousBaseline),
          );
        }
      } catch {
        claimedBaseline = null;
      }

      const { data, error } = await getSupabaseBrowserClient()
        .from("user_learning_state")
        .select("revision, progress, preferences, saved_words")
        .eq("user_id", user.id)
        .maybeSingle();

      if (reconciliationId !== reconciliationRef.current) return;

      const pendingDuringRead = pendingReconcileSnapshotRef.current;
      pendingReconcileSnapshotRef.current = null;
      const cloudSnapshot = data ? parseCloudSnapshot(data) : null;
      const cloudRevision = data?.revision;
      const cloudMalformed = Boolean(
        data &&
          (!cloudSnapshot ||
            !Number.isSafeInteger(cloudRevision) ||
            cloudRevision < 0),
      );
      let next = cloudSnapshot ?? userSnapshot;

      if (userCacheIsDirty) {
        next = cloudSnapshot
          ? userCacheBaseline
            ? applySnapshotChanges(
                userCacheBaseline,
                userSnapshot,
                cloudSnapshot,
                { explicitReset: resetPending },
              )
            : mergeSnapshots(userSnapshot, cloudSnapshot)
          : userSnapshot;
      }

      const shouldClaimAnonymous = !claimedBy || claimedBy === user.id;
      const anonymousForMerge =
        claimedBy === user.id
          ? claimedBaseline
            ? snapshotAdditionsSince(
                anonymousClaimSnapshot,
                claimedBaseline,
              )
            : cloneSnapshot(defaultSnapshot)
          : anonymousClaimSnapshot;
      if (shouldClaimAnonymous) {
        // The anonymous claim contributes learning additions. Preferences come
        // from the device only on the very first claim of a fresh account;
        // afterwards the signed-in account stays authoritative so the frozen
        // anonymous snapshot cannot keep reverting settings changes.
        next = mergeSnapshots(anonymousForMerge, next, {
          preferences: !claimedBy && !cloudSnapshot ? "local" : "cloud",
        });
      }
      if (pendingDuringRead) {
        next = applySnapshotChanges(
          reconciliationBaseline,
          pendingDuringRead,
          next,
          { explicitReset: resetPending },
        );
      }

      applySnapshot(next);
      try {
        writeSnapshot(next, user.id);
      } catch {
        // The signed-in session can continue with in-memory state.
      }
      setCloudReady(true);

      if (error || cloudMalformed) {
        reconciliationFailedRef.current = true;
        if (pendingDuringRead) {
          try {
            window.localStorage.setItem(keys.dirty, "true");
          } catch {
            // The pending snapshot remains available in memory.
          }
        }
        setSyncStatus("error");
        setSyncMessage(
          "You’re signed in, but your progress is only on this device right now.",
        );
        scheduleReconcileRetry();
        return;
      }

      reconciliationFailedRef.current = false;
      reconcileAttemptsRef.current = 0;
      cloudBaselinesRef.current.set(user.id, {
        snapshot: cloudSnapshot ?? cloneSnapshot(defaultSnapshot),
        revision: typeof cloudRevision === "number" ? cloudRevision : null,
      });
      const version = ++syncVersionRef.current;
      // A reload that changed nothing has nothing to push; skipping the write
      // avoids a pointless revision bump (and CAS contention) on every visit.
      const cloudUnchanged =
        !resetPending &&
        serializeSnapshot(next) ===
          serializeSnapshot(cloudSnapshot ?? cloneSnapshot(defaultSnapshot));
      try {
        window.localStorage.setItem(
          keys.cloudBaseline,
          serializeSnapshot(
            cloudSnapshot ?? cloneSnapshot(defaultSnapshot),
          ),
        );
        window.localStorage.setItem(
          keys.dirty,
          cloudUnchanged ? "false" : "true",
        );
        if (shouldClaimAnonymous) {
          window.localStorage.setItem(ANONYMOUS_CLAIM_KEY, user.id);
          window.localStorage.setItem(
            keys.anonymousBaseline,
            serializeSnapshot(anonymousClaimSnapshot),
          );
        }
      } catch {
        // The snapshot still remains available in memory for this session.
      }
      if (cloudUnchanged) {
        setSyncStatus("synced");
        setSyncMessage("Progress backed up.");
        return;
      }
      syncSnapshot(next, user, version);
    };

    const scheduleReconcileRetry = () => {
      const attempt = reconcileAttemptsRef.current;
      reconcileAttemptsRef.current = Math.min(attempt + 1, 6);
      const delay = Math.min(30_000, 2_000 * 2 ** attempt);
      if (reconcileRetryTimerRef.current) {
        window.clearTimeout(reconcileRetryTimerRef.current);
      }
      reconcileRetryTimerRef.current = window.setTimeout(() => {
        reconcileRetryTimerRef.current = null;
        if (reconciliationId === reconciliationRef.current) {
          setReconcileRetry((current) => current + 1);
        }
      }, delay);
    };

    reconcile().catch(() => {
      if (reconciliationId !== reconciliationRef.current) return;
      reconciliationFailedRef.current = true;
      setSyncStatus("error");
      setSyncMessage(
        "You’re signed in, but your progress is only on this device right now.",
      );
      scheduleReconcileRetry();
    });

    return () => {
      if (reconcileRetryTimerRef.current) {
        window.clearTimeout(reconcileRetryTimerRef.current);
        reconcileRetryTimerRef.current = null;
      }
    };
  }, [
    applySnapshot,
    authReady,
    hydrated,
    reconcileRetry,
    syncSnapshot,
    user,
  ]);

  useEffect(() => {
    if (!hydrated) return;

    if (!user) {
      try {
        writeSnapshot(snapshot);
        anonymousSnapshotRef.current = snapshot;
      } catch {
        // Practice stays usable when browser storage is blocked.
      }
      return;
    }

    const serialized = serializeSnapshot(snapshot);
    if (!cloudReady) {
      if (serialized !== lastSerializedRef.current) {
        pendingReconcileSnapshotRef.current = cloneSnapshot(snapshot);
        // Persist edits made while the cloud read is still in flight so a
        // closed tab cannot lose them; the dirty flag lets the next reconcile
        // merge them via the cached baseline.
        try {
          writeSnapshot(snapshot, user.id);
          window.localStorage.setItem(
            userStorageKeys(user.id).dirty,
            "true",
          );
        } catch {
          // The pending snapshot remains available in memory.
        }
      }
      return;
    }

    try {
      writeSnapshot(snapshot, user.id);
    } catch {
      // Practice stays usable when browser storage is blocked.
    }

    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;

    const keys = userStorageKeys(user.id);
    try {
      window.localStorage.setItem(keys.dirty, "true");
    } catch {
      // The current in-memory snapshot will still be retried.
    }

    if (reconciliationFailedRef.current) return;

    const version = ++syncVersionRef.current;
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
    // The "saving" status is set by syncSnapshot when the debounce fires, so
    // a cleared timer cannot leave the UI stuck on "Backing up…".
    syncTimerRef.current = window.setTimeout(() => {
      syncSnapshot(snapshot, user, version);
    }, 650);

    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [cloudReady, hydrated, snapshot, syncSnapshot, user]);

  const retrySync = useCallback(() => {
    if (!user) return;
    if (reconciliationFailedRef.current) {
      setReconcileRetry((current) => current + 1);
      return;
    }
    if (!cloudReady) {
      setReconcileRetry((current) => current + 1);
      return;
    }
    const version = ++syncVersionRef.current;
    syncSnapshot(currentSnapshotRef.current, user, version);
  }, [cloudReady, syncSnapshot, user]);

  const resetProgress = useCallback(() => {
    // Reset intent is recorded explicitly so sync can distinguish a confirmed
    // reset from a snapshot that merely lost its data.
    resetPendingRef.current = true;
    if (user) {
      try {
        window.localStorage.setItem(
          userStorageKeys(user.id).resetPending,
          "true",
        );
      } catch {
        // The in-memory flag still covers this session.
      }
    }
    try {
      const learnerId = user?.id ?? "anonymous";
      const quizPrefix = `palukulu.quiz-draft.v1:${learnerId}:`;
      const sentenceKey = `palukulu.sentence-draft.v1:${learnerId}`;
      const lessonPrefix = `palukulu.lesson-session.v1.${learnerId}.`;
      const localKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
      for (const key of localKeys) {
        if (key && (key.startsWith(quizPrefix) || key === sentenceKey)) window.localStorage.removeItem(key);
      }
      const sessionKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
      for (const key of sessionKeys) {
        if (key?.startsWith(lessonPrefix)) window.sessionStorage.removeItem(key);
      }
    } catch {
      // Reset still clears saved progress when browser draft storage is unavailable.
    }
    setState({ completed: [], confidence: {} });
  }, [user]);

  useEffect(() => {
    const handleOnline = () => {
      if (reconciliationFailedRef.current) {
        setReconcileRetry((current) => current + 1);
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const anonymousKeys = new Set<string>([
      STORAGE_KEY,
      LEGACY_STORAGE_KEY,
      PREFERENCES_KEY,
      SAVED_WORDS_KEY,
    ]);
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) return;

      if (!user) {
        if (!anonymousKeys.has(event.key)) return;
        let stored: LearningSnapshot;
        try {
          stored = readAnonymousSnapshot();
        } catch {
          return;
        }
        // Another tab wrote the shared anonymous keys; merge instead of
        // letting the tabs clobber each other last-writer-wins.
        const merged = mergeSnapshots(currentSnapshotRef.current, stored, {
          preferences: "cloud",
        });
        if (
          serializeSnapshot(merged) ===
          serializeSnapshot(currentSnapshotRef.current)
        ) {
          return;
        }
        anonymousSnapshotRef.current = merged;
        applySnapshot(merged);
        return;
      }

      if (!cloudReady) return;
      const keys = userStorageKeys(user.id);
      if (
        event.key !== keys.progress &&
        event.key !== keys.preferences &&
        event.key !== keys.savedWords
      ) {
        return;
      }
      const stored = readUserSnapshot(user.id);
      const merged = mergeSnapshots(currentSnapshotRef.current, stored, {
        preferences: "cloud",
      });
      if (
        serializeSnapshot(merged) !==
        serializeSnapshot(currentSnapshotRef.current)
      ) {
        applySnapshot(merged);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [applySnapshot, cloudReady, hydrated, user]);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword(
        { email, password },
      );
      return { error: error?.message ?? null };
    },
    [],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const emailRedirectTo =
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/account`;
      const { data, error } = await getSupabaseBrowserClient().auth.signUp({
        email,
        password,
        options: { emailRedirectTo },
      });

      return {
        error: error?.message ?? null,
        needsEmailConfirmation: Boolean(data.user && !data.session),
      };
    },
    [],
  );

  const signInWithGoogle = useCallback(
    (idToken: string, rawNonce: string): Promise<AuthResult> =>
      signInWithGoogleIdToken(
        getSupabaseBrowserClient(),
        idToken,
        rawNonce,
      ),
    [],
  );

  const sendPasswordReset = useCallback(
    async (email: string): Promise<AuthResult> => {
      const redirectTo = new URL("/account", window.location.origin);
      redirectTo.searchParams.set("mode", "reset-password");
      const { error } =
        await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo.toString(),
        });
      return { error: error?.message ?? null };
    },
    [],
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({
        password,
      });
      return { error: error?.message ?? null };
    },
    [],
  );

  const signOut = useCallback(async (): Promise<AuthResult> => {
    const { error } = await getSupabaseBrowserClient().auth.signOut();
    return { error: error?.message ?? null };
  }, []);

  const value = useMemo<LearningContextValue>(
    () => ({
      state,
      setState,
      preferences,
      setPreferences,
      savedWords,
      setSavedWords,
      hydrated,
      user,
      authReady,
      cloudReady,
      syncStatus,
      syncMessage,
      signInWithPassword,
      signUp,
      signInWithGoogle,
      sendPasswordReset,
      updatePassword,
      signOut,
      retrySync,
      resetProgress,
    }),
    [
      authReady,
      cloudReady,
      hydrated,
      preferences,
      resetProgress,
      retrySync,
      savedWords,
      sendPasswordReset,
      signInWithGoogle,
      signInWithPassword,
      signOut,
      signUp,
      state,
      syncMessage,
      syncStatus,
      updatePassword,
      user,
    ],
  );

  return (
    <LearningContext.Provider value={value}>
      {children}
    </LearningContext.Provider>
  );
}

export function useLearning() {
  const value = useContext(LearningContext);
  if (!value) {
    throw new Error("useLearning must be used inside LearningProvider.");
  }

  return value;
}
