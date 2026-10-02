import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { allLessons, practicePacks } from "../app/course-data.ts";
import { phraseKey } from "../app/practice-path.mjs";
import {
  buildDailyQuiz,
  localDay,
  normalizeAnswer,
  recordQuizDay,
  sentenceEntries,
  sentenceMatches,
  shuffledTokens,
  streakForDays,
  validateQuizQuestions,
  vocabularyEntries,
  vocabularyTopics,
} from "../app/review-data.ts";
import {
  applySnapshotChanges,
  hasLearningData,
  mergeSnapshots,
  normalizeLearningSnapshot,
  parseCloudSnapshot,
  parseCurrentProgress,
  parseLearningSnapshot,
  parseLegacyProgress,
  snapshotAdditionsSince,
} from "../app/learning-state.ts";

const emptyState = () => ({ completed: [], confidence: {} });
const result = (score = 7) => ({ score, total: 10 });
const snapshot = (state = emptyState(), savedWords = []) => ({
  state,
  preferences: { showPronunciation: true, autoplay: false },
  savedWords,
});
const wordByKey = new Map(vocabularyEntries.map((entry) => [entry.key, entry]));
const days = Array.from({ length: 180 }, (_, index) => {
  const date = new Date("2026-01-01T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

function assertQuizContract(questions, day) {
  assert.equal(questions.length, 10, day);
  assert.equal(new Set(questions.map((question) => question.id)).size, 10, day);
  assert.equal(new Set(questions.map((question) => question.wordKey)).size, 10, day);
  assert.deepEqual(new Set(questions.map((question) => question.kind)), new Set([
    "meaning", "translation", "listening", "usage",
  ]), day);
  for (const question of questions) {
    const word = wordByKey.get(question.wordKey);
    assert.ok(word, question.id);
    assert.equal(new Set(question.options.map((option) => option.id)).size, question.options.length, question.id);
    assert.equal(new Set(question.options.map((option) => normalizeAnswer(option.label))).size, question.options.length, question.id);
    assert.equal(question.options.filter((option) => option.id === question.answerId).length, 1, question.id);
    assert.equal(question.options.length, question.kind === "usage" ? 2 : 4, question.id);
    if (question.kind === "listening") {
      assert.equal(question.audioSrc, word.audioSrc, question.id);
      assert.ok(existsSync(new URL(`../public${question.audioSrc.split("?")[0]}`, import.meta.url)), question.audioSrc);
    }
    if (question.kind === "usage") {
      const forms = [{ roman: word.roman, usage: word.usage }, ...(word.alternatives ?? [])];
      const offeredForms = question.options.map((option) => forms.find((form) => form.roman === option.id));
      assert.ok(offeredForms.every((form) => form?.usage?.kind === "relationship"), question.id);
      assert.deepEqual(new Set(offeredForms.map((form) => form.usage.audience)), new Set(["familiar", "respectful"]), question.id);
      const requestedAudience = question.prompt.includes("a close friend you know well") ? "familiar" : "respectful";
      assert.equal(forms.find((form) => form.roman === question.answerId)?.usage?.audience, requestedAudience, question.id);
    }
  }
  assert.equal(questions.filter((question) => question.kind === "usage").length, 1, day);
  assert.deepEqual(validateQuizQuestions(day, questions), questions, day);
}

test("vocabulary retains canonical phrase identities and every source lesson membership", () => {
  const sourceMembership = new Map();
  for (const lesson of allLessons) {
    for (const word of lesson.words) {
      const key = phraseKey(word);
      sourceMembership.set(key, [...(sourceMembership.get(key) ?? []), lesson.id]);
    }
  }
  assert.equal(vocabularyEntries.length, sourceMembership.size);
  assert.equal(wordByKey.size, vocabularyEntries.length);
  for (const entry of vocabularyEntries) {
    assert.deepEqual(entry.lessonIds, sourceMembership.get(entry.key));
    assert.equal(entry.topicId, entry.lessonIds[0]);
    assert.equal(entry.topicTitle, allLessons.find((lesson) => lesson.id === entry.topicId)?.title);
  }
  assert.ok(vocabularyEntries.some((entry) => entry.lessonIds.length > 1));
  assert.deepEqual(vocabularyTopics.map((topic) => topic.id), allLessons.map((lesson) => lesson.id));
});

test("starter and fully practiced quizzes satisfy the ten-question mixed review contract across 180 days", () => {
  const practiced = {
    completed: allLessons.map((lesson) => lesson.id),
    confidence: Object.fromEntries(vocabularyEntries.map((entry) => [entry.key, "ready"])),
  };
  for (const day of days) {
    assertQuizContract(buildDailyQuiz(day, emptyState()), day);
    assertQuizContract(buildDailyQuiz(day, practiced), day);
  }
});

test("quiz generation is deterministic within a day and changes phrase and answer layouts between days", () => {
  const state = { completed: [allLessons[0].id], confidence: {} };
  const before = structuredClone(state);
  const saved = [vocabularyEntries.at(-1).key];
  const first = buildDailyQuiz("2026-10-02", state, saved);
  assert.deepEqual(buildDailyQuiz("2026-10-02", state, saved), first);
  const layout = (questions) => questions.map((question) => [question.wordKey, question.kind, question.options.map((option) => option.id)]);
  assert.notDeepEqual(layout(buildDailyQuiz("2026-10-03", state, saved)), layout(first));
  assert.deepEqual(state, before);
  assert.deepEqual(saved, [vocabularyEntries.at(-1).key]);
});

test("small practiced, saved, and completed-lesson pools are included before unseen fallback phrases", () => {
  const starter = new Set(practicePacks.slice(0, 2).flatMap((pack) => pack.words.map(phraseKey)));
  const learned = vocabularyEntries.filter((entry) => !starter.has(entry.key)).slice(-3);
  const state = { completed: [], confidence: { [learned[0].key]: "learning", [learned[1].key]: "ready" } };
  for (const day of days.slice(0, 30)) {
    const keys = new Set(buildDailyQuiz(day, state, [learned[2].key]).map((question) => question.wordKey));
    for (const entry of learned) assert.ok(keys.has(entry.key), `${day}: ${entry.english}`);
    const lesson = allLessons.find((candidate) => candidate.id === "food-water");
    const completedKeys = new Set(buildDailyQuiz(day, { completed: [lesson.id], confidence: {} }).map((question) => question.wordKey));
    for (const word of lesson.words) assert.ok(completedKeys.has(phraseKey(word)), `${day}: completed ${word.english}`);
  }
});

test("sentence practice accepts canonical romanization, Telugu script, and recorded alternative forms in both directions", () => {
  assert.ok(sentenceEntries.length > 0);
  for (const entry of sentenceEntries) {
    assert.ok(entry.roman.trim().split(/\s+/).length > 1);
    assert.doesNotMatch(entry.roman, /…|\.{3}/);
    assert.ok(sentenceMatches(entry, `  ${entry.roman.toUpperCase()}!  `, "to-telugu"), entry.english);
    assert.ok(sentenceMatches(entry, entry.telugu, "to-telugu"), entry.english);
    assert.ok(sentenceMatches(entry, entry.english, "to-english"), entry.english);
    assert.equal(sentenceMatches(entry, "", "to-telugu"), false);
    assert.equal(sentenceMatches(entry, "a completely different answer", "to-telugu"), false);
    for (const alternative of entry.alternatives ?? []) {
      assert.ok(sentenceMatches(entry, alternative.roman, "to-telugu"), alternative.roman);
      assert.ok(sentenceMatches(entry, alternative.telugu, "to-telugu"), alternative.telugu);
    }
  }
});

test("sentence English answers accept contractions, slash alternatives, punctuation, and context annotations", () => {
  for (const [contracted, expanded] of [
    ["I’m tired", "I am tired"],
    ["I'll come tomorrow", "I will come tomorrow"],
    ["It's enough", "It is enough"],
    ["That's good", "That is good"],
    ["I don't know", "I do not know"],
    ["I didn’t understand", "I did not understand"],
  ]) {
    const word = { english: contracted, roman: "example words", telugu: "ఉదాహరణ పదాలు" };
    assert.ok(sentenceMatches(word, expanded, "to-english"), contracted);
  }
  assert.ok(sentenceMatches({ english: "hello / greetings (respectful)" }, "Greetings!", "to-english"));
  assert.equal(normalizeAnswer("  I’M   TIRED! (respectful)  "), "i am tired");
});

test("sentence token banks preserve repeated words and deterministic order", () => {
  const text = "nenu nenu intiki veltaanu";
  const expected = text.split(" ");
  const shuffled = shuffledTokens(text, "repeated-words");
  assert.deepEqual(shuffledTokens(text, "repeated-words"), shuffled);
  assert.deepEqual([...shuffled].sort(), [...expected].sort());
  assert.equal(shuffled.filter((token) => token === "nenu").length, 2);
  assert.notDeepEqual(shuffled, expected);
  assert.deepEqual(shuffledTokens("chaala chaala", "same-tokens"), ["chaala", "chaala"]);
  for (const entry of sentenceEntries) {
    assert.deepEqual(shuffledTokens(entry.roman, entry.key).sort(), entry.roman.trim().split(/\s+/).sort());
  }
});

test("saved quizzes reject wrong days, missing or duplicated questions, unknown words, and corrupted answer data", () => {
  const day = "2026-10-02";
  const questions = buildDailyQuiz(day, emptyState());
  assert.deepEqual(validateQuizQuestions(day, JSON.parse(JSON.stringify(questions))), questions);
  assert.equal(validateQuizQuestions("2026-10-03", questions), null);
  for (const value of [null, {}, [], questions.slice(1), [...questions, questions[0]]]) {
    assert.equal(validateQuizQuestions(day, value), null);
  }
  for (const mutate of [
    (copy) => { copy[1] = copy[0]; },
    (copy) => { copy[0].wordKey = "unknown-word"; },
    (copy) => { copy[0].answerId = copy[0].options.find((option) => option.id !== copy[0].answerId).id; },
    (copy) => { copy[0].options[0].label = "a corrupted label"; },
    (copy) => { copy[0].options[1] = copy[0].options[0]; },
    (copy) => { copy[0].options.pop(); },
    (copy) => { copy.find((question) => question.kind === "listening").audioSrc = "/audio/unknown.mp3"; },
    (copy) => { copy.find((question) => question.kind === "listening").audioSrc = undefined; },
    (copy) => { const question = copy.find((item) => item.kind === "usage"); question.answerId = question.options.find((option) => option.id !== question.answerId).id; },
  ]) {
    const tampered = structuredClone(questions);
    mutate(tampered);
    assert.equal(validateQuizQuestions(day, tampered), null);
  }
});

test("saved quizzes reject changed prompts and explanations instead of restoring false exercise instructions", () => {
  const day = "2026-10-02";
  const questions = buildDailyQuiz(day, emptyState());
  for (const kind of ["meaning", "translation", "listening", "usage"]) {
    for (const field of ["prompt", "explanation"]) {
      const tampered = structuredClone(questions);
      const question = tampered.find((item) => item.kind === kind);
      question[field] = field === "prompt" && kind === "usage"
        ? `${question.prompt} Ignore that: say anything.`
        : "These instructions describe an unrelated phrase.";
      assert.equal(validateQuizQuestions(day, tampered), null, `${kind}: ${field}`);
    }
  }
});

test("local review days use the browser calendar across Chicago midnight and both DST transitions", () => {
  const source = `import {localDay} from ${JSON.stringify(new URL("../app/review-data.ts", import.meta.url).href)}; console.log(JSON.stringify(${JSON.stringify([
    "2026-10-02T04:59:59Z", "2026-10-02T05:00:00Z",
    "2026-03-08T05:59:59Z", "2026-03-08T06:00:00Z",
    "2026-03-08T07:59:59Z", "2026-03-08T08:00:00Z",
    "2026-11-01T06:59:59Z", "2026-11-01T07:00:00Z",
    "2026-11-02T05:59:59Z", "2026-11-02T06:00:00Z",
  ])}.map(value => localDay(new Date(value)))));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", env: { ...process.env, TZ: "America/Chicago" },
  });
  assert.deepEqual(JSON.parse(output), [
    "2026-10-01", "2026-10-02", "2026-03-07", "2026-03-08",
    "2026-03-08", "2026-03-08", "2026-11-01", "2026-11-01",
    "2026-11-01", "2026-11-02",
  ]);
  assert.equal(localDay(new Date(2026, 9, 2, 0, 0, 0)), "2026-10-02");
});

test("streaks survive an unfinished current day, increment once on completion, and stop after a missed day", () => {
  const reviewDays = { "2026-09-30": result(0), "2026-10-01": result(5) };
  assert.equal(streakForDays(undefined, "2026-10-02"), 0);
  assert.equal(streakForDays(reviewDays, "2026-10-02"), 2);
  assert.equal(streakForDays({ ...reviewDays, "2026-10-02": result(0) }, "2026-10-02"), 3);
  assert.equal(streakForDays(reviewDays, "2026-10-03"), 0);
  assert.equal(streakForDays({ "2026-09-30": result(), "2026-10-02": result() }, "2026-10-02"), 1);
  assert.equal(streakForDays({ "2026-10-03": result() }, "2026-10-02"), 0);
  assert.equal(streakForDays({}, "2026-10-02"), 0);
});

test("streak calendar arithmetic crosses DST, years, and leap days without counting elapsed hours", () => {
  for (const [dates, today] of [
    [["2026-03-07", "2026-03-08", "2026-03-09"], "2026-03-09"],
    [["2026-10-31", "2026-11-01", "2026-11-02"], "2026-11-02"],
    [["2026-12-30", "2026-12-31", "2027-01-01"], "2027-01-01"],
    [["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01"],
  ]) {
    assert.equal(streakForDays(Object.fromEntries(dates.map((day) => [day, result()])), today), 3);
  }
});

test("recording completion is immutable and idempotent for one day while preserving all learning fields", () => {
  const state = { completed: ["food-water"], confidence: { water: "ready" }, reviewDays: { "2026-10-01": result(6) } };
  const before = structuredClone(state);
  const recorded = recordQuizDay(state, "2026-10-02", 8);
  assert.deepEqual(state, before);
  assert.deepEqual(recorded, { ...state, reviewDays: { ...state.reviewDays, "2026-10-02": result(8) } });
  assert.equal(recordQuizDay(recorded, "2026-10-02", 10), recorded);
  assert.equal(streakForDays(recorded.reviewDays, "2026-10-02"), 2);
  assert.deepEqual(recordQuizDay(emptyState(), "2026-10-02", -4).reviewDays, { "2026-10-02": result(0) });
  assert.deepEqual(recordQuizDay(emptyState(), "2026-10-02", 20).reviewDays, { "2026-10-02": result(10) });
  assert.deepEqual(recordQuizDay(emptyState(), "2026-10-02", 7.6).reviewDays, { "2026-10-02": result(8) });
});

test("progress parsing keeps valid review completions and removes malformed dates, scores, and totals", () => {
  const valid = { "2026-10-02": result(0), "2028-02-29": result(10) };
  const reviewDays = {
    ...valid, "2026-02-29": result(), "2026-13-01": result(), "26-10-02": result(),
    "2026-10-03": { score: 11, total: 10 }, "2026-10-04": { score: -1, total: 10 },
    "2026-10-05": { score: 5.5, total: 10 }, "2026-10-06": { score: "7", total: 10 },
    "2026-10-07": { score: 7, total: 9 }, "2026-10-08": null,
    "2026-10-09": { score: Number.NaN, total: 10 }, "2026-10-10": { score: Infinity, total: 10 },
  };
  const parsed = parseCurrentProgress({ completed: ["food-water"], confidence: { water: "ready" }, reviewDays });
  assert.deepEqual(parsed.reviewDays, valid);
  assert.deepEqual(parsed.completed, ["food-water"]);
  assert.deepEqual(parsed.confidence, { water: "ready" });
  assert.deepEqual(parseCurrentProgress({ ...emptyState(), reviewDays: [] }), emptyState());
  assert.deepEqual(parseCurrentProgress(emptyState()), emptyState());
  assert.deepEqual(parseLegacyProgress({ completed: ["food-water"] }), { completed: ["food-water"], confidence: {} });
});

test("review-only progress round-trips through local snapshots, cloud snapshots, and normalization", () => {
  const value = snapshot({ ...emptyState(), reviewDays: { "2026-10-02": result(6) } }, [vocabularyEntries[0].key]);
  assert.ok(hasLearningData(snapshot(value.state)));
  assert.deepEqual(parseLearningSnapshot(JSON.parse(JSON.stringify(value))), value);
  assert.deepEqual(parseCloudSnapshot({ progress: value.state, preferences: value.preferences, saved_words: value.savedWords }), value);
  assert.deepEqual(normalizeLearningSnapshot(value), value);
});

test("cloud and local review-day merges keep both histories and deterministically resolve the same day", () => {
  const local = snapshot({ ...emptyState(), reviewDays: { "2026-10-01": result(3), "2026-10-02": result(8) } });
  const cloud = snapshot({ ...emptyState(), reviewDays: { "2026-09-30": result(7), "2026-10-02": result(5) } });
  const merged = mergeSnapshots(local, cloud);
  assert.deepEqual(merged.state.reviewDays, { "2026-09-30": result(7), "2026-10-01": result(3), "2026-10-02": result(8) });
  assert.deepEqual(mergeSnapshots(cloud, local).state.reviewDays, merged.state.reviewDays);
  assert.equal(streakForDays(merged.state.reviewDays, "2026-10-02"), 3);
});

test("anonymous progress additions carry only new or changed review days without losing account history", () => {
  const baseline = snapshot({ ...emptyState(), reviewDays: { "2026-09-30": result(7), "2026-10-01": result(4) } });
  const current = snapshot({ ...emptyState(), reviewDays: { ...baseline.state.reviewDays, "2026-10-01": result(8), "2026-10-02": result(6) } });
  const additions = snapshotAdditionsSince(current, baseline);
  assert.deepEqual(additions.state.reviewDays, { "2026-10-01": result(8), "2026-10-02": result(6) });
  const account = snapshot({ ...emptyState(), reviewDays: { "2026-09-29": result(9) } });
  assert.deepEqual(mergeSnapshots(additions, account).state.reviewDays, { "2026-09-29": result(9), "2026-10-01": result(8), "2026-10-02": result(6) });
  assert.deepEqual(snapshotAdditionsSince(current, current).state, emptyState());
});

test("concurrent account sync retains another device's quiz completion and local lesson changes", () => {
  const baseline = snapshot({ completed: ["hello-goodbye"], confidence: {}, reviewDays: { "2026-09-30": result(7) } });
  const current = snapshot({ completed: ["hello-goodbye", "food-water"], confidence: { water: "learning" }, reviewDays: { ...baseline.state.reviewDays, "2026-10-01": result(6) } });
  const target = snapshot({ completed: ["hello-goodbye", "names-introductions"], confidence: { name: "ready" }, reviewDays: { ...baseline.state.reviewDays, "2026-10-02": result(8) } });
  const originals = structuredClone([baseline, current, target]);
  const synced = applySnapshotChanges(baseline, current, target);
  assert.deepEqual(synced.state.reviewDays, { "2026-09-30": result(7), "2026-10-01": result(6), "2026-10-02": result(8) });
  assert.deepEqual(new Set(synced.state.completed), new Set(["hello-goodbye", "food-water", "names-introductions"]));
  assert.deepEqual(synced.state.confidence, { water: "learning", name: "ready" });
  assert.deepEqual([baseline, current, target], originals);
});

test("ordinary lesson changes and missing review fields preserve cloud quiz history", () => {
  const baseline = snapshot({ completed: ["hello-goodbye"], confidence: {}, reviewDays: { "2026-10-01": result(7) } });
  const current = snapshot({ completed: ["hello-goodbye", "food-water"], confidence: {} });
  const target = snapshot({ completed: ["hello-goodbye"], confidence: {}, reviewDays: { "2026-10-01": result(7), "2026-10-02": result(8) } });
  assert.deepEqual(applySnapshotChanges(baseline, current, target).state.reviewDays, target.state.reviewDays);
  const reviewOnlyBaseline = snapshot({ ...emptyState(), reviewDays: baseline.state.reviewDays });
  assert.deepEqual(applySnapshotChanges(reviewOnlyBaseline, snapshot(), target), target);
});

test("explicit reset clears quiz history and streak while keeping saved-word edits and later completions", () => {
  const baseline = snapshot({ completed: ["hello-goodbye"], confidence: { hello: "ready" }, reviewDays: { "2026-10-01": result(7) } }, ["hello", "water"]);
  const target = snapshot({ ...baseline.state, reviewDays: { ...baseline.state.reviewDays, "2026-10-02": result(8) } }, ["hello", "water", "name"]);
  const current = snapshot(emptyState(), ["hello"]);
  const reset = applySnapshotChanges(baseline, current, target, { explicitReset: true });
  assert.deepEqual(reset.state, emptyState());
  assert.deepEqual(reset.savedWords, ["hello", "name"]);
  assert.equal(streakForDays(reset.state.reviewDays, "2026-10-02"), 0);
  const restarted = recordQuizDay(reset.state, "2026-10-03", 4);
  assert.deepEqual(restarted.reviewDays, { "2026-10-03": result(4) });
  assert.equal(streakForDays(restarted.reviewDays, "2026-10-03"), 1);
});

test("a pending offline reset preserves newly earned quiz and lesson progress when reconnecting", () => {
  const baseline = snapshot({
    completed: ["hello-goodbye"],
    confidence: { hello: "ready" },
    reviewDays: { "2026-10-01": result(9), "2026-10-02": result(10) },
  }, ["hello", "water"]);
  // The learner resets while offline, then practices again before the reset
  // can be applied to a cloud snapshot that still holds the old history.
  const afterReset = recordQuizDay(emptyState(), "2026-10-02", 3);
  const current = snapshot({
    ...afterReset,
    completed: ["food-water"],
    confidence: { water: "learning" },
  }, ["hello"]);
  const target = snapshot({
    completed: ["hello-goodbye", "names-introductions"],
    confidence: { hello: "ready", name: "ready" },
    reviewDays: { ...baseline.state.reviewDays, "2026-09-30": result(8) },
  }, ["hello", "water", "name"]);
  const originals = structuredClone([baseline, current, target]);
  const reconnected = applySnapshotChanges(baseline, current, target, { explicitReset: true });
  assert.deepEqual(reconnected.state, current.state);
  assert.deepEqual(reconnected.state.reviewDays, { "2026-10-02": result(3) });
  assert.deepEqual(reconnected.state.completed, ["food-water"]);
  assert.deepEqual(reconnected.state.confidence, { water: "learning" });
  assert.deepEqual(reconnected.savedWords, ["hello", "name"]);
  assert.equal(streakForDays(reconnected.state.reviewDays, "2026-10-02"), 1);
  assert.deepEqual(applySnapshotChanges(baseline, current, reconnected, { explicitReset: true }), reconnected);
  assert.deepEqual([baseline, current, target], originals);
});
