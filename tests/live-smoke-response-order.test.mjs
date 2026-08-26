import assert from "node:assert/strict";
import test from "node:test";

import { canAcceptLiveSmokeCompletion } from "../scripts/live-smoke-response-order.mjs";

test("does not attribute a delayed prior boundary to a response that has not started", () => {
  assert.equal(
    canAcceptLiveSmokeCompletion({
      hasAcceptedTurn: false,
      audiblePcmBytes: 0,
      audiblePcmPeak: 0,
    }),
    false,
  );
  assert.equal(
    canAcceptLiveSmokeCompletion({
      hasAcceptedTurn: true,
      audiblePcmBytes: 0,
      audiblePcmPeak: 0,
    }),
    false,
    "an accepted second tool call alone cannot adopt the first turn's delayed completion",
  );
  assert.equal(
    canAcceptLiveSmokeCompletion({
      hasAcceptedTurn: true,
      audiblePcmBytes: 3_200,
      audiblePcmPeak: 1_024,
    }),
    true,
  );
});
