import {
  practicalLessons,
  resolveTeluguFormUsage,
  type Lesson,
  type TeluguFormUsage,
} from "../course-data.ts";
import {
  createRecordingKey,
  normalizeSpokenText,
} from "../phrase-recording-key.ts";

export { createRecordingKey } from "../phrase-recording-key.ts";

export type RecordingSource = {
  lessonId: string;
  lessonTitle: string;
  wordId: string;
  form: "primary" | "alternative";
  formIndex: number;
  formLabel: string;
};

export type RecordingTarget = {
  recordingKey: string;
  slug: string;
  telugu: string;
  roman: string;
  pronunciation: string;
  english: string;
  audienceLabel: string;
  audienceGuidance: string;
  sources: RecordingSource[];
};

export type PhraseRecordingRow = {
  id: string;
  recording_key: string;
  speaker_name: string;
  storage_path: string;
  mime_type: string;
  duration_ms: number;
  status: "ready" | "archived";
  created_at: string;
};

type RecordingCandidate = Omit<
  RecordingTarget,
  "recordingKey" | "slug" | "sources"
> & {
  usage?: TeluguFormUsage;
  source: RecordingSource;
};

function romanSlug(value: string) {
  const slug = value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);

  return slug || "telugu-phrase";
}

function candidateFrom(
  lesson: Lesson,
  word: Lesson["words"][number],
  formIndex: number,
): RecordingCandidate {
  const alternative = formIndex > 0 ? word.alternatives?.[formIndex - 1] : null;
  const form = alternative ? "alternative" : "primary";
  const usage = alternative?.usage ?? word.usage;
  const usageCopy = resolveTeluguFormUsage(usage);

  return {
    telugu: normalizeSpokenText(alternative?.telugu ?? word.telugu),
    roman: normalizeSpokenText(alternative?.roman ?? word.roman),
    pronunciation: normalizeSpokenText(
      alternative?.pronunciation ?? word.pronunciation,
    ),
    english: normalizeSpokenText(word.english),
    audienceLabel:
      alternative?.label ??
      (usageCopy.showContext ? usageCopy.label : "Works with anyone"),
    audienceGuidance: usageCopy.guidance,
    usage,
    source: {
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      wordId: word.id,
      form,
      formIndex,
      formLabel:
        alternative?.label ??
        (usageCopy.showContext ? usageCopy.label : "Standard form"),
    },
  };
}

export function buildRecordingTargets(
  lessons: readonly Lesson[] = practicalLessons,
): RecordingTarget[] {
  const byTelugu = new Map<string, RecordingTarget>();
  const keys = new Map<string, string>();

  for (const lesson of lessons) {
    for (const word of lesson.words) {
      const formCount = 1 + (word.alternatives?.length ?? 0);

      for (let formIndex = 0; formIndex < formCount; formIndex += 1) {
        const candidate = candidateFrom(lesson, word, formIndex);
        const existing = byTelugu.get(candidate.telugu);

        if (existing) {
          if (
            existing.roman !== candidate.roman ||
            existing.pronunciation !== candidate.pronunciation
          ) {
            throw new Error(
              `Conflicting recording guide for ${candidate.telugu}.`,
            );
          }
          existing.sources.push(candidate.source);
          continue;
        }

        const recordingKey = createRecordingKey(candidate.telugu);
        const keyOwner = keys.get(recordingKey);
        if (keyOwner && keyOwner !== candidate.telugu) {
          throw new Error(`Recording key collision: ${recordingKey}.`);
        }
        keys.set(recordingKey, candidate.telugu);

        byTelugu.set(candidate.telugu, {
          recordingKey,
          slug: romanSlug(candidate.roman),
          telugu: candidate.telugu,
          roman: candidate.roman,
          pronunciation: candidate.pronunciation,
          english: candidate.english,
          audienceLabel: candidate.audienceLabel,
          audienceGuidance: candidate.audienceGuidance,
          sources: [candidate.source],
        });
      }
    }
  }

  return Array.from(byTelugu.values());
}

export const recordingTargets = buildRecordingTargets();

export function normalizeSpeakerName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

function storageSegment(value: string, fallback: string) {
  const segment = value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return segment || fallback;
}

export function audioExtension(mimeType: string) {
  const normalized = mimeType.split(";", 1)[0]?.toLocaleLowerCase();
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a") return "m4a";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/wav" || normalized === "audio/wave") return "wav";
  if (normalized === "audio/webm") return "webm";
  throw new Error("This browser created an unsupported audio format.");
}

export function buildRecordingStoragePath({
  userId,
  recordingKey,
  speakerName,
  mimeType,
  recordedAt,
}: {
  userId: string;
  recordingKey: string;
  speakerName: string;
  mimeType: string;
  recordedAt: Date;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("Invalid recording owner.");
  }
  if (!/^phrase-[a-z0-9]+$/.test(recordingKey)) {
    throw new Error("Invalid recording target.");
  }
  if (Number.isNaN(recordedAt.getTime())) {
    throw new Error("Invalid recording time.");
  }
  const speaker = storageSegment(speakerName, "family-voice");
  const timestamp = recordedAt.toISOString().replace(/[-:.TZ]/g, "");
  return `${userId}/${recordingKey}/${speaker}-${timestamp}.${audioExtension(mimeType)}`;
}

export function latestRecordingByTarget(rows: readonly PhraseRecordingRow[]) {
  const latest = new Map<string, PhraseRecordingRow>();
  const sorted = [...rows].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );

  for (const row of sorted) {
    if (row.status === "ready" && !latest.has(row.recording_key)) {
      latest.set(row.recording_key, row);
    }
  }

  return latest;
}
