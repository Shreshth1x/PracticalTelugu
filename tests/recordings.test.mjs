import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { practicalLessons } from "../app/course-data.ts";
import { phraseAudioByRecordingKey } from "../app/phrase-audio.generated.ts";
import {
  audioExtension,
  buildRecordingStoragePath,
  buildRecordingTargets,
  createRecordingKey,
  latestRecordingByTarget,
  recordingTargets,
} from "../app/recordings/recording-catalog.ts";

function rawCourseForms() {
  return practicalLessons.flatMap((lesson) =>
    lesson.words.flatMap((word) => [word, ...(word.alternatives ?? [])]),
  );
}

test("builds one stable recording target for every unique spoken form", () => {
  const rawForms = rawCourseForms();

  assert.equal(practicalLessons.length, 14);
  assert.equal(rawForms.length, 78);
  assert.equal(recordingTargets.length, 67);
  assert.equal(
    new Set(recordingTargets.map((target) => target.recordingKey)).size,
    67,
  );
  assert.equal(new Set(recordingTargets.map((target) => target.slug)).size, 67);
  assert.ok(
    recordingTargets.every((target) => /^phrase-[a-z0-9]+$/.test(target.recordingKey)),
  );
  assert.ok(recordingTargets.every((target) => /^[a-z0-9-]+$/.test(target.slug)));

  const hello = recordingTargets.find((target) => target.roman === "namaskaaram");
  const respectfulHello = recordingTargets.find(
    (target) => target.roman === "namaskaaram andi",
  );
  const familiarMeal = recordingTargets.find(
    (target) => target.roman === "tinnaavaa?",
  );
  const respectfulMeal = recordingTargets.find(
    (target) => target.roman === "tinnaaraa?",
  );

  assert.equal(hello?.sources.length, 2);
  assert.equal(respectfulHello?.sources.length, 2);
  assert.notEqual(familiarMeal?.recordingKey, respectfulMeal?.recordingKey);
});

test("keeps recording identity tied to spoken Telugu, not editable romanization", () => {
  const telugu = "మళ్లీ చెప్పండి";
  assert.equal(createRecordingKey(telugu), createRecordingKey(telugu));

  const first = recordingTargets.find((target) => target.telugu === telugu);
  assert.equal(first?.recordingKey, createRecordingKey(telugu));
});

test("maps every course form to its canonical published recording", async () => {
  const rawForms = rawCourseForms();
  const publishedEntries = Object.entries(phraseAudioByRecordingKey);
  const expectedKeys = recordingTargets
    .map((target) => target.recordingKey)
    .sort();

  assert.equal(rawForms.length, 78);
  assert.ok(rawForms.every((form) => form.audioSrc));
  assert.equal(new Set(rawForms.map((form) => form.audioSrc)).size, 67);
  assert.equal(publishedEntries.length, 67);
  assert.deepEqual(
    publishedEntries.map(([recordingKey]) => recordingKey).sort(),
    expectedKeys,
  );

  for (const [recordingKey, publicSrc] of publishedEntries) {
    assert.equal(publicSrc, `/audio/phrases/${recordingKey}.mp3`);
    const fileUrl = new URL(`../public${publicSrc}`, import.meta.url);
    const file = await stat(fileUrl);
    const bytes = await readFile(fileUrl);
    const beginsWithId3 = bytes.subarray(0, 3).toString("ascii") === "ID3";
    const beginsWithMp3Frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;

    assert.ok(file.size > 5_000, `${recordingKey} is unexpectedly small`);
    assert.ok(
      beginsWithId3 || beginsWithMp3Frame,
      `${recordingKey} does not look like an MP3`,
    );
  }
});

test("rejects conflicting guides for one Telugu recording", () => {
  const baseLesson = practicalLessons[0];
  const firstWord = baseLesson.words[0];
  const conflictingLessons = [
    {
      ...baseLesson,
      id: "first",
      words: [{ ...firstWord, roman: "namaskaaram" }],
    },
    {
      ...baseLesson,
      id: "second",
      words: [{ ...firstWord, roman: "different-spelling" }],
    },
  ];

  assert.throws(
    () => buildRecordingTargets(conflictingLessons),
    /Conflicting recording guide/,
  );
});

test("maps only supported recorder MIME types to honest file extensions", () => {
  assert.equal(audioExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(audioExtension("audio/mp4"), "m4a");
  assert.equal(audioExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(audioExtension("audio/mpeg"), "mp3");
  assert.equal(audioExtension("audio/wav"), "wav");
  assert.throws(() => audioExtension(""), /unsupported audio format/i);
  assert.throws(() => audioExtension("video/webm"), /unsupported audio format/i);
});

test("builds owner-scoped storage paths without personal text in phrase folders", () => {
  const path = buildRecordingStoragePath({
    userId: "00000000-0000-4000-8000-000000000000",
    recordingKey: "phrase-abc1234",
    speakerName: "Grandma Rao",
    mimeType: "audio/mp4",
    recordedAt: new Date("2026-08-02T18:45:13.000Z"),
  });

  assert.equal(
    path,
    "00000000-0000-4000-8000-000000000000/phrase-abc1234/grandma-rao-20260802184513000.m4a",
  );
  assert.throws(
    () =>
      buildRecordingStoragePath({
        userId: "../other-user",
        recordingKey: "phrase-abc1234",
        speakerName: "Family voice",
        mimeType: "audio/webm",
        recordedAt: new Date(),
      }),
    /Invalid recording owner/,
  );
});

test("selects the latest ready take for each phrase", () => {
  const rows = [
    {
      id: "old",
      recording_key: "phrase-one",
      speaker_name: "Grandma",
      storage_path: "one",
      mime_type: "audio/webm",
      duration_ms: 1000,
      status: "ready",
      created_at: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "new",
      recording_key: "phrase-one",
      speaker_name: "Grandpa",
      storage_path: "two",
      mime_type: "audio/webm",
      duration_ms: 900,
      status: "ready",
      created_at: "2026-08-02T00:00:00.000Z",
    },
    {
      id: "archived",
      recording_key: "phrase-two",
      speaker_name: "Grandma",
      storage_path: "three",
      mime_type: "audio/webm",
      duration_ms: 800,
      status: "archived",
      created_at: "2026-08-03T00:00:00.000Z",
    },
  ];

  const latest = latestRecordingByTarget(rows);
  assert.equal(latest.get("phrase-one")?.id, "new");
  assert.equal(latest.has("phrase-two"), false);
});

test("opens recording without login while keeping each browser's audio private", async () => {
  const originalMigration = await readFile(
    new URL(
      "../supabase/migrations/20260802184513_phrase_recordings.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const publicSessionMigration = await readFile(
    new URL(
      "../supabase/migrations/20260802194000_public_phrase_recorder_sessions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const recorder = await readFile(
    new URL("../app/recordings/RecorderStudio.tsx", import.meta.url),
    "utf8",
  );
  const supabaseClient = await readFile(
    new URL("../app/supabase-client.ts", import.meta.url),
    "utf8",
  );
  const learningProvider = await readFile(
    new URL("../app/LearningProvider.tsx", import.meta.url),
    "utf8",
  );
  const supabaseConfig = await readFile(
    new URL("../supabase/config.toml", import.meta.url),
    "utf8",
  );

  assert.match(originalMigration, /create table public\.phrase_recordings/i);
  assert.match(
    originalMigration,
    /alter table public\.phrase_recordings enable row level security/i,
  );
  assert.match(
    originalMigration,
    /'phrase-recordings',\s*'phrase-recordings',\s*false/i,
  );
  assert.ok(
    (publicSessionMigration.match(/on storage\.objects/gi) ?? []).length >= 8,
    "private storage policies are replaced without becoming public",
  );
  assert.match(publicSessionMigration, /auth\.uid\(\)\) = user_id/);
  assert.match(publicSessionMigration, /file_size_limit = 2097152/);
  assert.doesNotMatch(publicSessionMigration, /recorder_members\.active/);
  assert.match(supabaseConfig, /enable_anonymous_sign_ins = true/);
  assert.match(supabaseClient, /getSupabaseRecorderClient/);
  assert.match(supabaseClient, /practicaltelugu-recorder-auth-v1/);
  assert.match(learningProvider, /user\?\.is_anonymous \? null/);
  assert.match(recorder, /auth\.signInAnonymously\(\)/);
  assert.match(recorder, /SPEAKER_OPTIONS = \["Grandma", "Grandpa"\] as const/);
  assert.match(recorder, /role="radiogroup"/);
  assert.doesNotMatch(recorder, /speakerInputRef|Grandma, Grandpa, or their name/);
  assert.doesNotMatch(
    recorder,
    /useLearning|mode=signin|Sign in before recording|recorder_members|claim_phrase_recorder_access|speaker agreed|consentConfirmed/,
  );
  assert.match(recorder, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(recorder, /MediaRecorder\.isTypeSupported/);
  assert.match(recorder, /\.upload\(storagePath, previewBlob/);
  assert.match(recorder, /\.remove\(\[storagePath\]\)/);
  assert.match(recorder, /\.createSignedUrl\(currentSaved\.storage_path/);
  assert.doesNotMatch(recorder, /getPublicUrl/);
});

test("exports recordings through the linked CLI without revealing an admin key", async () => {
  const exporter = await readFile(
    new URL("../scripts/export-phrase-recordings.mjs", import.meta.url),
    "utf8",
  );
  const processor = await readFile(
    new URL("../scripts/process-phrase-recordings.mjs", import.meta.url),
    "utf8",
  );

  assert.match(exporter, /"db",\s*"query",\s*"--linked"/);
  assert.match(exporter, /"storage",\s*"cp"/);
  assert.doesNotMatch(exporter, /api-keys|service_role|serviceRoleKey/);
  assert.match(processor, /silenceremove=/);
  assert.match(processor, /loudnorm=I=-19:TP=-1\.5/);
  assert.match(processor, /practicaltelugu-\$\{speakerSlug\}-voice-clone\.wav/);
});
