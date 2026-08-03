import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = process.cwd();
const projectRef = (
  await readFile(path.join(workspace, "supabase/.temp/project-ref"), "utf8")
).trim();
const outputRoot = path.join(workspace, "work/recordings");
const rawRoot = path.join(outputRoot, "raw");
const bucketDownloadRoot = path.join(rawRoot, "phrase-recordings");

const queryResult = JSON.parse(
  execFileSync(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--output-format",
      "json",
      "select recordings.id, recordings.recording_key, recordings.phrase_telugu, recordings.phrase_roman, recordings.phrase_english, recordings.speaker_name, recordings.storage_path, recordings.mime_type, recordings.byte_size, recordings.duration_ms, recordings.status, recordings.created_at from public.phrase_recordings as recordings inner join public.recorder_members as members on members.user_id = recordings.user_id where recordings.status = 'ready' and members.role = 'owner' and members.active order by recordings.created_at;",
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    },
  ),
);
const rows = queryResult.rows ?? [];
const latestByTarget = new Map();
for (const row of rows) latestByTarget.set(row.recording_key, row);
const selectedRows = [...latestByTarget.values()].sort((left, right) =>
  left.created_at.localeCompare(right.created_at),
);

await mkdir(rawRoot, { recursive: true });
execFileSync(
  "supabase",
  [
    "storage",
    "cp",
    "--recursive",
    "ss:///phrase-recordings",
    rawRoot,
    "--linked",
    "--experimental",
    "--jobs",
    "4",
  ],
  {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "ignore", "inherit"],
  },
);

for (const row of rows) {
  const localPath = path.join(bucketDownloadRoot, row.storage_path);
  await access(localPath);
  row.local_path = path.relative(workspace, localPath);
}

const selectedIds = new Set(selectedRows.map((row) => row.id));
const selected = rows.filter((row) => selectedIds.has(row.id));
const manifest = {
  exported_at: new Date().toISOString(),
  project_ref: projectRef,
  row_count: rows.length,
  selected_count: selected.length,
  rows,
  selected,
};

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const speakerCounts = Object.fromEntries(
  [...new Set(selected.map((row) => row.speaker_name))]
    .sort()
    .map((speaker) => [
      speaker,
      selected.filter((row) => row.speaker_name === speaker).length,
    ]),
);

console.log(
  JSON.stringify(
    {
      rows: rows.length,
      selected: selected.length,
      speakers: speakerCounts,
      manifest: "work/recordings/manifest.json",
    },
    null,
    2,
  ),
);
