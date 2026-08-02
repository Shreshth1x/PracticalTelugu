import { performance } from "node:perf_hooks";

import { GoogleGenAI } from "@google/genai";

import {
  LIVE_MODEL,
  PRESENT_TURN_TOOL_NAME,
  buildLiveConnectConfig,
  buildLiveTokenConstraintConfig,
} from "../app/practice-live/live-config.ts";
import { findLivePhraseCue } from "../app/practice-live/live-follow-along.ts";
import { getLiveScenario } from "../app/practice-live/live-scenarios.ts";
import { parseLiveTurnToolCall } from "../app/practice-live/live-transcript.ts";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required for the Practice Live smoke test.");
}

const scenario = getLiveScenario(process.argv[2] ?? "family-check-in");
if (!scenario) {
  throw new Error("Choose family-check-in, at-the-table, or when-stuck.");
}
const verifyConversation = process.argv.includes("--conversation");

const startedAt = performance.now();
let promptSentAt = 0;
let firstToolCallAt = 0;
let firstAudioAt = 0;
let selectedCueId = "";
let firstCaption = null;
let followupSentAt = 0;
let secondToolCallAt = 0;
let secondAudioAt = 0;
let secondCaption = null;
let lastToolCall = null;
let expectedClose = false;
let session;

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

function resolveWhenReady() {
  if (verifyConversation) {
    if (secondToolCallAt && secondAudioAt) resolveReady();
    return;
  }

  if (firstToolCallAt && firstAudioAt) resolveReady();
}

const timeout = setTimeout(() => {
  rejectReady(
    new Error(
      `Gemini did not publish a valid caption and return audio in time.${
        lastToolCall ? ` Last tool call: ${JSON.stringify(lastToolCall)}` : ""
      }`,
    ),
  );
}, verifyConversation ? 30_000 : 20_000);

try {
  const serverAi = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });
  const config = buildLiveConnectConfig(scenario);
  const tokenStartedAt = performance.now();
  const token = await serverAi.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: LIVE_MODEL,
        config: buildLiveTokenConstraintConfig(config),
      },
      lockAdditionalFields: [],
    },
  });
  const tokenCreatedAt = performance.now();
  if (!token.name) throw new Error("Gemini returned an empty ephemeral token.");

  const ai = new GoogleGenAI({
    apiKey: token.name,
    httpOptions: { apiVersion: "v1alpha" },
  });

  session = await ai.live.connect({
    model: LIVE_MODEL,
    config,
    callbacks: {
      onmessage: (message) => {
        const functionCalls = message.toolCall?.functionCalls ?? [];
        if (functionCalls.length) {
          const functionResponses = functionCalls.map((call) => {
            lastToolCall = { name: call.name, args: call.args };
            const parsed =
              call.name === PRESENT_TURN_TOOL_NAME
                ? parseLiveTurnToolCall(call.args)
                : null;
            const cueId = parsed?.mayu.cueId ?? "";
            const cue = cueId
              ? findLivePhraseCue(scenario.words, cueId)
              : null;

            if (cue) selectedCueId = cue.id;
            if (parsed && !firstCaption) {
              firstCaption = parsed.mayu;
              firstToolCallAt = performance.now();
            } else if (parsed && followupSentAt && !secondCaption) {
              secondCaption = parsed;
              secondToolCallAt = performance.now();
            }

            return {
              id: call.id,
              name: call.name,
              response: parsed
                ? {
                    output: {
                      accepted: true,
                      captionReady: true,
                      ...(cue ? { cueId: cue.id } : {}),
                    },
                  }
                : { error: "Invalid English-letter caption." },
            };
          });

          session?.sendToolResponse({ functionResponses });
          resolveWhenReady();
        }

        const audio = (message.serverContent?.modelTurn?.parts ?? []).find(
          (part) => Boolean(part.inlineData?.data),
        );
        if (audio && promptSentAt) {
          if (followupSentAt) {
            secondAudioAt ||= performance.now();
          } else {
            firstAudioAt ||= performance.now();
          }
          resolveWhenReady();
        }

        if (
          verifyConversation &&
          message.serverContent?.turnComplete &&
          firstCaption &&
          firstAudioAt &&
          !followupSentAt
        ) {
          followupSentAt = performance.now();
          session?.sendRealtimeInput({
            text:
              "I ate, but I am still a little hungry. Treat this as my learner reply and continue our family conversation naturally in Telugu.",
          });
        }
      },
      onerror: (error) => {
        rejectReady(
          error instanceof Error
            ? error
            : new Error("Gemini Live reported a connection error."),
        );
      },
      onclose: (event) => {
        if (!expectedClose) {
          rejectReady(
            new Error(
              `Gemini closed before returning audio (${event.code}: ${event.reason || "no reason"}).`,
            ),
          );
        }
      },
    },
  });

  const connectedAt = performance.now();
  promptSentAt = performance.now();
  session.sendRealtimeInput({ text: scenario.openingCue });

  await ready;
  const result = {
    scenario: scenario.id,
    model: LIVE_MODEL,
    selectedCueId,
    caption: firstCaption,
    tokenMs: Math.round(tokenCreatedAt - tokenStartedAt),
    connectMs: Math.round(connectedAt - startedAt),
    captionCardMs: firstToolCallAt
      ? Math.round(firstToolCallAt - promptSentAt)
      : null,
    firstAudioMs: Math.round(firstAudioAt - promptSentAt),
    ...(verifyConversation
      ? {
          secondTurn: secondCaption,
          secondCaptionMs: Math.round(secondToolCallAt - followupSentAt),
          secondAudioMs: Math.round(secondAudioAt - followupSentAt),
        }
      : {}),
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(timeout);
  expectedClose = true;
  session?.close();
}
