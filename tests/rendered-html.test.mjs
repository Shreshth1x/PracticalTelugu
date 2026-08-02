import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  allLessons,
  findLesson,
  practicePacks,
} from "../app/course-data.ts";
import {
  applySnapshotChanges,
  canonicalPhraseKey,
  mergeSnapshots,
  normalizeLearningSnapshot,
  parseCloudSnapshot,
  parseCurrentProgress,
  parseSavedWords,
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

const previousPhrasebookKeys = [
  "నమస్కారం::hello",
  "ఎలా ఉన్నారు?::how are you? (respectful)",
  "బాగున్నాను::I’m well",
  "మళ్లీ కలుద్దాం::see you again",
  "ధన్యవాదాలు::thank you",
  "దయచేసి::please",
  "పరవాలేదు::it’s okay / no problem",
  "క్షమించండి::sorry / excuse me",
  "అవును::yes",
  "కాదు::no",
  "సరే::okay",
  "తెలియదు::I don’t know",
  "మీ పేరు ఏంటి?::what is your name?",
  "నా పేరు…::my name is…",
  "మిమ్మల్ని కలవడం సంతోషం::nice to meet you",
  "మీరు ఎక్కడి నుంచి?::where are you from?",
  "తిన్నారా?::have you eaten?",
  "మీరు ఎలా ఉన్నారు?::how are you? (respectful)",
  "మీరు ఎక్కడ ఉన్నారు?::where are you?",
  "అమ్మ ఇంట్లో ఉన్నారా?::is mom at home?",
  "నీళ్లు కావాలి::I would like water",
  "ఇది చాలా బాగుంది::this is very good",
  "ఇంకొంచెం::a little more",
  "చాలు::that’s enough",
  "నాకు అర్థం కాలేదు::I didn’t understand",
  "మెల్లగా చెప్పండి::please say it slowly",
  "మళ్లీ చెప్పండి::please say it again",
  "నాకు తెలుగు బాగా రాదు::I don’t know Telugu well",
  "నేను బాగున్నాను::I am well",
  "నాకు అలసటగా ఉంది::I am tired",
  "నాకు సంతోషంగా ఉంది::I am happy",
  "మీరు ఎలా ఉన్నారు?::how are you?",
  "నేను రేపు వస్తాను::I’ll come tomorrow",
  "మీరు ఎప్పుడు ఇంట్లో ఉంటారు?::when will you be home?",
  "నేను ఇప్పుడు బయల్దేరాను::I’m leaving now",
  "మళ్లీ కలుద్దాం::let’s meet again",
  "నాకు ఇది కావాలి::I want this",
  "నాకు ఇది వద్దు::I don’t want this",
  "ఇది ఎంత?::how much is this?",
  "అది::that one",
  "బస్ స్టాప్ ఎక్కడ ఉంది?::where is the bus stop?",
  "ఇక్కడ ఆపండి దయచేసి::stop here, please",
  "సూటిగా వెళ్ళండి::go straight",
  "ఇది అక్కడికి వెళ్లే దారినా?::is this the way there?",
  "చాలా ఖరీదు::too expensive",
  "ధర తగ్గించగలరా?::can you reduce the price?",
  "చేంజ్ ఉందా?::do you have change?",
  "నాకు ఒంట్లో బాగా లేదు::I’m not feeling well",
  "నాకు కొంచెం జ్వరంగా ఉంది::I have a slight fever",
  "నాకు డాక్టర్ కావాలి::I need a doctor",
  "నాకు సహాయం కావాలి::I need help",
];

async function readSourceTree(directory) {
  const sources = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      sources.push(await readSourceTree(new URL(`${entry.name}/`, directory)));
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
  ["/practice-live", /Practice Telugu out loud\./],
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

test("keeps direct recording access unlisted and private", async () => {
  const [recorderResponse, homeResponse, recorderPage] = await Promise.all([
    render("/recordings"),
    render("/"),
    readFile(new URL("../app/recordings/page.tsx", import.meta.url), "utf8"),
  ]);
  const [recorderHtml, homeHtml] = await Promise.all([
    recorderResponse.text(),
    homeResponse.text(),
  ]);

  assert.equal(recorderResponse.status, 200);
  assert.match(recorderHtml, /Voice recorder/);
  assert.match(recorderHtml, /Preparing the recorder/);
  assert.match(recorderHtml, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(homeHtml, /href="\/recordings"/);
  assert.match(recorderPage, /robots:\s*\{[\s\S]*index:\s*false/);
});

test("focused word and lesson sessions omit global navigation", async () => {
  for (const pathname of ["/words/daily", "/lesson/hello-goodbye"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.doesNotMatch(html, /aria-label="Primary navigation"/, pathname);
    assert.match(html, /role="progressbar"/, pathname);
  }
});

test("puts Practice Live in the public navigation and marks its route", async () => {
  const response = await render("/practice-live");
  const html = await response.text();
  const navStart = html.indexOf('aria-label="Primary navigation"');
  const navEnd = html.indexOf("</nav>", navStart);
  const navigation = html.slice(navStart, navEnd);

  assert.ok(navStart >= 0, "primary navigation is present");
  assert.match(navigation, /href="\/practice-live"/);
  assert.match(navigation, />Practice Live<\/a>/);
  assert.match(
    navigation,
    /top-nav-link top-nav-link-active[^>]*aria-current="page"[^>]*>Practice Live/,
  );
});

test("keeps live practice grounded in useful non-greeting situations", async () => {
  const source = await readFile(
    new URL("../app/practice-live/live-scenarios.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /id: "family-check-in"/);
  assert.match(source, /id: "at-the-table"/);
  assert.match(source, /id: "when-stuck"/);
  assert.match(source, /findPracticePack\("family-check-in"\)/);
  assert.match(source, /findPracticePack\("at-the-table"\)/);
  assert.match(source, /findPracticeLesson\("when-stuck"\)/);
  assert.doesNotMatch(source, /findPracticeWord\([^)]*"(?:hello|thank-you)"/);
});

test("keeps Practice Live Telugu in English letters with English directly underneath", async () => {
  const [response, source] = await Promise.all([
    render("/practice-live"),
    readFile(
      new URL("../app/practice-live/PracticeLive.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const html = await response.text();
  const teluguScript = /[\u0c00-\u0c7f]/u;

  assert.doesNotMatch(html, teluguScript);
  assert.doesNotMatch(source, /\.telugu\b/);
  assert.doesNotMatch(source, /lang="te"/);
  assert.doesNotMatch(source, /turn\.text/);
  assert.doesNotMatch(source, /live-follow-telugu/);

  const currentTurnStart = source.indexOf('className="live-follow-spoken"');
  const currentTurnEnd = source.indexOf("</div>", source.indexOf('className="live-follow-english"'));
  const currentTurn = source.slice(currentTurnStart, currentTurnEnd);
  assert.ok(currentTurnStart >= 0, "current spoken turn is present");
  assert.ok(
    currentTurn.indexOf('className="live-follow-roman"') <
      currentTurn.indexOf('className="live-follow-english"'),
    "English follows Telugu written in English letters in the current turn",
  );

  const transcriptStart = source.indexOf('className="live-transcript-copy"');
  const transcriptEnd = source.indexOf(") : (", transcriptStart);
  const transcript = source.slice(transcriptStart, transcriptEnd);
  assert.ok(transcriptStart >= 0, "paired transcript copy is present");
  assert.ok(
    transcript.indexOf("live-transcript-roman") <
      transcript.indexOf("live-transcript-english"),
    "English follows Telugu written in English letters in every transcript turn",
  );
});

test("makes Live register, time cap, and microphone processing explicit before start", async () => {
  const response = await render("/practice-live");
  const html = await response.text();

  assert.match(html, /Who are you speaking with\?/);
  assert.match(html, /Someone close/);
  assert.match(html, /Elder or someone new/);
  assert.match(html, /Safest even when someone new is your age/);
  assert.match(html, /Quick practice/);
  assert.match(html, />1:00</);
  assert.match(html, /Full practice/);
  assert.match(html, />2:00</);
  assert.match(html, /audio is sent to Google Gemini/);
  assert.match(html, /PracticalTelugu does not save your audio/);
});

test("keeps the completed Live session focused on an honest coaching dashboard", async () => {
  const [pageSource, gradingSource] = await Promise.all([
    readFile(
      new URL("../app/practice-live/PracticeLive.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/practice-live/live-session-grading.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /className="live-results"/);
  assert.match(pageSource, /Pronunciation/);
  assert.match(pageSource, /Accuracy/);
  assert.match(pageSource, /Response time/);
  assert.match(pageSource, /Your next rep/);
  assert.match(pageSource, /Review your conversation/);
  assert.match(pageSource, /not a phoneme-by-phoneme accent grade/);
  assert.ok(
    pageSource.indexOf("<SessionResults") <
      pageSource.indexOf('className="live-review"'),
    "the score appears before the optional transcript review",
  );
  assert.match(gradingSource, /scoreLiveResponseTime/);
  assert.match(gradingSource, /METRIC_WEIGHTS/);
});

test("keeps the permanent Gemini key on the server", async () => {
  const clientSource = await readFile(
    new URL("../app/practice-live/useGeminiLive.ts", import.meta.url),
    "utf8",
  );
  const routeSource = await readFile(
    new URL("../app/api/practice-live/token/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(clientSource, /fetch\("\/api\/practice-live\/token"/);
  assert.doesNotMatch(clientSource, /GEMINI_API_KEY|NEXT_PUBLIC_GEMINI/);
  assert.doesNotMatch(clientSource, /SESSION_LIMIT_SECONDS = 5 \* 60/);
  assert.match(clientSource, /deadlineTimerRef/);
  assert.match(clientSource, /sessionLimitSeconds/);
  assert.match(clientSource, /durationSeconds/);
  assert.match(clientSource, /relationship/);
  assert.match(clientSource, /sendRealtimeInput\(\{\s*text:/);
  assert.doesNotMatch(clientSource, /sendClientContent\(/);
  assert.match(clientSource, /project has been denied access/);
  assert.match(clientSource, /onclose:\s*\(event\)/);
  assert.match(routeSource, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(routeSource, /NEXT_PUBLIC_/);
  assert.match(routeSource, /uses:\s*1/);
  assert.match(routeSource, /NEW_SESSION_WINDOW_SECONDS = 60/);
  assert.match(routeSource, /SESSION_DRAIN_HEADROOM_SECONDS = 10/);
  assert.match(routeSource, /durationSeconds \+ TOKEN_EXPIRY_HEADROOM_SECONDS/);
  assert.match(routeSource, /SHORT_WINDOW_STARTS = 6/);
  assert.match(routeSource, /DAILY_STARTS = 20/);
  assert.match(routeSource, /"Retry-After"/);
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
      "could I have some water?",
      "please say it again",
    ],
  );

  const pathKeys = practicePacks.flatMap((pack) =>
    pack.words.map((word) => phraseKey(word)),
  );
  const phraseIds = practicePacks.flatMap((pack) =>
    pack.words.map((word) => word.id),
  );
  const teluguPhrases = practicePacks.flatMap((pack) =>
    pack.words.map((word) => word.telugu),
  );
  assert.equal(new Set(pathKeys).size, 49);
  assert.equal(new Set(phraseIds).size, 49);
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
  const seenById = new Map();

  for (const word of allLessons.flatMap((lesson) => lesson.words)) {
    assert.ok(word.id.trim(), `${word.telugu}: stable id is present`);
    assert.ok(
      word.progressKey.trim(),
      `${word.telugu}: progress key is present`,
    );
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

    const existingById = seenById.get(word.id);
    if (existingById) {
      assert.equal(
        word.progressKey,
        existingById,
        `${word.id}: repeated lesson entries keep the same progress identity`,
      );
    } else {
      seenById.set(word.id, word.progressKey);
    }

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

    for (const alternative of word.alternatives ?? []) {
      assert.ok(alternative.label.trim(), `${word.id}: alternative is labeled`);
      assert.ok(
        alternative.telugu.trim(),
        `${word.id}: alternative Telugu is present`,
      );
      assert.ok(
        alternative.roman.trim(),
        `${word.id}: alternative romanization is present`,
      );
      assert.ok(
        alternative.pronunciation.trim(),
        `${word.id}: alternative pronunciation is present`,
      );
      assert.notEqual(
        alternative.telugu,
        word.telugu,
        `${word.id}: alternative differs from the primary phrase`,
      );
    }
  }

  assert.equal(seenByTelugu.size, 49);
  assert.equal(seenById.size, 49);
});

test("uses complete Telugu phrases while preserving earlier progress keys", async () => {
  const hello = findLesson("hello-goodbye")?.words[0];
  const thankYou = findLesson("please-thank-you")?.words[0];
  const water = findLesson("food-water")?.words[0];

  assert.ok(hello);
  assert.ok(thankYou);
  assert.ok(water);
  assert.equal(hello.telugu, "నమస్కారం");
  assert.equal(phraseKey(hello), "నమస్కారం::hello");
  assert.equal(thankYou.telugu, "ధన్యవాదాలు");
  assert.equal(phraseKey(thankYou), "ధన్యవాదాలు::thank you");
  assert.equal(water.telugu, "నీళ్లు ఇస్తారా?");
  assert.equal(
    phraseKey(water),
    "నీళ్లు కావాలి::I would like water",
  );

  const firstPackAfterHello = resolvePracticePath(practicePacks, {
    "నమస్కారం::hello": "ready",
  });
  assert.equal(firstPackAfterHello.packIndex, 0);
  assert.equal(firstPackAfterHello.phraseIndex, 1);

  const response = await render("/lesson/hello-goodbye");
  const html = await response.text();
  const greetingIndex = html.indexOf(">నమస్కారం</span>");
  const registerIndex = html.indexOf("Extra respectful");
  const respectfulIndex = html.indexOf("నమస్కారం అండి");

  assert.ok(greetingIndex >= 0, "the Telugu greeting is taught first");
  assert.ok(registerIndex > greetingIndex, "register guidance follows it");
  assert.ok(
    respectfulIndex > registerIndex,
    "respectful greeting is clearly secondary",
  );
});

test("keeps familiar listener context attached to primary learning surfaces", async () => {
  const askName = findLesson("names-introductions")?.words.find(
    (word) => word.id === "ask-name",
  );

  assert.ok(askName);
  assert.equal(askName.usage?.audience, "familiar");
  assert.equal(askName.usage?.kind, "relationship");

  for (const pathname of ["/words", "/lesson/names-introductions"]) {
    const response = await render(pathname);
    const html = await response.text();
    const familiarPhraseIndex = html.indexOf(">nee peru enti?</span>");
    const familiarContextIndex = html.lastIndexOf(
      ">Someone close</span>",
      familiarPhraseIndex,
    );

    assert.ok(
      familiarPhraseIndex >= 0,
      `${pathname}: familiar name question is rendered`,
    );
    assert.ok(
      familiarContextIndex >= 0 &&
        familiarPhraseIndex - familiarContextIndex < 600,
      `${pathname}: Someone close stays attached to the familiar phrase`,
    );
  }

  const appSource = await readFile(
    new URL("../app/PalukuApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    appSource,
    /showUsageContext \?\? resolveTeluguFormUsage\(word\.usage\)\.showContext/,
    "PhraseStack defaults to the word's semantic usage context",
  );
  assert.doesNotMatch(
    appSource,
    /showUsageContext=\{false\}/,
    "primary learning surfaces do not suppress register context",
  );
  assert.match(
    appSource,
    /english: step\.shownMeaning,[\s\S]{0,220}usage: step\.word\.usage/,
    "constructed assessment phrases retain their usage metadata",
  );
});

test("never presents a copied English pronunciation as Telugu", () => {
  const copiedTelugu =
    /హాయ్|థ్యాంక్స్|ప్లీజ్|సారీ|హ్యాపీ|బస్ స్టాప్|చేంజ్|డాక్టర్/;
  const copiedRoman =
    /\b(?:haay|thanks|please|saari|happi\w*|bus stop|change|doctor)\b/i;

  for (const word of allLessons.flatMap((lesson) => lesson.words)) {
    assert.doesNotMatch(word.telugu, copiedTelugu, `${word.id}: Telugu phrase`);
    assert.doesNotMatch(
      word.roman,
      copiedRoman,
      `${word.id}: romanized Telugu`,
    );

    for (const alternative of word.alternatives ?? []) {
      assert.doesNotMatch(
        alternative.telugu,
        copiedTelugu,
        `${word.id}: alternative Telugu phrase`,
      );
      assert.doesNotMatch(
        alternative.roman,
        copiedRoman,
        `${word.id}: alternative romanized Telugu`,
      );
    }
  }
});

test("migrates every phrasebook key from the previous course", () => {
  const currentKeys = new Set(
    allLessons
      .flatMap((lesson) => lesson.words)
      .map((word) => phraseKey(word)),
  );
  const previousConfidence = Object.fromEntries(
    previousPhrasebookKeys.map((key) => [key, "learning"]),
  );

  assert.equal(previousPhrasebookKeys.length, 51);
  assert.equal(currentKeys.size, 49);

  previousPhrasebookKeys.forEach((key) => {
    assert.ok(
      currentKeys.has(canonicalPhraseKey(key)),
      `${key}: previous phrase still resolves to the current phrasebook`,
    );
  });

  const expectedKeys = new Set(
    previousPhrasebookKeys.map(canonicalPhraseKey),
  );
  assert.deepEqual(expectedKeys, currentKeys);
  assert.deepEqual(
    new Set(parseSavedWords(previousPhrasebookKeys)),
    currentKeys,
    "local saved phrases are canonicalized",
  );

  const localProgress = parseCurrentProgress({
    completed: [],
    confidence: previousConfidence,
  });
  assert.ok(localProgress);
  assert.deepEqual(
    new Set(Object.keys(localProgress.confidence)),
    currentKeys,
    "local confidence is canonicalized",
  );

  const cloud = parseCloudSnapshot({
    progress: {
      completed: [],
      confidence: previousConfidence,
    },
    preferences: {
      showPronunciation: true,
      autoplay: false,
    },
    saved_words: previousPhrasebookKeys,
  });
  assert.ok(cloud);
  assert.deepEqual(new Set(cloud.savedWords), currentKeys);
  assert.deepEqual(new Set(Object.keys(cloud.state.confidence)), currentKeys);

  const normalizedBeforeWrite = normalizeLearningSnapshot({
    state: {
      completed: [],
      confidence: previousConfidence,
    },
    preferences: cloud.preferences,
    savedWords: previousPhrasebookKeys,
  });
  assert.deepEqual(new Set(normalizedBeforeWrite.savedWords), currentKeys);
  assert.deepEqual(
    new Set(Object.keys(normalizedBeforeWrite.state.confidence)),
    currentKeys,
  );
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
    /applySnapshotChanges\(\s*baseline\.snapshot,\s*normalizedNext,\s*latestSnapshot/s,
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
  assert.match(accountPage, /Open family recorder/);
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
  assert.match(app, /word\.alternatives/);
  assert.match(app, /alternative\.pronunciation/);
  assert.match(app, /alternative\.audioSrc/);
  assert.match(app, /Other useful ways to say this/);
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
  assert.match(learningState, /LEGACY_PHRASE_KEY_ALIASES/);
  assert.match(
    learningProvider,
    /const normalizedNext = normalizeLearningSnapshot\(next\)/,
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
  assert.match(courseData, /progressKey/);
  assert.match(courseData, /findPracticeWord\(lessonId: string, wordId: string\)/);

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
    ["../app/practice-live/page.tsx", "practice-live"],
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
