import assert from "node:assert/strict";
import test from "node:test";

import {
  getLiveVoiceFallbackNotice,
  getLiveVoiceModeNotice,
  isLiveVoiceModeReason,
} from "../app/practice-live/live-voice-status.ts";

test("accepts only the bounded voice-mode diagnostic reasons", () => {
  for (const reason of [
    "authorized",
    "not_configured",
    "signed_out",
    "not_allowlisted",
    "auth_unavailable",
  ]) {
    assert.equal(isLiveVoiceModeReason(reason), true, reason);
  }

  for (const value of [undefined, "", "fish_rejected", "admin@example.com"])
    assert.equal(isLiveVoiceModeReason(value), false, String(value));
});

test("explains why the selected private voice is not active without secrets", () => {
  assert.equal(
    getLiveVoiceModeNotice({
      familyVoice: "grandma",
      voiceMode: "fish",
      reason: "authorized",
    }),
    "",
  );
  assert.equal(
    getLiveVoiceModeNotice({
      familyVoice: "grandpa",
      voiceMode: "gemini",
      reason: "signed_out",
    }),
    "Sign in with the authorized account to use Grandpa's voice. Mayu's backup voice is playing.",
  );
  assert.equal(
    getLiveVoiceModeNotice({
      familyVoice: "grandma",
      voiceMode: "gemini",
      reason: "not_configured",
    }),
    "Grandma's voice is not configured in this deployment. Mayu's backup voice is playing.",
  );
  assert.equal(
    getLiveVoiceModeNotice({
      familyVoice: "grandma",
      voiceMode: "gemini",
      reason: "not_allowlisted",
    }),
    "This account cannot use Grandma's voice. Mayu's backup voice is playing.",
  );
  assert.equal(
    getLiveVoiceModeNotice({
      familyVoice: "grandma",
      voiceMode: "gemini",
      reason: "auth_unavailable",
    }),
    "Private voice access could not be verified in time. Mayu's backup voice is playing.",
  );
});

test("announces a per-turn Fish fallback using the selected family label", () => {
  assert.equal(
    getLiveVoiceFallbackNotice("grandpa"),
    "Grandpa's voice could not load this turn. Mayu's backup voice is playing.",
  );
  assert.equal(
    getLiveVoiceFallbackNotice("grandma", "fish_payment_required"),
    "Fish Audio needs API credit before Grandma's voice can play. Mayu's backup voice is playing.",
  );
});
