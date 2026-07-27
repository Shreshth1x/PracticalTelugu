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
  ["/", /A little Telugu for today\./],
  ["/learn", /Learn in the order that fits you\./],
  ["/words", /Words worth keeping close\./],
  ["/words/daily", /id="daily-word-title"/],
  ["/settings", /Make the words easier to meet\./],
  ["/lesson/hello-goodbye", /class="introduce-exercise"/],
];

test("server-renders every V2 route with a unique primary heading", async () => {
  for (const [pathname, heading] of routeCases) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
      pathname,
    );

    const html = await response.text();
    assert.match(html, /PalukuLingo/, pathname);
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

test("unknown lesson URLs return a real not-found response", async () => {
  const response = await render("/lesson/not-a-real-lesson");
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /Mayu can’t find that page\./);
  assert.match(html, /href="\/"/);
});

test("keeps the V1 progress contract while adding the V2 routes", async () => {
  const [app, courseData, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/PalukuApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/course-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(app, /palukulu\.progress\.v1/);
  assert.match(app, /palukulu\.onboarded\.v1/);
  assert.match(app, /\.\.\.defaultState,[\s\S]*JSON\.parse\(raw\)/);
  assert.match(
    app,
    /getItem\(STORAGE_KEY\)[\s\S]*catch \{[\s\S]*setState\(defaultState\);[\s\S]*getItem\(PREFERENCES_KEY\)/,
  );
  assert.match(app, /if \(!hydrated\) return;/);
  assert.match(app, /selectedTrack: lesson\.track/);
  assert.match(app, /correct \/ graded >= 0\.6/);
  assert.match(
    app,
    /correct \* 10 \+ \(correct === graded \? 15 : 0\)/,
  );
  assert.match(
    app,
    /current\.completed\.includes\(lesson\.id\)[\s\S]*\[\.\.\.current\.completed, lesson\.id\]/,
  );
  assert.match(app, /setLessonEnergy\(\(current\) => Math\.max\(0, current - 1\)\)/);
  assert.match(
    app,
    /energy: Math\.max\(0, current\.energy - 1\)/,
  );
  assert.match(app, /type: "introduce"/);
  assert.match(app, /type: "matching"/);
  assert.match(courseData, /essentials-milestone/);
  assert.match(courseData, /building-blocks-milestone/);

  const exactDisplayFontEmbed =
    "https://fonts.googleapis.com/css2?family=Capriola&family=Geist+Pixel&family=Turret+Road:wght@200;300;400;500;700;800&display=swap";
  assert.ok(layout.includes(exactDisplayFontEmbed));
  assert.match(layout, /Noto\+Sans\+Telugu/);
  assert.match(css, /"Noto Sans Telugu"/);
  assert.doesNotMatch(css, /transition(?:-property)?:\s*all\b/);

  for (const pose of [
    "welcome",
    "teach",
    "listen",
    "encourage",
    "celebrate",
    "read",
  ]) {
    assert.match(app, new RegExp(`"${pose}"`));
  }
  assert.match(app, /maya-peacock\.webp/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
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
