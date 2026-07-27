import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { allLessons, practicePacks } from "../app/course-data.ts";
import {
  applySnapshotChanges,
  mergeSnapshots,
  parseCloudSnapshot,
  safeAppPath,
  snapshotAdditionsSince,
} from "../app/learning-state.ts";
import {
  phraseKey,
  resolvePracticePath,
  resolvePracticeRoadmap,
} from "../app/practice-path.mjs";

const templateRoot = new URL("../", import.meta.url);
let renderCount = 0;

async function readSourceTree(directory) {
  const sources = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      sources.push(...(await readSourceTree(new URL(`${entry.name}/`, directory))));
    } else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) {
      sources.push(await readFile(entryUrl, "utf8"));
    }
  }

  return sources.join("\n");
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  renderCount += 1;
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${renderCount}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

const routeCases = [
  ["/", /Learn Telugu you’ll actually use/],
  ["/learn", /What do you need to say\?/],
  ["/words", /Find what you need to say\./],
  ["/words/daily", /id="daily-word-title"/],
  ["/settings", />Settings\.<\/h1>/],
  [
    "/account",
    /Checking your account|Keep your Telugu progress\.|Welcome back\./,
  ],
  ["/lesson/hello-goodbye", /class="introduce-exercise"/],
];

test("server-renders every practical route publicly with its intended content", async () => {
  for (const [pathname, heading] of routeCases) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("location"), null, pathname);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
      pathname,
    );

    const html = await response.text();
    assert.match(html, /PracticalTelugu/i, pathname);
    assert.match(html, heading, pathname);
    assert.doesNotMatch(
      html,
      /codex-preview|react-loading-skeleton|You must sign in|Authentication required/i,
      pathname,
    );
  }
});

test("focused word and lesson sessions omit global navigation", async () => {
  for (const pathname of ["/words/daily", "/lesson/hello-goodbye"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.doesNotMatch(html, /aria-label="Primary navigation"/, pathname);
    assert.match(html, /role="progressbar"/, pathname);
  }
});

test("uses the approved peacock mark across brand surfaces", async () => {
  const response = await render("/");
  const html = await response.text();

  assert.match(
    html,
    /practicaltelugu-peacock-mark-v3\.png\?v=approved-1/,
  );
  assert.match(html, /practicaltelugu-favicon-v3\.png\?v=approved-1/);
  assert.match(html, /og\.png\?v=user-logo-3/);
  assert.doesNotMatch(html, /class="wordmark-mark"[^>]*>\s*తె\s*</);
});

test("keeps the home hero focused on one compact action cluster", async () => {
  const response = await render("/");
  const html = await response.text();
  const actionsStart = html.indexOf('class="home-actions"');
  const actionsEnd = html.indexOf("</div>", actionsStart);
  const practiceIndex = html.indexOf("Practice your first five", actionsStart);
  const durationIndex = html.indexOf(
    "Set 1 of 10, about 4 minutes",
    actionsStart,
  );
  const situationIndex = html.indexOf("Choose a situation", actionsStart);

  assert.doesNotMatch(
    html,
    /Five practical Telugu phrases for family visits/,
  );
  assert.ok(actionsStart >= 0, "home action cluster is present");
  assert.ok(practiceIndex > actionsStart, "practice action begins the cluster");
  assert.ok(durationIndex > practiceIndex, "duration follows the practice action");
  assert.ok(
    situationIndex > durationIndex,
    "situation link follows the duration",
  );
  assert.ok(
    situationIndex < actionsEnd,
    "situation link stays inside the action cluster",
  );
  assert.ok(
    html.indexOf('class="home-guide"', actionsEnd) > actionsEnd,
    "hello guide immediately follows the hero",
  );
  const guideStart = html.indexOf('class="home-guide"', actionsEnd);
  const guideEnd = html.indexOf("</section>", guideStart);
  const mayuIntro = html.indexOf("Meet Mayu", guideStart);
  assert.ok(mayuIntro > guideStart, "Mayu is introduced inside the hello guide");
  assert.ok(mayuIntro < guideEnd, "Mayu introduction stays with the mascot");
});

test("shows the entire practical path in one compact roadmap", async () => {
  const response = await render("/");
  const html = await response.text();
  const roadmapStart = html.indexOf('class="home-roadmap"');
  const roadmapEnd = html.indexOf("</section>", roadmapStart);
  const roadmap = html.slice(roadmapStart, roadmapEnd);

  assert.ok(roadmapStart >= 0, "home roadmap is present");
  assert.match(roadmap, /id="home-roadmap-title"/);
  assert.match(roadmap, /<ol class="roadmap-grid">/);
  assert.equal(
    (roadmap.match(/class="roadmap-step /g) ?? []).length,
    practicePacks.length,
  );
  assert.equal(
    (roadmap.match(/roadmap-step-current/g) ?? []).length,
    1,
    "the next set is visually current",
  );
  assert.equal(
    (roadmap.match(/roadmap-step-upcoming/g) ?? []).length,
    practicePacks.length - 1,
    "later sets remain visible",
  );
  assert.equal(
    (roadmap.match(/roadmap-step-completed/g) ?? []).length,
    0,
    "a new learner has no completed sets",
  );
  assert.match(roadmap, /aria-current="step"/);
  assert.match(roadmap, /0 of 10 sets practiced/);
  assert.doesNotMatch(html, /class="situation-preview"/);
  assert.doesNotMatch(html, /class="situation-row"/);

  let previousTitleIndex = -1;
  for (const pack of practicePacks) {
    const titleIndex = roadmap.indexOf(pack.title);
    assert.ok(titleIndex > previousTitleIndex, `${pack.title} is shown in order`);
    previousTitleIndex = titleIndex;
  }
});

test("moves through the practical path five phrases at a time", () => {
  assert.equal(practicePacks.length, 10);
  assert.deepEqual(
    practicePacks.map((pack) => pack.words.length),
    [5, 5, 5, 5, 5, 5, 5, 5, 5, 4],
  );
  assert.deepEqual(
    practicePacks[0].words.map((word) => word.english),
    [
      "hello",
      "thank you",
      "what is your name?",
      "I would like water",
      "please say it again",
    ],
  );

  const pathKeys = practicePacks.flatMap((pack) =>
    pack.words.map((word) => phraseKey(word)),
  );
  const teluguPhrases = practicePacks.flatMap((pack) =>
    pack.words.map((word) => word.telugu),
  );
  assert.equal(new Set(pathKeys).size, 49);
  assert.equal(new Set(teluguPhrases).size, 49);

  const empty = resolvePracticePath(practicePacks, {});
  assert.deepEqual(empty, {
    packIndex: 0,
    phraseIndex: 0,
    completedInPack: 0,
    completedPacks: 0,
    allComplete: false,
  });
  assert.deepEqual(
    resolvePracticeRoadmap(practicePacks, {}).map((step) => step.status),
    ["current", ...Array(9).fill("upcoming")],
  );

  const confidence = {
    [phraseKey(practicePacks[0].words[0])]: "learning",
    [phraseKey(practicePacks[0].words[1])]: "ready",
  };
  assert.equal(
    resolvePracticePath(practicePacks, confidence).phraseIndex,
    2,
  );

  for (const word of practicePacks[0].words) {
    confidence[phraseKey(word)] = "ready";
  }
  const secondPack = resolvePracticePath(practicePacks, confidence);
  assert.equal(secondPack.packIndex, 1);
  assert.equal(secondPack.phraseIndex, 0);
  assert.equal(secondPack.completedPacks, 1);
  const secondPackRoadmap = resolvePracticeRoadmap(
    practicePacks,
    confidence,
  );
  assert.equal(secondPackRoadmap[0].status, "completed");
  assert.equal(secondPackRoadmap[1].status, "current");
  assert.equal(secondPackRoadmap[1].practiced, 0);

  for (const word of practicePacks.flatMap((pack) => pack.words)) {
    confidence[phraseKey(word)] = "ready";
  }
  const complete = resolvePracticePath(practicePacks, confidence);
  assert.equal(complete.allComplete, true);
  assert.equal(complete.completedPacks, practicePacks.length);
  assert.equal(complete.packIndex, 0);
  assert.equal(complete.phraseIndex, 0);
  const completeRoadmap = resolvePracticeRoadmap(
    practicePacks,
    confidence,
  );
  assert.equal(
    completeRoadmap.filter((step) => step.status === "completed").length,
    practicePacks.length,
  );
  assert.equal(
    completeRoadmap.filter((step) => step.status === "current").length,
    0,
  );
});

test("merges device and cloud learning without losing the stronger progress", () => {
  const local = {
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: {
        namaskaaram: "ready",
        dhanyavaadaalu: "learning",
        neellu: "learning",
      },
    },
    preferences: {
      showPronunciation: false,
      autoplay: true,
    },
    savedWords: ["namaskaaram", "neellu"],
  };
  const cloud = parseCloudSnapshot({
    progress: {
      completed: ["hello-goodbye", "checking-in"],
      confidence: {
        namaskaaram: "learning",
        dhanyavaadaalu: "ready",
        baagunnaanu: "learning",
      },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    saved_words: ["namaskaaram", "baagunnaanu"],
  });

  assert.ok(cloud);
  const merged = mergeSnapshots(local, cloud);

  assert.deepEqual(
    new Set(merged.state.completed),
    new Set(["hello-goodbye", "at-the-table", "checking-in"]),
  );
  assert.deepEqual(
    new Set(merged.savedWords),
    new Set(["namaskaaram", "neellu", "baagunnaanu"]),
  );
  assert.deepEqual(merged.state.confidence, {
    namaskaaram: "ready",
    dhanyavaadaalu: "ready",
    baagunnaanu: "learning",
    neellu: "learning",
  });
  assert.deepEqual(
    merged.preferences,
    local.preferences,
    "the current device keeps its pronunciation and autoplay choices",
  );
});

test("imports only new anonymous progress after an account has claimed a device", () => {
  const baseline = {
    state: {
      completed: ["hello-goodbye"],
      confidence: { namaskaaram: "ready" },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    savedWords: ["namaskaaram"],
  };
  const current = {
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: {
        namaskaaram: "ready",
        neellu: "learning",
      },
    },
    preferences: {
      showPronunciation: false,
      autoplay: true,
    },
    savedWords: ["namaskaaram", "neellu"],
  };

  assert.deepEqual(snapshotAdditionsSince(current, baseline), {
    state: {
      completed: ["at-the-table"],
      confidence: { neellu: "learning" },
    },
    preferences: current.preferences,
    savedWords: ["neellu"],
  });
});

test("preserves additions and removals made while cloud progress is loading", () => {
  const baseline = {
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: {
        namaskaaram: "ready",
        neellu: "learning",
      },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    savedWords: ["namaskaaram", "neellu"],
  };
  const current = {
    state: {
      completed: ["hello-goodbye", "checking-in"],
      confidence: {
        namaskaaram: "learning",
        baagunnaanu: "ready",
      },
    },
    preferences: {
      showPronunciation: false,
      autoplay: true,
    },
    savedWords: ["neellu", "baagunnaanu"],
  };
  const cloud = {
    state: {
      completed: ["hello-goodbye", "at-the-table", "getting-around"],
      confidence: {
        namaskaaram: "ready",
        neellu: "learning",
        ekkada: "ready",
      },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    savedWords: ["namaskaaram", "neellu", "ekkada"],
  };

  assert.deepEqual(applySnapshotChanges(baseline, current, cloud), {
    state: {
      completed: ["hello-goodbye", "getting-around", "checking-in"],
      confidence: {
        namaskaaram: "learning",
        ekkada: "ready",
        baagunnaanu: "ready",
      },
    },
    preferences: current.preferences,
    savedWords: ["neellu", "ekkada", "baagunnaanu"],
  });
});

test("a reset during cloud loading stays a reset", () => {
  const baseline = {
    state: {
      completed: ["hello-goodbye"],
      confidence: { namaskaaram: "ready" },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    savedWords: ["namaskaaram"],
  };
  const reset = {
    state: { completed: [], confidence: {} },
    preferences: {
      showPronunciation: false,
      autoplay: false,
    },
    savedWords: [],
  };
  const cloud = {
    state: {
      completed: ["hello-goodbye", "at-the-table"],
      confidence: { namaskaaram: "ready", neellu: "learning" },
    },
    preferences: {
      showPronunciation: true,
      autoplay: true,
    },
    savedWords: ["namaskaaram", "neellu"],
  };

  assert.deepEqual(applySnapshotChanges(baseline, reset, cloud), reset);
});

test("keeps account return paths on the current site", () => {
  assert.equal(safeAppPath("/lesson/hello-goodbye?from=account"), "/lesson/hello-goodbye?from=account");
  assert.equal(safeAppPath("//evil.example"), "/");
  assert.equal(safeAppPath("/\\evil.example"), "/");
  assert.equal(safeAppPath("https://evil.example"), "/");
  assert.equal(safeAppPath(null), "/");
});

test("rejects malformed cloud rows so they cannot erase device progress", () => {
  const local = {
    state: {
      completed: ["hello-goodbye"],
      confidence: { namaskaaram: "ready" },
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    savedWords: ["namaskaaram"],
  };
  const malformedRows = [
    null,
    {},
    {
      progress: "not an object",
      preferences: {},
      saved_words: [],
    },
    {
      progress: { completed: "not an array", confidence: {} },
      preferences: {},
      saved_words: [],
    },
    {
      progress: { completed: [], confidence: ["not", "an", "object"] },
      preferences: {},
      saved_words: [],
    },
    {
      progress: { completed: [], confidence: {} },
      preferences: "not an object",
      saved_words: [],
    },
    {
      progress: { completed: [], confidence: {} },
      preferences: {},
      saved_words: "not an array",
    },
  ];

  for (const row of malformedRows) {
    const cloud = parseCloudSnapshot(row);
    assert.equal(cloud, null);
    const retained = cloud ? mergeSnapshots(local, cloud) : local;
    assert.deepEqual(retained, local);
  }
});

test("keeps meaning, romanized Telugu, pronunciation, and script distinct", async () => {
  for (const pathname of ["/words/daily", "/lesson/hello-goodbye"]) {
    const response = await render(pathname);
    const html = await response.text();
    const englishIndex = html.indexOf("phrase-english");
    const romanIndex = html.indexOf("phrase-roman");
    const pronunciationIndex = html.indexOf("phrase-pronunciation");
    const teluguIndex = html.indexOf("phrase-telugu");

    assert.ok(englishIndex >= 0, `${pathname}: English phrase is present`);
    assert.ok(
      romanIndex > englishIndex,
      `${pathname}: romanized Telugu follows English`,
    );
    assert.ok(
      pronunciationIndex > romanIndex,
      `${pathname}: pronunciation follows romanized Telugu`,
    );
    assert.ok(
      teluguIndex > pronunciationIndex,
      `${pathname}: Telugu follows pronunciation`,
    );
    assert.ok(
      html.indexOf("(nuh-muh-SKAA-rum)", pronunciationIndex) >
        pronunciationIndex,
      `${pathname}: easy pronunciation is enclosed in parentheses`,
    );
    assert.doesNotMatch(html, /\(namaskaaram\)/);
  }
});

test("every phrase has a separate curated speaking cue", () => {
  const seenByTelugu = new Map();

  for (const word of allLessons.flatMap((lesson) => lesson.words)) {
    assert.ok(word.roman.trim(), `${word.telugu}: romanization is present`);
    assert.ok(
      word.pronunciation.trim(),
      `${word.telugu}: pronunciation is present`,
    );
    assert.notEqual(
      word.roman.toLocaleLowerCase(),
      word.pronunciation.toLocaleLowerCase(),
      `${word.telugu}: pronunciation is not a duplicate romanization`,
    );
    assert.doesNotMatch(word.roman, /^\(.*\)$/);
    assert.doesNotMatch(word.pronunciation, /^\(.*\)$/);

    const existing = seenByTelugu.get(word.telugu);
    if (existing) {
      assert.deepEqual(
        { roman: word.roman, pronunciation: word.pronunciation },
        existing,
        `${word.telugu}: repeated phrases keep the same speaking guide`,
      );
    } else {
      seenByTelugu.set(word.telugu, {
        roman: word.roman,
        pronunciation: word.pronunciation,
      });
    }
  }

  assert.equal(seenByTelugu.size, 49);
});

test("unknown lesson URLs return a real not-found response", async () => {
  const response = await render("/lesson/not-a-real-lesson");
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /That page is not available\./);
  assert.match(html, /href="\/"/);
});

test("keeps cloud learning state private to its authenticated owner", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260727180014_user_learning_state.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /create table public\.user_learning_state\s*\(/i,
  );
  assert.match(
    migration,
    /user_id uuid primary key references auth\.users\s*\(id\) on delete cascade/i,
  );
  assert.match(migration, /progress jsonb not null/i);
  assert.match(migration, /preferences jsonb not null/i);
  assert.match(migration, /saved_words text\[\] not null/i);
  assert.match(
    migration,
    /alter table public\.user_learning_state enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.user_learning_state from anon/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]*to authenticated/i,
  );

  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(
        `create policy "[^"]+"\\s+on public\\.user_learning_state\\s+for ${operation}\\s+to authenticated`,
        "i",
      ),
      `${operation} is limited to authenticated users`,
    );
  }

  assert.ok(
    (migration.match(/\(select auth\.uid\(\)\) = user_id/gi) ?? []).length >=
      4,
    "every operation checks the authenticated user's id",
  );
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]*?\bto\s+(?:anon|public)\b/i,
  );
});

test("merges concurrent device writes with optimistic revisions", async () => {
  const [revisionMigration, learningProvider] = await Promise.all([
    readFile(
      new URL(
        "../supabase/migrations/20260727185800_add_learning_state_revision.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/LearningProvider.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(
    revisionMigration,
    /add column revision bigint not null default 0/i,
  );
  assert.match(revisionMigration, /check \(revision >= 0\)/i);
  assert.match(
    learningProvider,
    /applySnapshotChanges\(\s*baseline\.snapshot,\s*next,\s*latestSnapshot/s,
  );
  assert.match(learningProvider, /\.eq\("revision", latestRevision\)/);
  assert.match(learningProvider, /for \(let attempt = 0; attempt < 4/);
  assert.match(learningProvider, /insertError\?\.code === "23505"/);
});

test("never exposes a Supabase service credential in browser source", async () => {
  const clientSource = await readSourceTree(
    new URL("../app/", import.meta.url),
  );

  assert.doesNotMatch(
    clientSource,
    /SUPABASE_SERVICE_ROLE(?:_KEY)?|service[_-]?role|sb_secret_/i,
  );
  assert.doesNotMatch(
    clientSource,
    /SUPABASE_DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_URL/i,
  );
  assert.doesNotMatch(
    clientSource,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  );

  const supabaseClient = await readFile(
    new URL("../app/supabase-client.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    supabaseClient,
    /sb_publishable_|NEXT_PUBLIC_SUPABASE_(?:PUBLISHABLE|ANON)_KEY/,
  );
});

test("offers Google and email account creation without gating practice", async () => {
  const [accountPage, learningProvider] = await Promise.all([
    readFile(new URL("../app/account/AccountPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LearningProvider.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(accountPage, /Continue with Google/);
  assert.match(accountPage, /type="email"/);
  assert.match(accountPage, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(accountPage, /Create account/);
  assert.match(accountPage, /Sign in/);
  assert.match(accountPage, /The progress on this device will be added/);
  assert.match(learningProvider, /auth\.signInWithPassword/);
  assert.match(learningProvider, /auth\.signUp/);
  assert.match(learningProvider, /provider: "google"/);
  assert.doesNotMatch(accountPage, /router\.(?:push|replace)\(["']\/account/);
});

test("failed cloud reads refetch before writing and preserve later device progress", async () => {
  const learningProvider = await readFile(
    new URL("../app/LearningProvider.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    learningProvider,
    /reconciliationFailedRef\.current = true[\s\S]*setSyncStatus\("error"\)/,
  );
  assert.match(
    learningProvider,
    /if \(reconciliationFailedRef\.current\) \{[\s\S]*setReconcileRetry/,
  );
  assert.match(
    learningProvider,
    /userCacheIsDirty[\s\S]*mergeSnapshots\(userSnapshot, cloudSnapshot\)/,
  );
  assert.match(
    learningProvider,
    /userCacheBaseline[\s\S]*applySnapshotChanges\(\s*userCacheBaseline,\s*userSnapshot,\s*cloudSnapshot/s,
  );
  assert.match(learningProvider, /keys\.cloudBaseline/);
  assert.match(
    learningProvider,
    /shouldClaimAnonymous = !claimedBy \|\| claimedBy === user\.id/,
  );
});

test("keeps prior progress while enforcing the practical Telugu product contract", async () => {
  const [
    app,
    courseData,
    layout,
    css,
    learningState,
    learningProvider,
    packageJson,
    readme,
  ] = await Promise.all([
    readFile(new URL("../app/PalukuApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/course-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/learning-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LearningProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  const progressSource = `${learningState}\n${learningProvider}`;
  assert.match(progressSource, /palukulu\.progress\.v2/);
  assert.match(progressSource, /palukulu\.progress\.v1/);
  assert.match(progressSource, /LEGACY_STORAGE_KEY/);
  assert.match(
    learningProvider,
    /parseCurrentProgress\(readJson\(STORAGE_KEY\)\)[\s\S]*parseLegacyProgress\(readJson\(LEGACY_STORAGE_KEY\)\)/,
  );
  assert.match(
    learningState,
    /completed: uniqueStrings\(candidate\.completed\)/,
  );
  assert.match(
    learningState,
    /confidence: confidenceFrom\(candidate\.confidence\)/,
  );
  assert.match(learningProvider, /if \(!hydrated\) return;/);
  assert.match(app, /correct \/ graded >= 0\.6/);
  assert.match(
    app,
    /current\.completed\.includes\(lesson\.id\)[\s\S]*\[\.\.\.current\.completed, lesson\.id\]/,
  );
  assert.match(app, /resolvePracticePath\(practicePacks, state\.confidence\)/);
  assert.match(app, /key=\{hydrated \? "daily-restored" : "daily-initial"\}/);
  assert.match(
    app,
    /Continue to \$\{nextPack\.title\.toLocaleLowerCase\(\)\}/,
  );
  assert.doesNotMatch(app, /const dailyWords/);
  assert.match(app, /type: "introduce"/);
  assert.match(app, /type: "matching"/);
  assert.match(app, /tokens: phrase\.roman\.trim\(\)/);
  assert.doesNotMatch(app, /tokens: phrase\.telugu\.trim\(\)/);
  assert.match(
    app,
    /normalize\(answer\) === normalize\(step\.word\.roman\)/,
  );
  assert.doesNotMatch(
    app,
    /normalize\(answer\) === normalize\(step\.word\.pronunciation\)/,
  );
  assert.match(
    app,
    /className="phrase-english"[\s\S]*<SpokenGuide[\s\S]*className="phrase-telugu"/,
  );
  assert.match(
    app,
    /className="phrase-roman"[\s\S]*word\.roman[\s\S]*className="phrase-pronunciation"[\s\S]*formatPronunciation\(word\.pronunciation\)/,
  );
  assert.match(
    app,
    /word=\{words\[wordIndex\]\}[\s\S]*showPronunciation=\{showPronunciation\}/,
  );
  assert.match(
    app,
    /\$\{word\.telugu\} \$\{word\.roman\} \$\{word\.pronunciation\} \$\{word\.english\}/,
  );
  assert.match(
    learningState,
    /legacyShowRomanization = candidate\.showRomanization/,
  );
  assert.doesNotMatch(app, /formatPronunciation\(word\.roman\)/);
  assert.doesNotMatch(app, /Choose the pronunciation in order/);
  assert.doesNotMatch(app, /teluguFirst|Show Telugu larger/);
  assert.match(courseData, /SituationGroup/);
  assert.match(courseData, /situationGroups/);
  assert.match(courseData, /quick-start/);
  assert.match(courseData, /minutes: 4/);
  assert.match(courseData, /essentials-milestone/);
  assert.match(courseData, /building-blocks-milestone/);
  assert.match(courseData, /export const practicePacks/);
  assert.match(courseData, /learnerPronunciations/);
  assert.match(courseData, /Missing learner pronunciation/);

  const productCopy = `${app}\n${courseData}\n${layout}\n${learningState}\n${learningProvider}\n${readme}`;
  assert.doesNotMatch(
    productCopy,
    /from beginning|full course|telugu script & sounds|foundationLessons|selectedTrack/i,
  );
  assert.doesNotMatch(app, /\b(?:xp|streak|energy|dailyGoal)\b/i);
  assert.doesNotMatch(app, /showOnboarding|onboarding-screen/);

  const exactDisplayFontEmbed =
    "https://fonts.googleapis.com/css2?family=Capriola&family=Nunito+Sans:opsz,wght@6..12,400;6..12,500;6..12,600;6..12,700;6..12,800&display=swap";
  assert.ok(layout.includes(exactDisplayFontEmbed));
  assert.doesNotMatch(layout, /Geist\+Pixel|Turret\+Road/);
  assert.match(layout, /Noto\+Sans\+Telugu/);
  assert.match(css, /"Noto Sans Telugu"/);
  assert.match(css, /"Nunito Sans"/);
  assert.doesNotMatch(css, /"Geist Pixel"|"Turret Road"/);
  assert.doesNotMatch(css, /transition(?:-property)?:\s*all\b/);
  assert.match(
    css,
    /\.home-hero h1\s*\{[^}]*white-space:\s*nowrap;/,
  );
  assert.match(
    css,
    /@media \(max-width: 980px\)[\s\S]*?\.home-hero h1\s*\{[^}]*white-space:\s*normal;/,
  );
  assert.match(
    css,
    /\.wordmark-mark\s*\{[^}]*width:\s*41px;[^}]*transform:\s*translateY\(8px\);/,
  );
  assert.match(
    css,
    /@media \(max-width: 440px\)[\s\S]*?\.wordmark-mark\s*\{[^}]*width:\s*34px;[^}]*transform:\s*translateY\(6px\);/,
  );
  assert.doesNotMatch(productCopy, /[—·]/);
  assert.doesNotMatch(app, /overline|pixel-meta/);
  assert.match(app, /const practiceMeta = path\.allComplete/);
  assert.match(app, /Recording soon/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /type MayuVariant = "guide" \| "success"/);
  assert.match(app, /mayu-\$\{variant\}-v2\.webp/);
  assert.match(css, /\.home-mayu img\s*\{[^}]*animation:\s*mayu-sway/);
  assert.match(css, /@keyframes mayu-sway/);
  assert.doesNotMatch(
    app,
    /mayu-(?:welcome|teach|listen|encourage|celebrate|read)\.webp/,
  );
  await access(new URL("public/mayu-guide-v2.webp", templateRoot));
  await access(new URL("public/mayu-success-v2.webp", templateRoot));
  await access(
    new URL("public/practicaltelugu-peacock-mark-v3.png", templateRoot),
  );
  await access(
    new URL("public/practicaltelugu-favicon-v3.png", templateRoot),
  );
  await access(
    new URL("public/practicaltelugu-apple-icon-v3.png", templateRoot),
  );
  await access(new URL("public/og.png", templateRoot));
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

test("prior lesson links remain available as open practical situations", async () => {
  for (const pathname of [
    "/lesson/i-you-we",
    "/lesson/building-blocks-milestone",
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), /class="introduce-exercise"/, pathname);
  }
});

test("route modules select the intended screen without manual history routing", async () => {
  const routeFiles = [
    ["../app/page.tsx", "today"],
    ["../app/learn/page.tsx", "learn"],
    ["../app/words/page.tsx", "words"],
    ["../app/words/daily/page.tsx", "daily"],
    ["../app/settings/page.tsx", "settings"],
    ["../app/lesson/[slug]/page.tsx", "lesson"],
  ];

  for (const [path, screen] of routeFiles) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, new RegExp(`screen="${screen}"`), path);
  }

  const app = await readFile(
    new URL("../app/PalukuApp.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /from "next\/link"/);
  assert.match(app, /from "next\/navigation"/);
  assert.doesNotMatch(app, /history\.pushState/);
});
