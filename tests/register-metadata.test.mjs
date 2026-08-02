import assert from "node:assert/strict";
import test from "node:test";

import {
  practicalLessons,
  resolveTeluguFormUsage,
} from "../app/course-data.ts";
import { getLivePhraseCues } from "../app/practice-live/live-follow-along.ts";

function lessonWord(lessonId, wordId) {
  const lesson = practicalLessons.find((candidate) => candidate.id === lessonId);
  const word = lesson?.words.find((candidate) => candidate.id === wordId);
  assert.ok(word, `${lessonId}/${wordId} exists`);
  return word;
}

test("teaches the familiar and respectful name forms without changing identity", () => {
  const word = lessonWord("names-introductions", "ask-name");
  const alternative = word.alternatives?.[0];

  assert.equal(word.progressKey, "మీ పేరు ఏంటి?::what is your name?");
  assert.deepEqual(
    [word.telugu, word.roman],
    ["నీ పేరు ఏంటి?", "nee peru enti?"],
  );
  assert.deepEqual(
    [alternative?.telugu, alternative?.roman],
    ["మీ పేరు ఏంటి?", "mee peru enti?"],
  );
  assert.equal(resolveTeluguFormUsage(word.usage).label, "Someone close");
  assert.equal(
    resolveTeluguFormUsage(alternative?.usage).label,
    "Elder or someone new",
  );
  assert.match(word.note ?? "", /even if they are your age/);
});

test("annotates every reviewed listener-register pair semantically", () => {
  const pairs = [
    ["hello-goodbye", "how-are-you", "familiar", "respectful"],
    ["names-introductions", "ask-name", "familiar", "respectful"],
    ["family-words", "have-you-eaten", "familiar", "respectful"],
    ["family-words", "family-how-are-you", "familiar", "respectful"],
    ["family-words", "where-are-you", "familiar", "respectful"],
    ["food-water", "water", "respectful", "familiar"],
    ["when-stuck", "say-slowly", "respectful", "familiar"],
    ["when-stuck", "say-again", "respectful", "familiar"],
    ["i-you-we", "when-home", "familiar", "respectful"],
  ];

  for (const [lessonId, wordId, primaryAudience, alternativeAudience] of pairs) {
    const word = lessonWord(lessonId, wordId);
    assert.equal(
      resolveTeluguFormUsage(word.usage).audience,
      primaryAudience,
      `${wordId} primary audience`,
    );
    assert.equal(
      resolveTeluguFormUsage(word.alternatives?.[0]?.usage).audience,
      alternativeAudience,
      `${wordId} alternative audience`,
    );
  }
});

test("keeps style, listener respect, and respect toward a referent separate", () => {
  const busStop = lessonWord("question-words", "bus-stop");
  const meeting = lessonWord("names-introductions", "happy-to-meet-you");
  const mom = lessonWord("family-words", "is-mom-home");
  const stopHere = lessonWord("question-words", "stop-here");

  assert.deepEqual(
    resolveTeluguFormUsage(busStop.alternatives?.[0]?.usage),
    {
      audience: "anyone",
      kind: "style",
      label: "Works with anyone",
      guidance: "This form does not depend on who is listening.",
      showContext: false,
    },
  );
  assert.equal(
    resolveTeluguFormUsage(meeting.alternatives?.[0]?.usage).audience,
    "respectful",
  );
  assert.equal(resolveTeluguFormUsage(mom.usage).kind, "referent-honor");
  assert.equal(resolveTeluguFormUsage(mom.usage).audience, "anyone");
  assert.equal(resolveTeluguFormUsage(stopHere.usage).kind, "courtesy");
  assert.equal(resolveTeluguFormUsage(stopHere.usage).audience, "respectful");
});

test("Live cues never infer a listener register from a free-text label", () => {
  const cues = getLivePhraseCues([
    {
      id: "neutral-example",
      progressKey: "neutral-example",
      telugu: "నమస్కారం",
      roman: "namaskaaram",
      pronunciation: "nuh-muh-SKAA-rum",
      english: "hello",
      alternatives: [
        {
          label: "Extra respectful",
          telugu: "నమస్కారం అండి",
          roman: "namaskaaram andi",
          pronunciation: "nuh-muh-SKAA-rum UN-dee",
        },
      ],
    },
  ]);

  assert.equal(cues[0].audience, "anyone");
  assert.equal(cues[0].contextLabel, "Works with anyone");
  assert.equal(cues[1].audience, "anyone");
  assert.equal(cues[1].contextLabel, "Extra respectful");
});
