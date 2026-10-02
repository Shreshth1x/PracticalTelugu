import assert from "node:assert/strict";
import test from "node:test";

let renderCount = 0;

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("practice-hub-test", `${process.pid}-${Date.now()}-${renderCount++}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("practice hub routes publicly render the correct tool selection and navigation", async () => {
  for (const [pathname, selectedTab, title] of [
    ["/practice", "bank", "Practice"],
    ["/practice/sentences", "sentences", "Build sentences"],
    ["/practice/quiz", "quiz", "Daily quiz"],
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("location"), null, pathname);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(`<title>${title} \\| PracticalTelugu</title>`), pathname);
    assert.match(html, /<h1>Put your Telugu to use\.<\/h1>/, pathname);
    assert.match(html, /role="tablist" aria-label="Practice tools"/, pathname);
    const tabs = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter(([, attributes]) => attributes.includes('role="tab"'));
    assert.equal(tabs.length, 3, pathname);
    for (const id of ["bank", "sentences", "quiz"]) {
      const tab = tabs.find(([, attributes]) => attributes.includes(`id="hub-tab-${id}"`));
      assert.ok(tab, `${pathname}: ${id}`);
      assert.match(tab[1], new RegExp(`aria-selected="${id === selectedTab}"`), pathname);
      assert.match(tab[1], new RegExp(`tabindex="${id === selectedTab ? 0 : -1}"`), pathname);
    }
    assert.match(html, /role="status"[^>]*>Bringing back your practice…/, pathname);
    assert.match(html, /href="\/practice-live"/, pathname);
    assert.match(html, /href="\/learn"/, pathname);
    assert.doesNotMatch(html, /You must sign in|Authentication required|codex-preview/, pathname);
  }
});

test("home and phrasebook provide direct entry to daily review, sentences, and the vocabulary bank", async () => {
  const [home, words] = await Promise.all([render("/"), render("/words")]);
  assert.equal(home.status, 200);
  assert.equal(words.status, 200);
  const homeHtml = await home.text();
  const wordHtml = await words.text();
  assert.match(homeHtml, /href="\/practice\/quiz"/);
  assert.match(homeHtml, /href="\/practice\/sentences"/);
  assert.match(homeHtml, /href="\/practice"/);
  assert.match(homeHtml, /Ten questions a day/);
  assert.match(wordHtml, /href="\/practice"[^>]*>Use your vocabulary bank to build sentences and review/);
});
