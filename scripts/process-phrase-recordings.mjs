import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { recordingTargets } from "../app/recordings/recording-catalog.ts";

const workspace = process.cwd();
const workRoot = path.join(workspace, "work/recordings");
const stageRoot = path.join(workRoot, "stage");
const masterRoot = path.join(workRoot, "trimmed-masters");
const publicRoot = path.join(workspace, "public/audio/phrases");
const cloneRoot = path.join(workspace, "outputs/voice-cloning");
const manifest = JSON.parse(
  await readFile(path.join(workRoot, "manifest.json"), "utf8"),
);

const START_TRIM =
  "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB:start_silence=0.13:detection=rms:window=0.02";
const END_TRIM =
  "areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB:start_silence=0.18:detection=rms:window=0.02,areverse";

await Promise.all(
  [stageRoot, masterRoot, publicRoot, cloneRoot].map((directory) =>
    mkdir(directory, { recursive: true }),
  ),
);

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}):\n${result.stderr ?? ""}`,
    );
  }

  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function durationSeconds(filePath) {
  const { stdout } = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { capture: true },
  );
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`No duration for ${filePath}`);
  return duration;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function loudnormMeasurements(filePath) {
  const { stderr } = run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-af",
      "loudnorm=I=-19:TP=-1.5:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { capture: true },
  );
  const matches = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches?.length) throw new Error(`Could not measure loudness for ${filePath}`);
  return JSON.parse(matches.at(-1));
}

function quoteConcatPath(filePath) {
  return `file '${filePath.replaceAll("'", "'\\''")}'`;
}

const targetsByKey = new Map(
  recordingTargets.map((target, order) => [target.recordingKey, { ...target, order }]),
);
const latestOverall = new Map();
const latestBySpeakerAndKey = new Map();

for (const row of manifest.rows) {
  if (row.status !== "ready") continue;
  const target = targetsByKey.get(row.recording_key);
  if (!target) throw new Error(`Unknown recording key: ${row.recording_key}`);
  if (row.phrase_telugu !== target.telugu || row.phrase_roman !== target.roman) {
    throw new Error(`Phrase snapshot mismatch: ${row.recording_key}`);
  }
  if (!(["Grandma", "Grandpa"].includes(row.speaker_name))) {
    throw new Error(`Unexpected speaker: ${row.speaker_name}`);
  }

  latestOverall.set(row.recording_key, row);
  latestBySpeakerAndKey.set(`${row.speaker_name}:${row.recording_key}`, row);
}

const expectedKeys = new Set(recordingTargets.map((target) => target.recordingKey));
const missing = [...expectedKeys].filter((key) => !latestOverall.has(key));
if (missing.length || latestOverall.size !== expectedKeys.size) {
  throw new Error(`Recording coverage is incomplete: ${missing.join(", ")}`);
}

const pairRows = [...latestBySpeakerAndKey.values()].sort((left, right) => {
  const orderDifference =
    targetsByKey.get(left.recording_key).order -
    targetsByKey.get(right.recording_key).order;
  return orderDifference || left.speaker_name.localeCompare(right.speaker_name);
});
const processedByRecordingId = new Map();

for (const [index, row] of pairRows.entries()) {
  const target = targetsByKey.get(row.recording_key);
  const speakerSlug = row.speaker_name.toLocaleLowerCase("en-US");
  const inputPath = path.join(workspace, row.local_path);
  const startStagePath = path.join(
    stageRoot,
    `${row.recording_key}-${speakerSlug}-start.wav`,
  );
  const masterPath = path.join(
    masterRoot,
    `${row.recording_key}-${speakerSlug}.wav`,
  );
  const inputDuration = durationSeconds(inputPath);

  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-af",
    START_TRIM,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    "-map_metadata",
    "-1",
    startStagePath,
  ]);
  const startStageDuration = durationSeconds(startStagePath);

  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    startStagePath,
    "-af",
    END_TRIM,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    "-map_metadata",
    "-1",
    masterPath,
  ]);
  const outputDuration = durationSeconds(masterPath);
  if (outputDuration < 0.25) {
    throw new Error(`Trimmed output is too short: ${row.recording_key}`);
  }

  const processed = {
    order: target.order,
    recording_key: row.recording_key,
    telugu: target.telugu,
    roman: target.roman,
    english: target.english,
    speaker: row.speaker_name,
    source_recording_id: row.id,
    source_created_at: row.created_at,
    input_duration_ms: Math.round(inputDuration * 1000),
    trim_start_ms: Math.max(0, Math.round((inputDuration - startStageDuration) * 1000)),
    trim_end_ms: Math.max(0, Math.round((startStageDuration - outputDuration) * 1000)),
    output_duration_ms: Math.round(outputDuration * 1000),
    master_path: path.relative(workspace, masterPath),
    master_sha256: await sha256(masterPath),
  };
  processedByRecordingId.set(row.id, processed);

  if ((index + 1) % 10 === 0 || index === pairRows.length - 1) {
    console.log(`Trimmed ${index + 1}/${pairRows.length}`);
  }
}

const learnerAssets = [];
for (const target of recordingTargets) {
  const row = latestOverall.get(target.recordingKey);
  const processed = processedByRecordingId.get(row.id);
  const masterPath = path.join(workspace, processed.master_path);
  const outputPath = path.join(publicRoot, `${target.recordingKey}.mp3`);
  const measurements = loudnormMeasurements(masterPath);
  const loudnorm = [
    "loudnorm=I=-19:TP=-1.5:LRA=11",
    `measured_I=${measurements.input_i}`,
    `measured_LRA=${measurements.input_lra}`,
    `measured_TP=${measurements.input_tp}`,
    `measured_thresh=${measurements.input_thresh}`,
    `offset=${measurements.target_offset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");

  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    masterPath,
    "-af",
    loudnorm,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    "-map_metadata",
    "-1",
    outputPath,
  ]);

  learnerAssets.push({
    ...processed,
    public_src: `/audio/phrases/${target.recordingKey}.mp3`,
    public_path: path.relative(workspace, outputPath),
    public_sha256: await sha256(outputPath),
    public_duration_ms: Math.round(durationSeconds(outputPath) * 1000),
  });
}

const audioMapLines = learnerAssets
  .map((asset) => `  "${asset.recording_key}": "${asset.public_src}",`)
  .join("\n");
await writeFile(
  path.join(workspace, "app/phrase-audio.generated.ts"),
  `// Generated by scripts/process-phrase-recordings.mjs.\n` +
    `// Do not map recordings by romanization or filename; recording keys are canonical.\n` +
    `export const phraseAudioByRecordingKey: Readonly<Record<string, string>> = {\n` +
    `${audioMapLines}\n` +
    `};\n`,
);

const silencePath = path.join(stageRoot, "silence-200ms.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=44100:cl=mono",
  "-t",
  "0.2",
  "-c:a",
  "pcm_s16le",
  silencePath,
]);

const cloneFiles = {};
for (const speaker of ["Grandma", "Grandpa"]) {
  const speakerRows = pairRows.filter((row) => row.speaker_name === speaker);
  const concatEntries = [];
  for (const [index, row] of speakerRows.entries()) {
    const processed = processedByRecordingId.get(row.id);
    concatEntries.push(quoteConcatPath(path.join(workspace, processed.master_path)));
    if (index < speakerRows.length - 1) {
      concatEntries.push(quoteConcatPath(silencePath));
    }
  }

  const speakerSlug = speaker.toLocaleLowerCase("en-US");
  const concatPath = path.join(stageRoot, `${speakerSlug}-concat.txt`);
  const clonePath = path.join(
    cloneRoot,
    `practicaltelugu-${speakerSlug}-voice-clone.wav`,
  );
  await writeFile(concatPath, `${concatEntries.join("\n")}\n`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    "-map_metadata",
    "-1",
    clonePath,
  ]);

  cloneFiles[speaker] = {
    path: path.relative(workspace, clonePath),
    segment_count: speakerRows.length,
    duration_ms: Math.round(durationSeconds(clonePath) * 1000),
    sha256: await sha256(clonePath),
    recording_keys: speakerRows.map((row) => row.recording_key),
  };
}

const processedManifest = {
  generated_at: new Date().toISOString(),
  trim_filter: `${START_TRIM},${END_TRIM}`,
  learner_assets: learnerAssets,
  voice_clone_files: cloneFiles,
};
await writeFile(
  path.join(workRoot, "processed-manifest.json"),
  `${JSON.stringify(processedManifest, null, 2)}\n`,
);
await writeFile(
  path.join(cloneRoot, "manifest.json"),
  `${JSON.stringify(cloneFiles, null, 2)}\n`,
);

const trimTotals = learnerAssets.map(
  (asset) => asset.trim_start_ms + asset.trim_end_ms,
);
console.log(
  JSON.stringify(
    {
      learner_assets: learnerAssets.length,
      speakers: Object.fromEntries(
        Object.entries(cloneFiles).map(([speaker, value]) => [
          speaker,
          {
            segments: value.segment_count,
            duration_seconds: Number((value.duration_ms / 1000).toFixed(2)),
            path: value.path,
          },
        ]),
      ),
      trim_ms: {
        min: Math.min(...trimTotals),
        max: Math.max(...trimTotals),
        average: Math.round(
          trimTotals.reduce((sum, value) => sum + value, 0) /
            trimTotals.length,
        ),
      },
    },
    null,
    2,
  ),
);
