import assert from "node:assert/strict";
import test from "node:test";

import {
  getLiveFamilyVoiceLabel,
  getLiveSessionVoiceLabel,
} from "../app/practice-live/live-config.ts";

test("labels selected family voices without promising authorization", () => {
  assert.equal(getLiveFamilyVoiceLabel("grandma"), "Grandma's voice");
  assert.equal(getLiveFamilyVoiceLabel("grandpa"), "Grandpa's voice");
});

test("labels the actual session voice and any runtime fallback honestly", () => {
  assert.equal(
    getLiveSessionVoiceLabel({
      familyVoice: "grandma",
      voiceMode: "gemini",
    }),
    "Mayu's backup voice",
  );
  assert.equal(
    getLiveSessionVoiceLabel({
      familyVoice: "grandma",
      voiceMode: "fish",
    }),
    "Grandma's voice",
  );
  assert.equal(
    getLiveSessionVoiceLabel({
      familyVoice: "grandpa",
      voiceMode: "fish",
    }),
    "Grandpa's voice",
  );
  assert.equal(
    getLiveSessionVoiceLabel({
      familyVoice: "grandpa",
      voiceMode: "fish",
      usedVoiceFallback: true,
    }),
    "Grandpa's voice · backup used",
  );
  assert.equal(
    getLiveSessionVoiceLabel({ familyVoice: "grandma" }),
    "Mayu's backup voice",
    "legacy sessions without a recorded mode are not mislabeled as clones",
  );
});
