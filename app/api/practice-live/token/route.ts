import { GoogleGenAI } from "@google/genai";
import {
  buildLiveConnectConfig,
  buildLiveTokenConstraintConfig,
  LIVE_MODEL,
} from "../../../practice-live/live-config";
import { getLiveScenario } from "../../../practice-live/live-scenarios";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return json(
      {
        code: "missing_api_key",
        message:
          "Add GEMINI_API_KEY to .env.local, then restart the local server.",
      },
      503,
    );
  }

  let scenarioId: unknown;
  try {
    ({ scenarioId } = (await request.json()) as { scenarioId?: unknown });
  } catch {
    return json(
      {
        code: "invalid_request",
        message: "Choose a practice situation and try again.",
      },
      400,
    );
  }

  const scenario = getLiveScenario(scenarioId);
  if (!scenario) {
    return json(
      {
        code: "invalid_scenario",
        message: "That practice situation is not available.",
      },
      400,
    );
  }

  const config = buildLiveConnectConfig(scenario);
  const tokenConstraintConfig = buildLiveTokenConstraintConfig(config);

  try {
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
    const newSessionExpiresAt = new Date(now + 2 * 60 * 1000).toISOString();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    const authToken = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: tokenConstraintConfig,
        },
        lockAdditionalFields: [],
      },
    });

    if (!authToken.name) {
      throw new Error("Gemini returned an empty ephemeral token.");
    }

    return json({
      token: authToken.name,
      model: LIVE_MODEL,
      config,
      openingCue: scenario.openingCue,
      expiresAt,
    });
  } catch (error) {
    console.error("Practice Live token creation failed", error);

    return json(
      {
        code: "token_error",
        message:
          "Gemini Live could not create a temporary session. Try again in a moment.",
      },
      502,
    );
  }
}
