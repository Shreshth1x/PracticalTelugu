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
  safeAppPath,
  snapshotAdditionsSince,
  type LearningSnapshot,
  type Preferences,
  type SavedState,
  userStorageKeys,
} from "./learning-state";
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
  signInWithGoogle: (returnTo: string) => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  retrySync: () => void;
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

  try {
    return {
      state:
        parseCurrentProgress(readJson(keys.progress)) ??
        cloneSnapshot(defaultSnapshot).state,
      preferences: parsePreferences(readJson(keys.preferences)),
      savedWords: parseSavedWords(readJson(keys.savedWords)),
    };
  } catch {
    return cloneSnapshot(defaultSnapshot);
  }
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
  return JSON.stringify(normalizeLearningSnapshot(snapshot));
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

          cloudBaselinesRef.current.set(targetUser.id, {
            snapshot: cloneSnapshot(normalizedNext),
            revision: nextRevision,
          });
          try {
            window.localStorage.setItem(
              keys.cloudBaseline,
              serializeSnapshot(normalizedNext),
            );
          } catch {
            // Cloud remains authoritative when browser storage is unavailable.
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
    [],
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

      try {
        userCacheIsDirty =
          window.localStorage.getItem(keys.dirty) === "true";
      } catch {
        userCacheIsDirty = false;
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
        next = mergeSnapshots(anonymousForMerge, next);
      }
      if (pendingDuringRead) {
        next = applySnapshotChanges(
          reconciliationBaseline,
          pendingDuringRead,
          next,
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
        return;
      }

      reconciliationFailedRef.current = false;
      cloudBaselinesRef.current.set(user.id, {
        snapshot: cloudSnapshot ?? cloneSnapshot(defaultSnapshot),
        revision: typeof cloudRevision === "number" ? cloudRevision : null,
      });
      const version = ++syncVersionRef.current;
      try {
        window.localStorage.setItem(
          keys.cloudBaseline,
          serializeSnapshot(
            cloudSnapshot ?? cloneSnapshot(defaultSnapshot),
          ),
        );
        window.localStorage.setItem(keys.dirty, "true");
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
      syncSnapshot(next, user, version);
    };

    void reconcile();
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
    setSyncStatus("saving");
    setSyncMessage("Backing up your progress…");
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
    if (!user || !cloudReady) return;
    if (reconciliationFailedRef.current) {
      setReconcileRetry((current) => current + 1);
      return;
    }
    const version = ++syncVersionRef.current;
    syncSnapshot(currentSnapshotRef.current, user, version);
  }, [cloudReady, syncSnapshot, user]);

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
    async (returnTo: string): Promise<AuthResult> => {
      const callbackUrl = new URL("/account", window.location.origin);
      callbackUrl.searchParams.set("returnTo", safeAppPath(returnTo));
      const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      return { error: error?.message ?? null };
    },
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
    }),
    [
      authReady,
      cloudReady,
      hydrated,
      preferences,
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
