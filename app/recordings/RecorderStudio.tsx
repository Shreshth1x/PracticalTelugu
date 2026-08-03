"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Wordmark } from "../Wordmark";
import { getSupabaseRecorderClient } from "../supabase-client";
import {
  buildRecordingStoragePath,
  latestRecordingByTarget,
  normalizeSpeakerName,
  recordingTargets,
  type PhraseRecordingRow,
} from "./recording-catalog";

const RECORDING_BUCKET = "phrase-recordings";
const SPEAKER_STORAGE_KEY = "practicaltelugu.recorder-speaker.v1";
const SPEAKER_OPTIONS = ["Grandma", "Grandpa"] as const;
const MAX_RECORDING_MS = 20_000;
const RECORDER_LOAD_TIMEOUT_MS = 10_000;

type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "review"
  | "saving"
  | "saved";

type RecorderAccessState = "loading" | "authorized" | "error";
type SpeakerName = (typeof SPEAKER_OPTIONS)[number];

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="3" width="8" height="12" rx="4" />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7" />
    </svg>
  );
}

function PlayIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 7 8 5-8 5Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="6" width="4" height="12" rx="1" />
      <rect x="13" y="6" width="4" height="12" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.5 12.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={direction === "left" ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function preferredRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function baseMimeType(value: string) {
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase() ?? "";
}

function recorderErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Connect one or use this page on a phone.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Another app is using the microphone. Close it, then try again.";
  }
  return "The microphone could not start. Check the browser permission and try again.";
}

function formatTimer(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function LoadingState({ label }: { label: string }) {
  return (
    <section className="recorder-access-state" aria-live="polite">
      <span className="recorder-loading-mark" aria-hidden="true" />
      <p>{label}</p>
    </section>
  );
}

async function withRecorderTimeout<T>(operation: PromiseLike<T>) {
  let timeout: number | null = null;

  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("Recorder connection timed out.")),
          RECORDER_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

export function RecorderStudio() {
  const [accessState, setAccessState] =
    useState<RecorderAccessState>("loading");
  const [recorderUserId, setRecorderUserId] = useState("");
  const [rows, setRows] = useState<PhraseRecordingRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speakerName, setSpeakerName] = useState<SpeakerName>("Grandma");
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [savedPlaying, setSavedPlaying] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const attemptRef = useRef(0);
  const previewUrlRef = useRef("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const savedAudioRef = useRef<HTMLAudioElement | null>(null);

  const currentTarget = recordingTargets[currentIndex];
  const latestByTarget = useMemo(() => latestRecordingByTarget(rows), [rows]);
  const currentSaved = currentTarget
    ? latestByTarget.get(currentTarget.recordingKey)
    : undefined;
  const recordedCount = recordingTargets.reduce(
    (count, target) => count + Number(latestByTarget.has(target.recordingKey)),
    0,
  );
  const allRecorded = recordedCount === recordingTargets.length;
  const progress = (recordedCount / recordingTargets.length) * 100;

  const releaseMedia = useCallback(() => {
    if (analyserFrameRef.current !== null) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    setLevel(0);
  }, []);

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    previewAudioRef.current?.pause();
    setPreviewPlaying(false);
    setPreviewBlob(null);
    setPreviewMimeType("");
    setPreviewDurationMs(0);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setPreviewUrl("");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedSpeaker = window.localStorage.getItem(SPEAKER_STORAGE_KEY);
        if (savedSpeaker === "Grandma" || savedSpeaker === "Grandpa") {
          setSpeakerName(savedSpeaker);
        }
      } catch {
        // The recorder remains usable when browser storage is unavailable.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseRecorderClient();
    const requestController = new AbortController();
    const requestTimer = window.setTimeout(
      () => requestController.abort(),
      RECORDER_LOAD_TIMEOUT_MS,
    );

    async function loadRecorder() {
      setAccessState("loading");
      setError("");

      try {
        const currentSession = await withRecorderTimeout(
          supabase.auth.getSession(),
        );
        if (currentSession.error) throw currentSession.error;

        let session = currentSession.data.session;
        if (!session) {
          const anonymousSession = await withRecorderTimeout(
            supabase.auth.signInAnonymously(),
          );
          if (anonymousSession.error || !anonymousSession.data.session) {
            throw anonymousSession.error ?? new Error("No recording session.");
          }
          session = anonymousSession.data.session;
        }

        if (cancelled) return;
        const userId = session.user.id;
        setRecorderUserId(userId);

        const recordings = await supabase
          .from("phrase_recordings")
          .select(
            "id, recording_key, speaker_name, storage_path, mime_type, duration_ms, status, created_at",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .abortSignal(requestController.signal);

        if (cancelled) return;
        if (recordings.error) {
          setAccessState("error");
          setError(
            requestController.signal.aborted
              ? "The recorder took too long to connect. Check your connection and try again."
              : "The recordings could not be loaded. Check the connection and reload.",
          );
          return;
        }

        const loadedRows = (recordings.data ?? []) as PhraseRecordingRow[];
        setRows(loadedRows);
        const loadedLatest = latestRecordingByTarget(loadedRows);
        const firstMissing = recordingTargets.findIndex(
          (target) => !loadedLatest.has(target.recordingKey),
        );
        setCurrentIndex(firstMissing >= 0 ? firstMissing : 0);
        setAccessState("authorized");
      } catch {
        if (cancelled) return;
        setAccessState("error");
        setError(
          requestController.signal.aborted
            ? "The recorder took too long to connect. Check your connection and try again."
            : "The recorder could not get ready. Reload and try again.",
        );
      } finally {
        window.clearTimeout(requestTimer);
      }
    }

    void loadRecorder();
    return () => {
      cancelled = true;
      window.clearTimeout(requestTimer);
      requestController.abort();
    };
  }, []);

  useEffect(() => {
    const previewAudio = previewAudioRef.current;
    const savedAudio = savedAudioRef.current;
    return () => {
      attemptRef.current += 1;
      clearAdvanceTimer();
      releaseMedia();
      previewAudio?.pause();
      savedAudio?.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [clearAdvanceTimer, releaseMedia]);

  const beginAnalyser = useCallback((stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    const source = context.createMediaStreamSource(stream);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    audioContextRef.current = context;
    void context.resume().catch(() => undefined);

    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * 5.5));
      analyserFrameRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setPhase("stopping");
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    clearAdvanceTimer();
    setError("");
    setNotice("");
    savedAudioRef.current?.pause();
    setSavedPlaying(false);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. Open the page in Safari or Chrome on a phone.");
      return;
    }

    attemptRef.current += 1;
    const attemptId = attemptRef.current;
    clearPreview();
    releaseMedia();
    setElapsedMs(0);
    setPhase("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (attemptId !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = preferredRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (attemptId === attemptRef.current && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        if (attemptId !== attemptRef.current) return;
        attemptRef.current += 1;
        releaseMedia();
        setPhase("idle");
        setError("The recording was interrupted. Tap the microphone to try again.");
      };
      recorder.onstop = () => {
        const duration = Date.now() - startedAtRef.current;
        const chunks = chunksRef.current;
        const resolvedType = baseMimeType(
          recorder.mimeType || chunks[0]?.type || "",
        );
        releaseMedia();
        if (attemptId !== attemptRef.current) return;

        const blob = new Blob(chunks, resolvedType ? { type: resolvedType } : undefined);
        if (!resolvedType.startsWith("audio/") || blob.size === 0 || duration < 200) {
          setPhase("idle");
          setError("That take was too short to save. Tap the microphone and say the full phrase.");
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
        setPreviewBlob(blob);
        setPreviewMimeType(resolvedType);
        setPreviewDurationMs(duration);
        setElapsedMs(duration);
        setPhase("review");
      };

      beginAnalyser(stream);
      recorder.start(120);
      setPhase("recording");
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 100);
      stopTimerRef.current = window.setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (recordingError) {
      if (attemptId !== attemptRef.current) return;
      releaseMedia();
      setPhase("idle");
      setError(recorderErrorMessage(recordingError));
    }
  }, [
    beginAnalyser,
    clearAdvanceTimer,
    clearPreview,
    releaseMedia,
    stopRecording,
  ]);

  const changeTarget = useCallback(
    (nextIndex: number) => {
      if (["requesting", "recording", "stopping", "saving"].includes(phase)) {
        return;
      }
      clearAdvanceTimer();
      clearPreview();
      savedAudioRef.current?.pause();
      setSavedPlaying(false);
      setError("");
      setNotice("");
      setPhase("idle");
      setCurrentIndex(
        (nextIndex + recordingTargets.length) % recordingTargets.length,
      );
    },
    [clearAdvanceTimer, clearPreview, phase],
  );

  const togglePreview = useCallback(async () => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError("The preview could not play. Record the phrase again.");
      }
    } else {
      audio.pause();
    }
  }, []);

  const playSavedRecording = useCallback(async () => {
    if (!currentSaved) return;
    setError("");

    if (savedAudioRef.current && !savedAudioRef.current.paused) {
      savedAudioRef.current.pause();
      setSavedPlaying(false);
      return;
    }

    const { data, error: signedUrlError } = await getSupabaseRecorderClient()
      .storage.from(RECORDING_BUCKET)
      .createSignedUrl(currentSaved.storage_path, 600);
    if (signedUrlError || !data?.signedUrl) {
      setError("The saved take could not be opened. Try again in a moment.");
      return;
    }

    const audio = new Audio(data.signedUrl);
    savedAudioRef.current = audio;
    audio.onended = () => setSavedPlaying(false);
    audio.onpause = () => setSavedPlaying(false);
    try {
      await audio.play();
      setSavedPlaying(true);
    } catch {
      setError("The saved take could not play in this browser.");
    }
  }, [currentSaved]);

  const saveRecording = useCallback(async () => {
    if (
      !recorderUserId ||
      !currentTarget ||
      !previewBlob ||
      !previewMimeType
    ) {
      return;
    }

    const speaker = normalizeSpeakerName(speakerName);
    setPhase("saving");
    setError("");
    setNotice("");
    const supabase = getSupabaseRecorderClient();
    const recordedAt = new Date();
    let storagePath = "";

    try {
      storagePath = buildRecordingStoragePath({
        userId: recorderUserId,
        recordingKey: currentTarget.recordingKey,
        speakerName: speaker,
        mimeType: previewMimeType,
        recordedAt,
      });
    } catch (pathError) {
      setPhase("review");
      setError(
        pathError instanceof Error
          ? pathError.message
          : "This take could not be prepared for upload.",
      );
      return;
    }

    const upload = await supabase.storage
      .from(RECORDING_BUCKET)
      .upload(storagePath, previewBlob, {
        contentType: previewMimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (upload.error) {
      setPhase("review");
      setError("The take could not be saved. It is still here, so you can try again.");
      return;
    }

    const insert = await supabase
      .from("phrase_recordings")
      .insert({
        user_id: recorderUserId,
        recording_key: currentTarget.recordingKey,
        phrase_telugu: currentTarget.telugu,
        phrase_roman: currentTarget.roman,
        phrase_english: currentTarget.english,
        speaker_name: speaker,
        storage_path: storagePath,
        mime_type: previewMimeType,
        duration_ms: Math.min(60_000, Math.max(200, previewDurationMs)),
        byte_size: previewBlob.size,
        consent_confirmed_at: recordedAt.toISOString(),
        status: "ready",
      })
      .select(
        "id, recording_key, speaker_name, storage_path, mime_type, duration_ms, status, created_at",
      )
      .single();

    if (insert.error || !insert.data) {
      await supabase.storage.from(RECORDING_BUCKET).remove([storagePath]);
      setPhase("review");
      setError("The take could not be indexed. It is still here, so you can try again.");
      return;
    }

    const savedRow = insert.data as PhraseRecordingRow;
    const nextRows = [savedRow, ...rows];
    const nextLatest = latestRecordingByTarget(nextRows);
    setRows(nextRows);
    try {
      window.localStorage.setItem(SPEAKER_STORAGE_KEY, speaker);
    } catch {
      // Saving the recording does not depend on browser storage.
    }
    setPhase("saved");
    setNotice("Saved. Moving to the next phrase.");

    clearAdvanceTimer();
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      const nextMissing = recordingTargets.findIndex(
        (target, index) =>
          index > currentIndex && !nextLatest.has(target.recordingKey),
      );
      const wrappedMissing = recordingTargets.findIndex(
        (target) => !nextLatest.has(target.recordingKey),
      );
      clearPreview();
      setNotice("");
      setPhase("idle");
      if (nextMissing >= 0) setCurrentIndex(nextMissing);
      else if (wrappedMissing >= 0) setCurrentIndex(wrappedMissing);
    }, 700);
  }, [
    clearAdvanceTimer,
    clearPreview,
    currentIndex,
    currentTarget,
    previewBlob,
    previewDurationMs,
    previewMimeType,
    rows,
    recorderUserId,
    speakerName,
  ]);

  const sealDisabled = !["idle", "saved", "recording", "review"].includes(
    phase,
  );
  const handleSealAction = () => {
    if (phase === "recording") stopRecording();
    else if (phase === "review") void togglePreview();
    else if (phase === "idle" || phase === "saved") void startRecording();
  };
  const sealLabel =
    phase === "requesting"
      ? "Opening microphone"
      : phase === "recording"
        ? "Tap to stop"
        : phase === "stopping"
          ? "Finishing take"
          : phase === "review"
            ? previewPlaying
              ? "Pause this take"
              : "Listen to this take"
            : phase === "saving"
              ? "Saving take"
              : phase === "saved"
                ? "Saved"
                : "Tap to record";

  return (
    <main className="recorder-page">
      <header className="recorder-header">
        <Link href="/" aria-label="PracticalTelugu home">
          <Wordmark />
        </Link>
        <span className="recorder-private-label">
          <span aria-hidden="true" />
          Voice recorder
        </span>
        <Link href="/" className="recorder-exit">
          Back home
        </Link>
      </header>

      {accessState === "loading" ? (
        <LoadingState label="Preparing the recorder…" />
      ) : accessState === "error" ? (
        <section className="recorder-access-state recorder-access-card">
          <span className="recorder-kicker">Recorder unavailable</span>
          <h1>The recorder could not get ready.</h1>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.reload()}
          >
            Reload recorder
          </button>
        </section>
      ) : currentTarget ? (
        <>
          <section className="recorder-toolbar" aria-label="Recording progress">
            <div className="recorder-progress-copy">
              <span>{recordedCount} of {recordingTargets.length} saved</span>
              <button type="button" onClick={() => setShowLibrary(true)}>
                View all phrases
              </button>
            </div>
            <div
              className="recorder-progress-track"
              role="progressbar"
              aria-label="Phrases recorded"
              aria-valuemin={0}
              aria-valuemax={recordingTargets.length}
              aria-valuenow={recordedCount}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </section>

          <section className="recorder-intro">
            <span className="recorder-kicker">Family voice recorder</span>
            <h1>{allRecorded ? "Every phrase has a voice." : "Record one phrase at a time."}</h1>
            <p>
              Say it clearly and naturally. Each take is saved privately and reviewed before it is used.
            </p>
          </section>

          <section className="recorder-workspace">
            <article className="recorder-prompt" aria-labelledby="recording-phrase">
              <div className="recorder-prompt-meta">
                <span>Phrase {currentIndex + 1} of {recordingTargets.length}</span>
                {currentSaved ? (
                  <span className="recorder-saved-badge">
                    <CheckIcon /> Saved
                  </span>
                ) : (
                  <span>Not recorded</span>
                )}
              </div>
              <span className="recorder-meaning-label">Meaning</span>
              <h2 id="recording-phrase">
                {currentTarget.english.charAt(0).toLocaleUpperCase() +
                  currentTarget.english.slice(1)}
              </h2>
              <p className="recorder-telugu" lang="te">
                {currentTarget.telugu}
              </p>
              <p className="recorder-roman" lang="te-Latn">
                {currentTarget.roman}
              </p>
              <div className="recorder-context">
                <strong>{currentTarget.audienceLabel}</strong>
                <p>{currentTarget.audienceGuidance}</p>
              </div>
              {currentSaved ? (
                <button
                  type="button"
                  className="recorder-listen-saved"
                  onClick={playSavedRecording}
                >
                  <PlayIcon paused={!savedPlaying} />
                  {savedPlaying ? "Pause saved take" : `Listen to ${currentSaved.speaker_name}`}
                </button>
              ) : null}
            </article>

            <div className="recorder-stage">
              <fieldset
                className="recorder-speaker-toggle"
                disabled={[
                  "requesting",
                  "recording",
                  "stopping",
                  "saving",
                ].includes(phase)}
              >
                <legend>Who is speaking?</legend>
                <div role="radiogroup" aria-label="Choose the speaker">
                  {SPEAKER_OPTIONS.map((speaker) => (
                    <button
                      key={speaker}
                      type="button"
                      role="radio"
                      aria-checked={speakerName === speaker}
                      onClick={() => setSpeakerName(speaker)}
                    >
                      {speaker}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div
                className={`recorder-seal recorder-seal-${phase}`}
                style={{ "--voice-level": level } as CSSProperties}
              >
                <span className="recorder-seal-ring recorder-seal-ring-one" />
                <span className="recorder-seal-ring recorder-seal-ring-two" />
                <button
                  type="button"
                  onClick={handleSealAction}
                  disabled={sealDisabled}
                  aria-label={sealLabel}
                >
                  {phase === "recording" || phase === "stopping" ? (
                    <StopIcon />
                  ) : phase === "review" ? (
                    <PlayIcon paused={!previewPlaying} />
                  ) : phase === "saved" ? (
                    <CheckIcon />
                  ) : (
                    <MicIcon />
                  )}
                </button>
              </div>

              <strong className="recorder-seal-label">{sealLabel}</strong>
              <span className="recorder-timer" aria-live="off">
                {formatTimer(elapsedMs)}
              </span>
              <audio
                ref={previewAudioRef}
                src={previewUrl || undefined}
                preload="metadata"
                onPlay={() => setPreviewPlaying(true)}
                onPause={() => setPreviewPlaying(false)}
                onEnded={() => setPreviewPlaying(false)}
              />

              {phase === "review" || phase === "saving" ? (
                <div className="recorder-review-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={startRecording}
                    disabled={phase === "saving"}
                  >
                    Record again
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={saveRecording}
                    disabled={phase === "saving"}
                  >
                    {phase === "saving" ? "Saving…" : "Use this take"}
                  </button>
                </div>
              ) : null}

              {error ? <p className="recorder-error" role="alert">{error}</p> : null}
              {notice ? <p className="recorder-notice" role="status">{notice}</p> : null}
            </div>
          </section>

          <nav className="recorder-pagination" aria-label="Phrase navigation">
            <button type="button" onClick={() => changeTarget(currentIndex - 1)}>
              <ArrowIcon direction="left" /> Previous
            </button>
            <button type="button" onClick={() => changeTarget(currentIndex + 1)}>
              Skip for now <ArrowIcon direction="right" />
            </button>
          </nav>

          {showLibrary ? (
            <div className="recorder-library-backdrop" role="presentation">
              <section
                className="recorder-library"
                role="dialog"
                aria-modal="true"
                aria-labelledby="recorder-library-title"
              >
                <header>
                  <div>
                    <span className="recorder-kicker">Recording list</span>
                    <h2 id="recorder-library-title">All {recordingTargets.length} phrases</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLibrary(false)}
                    aria-label="Close phrase list"
                  >
                    Close
                  </button>
                </header>
                <ol>
                  {recordingTargets.map((target, index) => {
                    const saved = latestByTarget.has(target.recordingKey);
                    return (
                      <li key={target.recordingKey}>
                        <button
                          type="button"
                          className={index === currentIndex ? "is-current" : undefined}
                          onClick={() => {
                            changeTarget(index);
                            setShowLibrary(false);
                          }}
                        >
                          <span className="recorder-library-index">{index + 1}</span>
                          <span>
                            <strong>{target.english}</strong>
                            <small>{target.roman}</small>
                          </span>
                          <span className={saved ? "is-saved" : undefined}>
                            {saved ? "Saved" : "Open"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
