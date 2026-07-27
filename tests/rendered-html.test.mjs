import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
let renderCount = 0;

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
  ["/lesson/hello-goodbye", /class="introduce-exercise"/],
];

test("server-renders every practical route with a unique primary heading", async () => {
  for (const [pathname, heading] of routeCases) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
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
      /codex-preview|react-loading-skeleton/i,
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
  const practiceIndex = html.indexOf("Practice five phrases", actionsStart);
  const durationIndex = html.indexOf("About 4 minutes", actionsStart);
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

test("teaches each phrase in English, pronunciation, Telugu order", async () => {
  for (const pathname of ["/words/daily", "/lesson/hello-goodbye"]) {
    const response = await render(pathname);
    const html = await response.text();
    const englishIndex = html.indexOf("phrase-english");
    const pronunciationIndex = html.indexOf("phrase-roman");
    const teluguIndex = html.indexOf("phrase-telugu");

    assert.ok(englishIndex >= 0, `${pathname}: English phrase is present`);
    assert.ok(
      pronunciationIndex > englishIndex,
      `${pathname}: pronunciation follows English`,
    );
    assert.ok(
      teluguIndex > pronunciationIndex,
      `${pathname}: Telugu follows pronunciation`,
    );
  }
});

test("unknown lesson URLs return a real not-found response", async () => {
  const response = await render("/lesson/not-a-real-lesson");
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /That page is not available\./);
  assert.match(html, /href="\/"/);
});

test("keeps prior progress while enforcing the practical Telugu product contract", async () => {
  const [app, courseData, layout, css, packageJson, readme] = await Promise.all([
    readFile(new URL("../app/PalukuApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/course-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(app, /palukulu\.progress\.v2/);
  assert.match(app, /palukulu\.progress\.v1/);
  assert.match(app, /LEGACY_STORAGE_KEY/);
  assert.match(
    app,
    /getItem\(STORAGE_KEY\)[\s\S]*getItem\(LEGACY_STORAGE_KEY\)/,
  );
  assert.match(app, /completed: completedFrom\(candidate\.completed\)/);
  assert.match(app, /confidence: confidenceFrom\(candidate\.confidence\)/);
  assert.match(app, /if \(!hydrated\) return;/);
  assert.match(app, /correct \/ graded >= 0\.6/);
  assert.match(
    app,
    /current\.completed\.includes\(lesson\.id\)[\s\S]*\[\.\.\.current\.completed, lesson\.id\]/,
  );
  assert.match(app, /findDailyWord\("hello-goodbye"/);
  assert.match(app, /type: "introduce"/);
  assert.match(app, /type: "matching"/);
  assert.match(app, /tokens: phrase\.roman\.trim\(\)/);
  assert.doesNotMatch(app, /tokens: phrase\.telugu\.trim\(\)/);
  assert.match(
    app,
    /normalize\(answer\) === normalize\(step\.word\.roman\)/,
  );
  assert.match(
    app,
    /className="phrase-english"[\s\S]*className="phrase-roman"[\s\S]*className="phrase-telugu"/,
  );
  assert.doesNotMatch(app, /teluguFirst|Show Telugu larger/);
  assert.match(courseData, /SituationGroup/);
  assert.match(courseData, /situationGroups/);
  assert.match(courseData, /quick-start/);
  assert.match(courseData, /minutes: 4/);
  assert.match(courseData, /essentials-milestone/);
  assert.match(courseData, /building-blocks-milestone/);

  const productCopy = `${app}\n${courseData}\n${layout}\n${readme}`;
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
  assert.match(app, /practicedDaily/);
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
